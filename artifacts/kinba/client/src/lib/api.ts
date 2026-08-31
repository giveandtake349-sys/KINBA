type RuntimeConfig = Window & {
  __KINBA_API_BASE_URL__?: string;
};

const configuredApiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();

function normalizeApiBaseUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash)
      return "";
    if (["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname)) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    console.warn("[API] Ignoring invalid API base URL configuration.");
    return "";
  }
}

function resolveApiBaseUrl(): string {
  if (typeof window !== "undefined") {
    const runtimeValue = (window as RuntimeConfig).__KINBA_API_BASE_URL__;
    const runtimeBase = normalizeApiBaseUrl(runtimeValue);
    if (runtimeBase) return runtimeBase;

    const configuredBase = normalizeApiBaseUrl(configuredApiBaseUrl);
    if (configuredBase) return configuredBase;

    return window.location.origin.replace(/\/+$/, "");
  }
  return normalizeApiBaseUrl(configuredApiBaseUrl);
}

export const API_BASE_URL = resolveApiBaseUrl();

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = resolveApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}
