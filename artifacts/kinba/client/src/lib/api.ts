const KINBA_API_BASE_URL = "https://kinba.onrender.com";

export const API_BASE_URL = KINBA_API_BASE_URL;

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${KINBA_API_BASE_URL}${normalizedPath}`;
}
