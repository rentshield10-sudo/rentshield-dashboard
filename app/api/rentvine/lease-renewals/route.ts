import { NextResponse } from "next/server";
import { fetchRentvineRenewals } from "@/lib/rentvine";

export async function GET() {
  try {
    const renewals = await fetchRentvineRenewals();
    return NextResponse.json({ ok: true, renewals, total: renewals.length });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
