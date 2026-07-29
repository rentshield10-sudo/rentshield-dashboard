import { supabaseServer } from "@/lib/supabase-server";

const BUCKET = "lease-documents";

export async function uploadFile(path: string, data: Buffer, contentType: string): Promise<void> {
  const { error } = await supabaseServer.storage
    .from(BUCKET)
    .upload(path, data, { contentType, upsert: false });

  if (error) {
    throw new Error(`Supabase Storage upload failed for ${path}: ${error.message}`);
  }
}

export async function getSignedDownloadUrl(path: string, expiresInSeconds: number): Promise<string> {
  const { data, error } = await supabaseServer.storage
    .from(BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data) {
    throw new Error(
      `Supabase Storage signed URL failed for ${path}: ${error?.message || "no data returned"}`,
    );
  }

  return data.signedUrl;
}
