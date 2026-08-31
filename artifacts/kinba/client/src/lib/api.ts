const configuredApiBaseUrl = import.meta.env.DEV
  ? (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  : "";

function normalizeApiBaseUrl(value: string | undefined): string {
  if (!value) return "";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "VITE_API_BASE_URL must be an absolute HTTPS URL, for example https://kinba-api.onrender.com."
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("VITE_API_BASE_URL must use HTTP or HTTPS.");
  }
  // Production KINBA is a same-service deployment, so apiUrl() intentionally
  // resolves to the current origin. This prevents stale deployment variables
  // from sending authenticated requests to a different backend/database.
  if (
    import.meta.env.PROD &&
    (url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "0.0.0.0")
  ) {
    console.warn("[API] Ignoring localhost VITE_API_BASE_URL in production.");
    return "";
  }
  return url.toString().replace(/\/+$/, "");
}

export const API_BASE_URL = normalizeApiBaseUrl(configuredApiBaseUrl);

export function apiUrl(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
}
