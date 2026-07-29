import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getRentvineLeaseSnapshot, findRentvineRentCharge } from "@/lib/rentvine";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);

    const { data: row, error: fetchError } = await supabaseServer
      .from("apartment_lease_details")
      .select("activation_1, expiration_1, current_rent, rentvine_lease_id")
      .eq("id", id)
      .single();

    if (fetchError) throw fetchError;
    if (!row) {
      return NextResponse.json(
        { ok: false, error: `No apartment_lease_details row with id ${id}` },
        { status: 404 },
      );
    }

    if (!row.rentvine_lease_id) {
      return NextResponse.json(
        { ok: false, error: "No Rentvine lease is linked to this row." },
        { status: 400 },
      );
    }

    const [leaseSnapshot, rentLookup] = await Promise.all([
      getRentvineLeaseSnapshot(row.rentvine_lease_id),
      findRentvineRentCharge(row.rentvine_lease_id),
    ]);

    return NextResponse.json({
      ok: true,
      current: {
        startDate: leaseSnapshot.startDate,
        endDate: leaseSnapshot.endDate,
        rent: rentLookup.status === "found" ? rentLookup.charge.amount : null,
      },
      next: {
        startDate: row.activation_1,
        endDate: row.expiration_1,
        rent: row.current_rent !== null ? String(row.current_rent) : null,
      },
      rentLookupStatus: rentLookup.status,
    });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json(
      { ok: false, error: err?.message || String(error) },
      { status: 500 },
    );
  }
}
