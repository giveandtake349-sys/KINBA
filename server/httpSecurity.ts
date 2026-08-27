export function parseAllowedOrigins(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => /^https:\/\/[^\s/]+/i.test(origin)),
  );
}

export function isAllowedCorsOrigin(origin: string | undefined, allowedOrigins: Set<string>): origin is string {
  return Boolean(origin && allowedOrigins.has(origin));
}
