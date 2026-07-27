import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

function toDateOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const body = await request.json();

    const activation2 = toDateOrNull(body?.activation2);
    const expiration2 = toDateOrNull(body?.expiration2);

    const { data, error } = await supabaseServer
      .from("apartment_lease_details")
      .update({
        activation_2: activation2,
        expiration_2: expiration2,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, address, unit, activation_2, expiration_2, updated_at")
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
