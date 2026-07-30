import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { getSignedDownloadUrl } from "@/lib/storage";
import { logAuditEvent, getRequestMeta } from "@/lib/audit";
import { safeErrorResponse } from "@/lib/errors";

async function getParams(context: { params: Promise<{ id: string }> | { id: string } }) {
  return await context.params;
}

// Staff-side access to a completed agreement -- logged separately from the
// tenant-facing audit trail, since this is a different actor accessing the
// same document after the fact.
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await getParams(context);

    const { data: signingRequest, error } = await supabaseServer
      .from("signing_requests")
      .select("id, document_id, completed_pdf_path, status")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!signingRequest || !signingRequest.completed_pdf_path) {
      return NextResponse.json({ ok: false, error: "No completed document for this request." }, { status: 404 });
    }

    const url = await getSignedDownloadUrl(signingRequest.completed_pdf_path, 300);

    const { ipAddress, userAgent } = getRequestMeta(request);
    await logAuditEvent({
      signingRequestId: signingRequest.id,
      documentId: signingRequest.document_id,
      eventType: "completed_pdf_downloaded_by_staff",
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ ok: true, url });
  } catch (error) {
    return NextResponse.json({ ok: false, ...safeErrorResponse(error, "completed-pdf") }, { status: 500 });
  }
}
