import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

function toDateOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const body = await request.json();

    const activation1 = toDateOrNull(body?.activation1);
    const expiration1 = toDateOrNull(body?.expiration1);
    const activation2 = toDateOrNull(body?.activation2);
    const expiration2 = toDateOrNull(body?.expiration2);
    const currentRent = toNumberOrNull(body?.currentRent);
    const notes = body?.notes !== undefined ? String(body.notes).trim() || null : null;

    const { data, error } = await supabaseServer
      .from("apartment_lease_details")
      .update({
        activation_1: activation1,
        expiration_1: expiration1,
        activation_2: activation2,
        expiration_2: expiration2,
        current_rent: currentRent,
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(
        "id, address, unit, activation_1, expiration_1, activation_2, expiration_2, current_rent, notes, updated_at",
      )
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, row: data });
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
