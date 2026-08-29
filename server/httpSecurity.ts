export function parseAllowedOrigins(value: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const candidate of (value ?? "").split(",")) {
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:") continue;
      if (
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        continue;
      origins.add(url.origin);
    } catch {
      // Ignore malformed origins rather than enabling permissive CORS.
    }
  }
  return origins;
}

export function isAllowedCorsOrigin(
  origin: string | undefined,
  allowedOrigins: Set<string>
): origin is string {
  return Boolean(origin && allowedOrigins.has(origin));
}
