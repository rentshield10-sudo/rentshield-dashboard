import { supabaseServer } from "@/lib/supabase-server";
import { sha256Hex } from "@/lib/crypto-utils";

export interface SigningRequestRow {
  id: number;
  draft_id: number;
  tenant_name: string | null;
  tenant_email: string;
  document_id: string;
  token_hash: string;
  original_pdf_path: string | null;
  original_pdf_hash: string | null;
  completed_pdf_path: string | null;
  completed_pdf_hash: string | null;
  status: string;
  expires_at: string | null;
  opened_at: string | null;
  verified_at: string | null;
  consented_at: string | null;
  signed_at: string | null;
  completed_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function findSigningRequestByToken(rawToken: string): Promise<SigningRequestRow | null> {
  const tokenHash = sha256Hex(rawToken);
  const { data, error } = await supabaseServer
    .from("signing_requests")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function isExpired(req: SigningRequestRow): boolean {
  return !!req.expires_at && new Date(req.expires_at).getTime() < Date.now();
}

export function isTerminal(req: SigningRequestRow): boolean {
  return ["completed", "expired", "revoked", "declined"].includes(req.status);
}
