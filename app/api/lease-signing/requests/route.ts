import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseServer } from "@/lib/supabase-server";
import { uploadFile } from "@/lib/storage";
import { generateFilledPdf, type DraftField } from "@/lib/pdf-generation";
import { sha256Hex, generateToken } from "@/lib/crypto-utils";
import { logAuditEvent, getRequestMeta } from "@/lib/audit";
import { sendEmail } from "@/lib/email";

const DEFAULT_EXPIRY_DAYS = 7;

export async function GET() {
  try {
    const { data, error } = await supabaseServer
      .from("signing_requests")
      .select(
        "id, draft_id, tenant_name, tenant_email, document_id, status, expires_at, opened_at, verified_at, signed_at, completed_at, revoked_at, created_at",
      )
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ ok: true, requests: data });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const draftId = Number(body?.draftId);
    const tenantEmail = String(body?.tenantEmail ?? "").trim();
    const tenantName = body?.tenantName ? String(body.tenantName).trim() : null;
    const expiresInDays = Number(body?.expiresInDays) || DEFAULT_EXPIRY_DAYS;

    if (!Number.isFinite(draftId)) {
      return NextResponse.json({ ok: false, error: "draftId must be a number." }, { status: 400 });
    }
    if (!tenantEmail || !tenantEmail.includes("@")) {
      return NextResponse.json({ ok: false, error: "A valid tenantEmail is required." }, { status: 400 });
    }

    const { data: fields, error: fieldsError } = await supabaseServer
      .from("lease_template_fields")
      .select("id, page_number, x, y, width, height, label, field_type");
    if (fieldsError) throw fieldsError;

    const { data: filledValues, error: valuesError } = await supabaseServer
      .from("lease_template_filled_values")
      .select("field_id, value")
      .eq("draft_id", draftId);
    if (valuesError) throw valuesError;

    const valuesMap: Record<number, string> = {};
    for (const row of filledValues ?? []) {
      valuesMap[row.field_id] = row.value;
    }

    const pdfBytes = await generateFilledPdf((fields ?? []) as DraftField[], valuesMap);
    const pdfBuffer = Buffer.from(pdfBytes);
    const originalPdfHash = sha256Hex(pdfBuffer);

    const documentId = randomUUID();
    const originalPdfPath = `originals/${documentId}.pdf`;
    await uploadFile(originalPdfPath, pdfBuffer, "application/pdf");

    const rawToken = generateToken();
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: signingRequest, error: insertError } = await supabaseServer
      .from("signing_requests")
      .insert({
        draft_id: draftId,
        tenant_name: tenantName,
        tenant_email: tenantEmail,
        document_id: documentId,
        token_hash: tokenHash,
        original_pdf_path: originalPdfPath,
        original_pdf_hash: originalPdfHash,
        status: "sent",
        expires_at: expiresAt,
      })
      .select("id, document_id, expires_at")
      .single();

    if (insertError) throw insertError;

    const { ipAddress, userAgent } = getRequestMeta(request);
    await logAuditEvent({
      signingRequestId: signingRequest.id,
      documentId,
      eventType: "signing_request_created",
      metadata: { tenantEmail, draftId },
      ipAddress,
      userAgent,
    });

    const signingUrl = `/sign-renewal/${rawToken}`;
    const absoluteSigningUrl = `${new URL(request.url).origin}${signingUrl}`;

    let emailSent = false;
    try {
      await sendEmail({
        to: tenantEmail,
        subject: "Your lease renewal agreement is ready to sign",
        html: `
          <p>Hi ${tenantName || "there"},</p>
          <p>Your lease renewal agreement is ready for your review and signature.</p>
          <p><a href="${absoluteSigningUrl}">Click here to review and sign</a></p>
          <p>This link expires on ${new Date(signingRequest.expires_at).toLocaleDateString()}.</p>
        `,
      });
      emailSent = true;
      await logAuditEvent({
        signingRequestId: signingRequest.id,
        documentId,
        eventType: "signing_email_sent",
        ipAddress,
        userAgent,
      });
    } catch (emailError) {
      // Don't fail the whole request over email delivery -- staff can
      // still share the link manually (the response includes it either
      // way), and this is visible to them via emailSent: false.
      console.error("Failed to send signing invite email:", emailError);
    }

    return NextResponse.json({
      ok: true,
      signingUrl,
      documentId,
      expiresAt: signingRequest.expires_at,
      emailSent,
    });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
