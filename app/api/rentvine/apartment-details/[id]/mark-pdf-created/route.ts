import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

// Marks the "staff filled in the data and saved it" milestone -- the step
// before an approver reviews the draft and it goes out to the client for
// signature (those later steps aren't built yet). Surfaced in the
// Rentvine tab's existing Lease PDF column.
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const now = new Date().toISOString();

    const { data, error } = await supabaseServer
      .from("apartment_lease_details")
      .update({ pdf_saved_status: "pdf_created", pdf_saved_at: now, updated_at: now })
      .eq("id", id)
      .select("id, pdf_saved_status, pdf_saved_at")
      .single();

    if (error) throw error;

    return NextResponse.json({ ok: true, row: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
