import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { updateRentvineLeaseRenewalDates, updateRentvineLeaseFields } from "@/lib/rentvine";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);

    const { data: row, error: fetchError } = await supabaseServer
      .from("apartment_lease_details")
      .select(
        "address, unit, activation_2, expiration_2, current_rent, rentvine_lease_id, rentvine_lease_renewal_id",
      )
      .eq("id", id)
      .single();

    if (fetchError) throw fetchError;
    if (!row) {
      return NextResponse.json(
        { ok: false, error: `No apartment_lease_details row with id ${id}` },
        { status: 404 },
      );
    }

    if (!row.activation_2 || !row.expiration_2) {
      return NextResponse.json(
        { ok: false, error: "Both Activation 2 and Expiration 2 must be set before pushing to Rentvine." },
        { status: 400 },
      );
    }

    if (row.rentvine_lease_renewal_id) {
      const rentvineResult = await updateRentvineLeaseRenewalDates(row.rentvine_lease_renewal_id, {
        startDate: row.activation_2,
        endDate: row.expiration_2,
      });
      return NextResponse.json({ ok: true, target: "renewal", rentvineResponse: rentvineResult });
    }

    if (row.rentvine_lease_id) {
      const rentvineResult = await updateRentvineLeaseFields(row.rentvine_lease_id, {
        startDate: row.activation_2,
        endDate: row.expiration_2,
        currentRent: row.current_rent ?? undefined,
      });
      return NextResponse.json({ ok: true, target: "lease", rentvineResponse: rentvineResult });
    }

    return NextResponse.json(
      {
        ok: false,
        error: "No Rentvine lease or renewal record is linked to this row — cannot push.",
      },
      { status: 400 },
    );
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
