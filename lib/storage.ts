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

export async function downloadFile(path: string): Promise<Buffer> {
  const { data, error } = await supabaseServer.storage.from(BUCKET).download(path);

  if (error || !data) {
    throw new Error(`Supabase Storage download failed for ${path}: ${error?.message || "no data returned"}`);
  }

  return Buffer.from(await data.arrayBuffer());
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
