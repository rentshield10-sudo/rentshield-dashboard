import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const { data, error } = await supabaseServer
      .from("lease_template_filled_values")
      .select("field_id, value")
      .eq("draft_id", id);

    if (error) throw error;

    return NextResponse.json({ ok: true, values: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const body = await request.json();
    const fieldId = Number(body?.fieldId);
    const value = String(body?.value ?? "");

    if (!Number.isFinite(fieldId)) {
      return NextResponse.json({ ok: false, error: "fieldId must be a number." }, { status: 400 });
    }

    const { error } = await supabaseServer.from("lease_template_filled_values").upsert(
      { draft_id: Number(id), field_id: fieldId, value, updated_at: new Date().toISOString() },
      { onConflict: "draft_id,field_id" },
    );

    if (error) throw error;

    await supabaseServer
      .from("lease_template_drafts")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
