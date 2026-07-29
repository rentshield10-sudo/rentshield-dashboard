import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { logAuditEvent, getRequestMeta } from "@/lib/audit";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);
    const { ipAddress, userAgent } = getRequestMeta(request);

    const now = new Date().toISOString();

    // Only revoke from a non-terminal state — a completed/expired/already-
    // revoked request has nothing meaningful to revoke.
    const { data: updated, error } = await supabaseServer
      .from("signing_requests")
      .update({ status: "revoked", revoked_at: now, updated_at: now })
      .eq("id", id)
      .not("status", "in", "(completed,revoked,expired,declined)")
      .select("id, document_id");

    if (error) throw error;

    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { ok: false, error: "This signing request cannot be revoked (already completed/expired/revoked)." },
        { status: 409 },
      );
    }

    await logAuditEvent({
      signingRequestId: Number(id),
      documentId: updated[0].document_id,
      eventType: "signing_request_revoked",
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
