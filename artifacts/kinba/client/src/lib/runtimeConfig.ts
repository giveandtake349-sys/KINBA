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

export function resolveMediaUrl(
  value: string | null | undefined,
  bucket = "post-media"
) {
  const source = clean(value);
  if (!source) return undefined;
  const supabaseUrl =
    clean(import.meta.env.VITE_SUPABASE_URL) ??
    clean(runtimeConfig?.supabaseUrl);
  try {
    const parsed = new URL(
      source,
      typeof window !== "undefined"
        ? window.location.origin
        : "http://localhost"
    );
    if (parsed.hostname.endsWith(".r2.dev")) {
      return `/api/media/${parsed.pathname.replace(/^\/+/, "")}`;
    }
    if (/^https?:$/i.test(parsed.protocol)) {
      const normalized = parsed.toString();
      return /^http:/i.test(normalized) &&
        supabaseUrl &&
        normalized.startsWith(supabaseUrl)
        ? normalized.replace(/^http:/i, "https:")
        : normalized;
    }
  } catch {
    // Treat non-URL values as object keys below.
  }
  if (/^(blob:|data:)/i.test(source)) return source;
  const storageMarker = "/storage/v1/object/public/";
  if (source.includes(storageMarker) && supabaseUrl) {
    return `${supabaseUrl.replace(/\/+$/, "")}${source.slice(source.indexOf(storageMarker))}`;
  }
  if (source.startsWith("/")) return source;
  const r2Base = publicMediaConfig.r2PublicBaseUrl;
  if (r2Base) {
    try {
      const parsedBase = new URL(r2Base);
      if (parsedBase.hostname.endsWith(".r2.dev")) {
        return `/api/media/${source.replace(/^\/+/, "")}`;
      }
    } catch {
      // Fall through to Supabase or the raw source if the R2 base is malformed.
    }
    return `${r2Base.replace(/\/+$/, "")}/${source.replace(/^\/+/, "")}`;
  }
  if (supabaseUrl) {
    return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${source.replace(/^\/+/, "")}`;
  }
  return source;
}

export function isAbsoluteHttpUrl(
  value: string | null | undefined
): value is string {
  if (!value?.trim()) return false;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export const publicSupabaseConfig = {
  url:
    clean(import.meta.env.VITE_SUPABASE_URL) ??
    clean(runtimeConfig?.supabaseUrl),
  anonKey:
    clean(import.meta.env.VITE_SUPABASE_ANON_KEY) ??
    clean(runtimeConfig?.supabaseAnonKey),
};

export function hasPublicSupabaseConfig() {
  return Boolean(publicSupabaseConfig.url && publicSupabaseConfig.anonKey);
}
