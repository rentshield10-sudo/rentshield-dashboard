import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { findSigningRequestByToken, isExpired } from "@/lib/signing";
import { generateOtpCode, sha256Hex } from "@/lib/crypto-utils";
import { logAuditEvent, getRequestMeta } from "@/lib/audit";
import { isRateLimited } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { safeErrorResponse } from "@/lib/errors";

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

    const isDev = process.env.NODE_ENV !== "production";
    let emailSent = false;

    try {
      await sendEmail({
        to: signingRequest.tenant_email,
        subject: "Your verification code",
        html: `<p>Your verification code is: <b style="font-size:20px;">${code}</b></p><p>This code expires in 10 minutes.</p>`,
      });
      emailSent = true;
    } catch (emailError) {
      // In sandbox mode (no verified domain), Resend rejects sends to
      // arbitrary tenant addresses -- fall back to returning the code
      // directly, but ONLY in dev, so local testing keeps working.
      console.error("Failed to send verification code email:", emailError);
      if (!isDev) throw emailError;
    }

    return NextResponse.json({
      ok: true,
      emailSent,
      ...(isDev && !emailSent ? { devOnlyCode: code } : {}),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, ...safeErrorResponse(error, "send-code") }, { status: 500 });
  }
}
