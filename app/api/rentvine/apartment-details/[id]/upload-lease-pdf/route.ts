import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { renderCombinedLeasePdf } from "@/lib/pdf-generation";
import { substituteVariables } from "@/lib/template-vars";
import { uploadFileToRentvineLease } from "@/lib/rentvine";
import { getOrCreateDraftForApartment, deriveSignatureParticipants } from "@/lib/lease-draft";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

// Pushes the current draft's filled-in lease PDF to Rentvine, attached to
// the row's linked lease (objectTypeID 4 = Lease, per Rentvine's Object
// Types table -- confirmed working via POST, unlike PATCH/PUT on this
// account). On success this is the one 100%-certain "has a PDF" signal we
// can record, since we're the one making the call.
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const apartmentId = Number(id);
    if (!Number.isFinite(apartmentId)) {
      return NextResponse.json({ ok: false, error: "Invalid apartment lease details id." }, { status: 400 });
    }

    const { data: row, error: rowError } = await supabaseServer
      .from("apartment_lease_details")
      .select("address, unit, rentvine_lease_id")
      .eq("id", apartmentId)
      .maybeSingle();
    if (rowError) throw rowError;
    if (!row) {
      return NextResponse.json({ ok: false, error: "Apartment lease details row not found." }, { status: 404 });
    }
    if (!row.rentvine_lease_id) {
      return NextResponse.json(
        { ok: false, error: "This row has no linked Rentvine lease to upload to." },
        { status: 400 },
      );
    }

    const draftId = await getOrCreateDraftForApartment(apartmentId);

    const { data: template, error: templateError } = await supabaseServer
      .from("lease_templates")
      .select("body")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (templateError) throw templateError;
    if (!template?.body) {
      return NextResponse.json({ ok: false, error: "No lease template has been saved yet." }, { status: 400 });
    }

    const { data: draftValues, error: valuesError } = await supabaseServer
      .from("lease_template_draft_values")
      .select("variable_name, value")
      .eq("draft_id", draftId);
    if (valuesError) throw valuesError;

    const valuesMap: Record<string, string> = {};
    for (const v of draftValues ?? []) valuesMap[v.variable_name] = v.value;

    const filledText = substituteVariables(template.body, valuesMap);
    const pdfBytes = await renderCombinedLeasePdf(filledText, deriveSignatureParticipants(valuesMap));
    const pdfBuffer = Buffer.from(pdfBytes);

    const year = new Date().getFullYear();
    const fileName = `${row.address}${row.unit ? ` - ${row.unit}` : ""} - Lease Agreement ${year}.pdf`;

    const { fileId } = await uploadFileToRentvineLease(row.rentvine_lease_id, pdfBuffer, fileName);

    const now = new Date().toISOString();
    // Keeps a permanent record of every upload (never overwritten) in
    // addition to updating the "latest" summary columns below.
    const { error: historyError } = await supabaseServer.from("apartment_lease_pdf_uploads").insert({
      apartment_lease_details_id: apartmentId,
      rentvine_file_id: fileId,
      file_name: fileName,
      uploaded_at: now,
    });
    if (historyError) throw historyError;

    const { error: updateError } = await supabaseServer
      .from("apartment_lease_details")
      .update({
        uploaded_via_mission_control_at: now,
        uploaded_via_mission_control_file_id: fileId,
        rentvine_file_matched: true,
        rentvine_file_title: fileName,
        rentvine_file_checked_at: now,
        updated_at: now,
      })
      .eq("id", apartmentId);
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true, fileId });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
