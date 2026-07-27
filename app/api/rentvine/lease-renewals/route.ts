import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

type StatusColor = "expired" | "expiring_soon" | "ok";

const EXPIRING_SOON_DAYS = 30;

function computeStatus(leaseEnd: string | null): {
  daysUntilEnd: number | null;
  statusColor: StatusColor;
} {
  if (!leaseEnd) return { daysUntilEnd: null, statusColor: "ok" };

  const end = new Date(leaseEnd);
  if (isNaN(end.getTime())) return { daysUntilEnd: null, statusColor: "ok" };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const msPerDay = 1000 * 60 * 60 * 24;
  const daysUntilEnd = Math.round((end.getTime() - today.getTime()) / msPerDay);

  let statusColor: StatusColor = "ok";
  if (daysUntilEnd < 0) statusColor = "expired";
  else if (daysUntilEnd <= EXPIRING_SOON_DAYS) statusColor = "expiring_soon";

  return { daysUntilEnd, statusColor };
}

export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from("lease_renewals")
      .select(
        "lease_id, source, tenants, address, unit, city, state, portfolio, lease_status, lease_end, current_rent, current_balance, overdue_balance, has_overdue_balance, synced_at",
      )
      .order("lease_end", { ascending: true });

    if (error) throw error;

    const renewals = (data || []).map((row) => {
      const { daysUntilEnd, statusColor } = computeStatus(row.lease_end);
      return {
        source: row.source as "renewal" | "expiring",
        leaseID: row.lease_id as string,
        tenants: (row.tenants as string[]) || [],
        address: (row.address as string) || "",
        unit: (row.unit as string) || "",
        city: (row.city as string) || "",
        state: (row.state as string) || "",
        portfolio: (row.portfolio as string) || "",
        leaseStatus: (row.lease_status as string) || "",
        leaseEnd: (row.lease_end as string) || "",
        daysUntilEnd: daysUntilEnd !== null ? String(daysUntilEnd) : null,
        currentRent: row.current_rent !== null ? String(row.current_rent) : "",
        currentBalance: row.current_balance !== null ? String(row.current_balance) : "0",
        overdueBalance: row.overdue_balance !== null ? String(row.overdue_balance) : "0",
        hasOverdueBalance: !!row.has_overdue_balance,
        statusColor,
      };
    });

    return NextResponse.json({ ok: true, renewals, total: renewals.length });
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
