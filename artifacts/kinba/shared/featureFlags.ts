/**
 * Shared JHILIK feature-flag vocabulary (Phase 0 scaffold, Phase 1 runtime notes).
 *
 * Fail-closed defaults: every flag ships OFF. Server runtime storage lives in
 * the `feature_flags` table (Phase 1); missing table/row → treated as false.
 * Do not invent parallel ENABLE_* env toggles for these keys (spec §27).
 */

export const FEATURE_FLAG_KEYS = [
  "discover_v2",
  "jhilik_now",
  "time_limited_communities",
  "jhilik_drops",
  "jhilik_rewards",
  "video_rewards",
  "milestone_rewards",
  "free_verification",
  "moderation_v1",
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

/** Every flag ships disabled until its phase is deliberately enabled. */
export const FEATURE_FLAG_DEFAULTS: Readonly<Record<FeatureFlagKey, boolean>> =
  Object.freeze(
    Object.fromEntries(
      FEATURE_FLAG_KEYS.map(key => [key, false])
    ) as Record<FeatureFlagKey, boolean>
  );

/**
 * Dependency rules: a child flag is treated as OFF unless its parent is ON.
 * Enforced server-side when resolving active flags (fail closed).
 */
export const FEATURE_FLAG_DEPENDENCIES: Readonly<
  Partial<Record<FeatureFlagKey, FeatureFlagKey>>
> = Object.freeze({
  video_rewards: "jhilik_rewards",
  milestone_rewards: "jhilik_rewards",
});

export function isFeatureFlagKey(value: unknown): value is FeatureFlagKey {
  return (
    typeof value === "string" &&
    (FEATURE_FLAG_KEYS as readonly string[]).includes(value)
  );
}

/** Merge stored overrides onto defaults, then force dependency-closed children OFF. */
export function resolveFeatureFlags(
  overrides: Partial<Record<FeatureFlagKey, boolean>> | null | undefined
): Record<FeatureFlagKey, boolean> {
  const resolved: Record<FeatureFlagKey, boolean> = {
    ...FEATURE_FLAG_DEFAULTS,
  };
  if (overrides) {
    for (const key of FEATURE_FLAG_KEYS) {
      const value = overrides[key];
      if (typeof value === "boolean") resolved[key] = value;
    }
  }
  for (const [child, parent] of Object.entries(FEATURE_FLAG_DEPENDENCIES)) {
    if (!isFeatureFlagKey(child) || !isFeatureFlagKey(parent)) continue;
    if (!resolved[parent]) resolved[child] = false;
  }
  return resolved;
}
