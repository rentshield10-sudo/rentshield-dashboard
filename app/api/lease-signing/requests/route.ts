import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { supabaseServer } from "@/lib/supabase-server";
import { uploadFile } from "@/lib/storage";
import { renderCombinedLeasePdf } from "@/lib/pdf-generation";
import { substituteVariables } from "@/lib/template-vars";
import { sha256Hex, generateToken } from "@/lib/crypto-utils";
import { logAuditEvent, getRequestMeta } from "@/lib/audit";
import { sendEmail } from "@/lib/email";

const DEFAULT_EXPIRY_DAYS = 7;

export async function GET() {
  try {
    const { data: envelopes, error } = await supabaseServer
      .from("signing_requests")
      .select("id, draft_id, document_id, status, expires_at, completed_at, revoked_at, created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const envelopeIds = (envelopes ?? []).map((e) => e.id);
    const { data: participants, error: participantsError } = envelopeIds.length
      ? await supabaseServer
          .from("signing_participants")
          .select("id, signing_request_id, role, name, email, status")
          .in("signing_request_id", envelopeIds)
      : { data: [], error: null };
    if (participantsError) throw participantsError;

    const requests = (envelopes ?? []).map((envelope) => ({
      ...envelope,
      participants: (participants ?? []).filter((p) => p.signing_request_id === envelope.id),
    }));

    return NextResponse.json({ ok: true, requests });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const draftId = Number(body?.draftId);
    const expiresInDays = Number(body?.expiresInDays) || DEFAULT_EXPIRY_DAYS;
    const rawParticipants: unknown[] = Array.isArray(body?.participants) ? body.participants : [];

    if (!Number.isFinite(draftId)) {
      return NextResponse.json({ ok: false, error: "draftId must be a number." }, { status: 400 });
    }

    const participantsInput = rawParticipants
      .map((p) => {
        const item = p as Record<string, unknown>;
        return {
          role: String(item?.role ?? "").trim(),
          name: item?.name ? String(item.name).trim() : null,
          email: String(item?.email ?? "").trim(),
        };
      })
      .filter((p) => p.role && p.email.includes("@"));

    if (participantsInput.length === 0) {
      return NextResponse.json(
        { ok: false, error: "At least one participant (role + email) is required." },
        { status: 400 },
      );
    }

    // Signing order is Tenant(s) first, then Landlord, then anyone else
    // (e.g. Witness - Property Management) -- each participant can only
    // sign once everyone before them in this order has signed. Sorting is
    // stable, so multiple tenants keep the relative order staff entered
    // them in.
    function rolePriority(role: string): number {
      if (role === "Tenant") return 0;
      if (role === "Landlord") return 1;
      return 2;
    }
    const orderedParticipants = [...participantsInput].sort(
      (a, b) => rolePriority(a.role) - rolePriority(b.role),
    );

    const { data: template, error: templateError } = await supabaseServer
      .from("lease_templates")
      .select("name, body")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (templateError) throw templateError;
    if (!template?.body) {
      return NextResponse.json({ ok: false, error: "No lease template has been saved yet." }, { status: 400 });
    }

    const { data: draftValues, error: valuesError } = await supabaseServer
      .from("lease_template_draft_values")
      .select("variable_name, value")
      .eq("draft_id", draftId);
    if (valuesError) throw valuesError;

    const valuesMap: Record<string, string> = {};
    for (const row of draftValues ?? []) {
      valuesMap[row.variable_name] = row.value;
    }

    const filledText = substituteVariables(template.body, valuesMap);
    const pdfBytes = await renderCombinedLeasePdf(
      filledText,
      orderedParticipants.map((p) => ({ role: p.role, name: p.name || "" })),
    );
    const pdfBuffer = Buffer.from(pdfBytes);
    const originalPdfHash = sha256Hex(pdfBuffer);

    const documentId = randomUUID();
    const originalPdfPath = `originals/${documentId}.pdf`;
    await uploadFile(originalPdfPath, pdfBuffer, "application/pdf");

    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: envelope, error: insertError } = await supabaseServer
      .from("signing_requests")
      .insert({
        draft_id: draftId,
        document_id: documentId,
        document_title: template.name,
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
      signingRequestId: envelope.id,
      documentId,
      eventType: "signing_request_created",
      metadata: { participants: participantsInput.map((p) => ({ role: p.role, email: p.email })), draftId },
      ipAddress,
      userAgent,
    });

    const origin = new URL(request.url).origin;
    const results: { role: string; name: string | null; email: string; signingUrl: string; emailSent: boolean }[] = [];

    for (const [signingOrder, p] of orderedParticipants.entries()) {
      const rawToken = generateToken();
      const tokenHash = sha256Hex(rawToken);

      const { data: participant, error: participantError } = await supabaseServer
        .from("signing_participants")
        .insert({
          signing_request_id: envelope.id,
          role: p.role,
          name: p.name,
          email: p.email,
          token_hash: tokenHash,
          status: "sent",
          expires_at: expiresAt,
          signing_order: signingOrder,
        })
        .select("id")
        .single();
      if (participantError) throw participantError;

      const signingUrl = `/sign-renewal/${rawToken}`;
      const absoluteUrl = `${origin}${signingUrl}`;

      let emailSent = false;
      try {
        await sendEmail({
          to: p.email,
          subject: `Please sign: Lease Renewal Agreement (${p.role})`,
          html: `
            <p>Hi ${p.name || "there"},</p>
            <p>You've been asked to sign a lease renewal agreement as <b>${p.role}</b>.</p>
            <p><a href="${absoluteUrl}">Click here to review and sign</a></p>
            <p>This link expires on ${new Date(expiresAt).toLocaleDateString()}.</p>
          `,
        });
        emailSent = true;
        await logAuditEvent({
          signingRequestId: envelope.id,
          documentId,
          eventType: "signing_email_sent",
          metadata: { role: p.role, email: p.email },
          ipAddress,
          userAgent,
        });
      } catch (emailError) {
        console.error(`Failed to send signing invite email to ${p.email}:`, emailError);
      }

      results.push({ role: p.role, name: p.name, email: p.email, signingUrl, emailSent });
    }

    return NextResponse.json({
      ok: true,
      documentId,
      expiresAt: envelope.expires_at,
      participants: results,
    });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
