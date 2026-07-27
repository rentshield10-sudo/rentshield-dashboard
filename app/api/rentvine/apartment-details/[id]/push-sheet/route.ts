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
      .select("address, unit, activation_2, expiration_2")
      .eq("id", id)
      .single();

    if (fetchError) throw fetchError;
    if (!row) {
      return NextResponse.json(
        { ok: false, error: `No apartment_lease_details row with id ${id}` },
        { status: 404 },
      );
    }

    const n8nRes = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        address: row.address,
        unit: row.unit,
        activation2: row.activation_2,
        expiration2: row.expiration_2,
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
