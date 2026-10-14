/**
 * JHILIK Brand Advertising — Phase 6: video pre-roll ads.
 *
 * FB-style continuous run: a pre-roll ad has no mandatory end date. It
 * keeps serving until the budget is exhausted or the advertiser (or an
 * admin) manually pauses/ends it — same manual control model as Phase 3
 * campaigns (no cron in MVP).
 *
 * Money (per-play, NOT lump sum): each recorded play charges the brand a
 * fixed per-play rate (admin-set, cents). 55% goes to the creator whose
 * video the ad played before — credited in-transaction to the fiat
 * campaign_earnings ledger (campaignId NULL, prerollPlayId set). 45%
 * stays with the platform (tracked on the play row). Earnings accumulate
 * in the ledger and are visible in Studio → Earnings; actual payout is
 * the later payment module's job — no collection/payout here.
 *
 * Visibility rules (enforced here, not just in UI):
 *   - Creator sees ONLY their own earnings rows (amount/currency/status).
 *     They NEVER see brand budgets, spend, or other creators' data.
 *   - Advertiser ("brand" = user who advertises) sees ONLY their own ads.
 *   - Admins see everything + the eligibility settings.
 *
 * Anti-abuse: DB-backed rate limits on both endpoints, salted viewerHash
 * (never raw IP), bot UA filtering, per-viewer daily play cap, and the
 * budget check runs inside a row-locked transaction so concurrent plays
 * cannot overspend.
 */
import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  campaignEarnings,
  drops,
  follows,
  prerollAds,
  prerollPlays,
  prerollSettings,
  users,
  videos,
} from "../drizzle/schema";
import {
  assertTransition,
  PREROLL_AD_STATUSES,
  PREROLL_AD_TRANSITIONS,
  type PrerollAdStatus,
} from "../shared/stateMachines";
import { BOT_UA_RE, hashViewerIp } from "./analytics";
import { getDb } from "./db";
import { storageCreateUploadUrl } from "./storage";

/* ------------------------------------------------------------------ */
/* Constants + validation                                              */
/* ------------------------------------------------------------------ */

export const PREROLL_CURRENCIES = ["USD", "BDT"] as const;

/** Revenue split: 55% creator / 45% platform, integer math in cents. */
export const CREATOR_SHARE_PCT = 55;

export function splitRevenueCents(revenueCents: number): {
  creatorShareCents: number;
  platformShareCents: number;
} {
  const creatorShareCents = Math.round((revenueCents * CREATOR_SHARE_PCT) / 100);
  return {
    creatorShareCents,
    platformShareCents: revenueCents - creatorShareCents,
  };
}

const adTitleInput = z.string().trim().min(1).max(120);
const videoUrlInput = z
  .string()
  .trim()
  .url()
  .max(1024)
  .refine(u => u.startsWith("https://"), "Ad video URL must be https.");
const currencyInput = z.enum(PREROLL_CURRENCIES);

export const createAdInput = z.object({
  title: adTitleInput,
  videoUrl: videoUrlInput,
  thumbnailUrl: z.string().trim().url().max(1024).nullish(),
  dropId: z.number().int().positive().nullish(),
  budgetCents: z.number().int().min(100).max(100_000_000),
  currency: currencyInput.default("USD"),
  startsAt: z.string().datetime({ offset: true }).nullish(),
});

export const adStatusInput = z.object({
  adId: z.number().int().positive(),
  status: z.enum(PREROLL_AD_STATUSES),
});

export const getAdForVideoInput = z.object({
  videoId: z.number().int().positive(),
});

export const reportPlayInput = z.object({
  adId: z.number().int().positive(),
  videoId: z.number().int().positive(),
  watchedSecs: z.number().int().min(0).max(3600),
  skipped: z.boolean(),
});

