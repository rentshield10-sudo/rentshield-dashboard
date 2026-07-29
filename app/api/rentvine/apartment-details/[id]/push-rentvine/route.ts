import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import {
  updateRentvineLeaseFields,
  findRentvineRentCharge,
  updateRentvineRecurringCharge,
} from "@/lib/rentvine";

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
      .select("address, unit, activation_1, expiration_1, current_rent, rentvine_lease_id")
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
        { ok: false, error: "No Rentvine lease is linked to this row — cannot push." },
        { status: 400 },
      );
    }

    const leaseResult = await updateRentvineLeaseFields(row.rentvine_lease_id, {
      startDate: row.activation_1 ?? undefined,
      endDate: row.expiration_1 ?? undefined,
    });

    let rentResult: unknown = null;
    let rentWarning: string | undefined;

    if (row.current_rent !== null) {
      const rentLookup = await findRentvineRentCharge(row.rentvine_lease_id);
      if (rentLookup.status === "found") {
        rentResult = await updateRentvineRecurringCharge(row.rentvine_lease_id, rentLookup.charge.chargeId, {
          amount: row.current_rent,
        });
      } else if (rentLookup.status === "not_found") {
        rentWarning = "No recurring charge matching 'rent' was found on this lease — rent was not pushed.";
      } else {
        rentWarning = `Multiple charges matched 'rent' (${rentLookup.candidates
          .map((c) => c.description)
          .join(", ")}) — rent was not pushed to avoid updating the wrong one.`;
      }
    }

    return NextResponse.json({
      ok: true,
      target: "lease",
      rentvineResponse: leaseResult,
      rentResponse: rentResult,
      rentWarning,
    });
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
