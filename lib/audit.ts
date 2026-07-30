import { supabaseServer } from "@/lib/supabase-server";

export async function logAuditEvent(params: {
  signingRequestId?: number;
  documentId?: string;
  participantId?: number;
  eventType: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  const { error } = await supabaseServer.from("audit_events").insert({
    signing_request_id: params.signingRequestId ?? null,
    document_id: params.documentId ?? null,
    participant_id: params.participantId ?? null,
    event_type: params.eventType,
    event_metadata: params.metadata ?? null,
    ip_address: params.ipAddress ?? null,
    user_agent: params.userAgent ?? null,
  });

  if (error) {
    // Audit failures must never silently disappear, but also shouldn't
    // crash the request that triggered them.
    console.error("Failed to write audit event:", params.eventType, error);
  }
}

export function getRequestMeta(request: Request): {
  ipAddress: string | null;
  userAgent: string | null;
} {
  const ipAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    null;
  const userAgent = request.headers.get("user-agent");
  return { ipAddress, userAgent };
}
