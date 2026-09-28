/**
 * Optional haptics for reaction gestures.
 *
 * Vibration is purely advisory: it is guarded so unsupported platforms (iOS
 * Safari, desktop, jsdom) and blocked contexts no-op instead of throwing, and
 * no dependency is added for it.
 */

export type HapticPattern = "light" | "medium" | "success";

const PATTERNS: Record<HapticPattern, VibratePattern> = {
  light: 8,
  medium: 20,
  success: [0, 14, 45, 14],
};

export function haptic(pattern: HapticPattern = "light"): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Some embedders throw on denied vibration — never let that break a tap.
  }
}
