import { supabaseServer } from "@/lib/supabase-server";
import { sha256Hex } from "@/lib/crypto-utils";

export interface EnvelopeRow {
  id: number;
  draft_id: number;
  document_id: string;
  document_title: string | null;
  original_pdf_path: string | null;
  original_pdf_hash: string | null;
  completed_pdf_path: string | null;
  completed_pdf_hash: string | null;
  status: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParticipantRow {
  id: number;
  signing_request_id: number;
  role: string;
  name: string | null;
  email: string;
  token_hash: string;
  status: string;
  expires_at: string | null;
  opened_at: string | null;
  verified_at: string | null;
  consented_at: string | null;
  signed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function findParticipantByToken(
  rawToken: string,
): Promise<{ participant: ParticipantRow; envelope: EnvelopeRow } | null> {
  const tokenHash = sha256Hex(rawToken);

  const { data: participant, error } = await supabaseServer
    .from("signing_participants")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;
  if (!participant) return null;

  const { data: envelope, error: envelopeError } = await supabaseServer
    .from("signing_requests")
    .select("*")
    .eq("id", participant.signing_request_id)
    .maybeSingle();
  if (envelopeError) throw envelopeError;
  if (!envelope) return null;

  return { participant, envelope };
}

export function isParticipantExpired(p: ParticipantRow): boolean {
  return !!p.expires_at && new Date(p.expires_at).getTime() < Date.now();
}

export function isParticipantTerminal(p: ParticipantRow): boolean {
  return ["signed", "declined"].includes(p.status);
}

export function isEnvelopeTerminal(e: EnvelopeRow): boolean {
  return ["completed", "expired", "revoked", "declined"].includes(e.status);
}