export const updateSettingsInput = z.object({
  minFollowers: z.number().int().min(0).max(10_000_000),
  minViews: z.number().int().min(0).max(1_000_000_000),
  costPerPlayCents: z.number().int().min(1).max(10_000),
  maxPlaysPerViewerPerDay: z.number().int().min(1).max(10_000),
});

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export type PrerollSettings = {
  minFollowers: number;
  minViews: number;
  costPerPlayCents: number;
  maxPlaysPerViewerPerDay: number;
};

const DEFAULT_SETTINGS: PrerollSettings = {
  minFollowers: 1000,
  minViews: 10000,
  costPerPlayCents: 2,
  maxPlaysPerViewerPerDay: 20,
};

/** Read the single settings row, seeding defaults on first use. */
export async function getPrerollSettings(): Promise<PrerollSettings> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(prerollSettings)
    .where(eq(prerollSettings.id, 1))
    .limit(1);
  if (row) {
    return {
      minFollowers: row.minFollowers,
      minViews: row.minViews,
      costPerPlayCents: row.costPerPlayCents,
      maxPlaysPerViewerPerDay: row.maxPlaysPerViewerPerDay,
    };
  }
  await db.insert(prerollSettings).values({ id: 1, ...DEFAULT_SETTINGS });
  return { ...DEFAULT_SETTINGS };
}

export async function updatePrerollSettings(
  input: z.infer<typeof updateSettingsInput>
): Promise<PrerollSettings> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  // Ensure the row exists first (upsert by fixed id).
  await db
    .insert(prerollSettings)
    .values({ id: 1, ...DEFAULT_SETTINGS })
    .onConflictDoNothing({ target: prerollSettings.id });
  const [row] = await db
    .update(prerollSettings)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(prerollSettings.id, 1))
    .returning();
  if (!row) throw new Error("Could not update pre-roll settings.");
  return {
    minFollowers: row.minFollowers,
    minViews: row.minViews,
    costPerPlayCents: row.costPerPlayCents,
    maxPlaysPerViewerPerDay: row.maxPlaysPerViewerPerDay,
  };
}

/* ------------------------------------------------------------------ */
/* Eligibility                                                         */
/* ------------------------------------------------------------------ */

/**
 * A creator is eligible for pre-roll ads when they meet BOTH admin-set
 * criteria: followers >= minFollowers AND lifetime video views >= minViews.
 * New/small accounts are excluded.
 */
export async function isCreatorEligible(
  creatorId: number,
  settings?: PrerollSettings
): Promise<{ eligible: boolean; followers: number; totalViews: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const s = settings ?? (await getPrerollSettings());
  const [f] = await db
    .select({ n: sql<number>`count(*)` })
    .from(follows)
    .where(eq(follows.followedId, creatorId));
  const followers = Number(f?.n ?? 0);
  const [v] = await db
    .select({ n: sql<number>`coalesce(sum(${videos.viewCount}), 0)` })
    .from(videos)
    .where(eq(videos.userId, creatorId));
  const totalViews = Number(v?.n ?? 0);
  return {
    eligible: followers >= s.minFollowers && totalViews >= s.minViews,
    followers,
    totalViews,
  };
}

/* ------------------------------------------------------------------ */
/* Ad serving                                                          */
/* ------------------------------------------------------------------ */

export type ServedPrerollAd = {
  id: number;
  title: string;
  videoUrl: string;
  brandName: string;
  drop: {
    id: number;
    title: string;
    price: string;
    currency: string;
    mediaUrl: string;
  } | null;
};

/**
 * Pick a pre-roll ad for a video, or null when no ad should play:
 * ineligible creator, viewer daily cap hit, or no active ad with budget.
 * Public — viewers may be logged out. Rate-limited by the caller.
 */
