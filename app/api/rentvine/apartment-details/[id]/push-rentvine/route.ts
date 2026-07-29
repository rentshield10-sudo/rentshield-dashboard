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
      .select("address, unit, activation_2, expiration_2, rentvine_lease_id, rentvine_lease_renewal_id")
      .eq("id", id)
      .single();

    if (fetchError) throw fetchError;
    if (!row) {
      return NextResponse.json(
        { ok: false, error: `No apartment_lease_details row with id ${id}` },
        { status: 404 },
      );
    }

    if (!row.activation_2 && !row.expiration_2) {
      return NextResponse.json(
        { ok: false, error: "Fill in Activation 2 and/or Expiration 2 before pushing to Rentvine." },
        { status: 400 },
      );
    }

    // Prefer the documented, schema-verified lease endpoint (POST
    // /leases/{leaseID} per Rentvine's published OpenAPI spec) over the
    // undocumented /leases/renewals/{id} path, which doesn't appear in that
    // spec at all and has no confirmed write support.
    if (row.rentvine_lease_id) {
      const rentvineResult = await updateRentvineLeaseFields(row.rentvine_lease_id, {
        startDate: row.activation_2 ?? undefined,
        endDate: row.expiration_2 ?? undefined,
      });
      return NextResponse.json({ ok: true, target: "lease", rentvineResponse: rentvineResult });
    }

    if (row.rentvine_lease_renewal_id) {
      const rentvineResult = await updateRentvineLeaseRenewalDates(row.rentvine_lease_renewal_id, {
        startDate: row.activation_2 ?? undefined,
        endDate: row.expiration_2 ?? undefined,
      });
      return NextResponse.json({ ok: true, target: "renewal", rentvineResponse: rentvineResult });
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
