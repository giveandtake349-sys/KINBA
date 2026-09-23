/**
 * JHILIK feature-flag runtime (Phase 1).
 *
 * Fail-closed: missing DB/table/row → FEATURE_FLAG_DEFAULTS (all false).
 * Boot never depends on feature_flags existing — query errors are swallowed
 * into defaults so the app starts with pre-migration or empty schema.
 * In-memory cache ~30s; admin set invalidates immediately.
 */
import { eq } from "drizzle-orm";
import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAG_DEPENDENCIES,
  FEATURE_FLAG_KEYS,
  isFeatureFlagKey,
  resolveFeatureFlags,
  type FeatureFlagKey,
} from "@shared/featureFlags";
import { featureFlags } from "../drizzle/schema";
import { getDb } from "./db";

const CACHE_TTL_MS = 30_000;

type FlagCache = {
  values: Record<FeatureFlagKey, boolean>;
  expiresAt: number;
};

let cache: FlagCache | null = null;

async function loadFromDatabase(): Promise<Record<FeatureFlagKey, boolean>> {
  const db = await getDb();
  if (!db) return resolveFeatureFlags(null);
  try {
    const rows = await db.select().from(featureFlags);
    const overrides: Partial<Record<FeatureFlagKey, boolean>> = {};
    for (const row of rows) {
      if (isFeatureFlagKey(row.flagKey)) {
        overrides[row.flagKey] = Boolean(row.enabled);
      }
    }
    return resolveFeatureFlags(overrides);
  } catch (error) {
    // Table may not exist yet (pre-migration) or DB blip → fail closed.
    console.warn("[FeatureFlags] Falling back to defaults:", error);
    return resolveFeatureFlags(null);
  }
}

export async function getActiveFeatureFlags(
  options?: { forceRefresh?: boolean }
): Promise<Record<FeatureFlagKey, boolean>> {
  const now = Date.now();
  if (
    !options?.forceRefresh &&
    cache &&
    cache.expiresAt > now
  ) {
    return { ...cache.values };
  }
  const values = await loadFromDatabase();
  cache = { values, expiresAt: now + CACHE_TTL_MS };
  return { ...values };
}

export async function isFeatureFlagEnabled(
  key: FeatureFlagKey,
  options?: { forceRefresh?: boolean }
): Promise<boolean> {
  const flags = await getActiveFeatureFlags(options);
  return Boolean(flags[key]);
}

export async function setFeatureFlag(
  key: FeatureFlagKey,
  enabled: boolean,
  updatedBy: number | null
): Promise<Record<FeatureFlagKey, boolean>> {
  if (!isFeatureFlagKey(key)) {
    throw new Error("Unknown feature flag key.");
  }
  const parentKey = FEATURE_FLAG_DEPENDENCIES[key];
  if (enabled && parentKey) {
    const current = await getActiveFeatureFlags();
    if (!current[parentKey]) {
      throw new Error(
        `Enable "${parentKey}" before enabling "${key}" (dependency gate).`
      );
    }
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(featureFlags)
    .values({
      flagKey: key,
      enabled,
      description: null,
      updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: featureFlags.flagKey,
      set: {
        enabled,
        updatedBy,
        updatedAt: new Date(),
      },
    });
  cache = null;
  return getActiveFeatureFlags({ forceRefresh: true });
}

export async function listFeatureFlagRows() {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db.select().from(featureFlags);
    const byKey = new Map(rows.map(row => [row.flagKey, row]));
    // Always expose the full key set so admin UI has stable rows.
    return FEATURE_FLAG_KEYS.map(key => {
      const row = byKey.get(key);
      return {
        flagKey: key,
        enabled: row ? Boolean(row.enabled) : FEATURE_FLAG_DEFAULTS[key],
        description: row?.description ?? null,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
        persisted: Boolean(row),
      };
    });
  } catch (error) {
    console.warn("[FeatureFlags] list failed:", error);
    return FEATURE_FLAG_KEYS.map(key => ({
      flagKey: key,
      enabled: FEATURE_FLAG_DEFAULTS[key],
      description: null,
      updatedAt: null,
      updatedBy: null,
      persisted: false,
    }));
  }
}

/** Test/ops helper — clears the in-process cache. */
export function resetFeatureFlagCache(): void {
  cache = null;
}

export type { FeatureFlagKey };
export { FEATURE_FLAG_KEYS, FEATURE_FLAG_DEFAULTS, isFeatureFlagKey };
export { eq };
