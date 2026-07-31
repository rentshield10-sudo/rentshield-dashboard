import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

// Returns a draft's metadata, including the apartment it's linked to (if
// any) -- used by the Lease Template tab to know whether it's editing a
// specific unit's draft (and what to show in the header) versus the
// standalone master-template editor.
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);

    const { data: draft, error: draftError } = await supabaseServer
      .from("lease_template_drafts")
      .select("id, apartment_lease_details_id")
      .eq("id", id)
      .maybeSingle();
    if (draftError) throw draftError;
    if (!draft) {
      return NextResponse.json({ ok: false, error: "Draft not found." }, { status: 404 });
    }

    let apartment: { id: number; address: string; unit: string } | null = null;
    if (draft.apartment_lease_details_id) {
      const { data: row, error: rowError } = await supabaseServer
        .from("apartment_lease_details")
        .select("id, address, unit")
        .eq("id", draft.apartment_lease_details_id)
        .maybeSingle();
      if (rowError) throw rowError;
      if (row) apartment = row;
    }

    return NextResponse.json({ ok: true, draft: { id: draft.id, apartment } });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
