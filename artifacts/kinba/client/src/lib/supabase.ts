import { createClient } from "@supabase/supabase-js";
import { hasPublicSupabaseConfig, publicSupabaseConfig } from "./runtimeConfig";

if (!hasPublicSupabaseConfig()) {
  console.warn(
    "[Supabase Auth] Missing VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY and server runtime config."
  );
}

const browserStorage =
  typeof window !== "undefined" ? window.localStorage : undefined;

export const supabase = createClient(
  publicSupabaseConfig.url ?? "https://invalid.supabase.co",
  publicSupabaseConfig.anonKey ?? "invalid-anon-key",
  {
    auth: {
      persistSession: true,
      storage: browserStorage,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  },
);
