export type KinbaRuntimeConfig = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  r2PublicBaseUrl?: string;
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

export const publicMediaConfig = {
  r2PublicBaseUrl:
    clean(import.meta.env.VITE_R2_PUBLIC_BASE_URL) ??
    clean(runtimeConfig?.r2PublicBaseUrl),
};

export function resolveMediaUrl(value: string | null | undefined) {
  const source = clean(value);
  if (!source) return undefined;
  if (/^(https?:|blob:|data:)/i.test(source)) return source;
  if (source.startsWith("/")) return source;
  const base = publicMediaConfig.r2PublicBaseUrl;
  return base ? `${base.replace(/\/+$/, "")}/${source.replace(/^\/+/, "")}` : source;
}

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
