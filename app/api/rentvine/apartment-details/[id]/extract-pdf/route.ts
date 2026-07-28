import { NextResponse } from "next/server";
import { PDFParse } from "pdf-parse";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

function convertUsDateToIso(value: string): string | null {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  const [, month, day, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "No file uploaded." }, { status: 400 });
    }

    if (file.type && file.type !== "application/pdf") {
      return NextResponse.json({ ok: false, error: "File must be a PDF." }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ ok: false, error: "File is too large (max 10MB)." }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    const text = parsed.text;

    const dateMatch = text.match(
      /commence\s+on,?\s*(\d{1,2}\/\d{1,2}\/\d{4})[\s\S]*?expiration\s+on,?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    );

    if (!dateMatch) {
      return NextResponse.json(
        { ok: false, error: "Could not find lease dates in this PDF." },
        { status: 422 },
      );
    }

    const activation1 = convertUsDateToIso(dateMatch[1]);
    const expiration1 = convertUsDateToIso(dateMatch[2]);

    if (!activation1 || !expiration1) {
      return NextResponse.json(
        { ok: false, error: "Found lease dates but couldn't parse their format." },
        { status: 422 },
      );
    }

    const rentMatch = text.match(/installments\s+of\s*\$([\d,]+(?:\.\d{2})?)/i);

    if (!rentMatch) {
      return NextResponse.json(
        { ok: false, error: "Could not find the rent amount in this PDF." },
        { status: 422 },
      );
    }

    const currentRent = Number(rentMatch[1].replace(/,/g, ""));

    if (!Number.isFinite(currentRent)) {
      return NextResponse.json(
        { ok: false, error: "Found a rent amount but couldn't parse it as a number." },
        { status: 422 },
      );
    }

    return NextResponse.json({ ok: true, activation1, expiration1, currentRent });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json(
      { ok: false, error: err?.message || "Failed to parse PDF." },
      { status: 500 },
    );
  }
}