export async function getAdForVideo(
  videoId: number,
  viewerHash: string
): Promise<ServedPrerollAd | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const settings = await getPrerollSettings();

  const [video] = await db
    .select({ id: videos.id, userId: videos.userId })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);
  if (!video) return null;

  // Only eligible creators' videos carry ads.
  const { eligible } = await isCreatorEligible(video.userId, settings);
  if (!eligible) return null;

  // Per-viewer daily abuse cap.
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [cap] = await db
    .select({ n: sql<number>`count(*)` })
    .from(prerollPlays)
    .where(
      and(
        eq(prerollPlays.viewerHash, viewerHash),
        gte(prerollPlays.createdAt, dayStart)
      )
    );
  if (Number(cap?.n ?? 0) >= settings.maxPlaysPerViewerPerDay) return null;

  // Active ads with remaining budget and (optional) start date reached.
  // Random pick spreads spend across advertisers.
  const [ad] = await db
    .select({
      id: prerollAds.id,
      title: prerollAds.title,
      videoUrl: prerollAds.videoUrl,
      dropId: prerollAds.dropId,
      brandName: users.name,
    })
    .from(prerollAds)
    .innerJoin(users, eq(users.id, prerollAds.userId))
    .where(
      and(
        eq(prerollAds.status, "active"),
        or(
          isNull(prerollAds.startsAt),
          lte(prerollAds.startsAt, new Date())
        ),
        sql`${prerollAds.spentCents} + ${settings.costPerPlayCents} <= ${prerollAds.budgetCents}`
      )
    )
    .orderBy(sql`random()`)
    .limit(1);
  if (!ad) return null;

  let drop: ServedPrerollAd["drop"] = null;
  if (ad.dropId != null) {
    const [d] = await db
      .select({
        id: drops.id,
        title: drops.title,
        price: drops.discountedPrice,
        currency: drops.currency,
        mediaUrl: drops.mediaUrl,
      })
      .from(drops)
      .where(eq(drops.id, ad.dropId))
      .limit(1);
    if (d) {
      drop = {
        id: d.id,
        title: d.title,
        price: String(d.price),
        currency: d.currency,
        mediaUrl: d.mediaUrl,
      };
    }
  }

  return {
    id: ad.id,
    title: ad.title,
    videoUrl: ad.videoUrl,
    brandName: ad.brandName ?? "Sponsored",
    drop,
  };
}

/* ------------------------------------------------------------------ */
/* Play reporting + revenue credit                                     */
/* ------------------------------------------------------------------ */

export type ReportedPlay = {
  playId: number;
  revenueCents: number;
  creatorShareCents: number;
  platformShareCents: number;
};

/**
 * Record one pre-roll play and credit the creator in-transaction
 * (same pattern as Phase 4's earning credit). The budget check runs
 * under a row lock so concurrent plays cannot overspend the ad.
 */
