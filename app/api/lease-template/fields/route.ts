import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from("lease_template_fields")
      .select("id, page_number, x, y, width, height, label, field_type, created_at")
      .order("id", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ ok: true, fields: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const pageNumber = Number(body?.pageNumber ?? 1);
    const x = Number(body?.x);
    const y = Number(body?.y);
    const width = Number(body?.width);
    const height = Number(body?.height);
    const label = String(body?.label ?? "").trim();
    const fieldType = String(body?.fieldType ?? "text");

    if (!label) {
      return NextResponse.json({ ok: false, error: "label is required." }, { status: 400 });
    }
    if (![x, y, width, height].every(Number.isFinite)) {
      return NextResponse.json(
        { ok: false, error: "x, y, width, height must be numbers." },
        { status: 400 },
      );
    }
    if (!["text", "date", "signature"].includes(fieldType)) {
      return NextResponse.json(
        { ok: false, error: "fieldType must be text, date, or signature." },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseServer
      .from("lease_template_fields")
      .insert({ page_number: pageNumber, x, y, width, height, label, field_type: fieldType })
      .select("id, page_number, x, y, width, height, label, field_type, created_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, field: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
