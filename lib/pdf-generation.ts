import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

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

const COMPANY_NAME = "ALMO Properties, LLC";

export interface AuditEventSummary {
  eventType: string;
  createdAt: string;
}

export interface CompletionCertificateParams {
  documentId: string;
  documentTitle: string;
  tenantName: string;
  tenantEmail: string;
  propertyAddress: string;
  signatureType: "typed" | "drawn";
  typedName?: string;
  signatureDataUrl?: string; // data:image/png;base64,...
  consentText1: string;
  consentText2: string;
  consentVersion: number;
  openedAt: string | null;
  verifiedAt: string | null;
  consentedAt: string;
  signedAt: string;
  ipAddress: string | null;
  originalPdfHash: string;
  auditEvents: AuditEventSummary[];
}

// Stamps the signature onto the last page of the agreement, then appends a
// human-readable completion certificate as final page(s). The completed
// PDF's own hash can't be embedded in itself (the hash is only known after
// this function finishes), so it's stored in the database row instead of
// printed on the certificate.
export async function stampCompletedPdf(
  originalPdfBytes: Buffer,
  params: CompletionCertificateParams,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pages = pdfDoc.getPages();
  const lastPage = pages[pages.length - 1];
  const black = rgb(0.07, 0.09, 0.15);
  const gray = rgb(0.4, 0.4, 0.4);

  const sigBlockY = 60;
  lastPage.drawText("Electronically signed", {
    x: 40,
    y: sigBlockY + 40,
    size: 9,
    font: boldFont,
    color: black,
  });

  if (params.signatureType === "drawn" && params.signatureDataUrl) {
    const base64 = params.signatureDataUrl.split(",")[1] ?? "";
    const pngImage = await pdfDoc.embedPng(Buffer.from(base64, "base64"));
    const scaled = pngImage.scale(1);
    const maxWidth = 200;
    const maxHeight = 60;
    const ratio = Math.min(maxWidth / scaled.width, maxHeight / scaled.height, 1);
    lastPage.drawImage(pngImage, {
      x: 40,
      y: sigBlockY,
      width: scaled.width * ratio,
      height: scaled.height * ratio,
    });
  } else {
    lastPage.drawText(params.typedName || params.tenantName, {
      x: 40,
      y: sigBlockY,
      size: 20,
      font,
      color: black,
    });
  }

  lastPage.drawText(`Signed by: ${params.tenantName} <${params.tenantEmail}>`, {
    x: 40,
    y: sigBlockY - 16,
    size: 8,
    font,
    color: black,
  });
  lastPage.drawText(`Date: ${params.signedAt}`, { x: 40, y: sigBlockY - 28, size: 8, font, color: black });
  lastPage.drawText(`Document ID: ${params.documentId}`, {
    x: 40,
    y: sigBlockY - 40,
    size: 8,
    font,
    color: black,
  });
  lastPage.drawText(
    "This document was electronically signed in accordance with the consent recorded below.",
    { x: 40, y: sigBlockY - 52, size: 7, font, color: gray },
  );

  // ── Completion certificate ──
  const certPage = pdfDoc.addPage();
  const { height: ch } = certPage.getSize();
  let cy = ch - 50;
  const lineHeight = 14;

  function line(text: string, opts: { bold?: boolean; size?: number } = {}) {
    certPage.drawText(text, {
      x: 50,
      y: cy,
      size: opts.size ?? 10,
      font: opts.bold ? boldFont : font,
      color: black,
    });
    cy -= lineHeight;
  }

  line("Certificate of Completion", { bold: true, size: 16 });
  cy -= 6;
  line(COMPANY_NAME, { bold: true });
  line(`Document: ${params.documentTitle}`);
  line(`Document ID: ${params.documentId}`);
  line(`Tenant: ${params.tenantName} <${params.tenantEmail}>`);
  line(`Property: ${params.propertyAddress}`);
  line("Verification method: Email one-time code");
  cy -= 6;
  line(`Opened: ${params.openedAt ?? "N/A"}`);
  line(`Email verified: ${params.verifiedAt ?? "N/A"}`);
  line(`Consent accepted: ${params.consentedAt}`);
  line(`Signed: ${params.signedAt}`);
  line(`IP address: ${params.ipAddress ?? "N/A"}`);
  cy -= 6;
  line(`Original document hash (SHA-256): ${params.originalPdfHash}`, { size: 7 });
  cy -= 6;
  line(`Consent version: ${params.consentVersion}`);
  line(`"${params.consentText1}"`, { size: 8 });
  line(`"${params.consentText2}"`, { size: 8 });
  cy -= 10;
  line("Audit trail:", { bold: true });
  for (const event of params.auditEvents) {
    line(`${event.createdAt} — ${event.eventType}`, { size: 8 });
  }

  return pdfDoc.save();
}
