import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { readFile } from "fs/promises";
import path from "path";
import { renderLeaseLayoutPdf, type SignatureBlockParticipant } from "@/lib/lease-pdf-layout";
import { renderLeadPaintDisclosurePdf } from "@/lib/lead-paint-disclosure-layout";

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const FONT_SIZE = 11;
const LINE_HEIGHT = 15;

function wrapLine(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (text === "") return [""];
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Renders plain text (with {{variables}} already substituted) as a fresh
// multi-page PDF -- replaces the earlier approach of drawing values onto a
// scanned template image, now that the template itself is plain text.
export async function renderTemplatePdf(text: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  let page: PDFPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const paragraphs = text.split("\n");
  for (const paragraph of paragraphs) {
    const wrapped = wrapLine(paragraph, font, FONT_SIZE, maxWidth);
    for (const line of wrapped) {
      if (y < MARGIN) {
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
      page.drawText(line, { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0.07, 0.09, 0.15) });
      y -= LINE_HEIGHT;
    }
  }

  return pdfDoc.save();
}

const LEAD_PAINT_PAMPHLET_PATH = path.join(process.cwd(), "lib", "assets", "lead-paint-pamphlet.pdf");

// Renders the lease with the exact-format layout engine (lib/lease-pdf-layout.tsx)
// and appends the real EPA lead-paint disclosure pamphlet's actual pages
// (copied as-is via pdf-lib, preserving its photos/logos exactly) as one
// combined document -- used everywhere: Preview PDF, what's generated for
// signing, and (since stampMultiPartyCompletedPdf below starts from these
// same bytes) the final signed document too.
export async function renderCombinedLeasePdf(
  text: string,
  participants: SignatureBlockParticipant[],
): Promise<Uint8Array> {
  const leaseBytes = await renderLeaseLayoutPdf(text, participants);
  const mergedDoc = await PDFDocument.load(leaseBytes);

  const disclosureBytes = await renderLeadPaintDisclosurePdf(participants);
  const disclosureDoc = await PDFDocument.load(disclosureBytes);
  const disclosurePages = await mergedDoc.copyPages(disclosureDoc, disclosureDoc.getPageIndices());
  for (const page of disclosurePages) {
    mergedDoc.addPage(page);
  }

  const pamphletBytes = await readFile(LEAD_PAINT_PAMPHLET_PATH);
  const pamphletDoc = await PDFDocument.load(pamphletBytes);
  const copiedPages = await mergedDoc.copyPages(pamphletDoc, pamphletDoc.getPageIndices());
  for (const page of copiedPages) {
    mergedDoc.addPage(page);
  }

  return mergedDoc.save();
}

const COMPANY_NAME = "ALMO Properties, LLC";

export interface AuditEventSummary {
  eventType: string;
  createdAt: string;
}

export interface ParticipantSignatureInfo {
  role: string;
  name: string;
  email: string;
  signatureType: "typed" | "drawn";
  typedName?: string;
  signatureDataUrl?: string; // data:image/png;base64,...
  openedAt: string | null;
  verifiedAt: string | null;
  consentedAt: string;
  signedAt: string;
  ipAddress: string | null;
}

export interface MultiPartyCompletionParams {
  documentId: string;
  documentTitle: string;
  consentText1: string;
  consentText2: string;
  consentVersion: number;
  originalPdfHash: string;
  participants: ParticipantSignatureInfo[];
  auditEvents: AuditEventSummary[];
}

// Appends a signatures page (one block per participant) and a completion
// certificate to the agreement, once every participant has signed. The
// original document's text isn't touched -- signatures aren't stamped
// inline at a specific line in the agreement (the plain-text template has
// no positional field data for that), they're recorded on a dedicated page
// instead, alongside the certificate. The completed PDF's own hash can't be
// embedded in itself (only known after this function finishes), so it's
// stored in the database row rather than printed here.
export async function stampMultiPartyCompletedPdf(
  originalPdfBytes: Buffer,
  params: MultiPartyCompletionParams,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const black = rgb(0.07, 0.09, 0.15);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  function ensureSpace(needed: number) {
    if (y - needed < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function line(text: string, opts: { bold?: boolean; size?: number; gapAfter?: number } = {}) {
    const size = opts.size ?? 10;
    const usedFont = opts.bold ? boldFont : font;
    const wrapped = wrapLine(text, usedFont, size, maxWidth);
    for (const l of wrapped) {
      ensureSpace(LINE_HEIGHT);
      page.drawText(l, { x: MARGIN, y, size, font: usedFont, color: black });
      y -= LINE_HEIGHT;
    }
    if (opts.gapAfter) y -= opts.gapAfter;
  }

  // ── Signatures page(s) ──
  line("Signatures", { bold: true, size: 16, gapAfter: 10 });

  for (const p of params.participants) {
    ensureSpace(80);
    line(`${p.role}: ${p.name} <${p.email}>`, { bold: true });

    if (p.signatureType === "drawn" && p.signatureDataUrl) {
      const base64 = p.signatureDataUrl.split(",")[1] ?? "";
      const pngImage = await pdfDoc.embedPng(Buffer.from(base64, "base64"));
      const scaled = pngImage.scale(1);
      const maxImgWidth = 180;
      const maxImgHeight = 50;
      const ratio = Math.min(maxImgWidth / scaled.width, maxImgHeight / scaled.height, 1);
      const imgHeight = scaled.height * ratio;
      ensureSpace(imgHeight + 4);
      page.drawImage(pngImage, {
        x: MARGIN,
        y: y - imgHeight,
        width: scaled.width * ratio,
        height: imgHeight,
      });
      y -= imgHeight + 4;
    } else {
      line(p.typedName || p.name, { size: 18 });
    }

    line(`Signed: ${p.signedAt}`, { size: 8 });
    line(`IP address: ${p.ipAddress ?? "N/A"}`, { size: 8, gapAfter: 12 });
  }

  // ── Completion certificate ──
  page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  y = PAGE_HEIGHT - MARGIN;

  line("Certificate of Completion", { bold: true, size: 16, gapAfter: 6 });
  line(COMPANY_NAME, { bold: true });
  line(`Document: ${params.documentTitle}`);
  line(`Document ID: ${params.documentId}`, { gapAfter: 6 });
  line("Verification method: Email one-time code", { gapAfter: 6 });

  for (const p of params.participants) {
    line(`${p.role}: ${p.name} <${p.email}>`, { bold: true });
    line(`  Opened: ${p.openedAt ?? "N/A"}`, { size: 8 });
    line(`  Email verified: ${p.verifiedAt ?? "N/A"}`, { size: 8 });
    line(`  Consent accepted: ${p.consentedAt}`, { size: 8 });
    line(`  Signed: ${p.signedAt}`, { size: 8, gapAfter: 6 });
  }

  line(`Original document hash (SHA-256): ${params.originalPdfHash}`, { size: 7, gapAfter: 6 });
  line(`Consent version: ${params.consentVersion}`);
  line(`"${params.consentText1}"`, { size: 8 });
  line(`"${params.consentText2}"`, { size: 8, gapAfter: 10 });

  line("Audit trail:", { bold: true });
  for (const event of params.auditEvents) {
    line(`${event.createdAt} — ${event.eventType}`, { size: 8 });
  }

  return pdfDoc.save();
}
