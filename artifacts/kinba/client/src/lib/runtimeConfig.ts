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
  try {
    const parsed = new URL(source, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    if (parsed.hostname.endsWith(".r2.dev")) {
      return `/api/media/${parsed.pathname.replace(/^\/+/, "")}`;
    }
    if (/^https?:$/i.test(parsed.protocol)) return parsed.toString();
  } catch {
    // Treat non-URL values as object keys below.
  }
  if (/^(blob:|data:)/i.test(source)) return source;
  if (source.startsWith("/")) return source;
  const base = publicMediaConfig.r2PublicBaseUrl;
  if (base) {
    try {
      const parsedBase = new URL(base);
      if (parsedBase.hostname.endsWith(".r2.dev")) {
        return `/api/media/${source.replace(/^\/+/, "")}`;
      }
    } catch {
      // Fall back to the raw key if the configured base is malformed.
    }
    return `${base.replace(/\/+$/, "")}/${source.replace(/^\/+/, "")}`;
  }
  return source;
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
