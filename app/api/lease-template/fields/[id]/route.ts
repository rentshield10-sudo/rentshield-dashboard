import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const body = await request.json();

    const patch: Record<string, unknown> = {};
    for (const key of ["x", "y", "width", "height"] as const) {
      if (body?.[key] !== undefined) {
        const n = Number(body[key]);
        if (!Number.isFinite(n)) {
          return NextResponse.json({ ok: false, error: `${key} must be a number.` }, { status: 400 });
        }
        patch[key] = n;
      }
    }
    if (body?.label !== undefined) patch.label = String(body.label).trim();
    if (body?.fieldType !== undefined) {
      if (!["text", "date", "signature"].includes(body.fieldType)) {
        return NextResponse.json(
          { ok: false, error: "fieldType must be text, date, or signature." },
          { status: 400 },
        );
      }
      patch.field_type = body.fieldType;
    }

    const { data, error } = await supabaseServer
      .from("lease_template_fields")
      .update(patch)
      .eq("id", id)
      .select("id, page_number, x, y, width, height, label, field_type, created_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, field: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const { error } = await supabaseServer.from("lease_template_fields").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
