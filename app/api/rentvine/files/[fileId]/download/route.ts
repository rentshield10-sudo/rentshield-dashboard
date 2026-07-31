import { NextResponse } from "next/server";
import { downloadRentvineFile } from "@/lib/rentvine";

async function getParams(context: { params: Promise<{ fileId: string }> | { fileId: string } }) {
  return await context.params;
}

// Proxies a Rentvine file download server-side (staff never see the
// Rentvine API credentials) so history links can point straight at a file.
export async function GET(
  _request: Request,
  context: { params: Promise<{ fileId: string }> | { fileId: string } },
) {
  try {
    const { fileId } = await getParams(context);
    const { buffer, contentType } = await downloadRentvineFile(fileId);

    // Content-Length is required for Chrome's inline PDF viewer -- without
    // it, the response falls back to Transfer-Encoding: chunked and Chrome
    // downloads the file instead of rendering it (confirmed live).
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        "Content-Length": String(buffer.length),
      },
    });
  } catch (error) {
    const err = error as { message?: string };
    return NextResponse.json({ ok: false, error: err?.message || String(error) }, { status: 500 });
  }
}
