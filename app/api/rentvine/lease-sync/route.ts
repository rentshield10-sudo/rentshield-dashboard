import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { fetchRentvineRenewals } from "@/lib/rentvine";

function toNumberOrNull(value: string): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function POST() {
  try {
    const rows = await fetchRentvineRenewals();

    const upsertRows = rows.map((r) => ({
      lease_id: r.leaseID,
      source: r.source,
      tenants: r.tenants,
      address: r.address,
      unit: r.unit,
      city: r.city,
      state: r.state,
      portfolio: r.portfolio,
      lease_status: r.leaseStatus,
      lease_end: r.leaseEnd || null,
      current_rent: toNumberOrNull(r.currentRent),
      current_balance: toNumberOrNull(r.currentBalance),
      overdue_balance: toNumberOrNull(r.overdueBalance),
      has_overdue_balance: r.hasOverdueBalance,
      synced_at: new Date().toISOString(),
    }));

    if (upsertRows.length === 0) {
      return NextResponse.json({ ok: true, synced: 0 });
    }

    const { error } = await supabaseServer
      .from("lease_renewals")
      .upsert(upsertRows, { onConflict: "lease_id" });

    if (error) throw error;

    return NextResponse.json({ ok: true, synced: upsertRows.length });
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
