import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { downloadFile, uploadFile, getSignedDownloadUrl } from "@/lib/storage";
import { stampCompletedPdf, type AuditEventSummary } from "@/lib/pdf-generation";
import { sha256Hex } from "@/lib/crypto-utils";
import { findSigningRequestByToken, isExpired } from "@/lib/signing";
import { logAuditEvent, getRequestMeta } from "@/lib/audit";
import { isRateLimited } from "@/lib/rate-limit";

const CONSENT_TEXT_1 =
  "I consent to use electronic records and electronic signatures for this renewal agreement.";
const CONSENT_TEXT_2 =
  "I confirm that I have reviewed and agree to the terms of this renewal agreement.";
const CONSENT_VERSION = 1;

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

    if (isRateLimited(`sign:${ipAddress ?? "unknown"}`, 10, 60 * 60 * 1000)) {
      return NextResponse.json({ ok: false, error: "Too many requests. Try again later." }, { status: 429 });
    }

    const body = await request.json();

    const consentAccepted1 = body?.consentAccepted1 === true;
    const consentAccepted2 = body?.consentAccepted2 === true;
    const signatureType = body?.signatureType === "drawn" ? "drawn" : "typed";
    const typedName = signatureType === "typed" ? String(body?.typedName ?? "").trim() : "";
    const signatureDataUrl =
      signatureType === "drawn" ? String(body?.signatureDataUrl ?? "") : "";

    // ── Server-side validation. Never trust the frontend for any of this. ──
    if (!consentAccepted1 || !consentAccepted2) {
      return NextResponse.json({ ok: false, error: "Both consent statements must be accepted." }, { status: 400 });
    }
    if (signatureType === "typed" && !typedName) {
      return NextResponse.json({ ok: false, error: "A typed signature name is required." }, { status: 400 });
    }
    if (signatureType === "drawn" && !signatureDataUrl.startsWith("data:image/png;base64,")) {
      return NextResponse.json({ ok: false, error: "A drawn signature is required." }, { status: 400 });
    }

    const signingRequest = await findSigningRequestByToken(token);
    if (!signingRequest) {
      await logAuditEvent({ eventType: "invalid_signing_link_attempt", ipAddress, userAgent });
      return NextResponse.json({ ok: false, error: "This signing link is invalid." }, { status: 404 });
    }
    if (isExpired(signingRequest) || ["expired", "revoked", "completed"].includes(signingRequest.status)) {
      return NextResponse.json({ ok: false, error: "This signing link is no longer active." }, { status: 410 });
    }
    if (!signingRequest.verified_at) {
      return NextResponse.json(
        { ok: false, error: "Email verification must be completed before signing." },
        { status: 400 },
      );
    }
    if (!signingRequest.original_pdf_path || !signingRequest.original_pdf_hash) {
      return NextResponse.json({ ok: false, error: "No original document is attached to this request." }, { status: 400 });
    }

    // Document integrity: confirm the stored original hasn't changed since
    // this signing request was created.
    const originalBytes = await downloadFile(signingRequest.original_pdf_path);
    const currentHash = sha256Hex(originalBytes);
    if (currentHash !== signingRequest.original_pdf_hash) {
      return NextResponse.json(
        { ok: false, error: "Document integrity check failed. Please contact the property manager." },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();

    // Atomic status transition: only proceeds if still in a pre-signed
    // state. If two submissions race, only one succeeds here — the other
    // gets 0 affected rows and is rejected as a duplicate.
    const { data: transitioned, error: transitionError } = await supabaseServer
      .from("signing_requests")
      .update({ status: "signed", consented_at: now, signed_at: now, updated_at: now })
      .eq("id", signingRequest.id)
      .in("status", ["opened", "verified"])
      .select("id");
    if (transitionError) throw transitionError;

    if (!transitioned || transitioned.length === 0) {
      return NextResponse.json(
        { ok: false, error: "This agreement has already been signed or is not ready to sign." },
        { status: 409 },
      );
    }

    await supabaseServer.from("signature_records").insert({
      signing_request_id: signingRequest.id,
      signature_type: signatureType,
      typed_name: signatureType === "typed" ? typedName : null,
      signature_data: signatureType === "drawn" ? signatureDataUrl : null,
      consent_text_1: CONSENT_TEXT_1,
      consent_text_2: CONSENT_TEXT_2,
      consent_version: CONSENT_VERSION,
      consented_at: now,
      signed_at: now,
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    await logAuditEvent({
      signingRequestId: signingRequest.id,
      documentId: signingRequest.document_id,
      eventType: "consent_accepted",
      metadata: { consentVersion: CONSENT_VERSION },
      ipAddress,
      userAgent,
    });
    await logAuditEvent({
      signingRequestId: signingRequest.id,
      documentId: signingRequest.document_id,
      eventType: "signature_submitted",
      metadata: { signatureType },
      ipAddress,
      userAgent,
    });

    // ── Fetch context for the completion certificate ──
    const { data: draft } = await supabaseServer
      .from("lease_template_drafts")
      .select("apartment_lease_details_id")
      .eq("id", signingRequest.draft_id)
      .maybeSingle();

    let propertyAddress = "N/A";
    if (draft?.apartment_lease_details_id) {
      const { data: apartment } = await supabaseServer
        .from("apartment_lease_details")
        .select("address, unit")
        .eq("id", draft.apartment_lease_details_id)
        .maybeSingle();
      if (apartment) {
        propertyAddress = [apartment.address, apartment.unit].filter(Boolean).join(" ");
      }
    }

    const { data: auditRows } = await supabaseServer
      .from("audit_events")
      .select("event_type, created_at")
      .eq("signing_request_id", signingRequest.id)
      .order("created_at", { ascending: true });

    const auditEvents: AuditEventSummary[] = (auditRows ?? []).map((row) => ({
      eventType: row.event_type,
      createdAt: row.created_at,
    }));

    const completedBytes = await stampCompletedPdf(originalBytes, {
      documentId: signingRequest.document_id,
      documentTitle: "Lease Renewal Agreement",
      tenantName: signingRequest.tenant_name || typedName || "Tenant",
      tenantEmail: signingRequest.tenant_email,
      propertyAddress,
      signatureType,
      typedName,
      signatureDataUrl,
      consentText1: CONSENT_TEXT_1,
      consentText2: CONSENT_TEXT_2,
      consentVersion: CONSENT_VERSION,
      openedAt: signingRequest.opened_at,
      verifiedAt: signingRequest.verified_at,
      consentedAt: now,
      signedAt: now,
      ipAddress,
      originalPdfHash: signingRequest.original_pdf_hash,
      auditEvents,
    });

    const completedBuffer = Buffer.from(completedBytes);
    const completedPdfHash = sha256Hex(completedBuffer);
    const completedPdfPath = `completed/${signingRequest.document_id}.pdf`;
    await uploadFile(completedPdfPath, completedBuffer, "application/pdf");

    const completedAt = new Date().toISOString();
    await supabaseServer
      .from("signing_requests")
      .update({
        status: "completed",
        completed_pdf_path: completedPdfPath,
        completed_pdf_hash: completedPdfHash,
        completed_at: completedAt,
        updated_at: completedAt,
      })
      .eq("id", signingRequest.id);

    await logAuditEvent({
      signingRequestId: signingRequest.id,
      documentId: signingRequest.document_id,
      eventType: "agreement_completed",
      ipAddress,
      userAgent,
    });

    const completedPdfUrl = await getSignedDownloadUrl(completedPdfPath, 3600);

    return NextResponse.json({ ok: true, documentId: signingRequest.document_id, completedPdfUrl });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
