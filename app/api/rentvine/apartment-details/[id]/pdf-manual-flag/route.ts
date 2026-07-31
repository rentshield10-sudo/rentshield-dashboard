import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

// Staff-set override for leases where a PDF already sits in Rentvine but
// the filename-matching heuristic (see lib/rentvine.ts matchLeasePdfFile)
// didn't catch it -- there's no reliable way to detect this from Rentvine's
// API, so it has to be told to us.
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const body = await request.json();
    const flag = body?.flag === true;

    const { data, error } = await supabaseServer
      .from("apartment_lease_details")
      .update({ pdf_manual_flag: flag, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, pdf_manual_flag")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, row: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
