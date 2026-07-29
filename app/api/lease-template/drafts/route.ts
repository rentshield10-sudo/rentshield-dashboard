import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const apartmentLeaseDetailsId = body?.apartmentLeaseDetailsId ?? null;

    const { data, error } = await supabaseServer
      .from("lease_template_drafts")
      .insert({ apartment_lease_details_id: apartmentLeaseDetailsId })
      .select("id, apartment_lease_details_id, created_at, updated_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, draft: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
