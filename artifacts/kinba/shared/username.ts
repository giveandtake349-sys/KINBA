export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 64;
export const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

export const RESERVED_USERNAMES = new Set([
  "admin",
  "support",
  "jhilik",
  "official",
  "api",
  "app",
  "system",
  "help",
  "settings",
  "search",
  "explore",
  "notifications",
  "messages",
  "profile",
  "rooms",
  "drops",
  "followers",
  "following",
  "verified",
  "official",
  "api",
  "cdn",
  "static",
  "media",
  "uploads",
  "assets",
  "cdn",
  "www",
  "mail",
  "email",
  "blog",
  "docs",
  "help",
  "legal",
  "privacy",
  "terms",
  "security",
  "safety",
  "abuse",
  "report",
  "contact",
  "about",
  "careers",
  "jobs",
  "press",
  "news",
  "status",
  "developer",
  "developers",
  "partner",
  "partners",
  "business",
  "enterprise",
]);

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase().normalize("NFC");
}

export function validateUsername(username: string): { valid: boolean; error?: string } {
  const normalized = normalizeUsername(username);

  if (normalized.length < USERNAME_MIN_LENGTH) {
    return { valid: false, error: `Username must be at least ${USERNAME_MIN_LENGTH} characters.` };
  }

  if (normalized.length > USERNAME_MAX_LENGTH) {
    return { valid: false, error: `Username must be at most ${USERNAME_MAX_LENGTH} characters.` };
  }

  if (!/^[A-Za-z0-9_]+$/.test(normalized)) {
    return { valid: false, error: "Username can only contain letters, numbers, and underscores." };
  }

  if (RESERVED_USERNAMES.has(normalized)) {
    return { valid: false, error: "This username is reserved." };
  }

  return { valid: true };
}

export function isUsernameAvailable(username: string): boolean {
  return validateUsername(username).valid;
}

export function formatUsernameForDisplay(username: string): string {
  return `@${normalizeUsername(username)}`;
}