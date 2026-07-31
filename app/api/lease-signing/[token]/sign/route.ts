import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { downloadFile, uploadFile, getSignedDownloadUrl } from "@/lib/storage";
import { stampMultiPartyCompletedPdf, type AuditEventSummary, type ParticipantSignatureInfo } from "@/lib/pdf-generation";
import { sha256Hex } from "@/lib/crypto-utils";
import { findParticipantByToken, isParticipantExpired, findBlockingParticipant } from "@/lib/signing";
import { logAuditEvent, getRequestMeta } from "@/lib/audit";
import { isRateLimited } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email";
import { safeErrorResponse } from "@/lib/errors";

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
    const signatureDataUrl = signatureType === "drawn" ? String(body?.signatureDataUrl ?? "") : "";

    if (!consentAccepted1 || !consentAccepted2) {
      return NextResponse.json({ ok: false, error: "Both consent statements must be accepted." }, { status: 400 });
    }
    if (signatureType === "typed" && !typedName) {
      return NextResponse.json({ ok: false, error: "A typed signature name is required." }, { status: 400 });
    }
    if (signatureType === "drawn" && !signatureDataUrl.startsWith("data:image/png;base64,")) {
      return NextResponse.json({ ok: false, error: "A drawn signature is required." }, { status: 400 });
    }

    const found = await findParticipantByToken(token);
    if (!found) {
      await logAuditEvent({ eventType: "invalid_signing_link_attempt", ipAddress, userAgent });
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
    if (!participant.verified_at) {
      return NextResponse.json(
        { ok: false, error: "Email verification must be completed before signing." },
        { status: 400 },
      );
    }
    if (await findBlockingParticipant(participant)) {
      return NextResponse.json({ ok: false, error: "It's not your turn to sign yet." }, { status: 409 });
    }
    if (!envelope.original_pdf_path || !envelope.original_pdf_hash) {
      return NextResponse.json({ ok: false, error: "No original document is attached to this request." }, { status: 400 });
    }

    const originalBytes = await downloadFile(envelope.original_pdf_path);
    if (sha256Hex(originalBytes) !== envelope.original_pdf_hash) {
      return NextResponse.json(
        { ok: false, error: "Document integrity check failed. Please contact the property manager." },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();

    // Atomic per-participant transition: only proceeds from a pre-signed
    // state, so a race (double submission) only lets one through.
    const { data: transitioned, error: transitionError } = await supabaseServer
      .from("signing_participants")
      .update({ status: "signed", consented_at: now, signed_at: now, updated_at: now })
      .eq("id", participant.id)
      .in("status", ["opened", "verified"])
      .select("id");
    if (transitionError) throw transitionError;

    if (!transitioned || transitioned.length === 0) {
      return NextResponse.json(
        { ok: false, error: "This signing request has already been completed or is not ready to sign." },
        { status: 409 },
      );
    }

    await supabaseServer.from("participant_signatures").insert({
      participant_id: participant.id,
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
      signingRequestId: envelope.id,
      documentId: envelope.document_id,
      participantId: participant.id,
      eventType: "consent_accepted",
      metadata: { consentVersion: CONSENT_VERSION },
      ipAddress,
      userAgent,
    });
    await logAuditEvent({
      signingRequestId: envelope.id,
      documentId: envelope.document_id,
      participantId: participant.id,
      eventType: "signature_submitted",
      metadata: { signatureType, role: participant.role },
      ipAddress,
      userAgent,
    });

    // ── Check whether every participant on this envelope has now signed ──
    const { data: allParticipants, error: allParticipantsError } = await supabaseServer
      .from("signing_participants")
      .select("id, role, name, email, status, opened_at, verified_at, consented_at, signed_at")
      .eq("signing_request_id", envelope.id);
    if (allParticipantsError) throw allParticipantsError;

    const everyoneSigned = (allParticipants ?? []).every((p) => p.status === "signed");

    if (!everyoneSigned) {
      return NextResponse.json({ ok: true, documentId: envelope.document_id, waitingOnOthers: true });
    }

    // ── Everyone signed: build the completed PDF ──
    const participantIds = (allParticipants ?? []).map((p) => p.id);
    const { data: signatures, error: signaturesError } = await supabaseServer
      .from("participant_signatures")
      .select("participant_id, signature_type, typed_name, signature_data, ip_address")
      .in("participant_id", participantIds);
    if (signaturesError) throw signaturesError;

    const signatureByParticipant = new Map((signatures ?? []).map((s) => [s.participant_id, s]));

    const participantInfos: ParticipantSignatureInfo[] = (allParticipants ?? []).map((p) => {
      const sig = signatureByParticipant.get(p.id);
      return {
        role: p.role,
        name: p.name || p.email,
        email: p.email,
        signatureType: (sig?.signature_type as "typed" | "drawn") ?? "typed",
        typedName: sig?.typed_name ?? undefined,
        signatureDataUrl: sig?.signature_data ?? undefined,
        openedAt: p.opened_at,
        verifiedAt: p.verified_at,
        consentedAt: p.consented_at as string,
        signedAt: p.signed_at as string,
        ipAddress: sig?.ip_address ?? null,
      };
    });

    const { data: auditRows } = await supabaseServer
      .from("audit_events")
      .select("event_type, created_at")
      .eq("signing_request_id", envelope.id)
      .order("created_at", { ascending: true });

    const auditEvents: AuditEventSummary[] = (auditRows ?? []).map((row) => ({
      eventType: row.event_type,
      createdAt: row.created_at,
    }));

    const completedBytes = await stampMultiPartyCompletedPdf(originalBytes, {
      documentId: envelope.document_id,
      documentTitle: envelope.document_title || "Lease Agreement",
      consentText1: CONSENT_TEXT_1,
      consentText2: CONSENT_TEXT_2,
      consentVersion: CONSENT_VERSION,
      originalPdfHash: envelope.original_pdf_hash,
      participants: participantInfos,
      auditEvents,
    });

    const completedBuffer = Buffer.from(completedBytes);
    const completedPdfHash = sha256Hex(completedBuffer);
    const completedPdfPath = `completed/${envelope.document_id}.pdf`;
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
      .eq("id", envelope.id);

    await logAuditEvent({
      signingRequestId: envelope.id,
      documentId: envelope.document_id,
      eventType: "agreement_completed",
      ipAddress,
      userAgent,
    });

    const completedPdfUrl = await getSignedDownloadUrl(completedPdfPath, 3600);

    // Notify every participant, not just the one who just signed.
    for (const p of allParticipants ?? []) {
      try {
        const emailUrl = await getSignedDownloadUrl(completedPdfPath, 7 * 24 * 60 * 60);
        await sendEmail({
          to: p.email,
          subject: "Your signed lease renewal agreement",
          html: `
            <p>The lease renewal agreement has been fully signed by all parties.</p>
            <p><a href="${emailUrl}">Download the completed agreement</a></p>
            <p>Document ID: ${envelope.document_id}</p>
          `,
        });
        await logAuditEvent({
          signingRequestId: envelope.id,
          documentId: envelope.document_id,
          participantId: p.id,
          eventType: "completed_pdf_emailed",
          ipAddress,
          userAgent,
        });
      } catch (emailError) {
        console.error(`Failed to send completed PDF email to ${p.email}:`, emailError);
      }
    }

    return NextResponse.json({
      ok: true,
      documentId: envelope.document_id,
      waitingOnOthers: false,
      completedPdfUrl,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, ...safeErrorResponse(error, "sign") }, { status: 500 });
  }
}
