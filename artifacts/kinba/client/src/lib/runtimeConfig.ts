export type KinbaRuntimeConfig = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};

declare global {
  interface Window {
    __KINBA_CONFIG__?: KinbaRuntimeConfig;
  }
}

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

const runtimeConfig =
  typeof window !== "undefined" ? window.__KINBA_CONFIG__ : undefined;

export const publicSupabaseConfig = {
  url:
    clean(import.meta.env.VITE_SUPABASE_URL) ?? clean(runtimeConfig?.supabaseUrl),
  anonKey:
    clean(import.meta.env.VITE_SUPABASE_ANON_KEY) ??
    clean(runtimeConfig?.supabaseAnonKey),
};

export function hasPublicSupabaseConfig() {
  return Boolean(publicSupabaseConfig.url && publicSupabaseConfig.anonKey);
}
