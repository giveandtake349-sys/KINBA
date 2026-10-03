/**
 * App-level "reduced motion" preference.
 *
 * Stored in localStorage and mirrored onto `<html data-motion="reduced">`, which
 * the global rule in `client/src/index.css` keys off. The device-level
 * `prefers-reduced-motion` media query keeps working independently; this toggle
 * only adds a user-controlled override inside JHILIK.
 */

export const MOTION_STORAGE_KEY = "kinba-motion";

export function isReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MOTION_STORAGE_KEY) === "reduced";
}

export function setReducedMotion(enabled: boolean): void {
  if (typeof window === "undefined") return;
  if (enabled) window.localStorage.setItem(MOTION_STORAGE_KEY, "reduced");
  else window.localStorage.removeItem(MOTION_STORAGE_KEY);
  applyMotionPreference(enabled);
}

export function applyMotionPreference(enabled: boolean): void {
  if (typeof document === "undefined") return;
  if (enabled) document.documentElement.setAttribute("data-motion", "reduced");
  else document.documentElement.removeAttribute("data-motion");
}

/** Boot-time sync so a saved preference survives a full page reload. */
export function applyStoredMotionPreference(): void {
  applyMotionPreference(isReducedMotion());
}
