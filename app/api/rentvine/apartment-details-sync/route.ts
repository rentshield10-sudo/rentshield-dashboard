import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { fetchAllApartmentDetails } from "@/lib/rentvine";

function toDateOrNull(value: string): string | null {
  return value ? value : null;
}

function toNumberOrNull(value: string): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function POST() {
  try {
    const rows = await fetchAllApartmentDetails();

    // Deduplicate by (address, unit). A unit can have more than one lease
    // record from Rentvine (e.g. a past tenant who moved out plus the
    // current tenant) sharing the same address+unit. Prefer the active
    // lease (isActive, from leaseStatusID) over a closed one — the renewal
    // date alone can't distinguish them, since a current lease with no
    // formal renewal yet has an empty expiration_2/activation_2 and would
    // otherwise lose to an older, closed lease that happens to have one.
    const deduped = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      const key = `${row.address}|${row.unit}`;
      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, row);
        continue;
      }

      if (row.isActive && !existing.isActive) {
        deduped.set(key, row);
        continue;
      }
      if (!row.isActive && existing.isActive) {
        continue;
      }

      // Both (or neither) active — keep the one with the more recent
      // expiration_2 (or activation_2 if no exp) as a secondary tie-breaker.
      const existingExp = existing.expiration2 || existing.activation2 || "";
      const newExp = row.expiration2 || row.activation2 || "";
      if (newExp > existingExp) {
        deduped.set(key, row);
      }
    }

    const upsertRows = Array.from(deduped.values()).map((r) => ({
      address: r.address,
      unit: r.unit,
      tenant_name: r.tenantName || null,
      activation_1: toDateOrNull(r.activation1),
      expiration_1: toDateOrNull(r.expiration1),
      activation_2: toDateOrNull(r.activation2),
      expiration_2: toDateOrNull(r.expiration2),
      current_rent: toNumberOrNull(r.currentRent),
      security_deposit: toNumberOrNull(r.securityDeposit),
      notes: r.notes || null,
      rentvine_lease_id: r.rentvineLeaseId || null,
      rentvine_unit_id: r.rentvineUnitId || null,
      rentvine_lease_renewal_id: r.rentvineLeaseRenewalId || null,
      source: "rentvine",
      updated_at: new Date().toISOString(),
    }));

    if (upsertRows.length === 0) {
      return NextResponse.json({ ok: true, synced: 0 });
    }

    const { error } = await supabaseServer
      .from("apartment_lease_details")
      .upsert(upsertRows, { onConflict: "address,unit" });

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