export async function reportPlay(opts: {
  adId: number;
  videoId: number;
  watchedSecs: number;
  skipped: boolean;
  viewerHash: string;
}): Promise<ReportedPlay> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const settings = await getPrerollSettings();
  const cost = settings.costPerPlayCents;
  const { creatorShareCents, platformShareCents } = splitRevenueCents(cost);

  return db.transaction(async tx => {
    // Row-lock the ad: the budget gate for concurrent plays.
    const [ad] = await tx
      .select()
      .from(prerollAds)
      .where(eq(prerollAds.id, opts.adId))
      .for("update")
      .limit(1);
    if (!ad) throw new Error("Ad not found.");
    if (ad.status !== "active") throw new Error("Ad is not active.");
    if (ad.spentCents + cost > ad.budgetCents) {
      throw new Error("Ad budget exhausted.");
    }
    if (ad.startsAt && ad.startsAt.getTime() > Date.now()) {
      throw new Error("Ad has not started yet.");
    }

    const [video] = await tx
      .select({ id: videos.id, userId: videos.userId })
      .from(videos)
      .where(eq(videos.id, opts.videoId))
      .limit(1);
    if (!video) throw new Error("Video not found.");

    const completed = !opts.skipped && opts.watchedSecs >= 5;

    const [play] = await tx
      .insert(prerollPlays)
      .values({
        adId: ad.id,
        videoId: video.id,
        creatorId: video.userId,
        viewerHash: opts.viewerHash,
        watchedSecs: opts.watchedSecs,
        skipped: opts.skipped,
        completed,
        revenueCents: cost,
        creatorShareCents,
      })
      .returning({ id: prerollPlays.id });

    await tx
      .update(prerollAds)
      .set({
        spentCents: sql`${prerollAds.spentCents} + ${cost}`,
        updatedAt: new Date(),
      })
      .where(eq(prerollAds.id, ad.id));

    // Creator credit: 55% into the fiat ledger. Auto-approved (no admin
    // review for pre-roll) — idempotent per play via the play id.
    // Amount is numeric(12,2) dollars; cents → dollars conversion here.
    await tx
      .insert(campaignEarnings)
      .values({
        campaignId: null,
        prerollPlayId: play?.id ?? null,
        creatorId: video.userId,
        amount: (creatorShareCents / 100).toFixed(2),
        currency: ad.currency,
        status: "approved",
        idempotencyKey: `preroll:${play?.id}`,
        reason: "Pre-roll ad revenue share (55%)",
        decidedAt: new Date(),
      })
      .onConflictDoNothing({ target: campaignEarnings.idempotencyKey });

    return {
      playId: play?.id ?? 0,
      revenueCents: cost,
      creatorShareCents,
      platformShareCents,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Advertiser: create + manage ads                                     */
/* ------------------------------------------------------------------ */

const PREROLL_AD_VIDEO_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;
const MAX_PREROLL_AD_BYTES = 50 * 1024 * 1024;
const PREROLL_AD_KEY_PREFIX = "preroll-ads/";

/**
 * Signed browser→R2 PUT URL for a pre-roll ad video. Public bucket —
 * the ad plays in the video player. Key is minted server-side.
 */
export async function createAdUploadUrl(
  userId: number,
  contentType: string,
  fileName: string,
  fileSize: number
): Promise<{ key: string; uploadUrl: string; publicUrl: string }> {
  if (!(PREROLL_AD_VIDEO_TYPES as readonly string[]).includes(contentType)) {
    throw new Error("Only MP4, WebM, or MOV ad videos are accepted.");
  }
  if (
    !Number.isSafeInteger(fileSize) ||
    fileSize < 1 ||
    fileSize > MAX_PREROLL_AD_BYTES
  ) {
    throw new Error("Ad video must be between 1 byte and 50 MB.");
  }
  const clean =
    fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "ad-video";
  const relKey = `${PREROLL_AD_KEY_PREFIX}${userId}/${Date.now()}-${clean}`;
  const { key, url, publicUrl } = await storageCreateUploadUrl(
    relKey,
    contentType
  );
  return { key, uploadUrl: url, publicUrl };
}

export async function createAd(
  userId: number,
  input: z.infer<typeof createAdInput>
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Drop link must exist, be owned by the advertiser, and not be archived.
  let dropId: number | null = null;
  if (input.dropId != null) {
    const [drop] = await db
      .select({ id: drops.id, sellerId: drops.sellerId, status: drops.status })
      .from(drops)
      .where(eq(drops.id, input.dropId))
      .limit(1);
    if (!drop) throw new Error("Drop not found.");
    if (drop.sellerId !== userId)
      throw new Error("You can only attach your own drops.");
    if (drop.status === "archived")
      throw new Error("Archived drops cannot be attached.");
    dropId = drop.id;
  }

  const [ad] = await db
    .insert(prerollAds)
    .values({
      userId,
      title: input.title,
      videoUrl: input.videoUrl,
      thumbnailUrl: input.thumbnailUrl ?? null,
      dropId,
      status: "draft",
      budgetCents: input.budgetCents,
      currency: input.currency,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
    })
    .returning({ id: prerollAds.id });
  return { id: ad?.id ?? 0 };
}

export type MyPrerollAd = {
  id: number;
  title: string;
  videoUrl: string;
  thumbnailUrl: string | null;
  status: PrerollAdStatus;
  budgetCents: number;
  spentCents: number;
  currency: string;
  plays: number;
  completedPlays: number;
  completionRate: number | null;
  createdAt: Date | null;
};

/** Advertiser's own video ads with real stats. Never other users' ads. */
export async function listMyAds(userId: number): Promise<MyPrerollAd[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select({
      id: prerollAds.id,
      title: prerollAds.title,
      videoUrl: prerollAds.videoUrl,
      thumbnailUrl: prerollAds.thumbnailUrl,
      status: prerollAds.status,
      budgetCents: prerollAds.budgetCents,
      spentCents: prerollAds.spentCents,
      currency: prerollAds.currency,
      createdAt: prerollAds.createdAt,
      plays: sql<number>`count(${prerollPlays.id})`,
      completedPlays: sql<number>`count(*) filter (where ${prerollPlays.completed})`,
    })
    .from(prerollAds)
    .leftJoin(prerollPlays, eq(prerollPlays.adId, prerollAds.id))
    .where(eq(prerollAds.userId, userId))
    .groupBy(prerollAds.id)
    .orderBy(desc(prerollAds.createdAt));
  return rows.map(r => {
    const plays = Number(r.plays ?? 0);
    const completedPlays = Number(r.completedPlays ?? 0);
    return {
      id: r.id,
      title: r.title,
      videoUrl: r.videoUrl,
      thumbnailUrl: r.thumbnailUrl,
      status: r.status,
      budgetCents: r.budgetCents,
      spentCents: r.spentCents,
      currency: r.currency,
      plays,
      completedPlays,
      completionRate:
        plays > 0 ? Math.round((completedPlays / plays) * 1000) / 10 : null,
      createdAt: r.createdAt,
    };
  });
}

/**
 * Advertiser moves their own ad through the lifecycle. Manual control —
 * no cron. Same model as Phase 3 campaign Activate/Pause/End.
 */
export async function updateAdStatus(
  userId: number,
  adId: number,
  toStatus: PrerollAdStatus
): Promise<{ id: number; status: PrerollAdStatus }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [ad] = await db
    .select({ id: prerollAds.id, userId: prerollAds.userId, status: prerollAds.status })
    .from(prerollAds)
    .where(eq(prerollAds.id, adId))
    .limit(1);
  if (!ad || ad.userId !== userId) throw new Error("Ad not found.");
  // Draft approval is admin-only — the advertiser cannot self-activate.
  if (ad.status === "draft" && toStatus === "active") {
    throw new Error("Only an admin can approve a draft ad.");
  }
  assertTransition(
    PREROLL_AD_TRANSITIONS,
    ad.status as PrerollAdStatus,
    toStatus,
    "pre-roll ad status"
  );
  const [updated] = await db
    .update(prerollAds)
    .set({ status: toStatus, updatedAt: new Date() })
    .where(eq(prerollAds.id, adId))
    .returning({ id: prerollAds.id, status: prerollAds.status });
  if (!updated) throw new Error("Could not update ad status.");
  return { id: updated.id, status: updated.status };
}

/** Advertiser's own sellable drops for the attach-drop picker. */
export async function listMyDropsForAds(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select({
      id: drops.id,
      title: drops.title,
      discountedPrice: drops.discountedPrice,
      currency: drops.currency,
      mediaUrl: drops.mediaUrl,
      status: drops.status,
    })
    .from(drops)
    .where(
      and(
        eq(drops.sellerId, userId),
        sql`${drops.status} != 'archived'`
      )
    )
    .orderBy(desc(drops.createdAt))
    .limit(50);
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export type AdminPrerollAd = MyPrerollAd & {
  advertiserName: string | null;
  revenueCents: number;
  creatorPayoutCents: number;
};

/** All video ads, newest first. Admin-only. */
export async function adminListAds(opts: {
  status?: PrerollAdStatus;
  limit: number;
  offset: number;
}): Promise<AdminPrerollAd[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select({
      id: prerollAds.id,
      title: prerollAds.title,
      videoUrl: prerollAds.videoUrl,
      thumbnailUrl: prerollAds.thumbnailUrl,
      status: prerollAds.status,
      budgetCents: prerollAds.budgetCents,
      spentCents: prerollAds.spentCents,
      currency: prerollAds.currency,
      createdAt: prerollAds.createdAt,
      advertiserName: users.name,
      plays: sql<number>`count(${prerollPlays.id})`,
      completedPlays: sql<number>`count(*) filter (where ${prerollPlays.completed})`,
      revenueCents: sql<number>`coalesce(sum(${prerollPlays.revenueCents}), 0)`,
      creatorPayoutCents: sql<number>`coalesce(sum(${prerollPlays.creatorShareCents}), 0)`,
    })
    .from(prerollAds)
    .innerJoin(users, eq(users.id, prerollAds.userId))
    .leftJoin(prerollPlays, eq(prerollPlays.adId, prerollAds.id))
    .where(
      opts.status ? eq(prerollAds.status, opts.status) : undefined
    )
    .groupBy(prerollAds.id, users.name)
    .orderBy(desc(prerollAds.createdAt))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map(r => {
    const plays = Number(r.plays ?? 0);
    const completedPlays = Number(r.completedPlays ?? 0);
    return {
      id: r.id,
      title: r.title,
      videoUrl: r.videoUrl,
      thumbnailUrl: r.thumbnailUrl,
      status: r.status,
      budgetCents: r.budgetCents,
      spentCents: r.spentCents,
      currency: r.currency,
      plays,
      completedPlays,
      completionRate:
        plays > 0 ? Math.round((completedPlays / plays) * 1000) / 10 : null,
      createdAt: r.createdAt,
      advertiserName: r.advertiserName,
      revenueCents: Number(r.revenueCents ?? 0),
      creatorPayoutCents: Number(r.creatorPayoutCents ?? 0),
    };
  });
}

/** Admin approves/pauses/ends any ad. */
export async function adminUpdateAdStatus(
  adId: number,
  toStatus: PrerollAdStatus
): Promise<{ id: number; status: PrerollAdStatus }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [ad] = await db
    .select({ id: prerollAds.id, status: prerollAds.status })
    .from(prerollAds)
    .where(eq(prerollAds.id, adId))
    .limit(1);
  if (!ad) throw new Error("Ad not found.");
  assertTransition(
    PREROLL_AD_TRANSITIONS,
    ad.status as PrerollAdStatus,
    toStatus,
    "pre-roll ad status"
  );
  const [updated] = await db
    .update(prerollAds)
    .set({ status: toStatus, updatedAt: new Date() })
    .where(eq(prerollAds.id, adId))
    .returning({ id: prerollAds.id, status: prerollAds.status });
  if (!updated) throw new Error("Could not update ad status.");
  return { id: updated.id, status: updated.status };
}

/** Platform-wide pre-roll totals. Admin-only. */
export async function adminPrerollStats(): Promise<{
  totalAds: number;
  activeAds: number;
  totalPlays: number;
  totalRevenueCents: number;
  totalCreatorPayoutCents: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [a] = await db
    .select({
      total: sql<number>`count(*)`,
      active: sql<number>`count(*) filter (where ${prerollAds.status} = 'active')`,
    })
    .from(prerollAds);
  const [p] = await db
    .select({
      plays: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(${prerollPlays.revenueCents}), 0)`,
      payout: sql<number>`coalesce(sum(${prerollPlays.creatorShareCents}), 0)`,
    })
    .from(prerollPlays);
  return {
    totalAds: Number(a?.total ?? 0),
    activeAds: Number(a?.active ?? 0),
    totalPlays: Number(p?.plays ?? 0),
    totalRevenueCents: Number(p?.revenue ?? 0),
    totalCreatorPayoutCents: Number(p?.payout ?? 0),
  };
}

/** Bot UA check shared with the analytics pipeline. */
export function isBotUserAgent(userAgent: string | undefined): boolean {
  return !!userAgent && BOT_UA_RE.test(userAgent);
}

export function hashViewer(ip: string, salt: string): string {
  return hashViewerIp(ip, salt);
}
