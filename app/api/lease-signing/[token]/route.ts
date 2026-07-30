import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getSignedDownloadUrl } from "@/lib/storage";
import { findParticipantByToken, isParticipantExpired } from "@/lib/signing";
import { logAuditEvent, getRequestMeta } from "@/lib/audit";
import { safeErrorResponse } from "@/lib/errors";

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

    const found = await findParticipantByToken(token);

    if (!found) {
      await logAuditEvent({ eventType: "invalid_signing_link_attempt", ipAddress, userAgent });
      return NextResponse.json({ ok: false, error: "This signing link is invalid." }, { status: 404 });
    }

    const { participant, envelope } = found;

    if (participant.status === "declined") {
      return NextResponse.json({ ok: false, error: "This signing request has been declined." }, { status: 410 });
    }
    if (envelope.status === "revoked") {
      return NextResponse.json({ ok: false, error: "This signing link has been revoked." }, { status: 410 });
    }
    if (participant.status === "signed") {
      return NextResponse.json(
        {
          ok: true,
          documentId: envelope.document_id,
          role: participant.role,
          name: participant.name,
          email: participant.email,
          status: "signed",
          waitingOnOthers: envelope.status !== "completed",
          envelopeCompleted: envelope.status === "completed",
          completedPdfUrl:
            envelope.status === "completed" && envelope.completed_pdf_path
              ? await getSignedDownloadUrl(envelope.completed_pdf_path, 3600)
              : null,
        },
      );
    }

    if (isParticipantExpired(participant) || envelope.status === "expired") {
      if (participant.status !== "declined") {
        await supabaseServer
          .from("signing_participants")
          .update({ status: "declined", updated_at: new Date().toISOString() })
          .eq("id", participant.id);
        await logAuditEvent({
          signingRequestId: envelope.id,
          documentId: envelope.document_id,
          participantId: participant.id,
          eventType: "signing_request_expired",
          ipAddress,
          userAgent,
        });
      }
      return NextResponse.json({ ok: false, error: "This signing link has expired." }, { status: 410 });
    }

    if (participant.status === "sent") {
      await supabaseServer
        .from("signing_participants")
        .update({ status: "opened", opened_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", participant.id);
      await logAuditEvent({
        signingRequestId: envelope.id,
        documentId: envelope.document_id,
        participantId: participant.id,
        eventType: "signing_link_opened",
        ipAddress,
        userAgent,
      });
    }

    const originalPdfUrl = envelope.original_pdf_path
      ? await getSignedDownloadUrl(envelope.original_pdf_path, 600)
      : null;

    return NextResponse.json({
      ok: true,
      documentId: envelope.document_id,
      role: participant.role,
      name: participant.name,
      email: participant.email,
      status: participant.status === "sent" ? "opened" : participant.status,
      originalPdfUrl,
      expiresAt: participant.expires_at,
      verifiedAt: participant.verified_at,
      consentedAt: participant.consented_at,
      waitingOnOthers: false,
      envelopeCompleted: false,
      completedPdfUrl: null,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, ...safeErrorResponse(error, "lease-signing/[token] GET") }, { status: 500 });
  }
}
