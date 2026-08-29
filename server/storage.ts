import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "./_core/env";

export const MEDIA_BUCKET = "signal-media";

let storageClient: SupabaseClient | null = null;

function getStorageClient() {
  if (!storageClient) {
    const serviceRoleKey = ENV.supabaseServiceRoleKey;
    if (!ENV.supabaseUrl || !serviceRoleKey) {
      throw new Error(
        "Supabase Storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server."
      );
    }
    storageClient = createClient(ENV.supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return storageClient;
}

function normalizeKey(relKey: string) {
  const key = relKey
    .replace(/\\/g, "/")
    .split("/")
    .filter(part => part && part !== "." && part !== "..")
    .map(part => part.replace(/[^a-zA-Z0-9._-]/g, "-") || "file")
    .join("/");
  if (!key) throw new Error("Storage object path cannot be empty.");
  return key;
}

function appendHashSuffix(relKey: string) {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

function publicUrl(key: string) {
  const { data } = getStorageClient()
    .storage.from(MEDIA_BUCKET)
    .getPublicUrl(key);
  if (!data.publicUrl)
    throw new Error("Supabase Storage returned an empty public URL.");
  return data.publicUrl;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));
  const { error } = await getStorageClient()
    .storage.from(MEDIA_BUCKET)
    .upload(key, data, {
      cacheControl: "3600",
      contentType,
      upsert: false,
    });
  if (error)
    throw new Error(`Supabase Storage upload failed: ${error.message}`);
  return { key, url: publicUrl(key) };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: publicUrl(key) };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  return publicUrl(normalizeKey(relKey));
}
