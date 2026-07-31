import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const apartmentId = Number(id);
    if (!Number.isFinite(apartmentId)) {
      return NextResponse.json({ ok: false, error: "Invalid apartment lease details id." }, { status: 400 });
    }

    const { data: apartment, error: apartmentError } = await supabaseServer
      .from("apartment_lease_details")
      .select("address, unit")
      .eq("id", apartmentId)
      .maybeSingle();
    if (apartmentError) throw apartmentError;
    if (!apartment) {
      return NextResponse.json({ ok: false, error: "Apartment lease details row not found." }, { status: 404 });
    }

    const { data: uploads, error: uploadsError } = await supabaseServer
      .from("apartment_lease_pdf_uploads")
      .select("id, rentvine_file_id, file_name, uploaded_at")
      .eq("apartment_lease_details_id", apartmentId)
      .order("uploaded_at", { ascending: false });
    if (uploadsError) throw uploadsError;

    return NextResponse.json({ ok: true, apartment, uploads: uploads ?? [] });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
