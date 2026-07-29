import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getSignedDownloadUrl } from "@/lib/storage";
import { findSigningRequestByToken, isExpired } from "@/lib/signing";
import { logAuditEvent, getRequestMeta } from "@/lib/audit";

async function getParams(context: { params: Promise<{ token: string }> | { token: string } }) {
  return await context.params;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ token: string }> | { token: string } },
) {
  try {
    const { token } = await getParams(context);
    const { ipAddress, userAgent } = getRequestMeta(request);

    const signingRequest = await findSigningRequestByToken(token);

    if (!signingRequest) {
      await logAuditEvent({
        eventType: "invalid_signing_link_attempt",
        ipAddress,
        userAgent,
      });
      return NextResponse.json({ ok: false, error: "This signing link is invalid." }, { status: 404 });
    }

    if (signingRequest.status === "revoked") {
      return NextResponse.json({ ok: false, error: "This signing link has been revoked." }, { status: 410 });
    }
    if (signingRequest.status === "completed") {
      return NextResponse.json(
        { ok: false, error: "This agreement has already been signed." },
        { status: 409 },
      );
    }
    if (isExpired(signingRequest) || signingRequest.status === "expired") {
      if (signingRequest.status !== "expired") {
        await supabaseServer
          .from("signing_requests")
          .update({ status: "expired", updated_at: new Date().toISOString() })
          .eq("id", signingRequest.id);
        await logAuditEvent({
          signingRequestId: signingRequest.id,
          documentId: signingRequest.document_id,
          eventType: "signing_request_expired",
          ipAddress,
          userAgent,
        });
      }
      return NextResponse.json({ ok: false, error: "This signing link has expired." }, { status: 410 });
    }

    if (signingRequest.status === "sent") {
      await supabaseServer
        .from("signing_requests")
        .update({ status: "opened", opened_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", signingRequest.id);
      await logAuditEvent({
        signingRequestId: signingRequest.id,
        documentId: signingRequest.document_id,
        eventType: "signing_link_opened",
        ipAddress,
        userAgent,
      });
    }

    const originalPdfUrl = signingRequest.original_pdf_path
      ? await getSignedDownloadUrl(signingRequest.original_pdf_path, 600)
      : null;

    return NextResponse.json({
      ok: true,
      documentId: signingRequest.document_id,
      tenantName: signingRequest.tenant_name,
      tenantEmail: signingRequest.tenant_email,
      status: signingRequest.status === "sent" ? "opened" : signingRequest.status,
      originalPdfUrl,
      expiresAt: signingRequest.expires_at,
      verifiedAt: signingRequest.verified_at,
      consentedAt: signingRequest.consented_at,
    });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
