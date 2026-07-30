import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { findParticipantByToken, isParticipantExpired } from "@/lib/signing";
import { sha256Hex, timingSafeEqualHex } from "@/lib/crypto-utils";
import { logAuditEvent, getRequestMeta } from "@/lib/audit";
import { isRateLimited } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/errors";

const MAX_FAILED_ATTEMPTS = 5;

async function getParams(context: { params: Promise<{ token: string }> | { token: string } }) {
  return await context.params;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> | { token: string } },
) {
  try {
    const { token } = await getParams(context);
    const { ipAddress, userAgent } = getRequestMeta(request);

    if (isRateLimited(`verify-code:${ipAddress ?? "unknown"}`, 20, 15 * 60 * 1000)) {
      return NextResponse.json({ ok: false, error: "Too many requests. Try again later." }, { status: 429 });
    }

    const body = await request.json();
    const code = String(body?.code ?? "").trim();

    const found = await findParticipantByToken(token);
    if (!found) {
      return NextResponse.json({ ok: false, error: "This signing link is invalid." }, { status: 404 });
    }
    const { participant, envelope } = found;

    if (
      isParticipantExpired(participant) ||
      ["declined", "signed"].includes(participant.status) ||
      envelope.status === "revoked"
    ) {
      return NextResponse.json({ ok: false, error: "This signing link is no longer active." }, { status: 410 });
    }

    const { data: activeCode, error: findError } = await supabaseServer
      .from("participant_verification_codes")
      .select("id, code_hash, expires_at, failed_attempts, used_at")
      .eq("participant_id", participant.id)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (findError) throw findError;

    if (!activeCode || new Date(activeCode.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ ok: false, error: "No active code. Request a new one." }, { status: 400 });
    }

    if (activeCode.failed_attempts >= MAX_FAILED_ATTEMPTS) {
      return NextResponse.json(
        { ok: false, error: "Too many incorrect attempts. Request a new code." },
        { status: 429 },
      );
    }

    if (!/^\d{6}$/.test(code) || !timingSafeEqualHex(sha256Hex(code), activeCode.code_hash)) {
      const failedAttempts = activeCode.failed_attempts + 1;
      await supabaseServer
        .from("participant_verification_codes")
        .update({ failed_attempts: failedAttempts })
        .eq("id", activeCode.id);

      await logAuditEvent({
        signingRequestId: envelope.id,
        documentId: envelope.document_id,
        participantId: participant.id,
        eventType: "failed_verification_attempt",
        metadata: { attemptNumber: failedAttempts },
        ipAddress,
        userAgent,
      });

      return NextResponse.json(
        { ok: false, error: `Incorrect code. ${MAX_FAILED_ATTEMPTS - failedAttempts} attempt(s) remaining.` },
        { status: 401 },
      );
    }

    const now = new Date().toISOString();
    await supabaseServer.from("participant_verification_codes").update({ used_at: now }).eq("id", activeCode.id);
    await supabaseServer
      .from("signing_participants")
      .update({ status: "verified", verified_at: now, updated_at: now })
      .eq("id", participant.id);

    await logAuditEvent({
      signingRequestId: envelope.id,
      documentId: envelope.document_id,
      participantId: participant.id,
      eventType: "email_verified",
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, ...safeErrorResponse(error, "verify-code") }, { status: 500 });
  }
}
