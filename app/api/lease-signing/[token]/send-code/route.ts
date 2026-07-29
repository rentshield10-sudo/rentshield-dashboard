import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { findSigningRequestByToken, isExpired } from "@/lib/signing";
import { generateOtpCode, sha256Hex } from "@/lib/crypto-utils";
import { logAuditEvent, getRequestMeta } from "@/lib/audit";
import { isRateLimited } from "@/lib/rate-limit";

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // 1 minute between resend requests

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

    if (isRateLimited(`send-code:${ipAddress ?? "unknown"}`, 10, 15 * 60 * 1000)) {
      return NextResponse.json({ ok: false, error: "Too many requests. Try again later." }, { status: 429 });
    }

    const signingRequest = await findSigningRequestByToken(token);
    if (!signingRequest) {
      return NextResponse.json({ ok: false, error: "This signing link is invalid." }, { status: 404 });
    }
    if (isExpired(signingRequest) || ["expired", "revoked", "completed"].includes(signingRequest.status)) {
      return NextResponse.json(
        { ok: false, error: "This signing link is no longer active." },
        { status: 410 },
      );
    }

    const { data: recent, error: recentError } = await supabaseServer
      .from("verification_codes")
      .select("created_at")
      .eq("signing_request_id", signingRequest.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentError) throw recentError;

    if (recent && Date.now() - new Date(recent.created_at).getTime() < RESEND_COOLDOWN_MS) {
      return NextResponse.json(
        { ok: false, error: "Please wait a moment before requesting another code." },
        { status: 429 },
      );
    }

    const code = generateOtpCode();
    const codeHash = sha256Hex(code);
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();

    const { error: insertError } = await supabaseServer.from("verification_codes").insert({
      signing_request_id: signingRequest.id,
      code_hash: codeHash,
      expires_at: expiresAt,
    });
    if (insertError) throw insertError;

    await logAuditEvent({
      signingRequestId: signingRequest.id,
      documentId: signingRequest.document_id,
      eventType: "verification_code_requested",
      ipAddress,
      userAgent,
    });

    // Email delivery is not wired up yet (deferred). For local testing only,
    // the code is returned directly here instead of being emailed — this
    // MUST be removed/gated before any real deployment, since it defeats
    // the whole point of email-based verification.
    const isDev = process.env.NODE_ENV !== "production";

    return NextResponse.json({
      ok: true,
      ...(isDev ? { devOnlyCode: code } : {}),
    });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
