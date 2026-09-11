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
  if (/^(blob:|data:)/i.test(source)) return source;
  if (/^https?:\/\//i.test(source) || source.startsWith("//")) {
    try {
      const parsed = new URL(source.startsWith("//") ? `https:${source}` : source);
      if (parsed.hostname.endsWith(".r2.dev")) {
        return `/api/media/${parsed.pathname.replace(/^\/+/, "")}${parsed.search}`;
      }
      if (parsed.protocol === "http:" && supabaseUrl &&
          parsed.host === new URL(supabaseUrl).host) {
        parsed.protocol = "https:";
      }
      return parsed.toString();
    } catch {
      return undefined;
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(source)) return undefined;
  const storagePath = source.replace(/^\/+/, "");
  if (storagePath.startsWith("storage/v1/object/")) {
    return supabaseUrl
      ? `${supabaseUrl.replace(/\/+$/, "")}/${storagePath}`
      : undefined;
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
    const objectPath = source.startsWith(`${bucket}/`) ? source : `${bucket}/${source}`;
    return new URL(`/storage/v1/object/public/${objectPath}`, supabaseUrl).toString();
  }
  return undefined;
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
