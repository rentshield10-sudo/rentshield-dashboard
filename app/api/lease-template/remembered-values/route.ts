import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const label = String(body?.label ?? "").trim();
    const value = String(body?.value ?? "").trim();

    if (!label || !value) {
      return NextResponse.json({ ok: false, error: "label and value are required." }, { status: 400 });
    }

    const { data: existing, error: findError } = await supabaseServer
      .from("lease_template_remembered_values")
      .select("id")
      .eq("label", label)
      .eq("value", value)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      const { error } = await supabaseServer
        .from("lease_template_remembered_values")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabaseServer.from("lease_template_remembered_values").insert({ label, value });
      if (error) throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
