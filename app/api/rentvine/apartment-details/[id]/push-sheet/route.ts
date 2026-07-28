import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);

    const webhookUrl = process.env.N8N_APARTMENT_SHEET_WEBHOOK_URL;
    if (!webhookUrl) {
      return NextResponse.json(
        { ok: false, error: "Missing env var: N8N_APARTMENT_SHEET_WEBHOOK_URL" },
        { status: 500 },
      );
    }

    const { data: row, error: fetchError } = await supabaseServer
      .from("apartment_lease_details")
      .select("address, unit, activation_1, expiration_1, activation_2, expiration_2, current_rent")
      .eq("id", id)
      .single();

    if (fetchError) throw fetchError;
    if (!row) {
      return NextResponse.json(
        { ok: false, error: `No apartment_lease_details row with id ${id}` },
        { status: 404 },
      );
    }

    const cells: Record<string, string> = {};
    if (row.activation_1) cells.D = row.activation_1;
    if (row.expiration_1) cells.E = row.expiration_1;
    if (row.activation_2) cells.F = row.activation_2;
    if (row.expiration_2) cells.G = row.expiration_2;
    if (row.current_rent !== null) cells.I = String(row.current_rent);

    const n8nRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: row.address,
        unit: row.unit,
        cells,
      }),
    });

    const n8nText = await n8nRes.text();
    let n8nJson: unknown;
    try {
      n8nJson = JSON.parse(n8nText);
    } catch {
      n8nJson = { raw: n8nText };
    }

    if (!n8nRes.ok) {
      return NextResponse.json(
        { ok: false, error: `n8n webhook returned ${n8nRes.status}`, detail: n8nJson },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, n8nResponse: n8nJson });
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
