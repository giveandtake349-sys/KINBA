import { createClient, type SupabaseClient, type User as SupabaseUser } from "@supabase/supabase-js";
type RequestWithHeaders = { headers: { authorization?: unknown } };
import { ENV } from "./_core/env";

let authClient: SupabaseClient | null = null;

function getAuthClient() {
  if (!authClient) {
    if (!ENV.supabaseUrl || !ENV.supabaseAnonKey) {
      throw new Error("Supabase Auth is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.");
    }
    authClient = createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return authClient;
}

export function getBearerToken(req: RequestWithHeaders): string | null {
  const value = req.headers.authorization;
  if (typeof value !== "string") return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function verifySupabaseAccessToken(req: RequestWithHeaders, client: SupabaseClient = getAuthClient()): Promise<SupabaseUser | null> {
  const token = getBearerToken(req);
  if (!token) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

export function supabaseOpenId(userId: string) {
  return `supabase:${userId}`;
}

export function supabaseDisplayName(user: SupabaseUser) {
  const metadata = user.user_metadata as Record<string, unknown> | null;
  const name = metadata?.full_name ?? metadata?.name;
  return typeof name === "string" && name.trim() ? name.trim() : user.email ?? "Kinba member";
}
