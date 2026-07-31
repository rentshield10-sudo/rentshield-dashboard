import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from("apartment_lease_details")
      .select(
        "id, address, unit, city, tenant_name, activation_1, expiration_1, activation_2, expiration_2, new_rent, current_rent, security_deposit, lease_status, notes, lease_sent, lease_sent_date, link, rentvine_lease_id, rentvine_unit_id, rentvine_lease_renewal_id, rentvine_file_matched, rentvine_file_title, rentvine_file_checked_at, pdf_manual_flag, uploaded_via_mission_control_at, uploaded_via_mission_control_file_id, pdf_saved_status, pdf_saved_at, source, updated_at",
      )
      .order("address", { ascending: true })
      .order("unit", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ ok: true, rows: data || [], total: (data || []).length });
  } catch (error) {
    const err = error as { message?: string; code?: string; details?: string; hint?: string };
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || String(error),
        detail: { code: err?.code, details: err?.details, hint: err?.hint },
      },
      { status: 500 },
    );
  }
}
