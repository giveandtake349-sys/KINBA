import { supabase } from "@/lib/supabase";

const RETURN_PATH_KEY = "kinba-auth-oauth-return";
const INTENT_KEY = "kinba-auth-oauth-intent";

export type GoogleOAuthIntent = "sign-in" | "link";

/**
 * Where Supabase sends the browser back to after the Google round trip.
 * BASE_URL is "/" by default and already ends with a slash, so this works for
 * local dev (http://localhost:4173) and production hosts alike as long as the
 * URL is allow-listed in the Supabase dashboard.
 */
export function googleCallbackUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}auth/callback`;
}

function rememberIntent(intent: GoogleOAuthIntent, returnPath?: string) {
  const path =
    returnPath ?? `${window.location.pathname}${window.location.search}`;
  window.sessionStorage.setItem(INTENT_KEY, intent);
  window.sessionStorage.setItem(RETURN_PATH_KEY, path);
}

export function takeOAuthIntent(): GoogleOAuthIntent {
  const value = window.sessionStorage.getItem(INTENT_KEY);
  window.sessionStorage.removeItem(INTENT_KEY);
  return value === "link" ? "link" : "sign-in";
}

/**
 * Read the pending intent without consuming it. Supabase strips `?code=` from
 * the URL as soon as the PKCE exchange finishes, so the callback page must key
 * off "did this tab start an OAuth flow?" rather than off URL params.
 */
export function peekOAuthIntent(): GoogleOAuthIntent | null {
  const value = window.sessionStorage.getItem(INTENT_KEY);
  if (value !== "sign-in" && value !== "link") return null;
  return value;
}

export function takeOAuthReturnPath(): string {
  const value = window.sessionStorage.getItem(RETURN_PATH_KEY);
  window.sessionStorage.removeItem(RETURN_PATH_KEY);
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

/** Sign in (or sign up) with Google as a brand new / existing Supabase user. */
export async function startGoogleSignIn(returnPath?: string): Promise<void> {
  rememberIntent("sign-in", returnPath);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: googleCallbackUrl() },
  });
  if (error) throw error;
}

/** Attach the Google identity to the already signed-in Supabase user. */
export async function startGoogleLink(returnPath?: string): Promise<void> {
  rememberIntent("link", returnPath);
  const { error } = await supabase.auth.linkIdentity({
    provider: "google",
    options: { redirectTo: googleCallbackUrl() },
  });
  if (error) throw error;
}

export function describeOAuthError(
  code: string | null | undefined,
  description?: string | null
): string {
  switch (code) {
    case "identity_already_exists":
      return "That Google account is already linked to another KINBA account.";
    case "manual_linking_disabled":
      return "Account linking is disabled for this project. Turn on manual linking in Supabase Auth settings.";
    case "provider_email_needs_confirmation":
      return "Confirm the Google account email before linking it.";
    case "validation_failed":
      return "Google sign-in failed validation. Please try again.";
    case "access_denied":
      return "Google sign-in was cancelled.";
    case "server_error":
    case "temporarily_unavailable":
      return "Google sign-in is temporarily unavailable. Please try again.";
    case "unexpected_failure":
      return "Google sign-in could not be completed. Please try again.";
    default: {
      const fallback = description?.trim();
      if (code && fallback) return `${fallback} (${code})`;
      if (fallback) return fallback;
      if (code) return `Google sign-in failed: ${code}`;
      return "Google sign-in could not be completed. Please try again.";
    }
  }
}

/** Turn any thrown auth-js error into a message a user can act on. */
export function oauthErrorMessage(error: unknown, fallback: string): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "") || null
      : null;
  const message = error instanceof Error ? error.message : undefined;
  if (!code && !message) return fallback;
  return describeOAuthError(code, message);
}
