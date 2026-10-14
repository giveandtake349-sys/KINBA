/**
 * JHILIK Brand Advertising — Phase 5: real measurement.
 *
 * Replaces the cosmetic in-memory viewDedup for analytics-grade tracking:
 *   - trackView / trackImpression write to video_view_events /
 *     video_impressions with DB-enforced dedup (unique per
 *     videoId + viewerHash + day — survives restarts, multi-instance safe).
 *   - Viewer identity = sha256(salt + UTC-day + ip); salt rotates daily in
 *     the hash input so old hashes become unlinkable. NEVER a raw IP.
 *   - Creator self-views are excluded at record time.
 *   - Known bot user-agents are skipped (redirected, not counted).
 *   - Hot paths are guarded by a DB-backed rate limiter (rate_limit_buckets)
 *     so limits hold across instances (the Express in-memory limiter does not).
 *   - Dashboards use lazy rollup: reads compute daily_content_stats /
 *     daily_campaign_stats on demand (no cron infra exists). Every number
 *     comes from the real DB; thin data renders an honest "not enough data
 *     yet" instead of invented figures.
 *
 * Privacy: hashed viewer ids only, truncated user-agents, no PII in event
 * tables. Rewards are NEVER tied to these counters in MVP (submission-based
 * + admin-approved only, per Phase-0 decision).
 */
import { createHash } from "node:crypto";
import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import {
  brandApplications,
  brands,
  campaignEarnings,
  campaignInvitations,
  campaigns,
  dailyCampaignStats,
  dailyContentStats,
  linkClicks,
  profiles,
  rateLimitBuckets,
  videoComments,
  videoImpressions,
  videoReactions,
  videoShares,
  videos,
  videoViewEvents,
} from "../drizzle/schema";
import { getDb } from "./db";

/* ------------------------------------------------------------------ */
/* Viewer identity + bot filtering                                      */
/* ------------------------------------------------------------------ */

/** Shared bot UA pattern (same semantics as the /r/:linkId route). */
export const BOT_UA_RE =
  /(bot|crawler|spider|facebookexternalhit|whatsapp|slack|twitter|embedly|pinterest|linkedinbot|discordbot|telegrambot)/i;

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && BOT_UA_RE.test(userAgent);
}

/** UTC calendar day, YYYY-MM-DD — the dedup window for view/impression events. */
export function viewerDayUTC(when: Date = new Date()): string {
  return when.toISOString().slice(0, 10);
}

/**
 * One-way viewer hash. The UTC day is part of the hash input, so the same
 * IP maps to a different hash each day (old hashes become unlinkable —
 * privacy by design). Raw IPs are never stored.
 */
export function hashViewerIp(ip: string, salt: string): string {
  return createHash("sha256")
    .update(`${salt}:${viewerDayUTC()}:${ip}`)
    .digest("hex");
}

export const TRACK_SOURCES = ["feed", "shorts", "detail", "embed"] as const;
export type TrackSource = (typeof TRACK_SOURCES)[number];

/* ------------------------------------------------------------------ */
/* DB-backed rate limiter (multi-instance safe)                         */
/* ------------------------------------------------------------------ */

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSec: number;
};

/**
 * Fixed-window rate limiter backed by rate_limit_buckets. The increment is
 * a single atomic upsert, so concurrent instances share one counter.
 * Fail-open when the DB is unreachable: tracking must never break UX.
 */
export async function checkDbRateLimit(opts: {
  key: string;
  windowMs: number;
  max: number;
}): Promise<RateLimitResult> {
  const db = await getDb();
  if (!db) return { allowed: true, retryAfterSec: 0 };
  const now = Date.now();
  const windowStart = new Date(
    Math.floor(now / opts.windowMs) * opts.windowMs
  );
  const [row] = await db
    .insert(rateLimitBuckets)
    .values({ key: opts.key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
      set: { count: sql`${rateLimitBuckets.count} + 1` },
    })
    .returning({ count: rateLimitBuckets.count });
  const current = Number(row?.count ?? 1);
  if (current > opts.max) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((windowStart.getTime() + opts.windowMs - now) / 1000)
    );
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true, retryAfterSec: 0 };
}

/* ------------------------------------------------------------------ */
/* Event recording (views + impressions)                                */
/* ------------------------------------------------------------------ */

export type TrackEventInput = {
  /** Id of a row in the unified content table ("videos": VIDEO/IMAGE/TEXT). */
  contentId: number;
  source?: string | null;
  userId?: number | null;
  ip: string;
  ipSalt: string;
  userAgent?: string | null;
};

export type TrackEventResult = {
  counted: boolean;
  reason?: "bot" | "self-view" | "duplicate" | "not-found" | "db-unavailable";
};

async function loadVideoForTracking(videoId: number) {
  const db = await getDb();
  if (!db) return null;
  const [video] = await db
    .select({
      id: videos.id,
      userId: videos.userId,
      campaignId: videos.campaignId,
      mediaType: videos.mediaType,
    })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);
  return video ?? null;
}

/**
 * Record one view event. Dedup is enforced by the DB unique index
 * (videoId, viewerHash, day) — the same viewer counts once per video per
 * day. The legacy videos.viewCount increments ONLY on a genuinely new
 * insert, keeping the old counter consistent with the event table.
 * Creator self-views are excluded entirely.
 */
export async function recordViewEvent(
  input: TrackEventInput
): Promise<TrackEventResult> {
  const db = await getDb();
  if (!db) return { counted: false, reason: "db-unavailable" };
  const userAgent = input.userAgent ?? "";
  if (isBotUserAgent(userAgent))
    return { counted: false, reason: "bot" };
  const video = await loadVideoForTracking(input.contentId);
  if (!video) return { counted: false, reason: "not-found" };
  if (input.userId != null && input.userId === video.userId) {
    return { counted: false, reason: "self-view" };
  }
  const day = viewerDayUTC();
  const viewerHash = hashViewerIp(input.ip, input.ipSalt);
  const inserted = await db
    .insert(videoViewEvents)
    .values({
      videoId: video.id,
      contentType: video.mediaType,
      campaignId: video.campaignId,
      viewerHash,
      userId: input.userId ?? null,
      userAgent: userAgent ? userAgent.slice(0, 512) : null,
      source: input.source ?? null,
      day,
    })
    .onConflictDoNothing({
      target: [
        videoViewEvents.videoId,
        videoViewEvents.viewerHash,
        videoViewEvents.day,
      ],
    })
    .returning({ id: videoViewEvents.id });
  if (inserted.length === 0) return { counted: false, reason: "duplicate" };
  await db
    .update(videos)
    .set({ viewCount: sql`${videos.viewCount} + 1` })
    .where(eq(videos.id, video.id));
  return { counted: true };
}

/**
 * Record one impression event (card entered the viewport). Same dedup and
 * self-view rules as views; no legacy counter to maintain.
 */
export async function recordImpressionEvent(
  input: TrackEventInput
): Promise<TrackEventResult> {
  const db = await getDb();
  if (!db) return { counted: false, reason: "db-unavailable" };
  const userAgent = input.userAgent ?? "";
  if (isBotUserAgent(userAgent))
    return { counted: false, reason: "bot" };
  const video = await loadVideoForTracking(input.contentId);
  if (!video) return { counted: false, reason: "not-found" };
  if (input.userId != null && input.userId === video.userId) {
    return { counted: false, reason: "self-view" };
  }
  const day = viewerDayUTC();
  const viewerHash = hashViewerIp(input.ip, input.ipSalt);
  const inserted = await db
    .insert(videoImpressions)
    .values({
      videoId: video.id,
      contentType: video.mediaType,
      campaignId: video.campaignId,
      viewerHash,
      userId: input.userId ?? null,
      day,
    })
    .onConflictDoNothing({
      target: [
        videoImpressions.videoId,
        videoImpressions.viewerHash,
        videoImpressions.day,
      ],
    })
    .returning({ id: videoImpressions.id });
  if (inserted.length === 0) return { counted: false, reason: "duplicate" };
  return { counted: true };
}

/* ------------------------------------------------------------------ */
/* Lazy rollup (no cron infra exists)                                   */
/* ------------------------------------------------------------------ */

/**
 * Aggregate one video-day from the event tables into daily_content_stats.
 * Idempotent upsert — safe to call on every dashboard read.
 */
export async function rollupVideoDay(
  videoId: number,
  day: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const [video] = await db
    .select({ mediaType: videos.mediaType })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);
  const [viewAgg] = await db
    .select({
      views: count(videoViewEvents.id),
      uniqueViewers:
        sql<number>`count(distinct ${videoViewEvents.viewerHash})`,
    })
    .from(videoViewEvents)
    .where(
      and(eq(videoViewEvents.videoId, videoId), eq(videoViewEvents.day, day))
    );
  const [impAgg] = await db
    .select({ impressions: count(videoImpressions.id) })
    .from(videoImpressions)
    .where(
      and(eq(videoImpressions.videoId, videoId), eq(videoImpressions.day, day))
    );
  const [clickAgg] = await db
    .select({ clicks: count(linkClicks.id) })
    .from(linkClicks)
    .where(and(eq(linkClicks.videoId, videoId), eq(linkClicks.day, day)));
  const row = {
    videoId,
    day,
    contentType: video?.mediaType ?? null,
    views: Number(viewAgg?.views ?? 0),
    impressions: Number(impAgg?.impressions ?? 0),
    clicks: Number(clickAgg?.clicks ?? 0),
    uniqueViewers: Number(viewAgg?.uniqueViewers ?? 0),
  };
  await db
    .insert(dailyContentStats)
    .values(row)
    .onConflictDoUpdate({
      target: [dailyContentStats.videoId, dailyContentStats.day],
      set: {
        contentType: row.contentType,
        views: row.views,
        impressions: row.impressions,
        clicks: row.clicks,
        uniqueViewers: row.uniqueViewers,
      },
    });
}

/**
 * Bulk rollup for a creator's videos over N days.
 *
 * FIX (2026-10-14): getCreatorStats used to call rollupVideoDay() in a
 * nested per-video-per-day loop — up to 50 videos × 7 days × 5 queries =
 * 1,750 SEQUENTIAL DB round-trips per dashboard load. On a real network
 * that took minutes, leaving the Studio Analytics tab stuck on
 * "Loading analytics…" forever. This version aggregates everything with
 * 3 GROUP BY queries + 1 bulk upsert (chunked), same idempotent result.
 */
export async function rollupVideosBulk(
  videoIds: number[],
  dayList: string[],
  mediaTypeById: Map<number, ContentTypeKey | null>
): Promise<void> {
  const db = await getDb();
  if (!db || videoIds.length === 0 || dayList.length === 0) return;
  const fromDay = dayList[0];

  const viewRows = await db
    .select({
      videoId: videoViewEvents.videoId,
      day: videoViewEvents.day,
      views: count(videoViewEvents.id),
      uniqueViewers:
        sql<number>`count(distinct ${videoViewEvents.viewerHash})`,
    })
    .from(videoViewEvents)
    .where(
      and(
        inArray(videoViewEvents.videoId, videoIds),
        gte(videoViewEvents.day, fromDay)
      )
    )
    .groupBy(videoViewEvents.videoId, videoViewEvents.day);

  const impRows = await db
    .select({
      videoId: videoImpressions.videoId,
      day: videoImpressions.day,
      impressions: count(videoImpressions.id),
    })
    .from(videoImpressions)
    .where(
      and(
        inArray(videoImpressions.videoId, videoIds),
        gte(videoImpressions.day, fromDay)
      )
    )
    .groupBy(videoImpressions.videoId, videoImpressions.day);

  const clickRows = await db
    .select({
      videoId: linkClicks.videoId,
      day: linkClicks.day,
      clicks: count(linkClicks.id),
    })
    .from(linkClicks)
    .where(
      and(inArray(linkClicks.videoId, videoIds), gte(linkClicks.day, fromDay))
    )
    .groupBy(linkClicks.videoId, linkClicks.day);

  type Agg = {
    views: number;
    uniqueViewers: number;
    impressions: number;
    clicks: number;
  };
  const keyOf = (videoId: number, day: string) => `${videoId}|${day}`;
  const aggByKey = new Map<string, Agg>();
  const getAgg = (videoId: number, day: string): Agg => {
    const k = keyOf(videoId, day);
    let a = aggByKey.get(k);
    if (!a) {
      a = { views: 0, uniqueViewers: 0, impressions: 0, clicks: 0 };
      aggByKey.set(k, a);
    }
    return a;
  };
  for (const r of viewRows) {
    const a = getAgg(r.videoId, String(r.day));
    a.views = Number(r.views ?? 0);
    a.uniqueViewers = Number(r.uniqueViewers ?? 0);
  }
  for (const r of impRows) {
    getAgg(r.videoId, String(r.day)).impressions = Number(
      r.impressions ?? 0
    );
  }
  for (const r of clickRows) {
    if (r.videoId == null) continue;
    getAgg(r.videoId, String(r.day)).clicks = Number(r.clicks ?? 0);
  }

  const rows: Array<{
    videoId: number;
    day: string;
    contentType: ContentTypeKey | null;
    views: number;
    impressions: number;
    clicks: number;
    uniqueViewers: number;
  }> = [];
  for (const videoId of videoIds) {
    const contentType = mediaTypeById.get(videoId) ?? null;
    for (const day of dayList) {
      const a = aggByKey.get(keyOf(videoId, day)) ?? {
        views: 0,
        uniqueViewers: 0,
        impressions: 0,
        clicks: 0,
      };
      rows.push({
        videoId,
        day,
        contentType,
        views: a.views,
        impressions: a.impressions,
        clicks: a.clicks,
        uniqueViewers: a.uniqueViewers,
      });
    }
  }

  // Chunked bulk upsert — same idempotent semantics as rollupVideoDay.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await db
      .insert(dailyContentStats)
      .values(chunk)
      .onConflictDoUpdate({
        target: [dailyContentStats.videoId, dailyContentStats.day],
        set: {
          contentType: sql`excluded."contentType"`,
          views: sql`excluded."views"`,
          impressions: sql`excluded."impressions"`,
          clicks: sql`excluded."clicks"`,
          uniqueViewers: sql`excluded."uniqueViewers"`,
        },
      });
  }
}

/**
 * Aggregate one campaign-day from event tables + the fiat earnings ledger
 * (spend = approved/credited earnings decided that day) into
 * daily_campaign_stats. Idempotent upsert.
 */
export async function rollupCampaignDay(
  campaignId: number,
  day: string
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const [viewAgg] = await db
    .select({
      views: count(videoViewEvents.id),
      uniqueViewers:
        sql<number>`count(distinct ${videoViewEvents.viewerHash})`,
    })
    .from(videoViewEvents)
    .where(
      and(eq(videoViewEvents.campaignId, campaignId), eq(videoViewEvents.day, day))
    );
  const [impAgg] = await db
    .select({ impressions: count(videoImpressions.id) })
    .from(videoImpressions)
    .where(
      and(
        eq(videoImpressions.campaignId, campaignId),
        eq(videoImpressions.day, day)
      )
    );
  const [clickAgg] = await db
    .select({ clicks: count(linkClicks.id) })
    .from(linkClicks)
    .where(
      and(eq(linkClicks.campaignId, campaignId), eq(linkClicks.day, day))
    );
  const [spendAgg] = await db
    .select({
      spend: sql<string>`coalesce(sum(${campaignEarnings.amount}), 0)`,
    })
    .from(campaignEarnings)
    .where(
      and(
        eq(campaignEarnings.campaignId, campaignId),
        inArray(campaignEarnings.status, ["approved", "paid_recorded"]),
        sql`(${campaignEarnings.decidedAt} at time zone 'utc')::date = ${day}::date`
      )
    );
  const row = {
    campaignId,
    day,
    views: Number(viewAgg?.views ?? 0),
    impressions: Number(impAgg?.impressions ?? 0),
    clicks: Number(clickAgg?.clicks ?? 0),
    spend: String(spendAgg?.spend ?? "0"),
  };
  await db
    .insert(dailyCampaignStats)
    .values(row)
    .onConflictDoUpdate({
      target: [dailyCampaignStats.campaignId, dailyCampaignStats.day],
      set: {
        views: row.views,
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.spend,
      },
    });
}

/** Last N UTC days (inclusive of today), oldest first. */
export function lastNDays(n: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/* ------------------------------------------------------------------ */
/* Dashboards                                                           */
/* ------------------------------------------------------------------ */

export type DayPoint = { day: string; views: number; impressions: number };

export type ContentTypeKey = "VIDEO" | "IMAGE" | "TEXT";

export type TypeBreakdown = Record<
  ContentTypeKey,
  {
    views: number;
    impressions: number;
    clicks: number;
    engagements: number;
    /** True reach: distinct viewers (viewerHash) in the period. */
    reach: number;
  }
>;

export function emptyTypeBreakdown(): TypeBreakdown {
  const zero = () => ({
    views: 0,
    impressions: 0,
    clicks: 0,
    engagements: 0,
    reach: 0,
  });
  return { VIDEO: zero(), IMAGE: zero(), TEXT: zero() };
}

function normalizeContentType(value: unknown): ContentTypeKey | null {
  return value === "VIDEO" || value === "IMAGE" || value === "TEXT"
    ? value
    : null;
}

export type CreatorDashboard = {
  totals: {
    views: number;
    impressions: number;
    clicks: number;
    /** True reach: distinct viewers across the period. */
    reach: number;
    engagements: number;
    /** Real user actions, split for the engagement hero bars. */
    reactions: number;
    comments: number;
    shares: number;
    engagementRate: number | null;
    ctr: number | null;
  };
  /** Per content-type breakdown (videos / photos / text posts). */
  byType: TypeBreakdown;
  series: DayPoint[];
  topVideos: Array<{
    videoId: number;
    title: string;
    contentType: ContentTypeKey | null;
    views: number;
    impressions: number;
    /** True reach: distinct viewers of this content in the period. */
    reach: number;
    engagements: number;
    reactions: number;
    comments: number;
    shares: number;
    engagementRate: number | null;
    ctr: number | null;
  }>;
  hasData: boolean;
};

function ctrOf(clicks: number, impressions: number): number | null {
  if (impressions <= 0) return null;
  return Math.round((clicks / impressions) * 1000) / 10;
}

/**
 * Facebook-style engagement rate: engagements ÷ reach (unique viewers),
 * as a percentage with 1 decimal. Reach — not raw views — is the
 * denominator, so repeat views by the same person don't dilute the rate.
 * Counts reflect real user actions only: one reaction per user per post
 * (DB unique constraint; changing reaction updates the row), comments
 * include replies (same table via parentId), shares count per share row.
 */
export function engagementRateOf(
  engagements: number,
  reach: number
): number | null {
  if (reach <= 0) return null;
  return Math.round((engagements / reach) * 1000) / 10;
}

export type VideoEngagement = {
  reactions: number;
  comments: number;
  shares: number;
};

/**
 * Per-video engagement counts from the existing reaction/comment/share
 * tables (likes/reactions + comments + shares). One grouped query per
 * table, merged into a single map.
 */
async function getEngagementByVideo(
  videoIds: number[]
): Promise<Map<number, VideoEngagement>> {
  const map = new Map<number, VideoEngagement>();
  const db = await getDb();
  if (!db || videoIds.length === 0) return map;
  const zero = (): VideoEngagement => ({
    reactions: 0,
    comments: 0,
    shares: 0,
  });
  const [reactionRows, commentRows, shareRows] = await Promise.all([
    db
      .select({
        videoId: videoReactions.videoId,
        n: count(videoReactions.id),
      })
      .from(videoReactions)
      .where(inArray(videoReactions.videoId, videoIds))
      .groupBy(videoReactions.videoId),
    db
      .select({
        videoId: videoComments.videoId,
        n: count(videoComments.id),
      })
      .from(videoComments)
      .where(inArray(videoComments.videoId, videoIds))
      .groupBy(videoComments.videoId),
    db
      .select({
        videoId: videoShares.videoId,
        n: count(videoShares.id),
      })
      .from(videoShares)
      .where(inArray(videoShares.videoId, videoIds))
      .groupBy(videoShares.videoId),
  ]);
  for (const row of reactionRows) {
    const entry = map.get(row.videoId) ?? zero();
    entry.reactions = Number(row.n ?? 0);
    map.set(row.videoId, entry);
  }
  for (const row of commentRows) {
    const entry = map.get(row.videoId) ?? zero();
    entry.comments = Number(row.n ?? 0);
    map.set(row.videoId, entry);
  }
  for (const row of shareRows) {
    const entry = map.get(row.videoId) ?? zero();
    entry.shares = Number(row.n ?? 0);
    map.set(row.videoId, entry);
  }
  return map;
}

/**
 * Per content-type engagement totals for a set of campaigns, joining the
 * engagement tables to videos (campaigns link at the content level).
 */
async function getEngagementByTypeForCampaigns(
  campaignIds: number[]
): Promise<Record<ContentTypeKey, number>> {
  const out: Record<ContentTypeKey, number> = {
    VIDEO: 0,
    IMAGE: 0,
    TEXT: 0,
  };
  const db = await getDb();
  if (!db || campaignIds.length === 0) return out;
  const queries = [
    db
      .select({
        contentType: videos.mediaType,
        n: count(videoReactions.id),
      })
      .from(videoReactions)
      .innerJoin(videos, eq(videos.id, videoReactions.videoId))
      .where(inArray(videos.campaignId, campaignIds))
      .groupBy(videos.mediaType),
    db
      .select({
        contentType: videos.mediaType,
        n: count(videoComments.id),
      })
      .from(videoComments)
      .innerJoin(videos, eq(videos.id, videoComments.videoId))
      .where(inArray(videos.campaignId, campaignIds))
      .groupBy(videos.mediaType),
    db
      .select({
        contentType: videos.mediaType,
        n: count(videoShares.id),
      })
      .from(videoShares)
      .innerJoin(videos, eq(videos.id, videoShares.videoId))
      .where(inArray(videos.campaignId, campaignIds))
      .groupBy(videos.mediaType),
  ];
  const [reactionRows, commentRows, shareRows] = await Promise.all(queries);
  for (const row of [...reactionRows, ...commentRows, ...shareRows]) {
    const key = normalizeContentType(row.contentType);
    if (key) out[key] += Number(row.n ?? 0);
  }
  return out;
}

/**
 * Per content-type breakdown for a set of campaigns, from the rolled-up
 * daily_content_stats joined to the videos table (campaigns are linked at
 * the content level). Used by the brand + admin dashboards.
 */
async function getTypeBreakdownForCampaigns(
  campaignIds: number[],
  sinceDay: string
): Promise<TypeBreakdown> {
  const breakdown = emptyTypeBreakdown();
  const db = await getDb();
  if (!db || campaignIds.length === 0) return breakdown;
  const rows = await db
    .select({
      contentType: dailyContentStats.contentType,
      views: sql<number>`sum(${dailyContentStats.views})`,
      impressions: sql<number>`sum(${dailyContentStats.impressions})`,
      clicks: sql<number>`sum(${dailyContentStats.clicks})`,
    })
    .from(dailyContentStats)
    .innerJoin(videos, eq(videos.id, dailyContentStats.videoId))
    .where(
      and(
        inArray(videos.campaignId, campaignIds),
        gte(dailyContentStats.day, sinceDay)
      )
    )
    .groupBy(dailyContentStats.contentType);
  for (const row of rows) {
    const key = normalizeContentType(row.contentType);
    if (!key) continue;
    breakdown[key] = {
      views: Number(row.views ?? 0),
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      engagements: 0,
      reach: 0,
    };
  }
  // True reach per type: distinct viewers from the deduped event table.
  const reachRows = await db
    .select({
      contentType: videoViewEvents.contentType,
      reach: sql<number>`count(distinct ${videoViewEvents.viewerHash})`,
    })
    .from(videoViewEvents)
    .innerJoin(videos, eq(videos.id, videoViewEvents.videoId))
    .where(
      and(
        inArray(videos.campaignId, campaignIds),
        gte(videoViewEvents.day, sinceDay)
      )
    )
    .groupBy(videoViewEvents.contentType);
  for (const row of reachRows) {
    const key = normalizeContentType(row.contentType);
    if (key) breakdown[key].reach = Number(row.reach ?? 0);
  }
  return breakdown;
}

/**
 * Creator dashboard: ONLY the creator's own videos. Lazy-rolls the last 7
 * days for up to 50 recent videos, then reads daily_content_stats.
 */
export async function getCreatorStats(
  userId: number,
  days = 7
): Promise<CreatorDashboard> {
  const db = await getDb();
  const empty: CreatorDashboard = {
    totals: {
      views: 0,
      impressions: 0,
      clicks: 0,
      reach: 0,
      engagements: 0,
      reactions: 0,
      comments: 0,
      shares: 0,
      engagementRate: null,
      ctr: null,
    },
    byType: emptyTypeBreakdown(),
    series: [],
    topVideos: [],
    hasData: false,
  };
  if (!db) return empty;
  const ownVideos = await db
    .select({ id: videos.id, title: videos.title, mediaType: videos.mediaType })
    .from(videos)
    .where(eq(videos.userId, userId))
    .orderBy(desc(videos.createdAt))
    .limit(50);
  if (ownVideos.length === 0) return empty;
  const videoIds = ownVideos.map(v => v.id);
  const dayList = lastNDays(days);
  // Bulk rollup (was: nested per-video-per-day loop issuing up to 1,750
  // sequential queries — the Analytics tab hung on "Loading…" forever).
  const mediaTypeById = new Map<number, ContentTypeKey | null>(
    ownVideos.map(v => [v.id, normalizeContentType(v.mediaType)] as const)
  );
  await rollupVideosBulk(videoIds, dayList, mediaTypeById);
  // Per-video engagements from the existing reaction/comment/share tables.
  const engagementByVideo = await getEngagementByVideo(videoIds);
  const stats = await db
    .select({
      videoId: dailyContentStats.videoId,
      day: dailyContentStats.day,
      contentType: dailyContentStats.contentType,
      views: dailyContentStats.views,
      impressions: dailyContentStats.impressions,
      clicks: dailyContentStats.clicks,
      uniqueViewers: dailyContentStats.uniqueViewers,
    })
    .from(dailyContentStats)
    .where(
      and(
        inArray(dailyContentStats.videoId, videoIds),
        gte(dailyContentStats.day, dayList[0])
      )
    );
  const [reactions] = await db
    .select({ n: count(videoReactions.id) })
    .from(videoReactions)
    .where(inArray(videoReactions.videoId, videoIds));
  const [comments] = await db
    .select({ n: count(videoComments.id) })
    .from(videoComments)
    .where(inArray(videoComments.videoId, videoIds));
  const [shares] = await db
    .select({ n: count(videoShares.id) })
    .from(videoShares)
    .where(inArray(videoShares.videoId, videoIds));

  const totals = {
    views: 0,
    impressions: 0,
    clicks: 0,
    reach: 0,
    reactions: Number(reactions?.n ?? 0),
    comments: Number(comments?.n ?? 0),
    shares: Number(shares?.n ?? 0),
    engagements:
      Number(reactions?.n ?? 0) +
      Number(comments?.n ?? 0) +
      Number(shares?.n ?? 0),
    engagementRate: null as number | null,
    ctr: null as number | null,
  };
  // True reach (Facebook-style denominator): distinct viewers over the
  // period — total, per video, and per content type — straight from the
  // deduped event table.
  const [reachRow] = await db
    .select({
      reach: sql<number>`count(distinct ${videoViewEvents.viewerHash})`,
    })
    .from(videoViewEvents)
    .where(
      and(
        inArray(videoViewEvents.videoId, videoIds),
        gte(videoViewEvents.day, dayList[0])
      )
    );
  totals.reach = Number(reachRow?.reach ?? 0);
  const reachByVideoRows = await db
    .select({
      videoId: videoViewEvents.videoId,
      reach: sql<number>`count(distinct ${videoViewEvents.viewerHash})`,
    })
    .from(videoViewEvents)
    .where(
      and(
        inArray(videoViewEvents.videoId, videoIds),
        gte(videoViewEvents.day, dayList[0])
      )
    )
    .groupBy(videoViewEvents.videoId);
  const reachByVideo = new Map(
    reachByVideoRows.map(r => [r.videoId, Number(r.reach ?? 0)])
  );
  const reachByTypeRows = await db
    .select({
      contentType: videoViewEvents.contentType,
      reach: sql<number>`count(distinct ${videoViewEvents.viewerHash})`,
    })
    .from(videoViewEvents)
    .where(
      and(
        inArray(videoViewEvents.videoId, videoIds),
        gte(videoViewEvents.day, dayList[0])
      )
    )
    .groupBy(videoViewEvents.contentType);
  const reachByType = new Map<ContentTypeKey, number>();
  for (const r of reachByTypeRows) {
    const key = normalizeContentType(r.contentType);
    if (key) reachByType.set(key, Number(r.reach ?? 0));
  }
  const byDay = new Map<string, DayPoint>();
  for (const d of dayList) byDay.set(d, { day: d, views: 0, impressions: 0 });
  const byVideo = new Map<number, { views: number; impressions: number }>();
  const byType = emptyTypeBreakdown();
  for (const row of stats) {
    const v = Number(row.views ?? 0);
    const imp = Number(row.impressions ?? 0);
    const clk = Number(row.clicks ?? 0);
    totals.views += v;
    totals.impressions += imp;
    totals.clicks += clk;
    const typeKey = normalizeContentType(row.contentType);
    const eng = engagementByVideo.get(row.videoId);
    const videoEngagements =
      (eng?.reactions ?? 0) + (eng?.comments ?? 0) + (eng?.shares ?? 0);
    if (typeKey) {
      byType[typeKey].views += v;
      byType[typeKey].impressions += imp;
      byType[typeKey].clicks += clk;
      byType[typeKey].engagements += videoEngagements;
      byType[typeKey].reach = reachByType.get(typeKey) ?? 0;
    }
    const point = byDay.get(String(row.day));
    if (point) {
      point.views += v;
      point.impressions += imp;
    }
    const agg = byVideo.get(row.videoId) ?? { views: 0, impressions: 0 };
    agg.views += v;
    agg.impressions += imp;
    byVideo.set(row.videoId, agg);
  }
  totals.ctr = ctrOf(totals.clicks, totals.impressions);
  totals.engagementRate = engagementRateOf(totals.engagements, totals.reach);
  const titleById = new Map(ownVideos.map(v => [v.id, v.title]));
  const typeById = new Map(
    ownVideos.map(v => [v.id, normalizeContentType(v.mediaType)])
  );
  const topVideos = [...byVideo.entries()]
    .map(([videoId, agg]) => {
      const eng = engagementByVideo.get(videoId);
      const reactionsN = eng?.reactions ?? 0;
      const commentsN = eng?.comments ?? 0;
      const sharesN = eng?.shares ?? 0;
      const engagements = reactionsN + commentsN + sharesN;
      const reach = reachByVideo.get(videoId) ?? 0;
      return {
        videoId,
        title: titleById.get(videoId) ?? `#${videoId}`,
        contentType: typeById.get(videoId) ?? null,
        views: agg.views,
        impressions: agg.impressions,
        reach,
        engagements,
        reactions: reactionsN,
        comments: commentsN,
        shares: sharesN,
        engagementRate: engagementRateOf(engagements, reach),
        ctr: ctrOf(agg.views, agg.impressions),
      };
    })
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);
  const hasData = totals.views > 0 || totals.impressions > 0;
  return {
    totals,
    byType,
    series: [...byDay.values()],
    topVideos,
    hasData,
  };
}

export type BrandCampaignStat = {
  campaignId: number;
  title: string;
  status: string;
  /** Phase 6: FB-style run mode. */
  runMode: "continuous" | "scheduled";
  views: number;
  impressions: number;
  clicks: number;
  ctr: number | null;
  spend: string;
  currency: string | null;
  /** Phase 6: budget tracking for the spent bar (cents). */
  budgetCents: number | null;
  spentCents: number;
  startsAt: string | null;
  endsAt: string | null;
  /** Per accepted creator: real views / engagement / reward for this campaign. */
  creators: BrandCreatorStat[];
};

/** One accepted creator's real performance inside a brand's campaign. */
export type BrandCreatorStat = {
  userId: number;
  displayName: string | null;
  username: string | null;
  views: number;
  reach: number;
  engagements: number;
  engagementRate: number | null;
  rewardAmount: string | null;
  rewardCurrency: string | null;
};

export type BrandDashboard = {
  totals: {
    views: number;
    impressions: number;
    clicks: number;
    ctr: number | null;
  };
  /** Per content-type breakdown (videos / photos / text posts). */
  byType: TypeBreakdown;
  campaigns: BrandCampaignStat[];
  hasData: boolean;
};

/**
 * Per-creator performance inside one campaign: accepted invitees only, with
 * their real views / reach / engagements from the event + rollup tables and
 * the reward the brand agreed with them. Never exposes pool or fee splits.
 */
export async function getCreatorBreakdownForCampaign(
  campaignId: number,
  sinceDay: string
): Promise<BrandCreatorStat[]> {
  const db = await getDb();
  if (!db) return [];
  const invitees = await db
    .select({
      userId: campaignInvitations.userId,
      rewardAmount: campaignInvitations.rewardAmount,
      rewardCurrency: campaignInvitations.rewardCurrency,
      displayName: profiles.displayName,
      username: profiles.username,
    })
    .from(campaignInvitations)
    .leftJoin(profiles, eq(profiles.userId, campaignInvitations.userId))
    .where(
      and(
        eq(campaignInvitations.campaignId, campaignId),
        eq(campaignInvitations.status, "accepted")
      )
    );
  if (invitees.length === 0) return [];
  // Views per creator from the rolled-up daily stats.
  const viewRows = await db
    .select({
      userId: videos.userId,
      views: sql<number>`sum(${dailyContentStats.views})`,
    })
    .from(dailyContentStats)
    .innerJoin(videos, eq(videos.id, dailyContentStats.videoId))
    .where(
      and(
        eq(videos.campaignId, campaignId),
        gte(dailyContentStats.day, sinceDay)
      )
    )
    .groupBy(videos.userId);
  // Reach per creator from the deduped view events.
  const reachRows = await db
    .select({
      userId: videos.userId,
      reach: sql<number>`count(distinct ${videoViewEvents.viewerHash})`,
    })
    .from(videoViewEvents)
    .innerJoin(videos, eq(videos.id, videoViewEvents.videoId))
    .where(
      and(
        eq(videos.campaignId, campaignId),
        gte(videoViewEvents.day, sinceDay)
      )
    )
    .groupBy(videos.userId);
  // Engagements per creator: group this campaign's content by creator, then
  // reuse the FB-formula engagement aggregation (real user actions only).
  const campVideos = await db
    .select({ id: videos.id, userId: videos.userId })
    .from(videos)
    .where(eq(videos.campaignId, campaignId));
  const videosByCreator = new Map<number, number[]>();
  for (const v of campVideos) {
    const list = videosByCreator.get(v.userId) ?? [];
    list.push(v.id);
    videosByCreator.set(v.userId, list);
  }
  const engagementByVideo = await getEngagementByVideo(
    campVideos.map(v => v.id)
  );
  const engagementsByCreator = new Map<number, number>();
  for (const [creatorId, vids] of videosByCreator) {
    let total = 0;
    for (const vid of vids) {
      const e = engagementByVideo.get(vid);
      total += (e?.reactions ?? 0) + (e?.comments ?? 0) + (e?.shares ?? 0);
    }
    engagementsByCreator.set(creatorId, total);
  }
  const viewsByCreator = new Map(
    viewRows.map(r => [r.userId, Number(r.views ?? 0)])
  );
  const reachByCreator = new Map(
    reachRows.map(r => [r.userId, Number(r.reach ?? 0)])
  );
  return invitees
    .map(inv => {
      const views = viewsByCreator.get(inv.userId) ?? 0;
      const reach = reachByCreator.get(inv.userId) ?? 0;
      const engagements = engagementsByCreator.get(inv.userId) ?? 0;
      return {
        userId: inv.userId,
        displayName: inv.displayName,
        username: inv.username,
        views,
        reach,
        engagements,
        engagementRate: engagementRateOf(engagements, reach),
        rewardAmount: inv.rewardAmount,
        rewardCurrency: inv.rewardCurrency,
      };
    })
    .sort((a, b) => b.views - a.views);
}

/**
 * Brand dashboard: ONLY campaigns belonging to the brand owner's own
 * applications. Never exposes creator PII, pool, or fee splits — those
 * columns are simply never selected here.
 */
export async function getBrandStats(
  userId: number,
  days = 30
): Promise<BrandDashboard> {
  const db = await getDb();
  const empty: BrandDashboard = {
    totals: { views: 0, impressions: 0, clicks: 0, ctr: null },
    byType: emptyTypeBreakdown(),
    campaigns: [],
    hasData: false,
  };
  if (!db) return empty;
  const apps = await db
    .select({ id: brandApplications.id })
    .from(brandApplications)
    .where(eq(brandApplications.userId, userId));
  if (apps.length === 0) return empty;
  const appIds = apps.map(a => a.id);
  const camps = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      status: campaigns.status,
      runMode: campaigns.runMode,
      budgetTotal: campaigns.budgetTotal,
      budgetCurrency: campaigns.budgetCurrency,
      startsAt: campaigns.startsAt,
      endsAt: campaigns.endsAt,
    })
    .from(campaigns)
    .where(inArray(campaigns.applicationId, appIds));
  if (camps.length === 0) return empty;
  const dayList = lastNDays(days);
  for (const camp of camps) {
    for (const day of dayList) {
      await rollupCampaignDay(camp.id, day);
    }
  }
  const campIds = camps.map(c => c.id);
  const stats = await db
    .select({
      campaignId: dailyCampaignStats.campaignId,
      views: dailyCampaignStats.views,
      impressions: dailyCampaignStats.impressions,
      clicks: dailyCampaignStats.clicks,
      spend: dailyCampaignStats.spend,
    })
    .from(dailyCampaignStats)
    .where(
      and(
        inArray(dailyCampaignStats.campaignId, campIds),
        gte(dailyCampaignStats.day, dayList[0])
      )
    );
  const aggByCamp = new Map<
    number,
    { views: number; impressions: number; clicks: number; spendCents: number }
  >();
  for (const row of stats) {
    const agg = aggByCamp.get(row.campaignId) ?? {
      views: 0,
      impressions: 0,
      clicks: 0,
      spendCents: 0,
    };
    agg.views += Number(row.views ?? 0);
    agg.impressions += Number(row.impressions ?? 0);
    agg.clicks += Number(row.clicks ?? 0);
    agg.spendCents += Math.round(Number(row.spend ?? 0) * 100);
    aggByCamp.set(row.campaignId, agg);
  }
  const totals = { views: 0, impressions: 0, clicks: 0, ctr: null as number | null };
  const campaignRows: BrandCampaignStat[] = [];
  // Phase 6: real spend per campaign from the fiat ledger (approved+).
  const spendRows = await db
    .select({
      campaignId: campaignEarnings.campaignId,
      total: sql<string>`coalesce(sum(${campaignEarnings.amount}), 0)`,
    })
    .from(campaignEarnings)
    .where(
      and(
        inArray(campaignEarnings.campaignId, campIds),
        inArray(campaignEarnings.status, ["approved", "paid_recorded"])
      )
    )
    .groupBy(campaignEarnings.campaignId);
  const spendByCamp = new Map<number, number>();
  for (const r of spendRows) {
    if (r.campaignId != null) {
      spendByCamp.set(r.campaignId, Math.round(Number(r.total) * 100));
    }
  }
  for (const camp of camps) {
    const agg = aggByCamp.get(camp.id) ?? {
      views: 0,
      impressions: 0,
      clicks: 0,
      spendCents: 0,
    };
    totals.views += agg.views;
    totals.impressions += agg.impressions;
    totals.clicks += agg.clicks;
    const creators = await getCreatorBreakdownForCampaign(camp.id, dayList[0]);
    const budgetCents =
      camp.budgetTotal != null ? Math.round(Number(camp.budgetTotal) * 100) : null;
    campaignRows.push({
      campaignId: camp.id,
      title: camp.title,
      status: camp.status,
      runMode: (camp.runMode ?? "continuous") as "continuous" | "scheduled",
      views: agg.views,
      impressions: agg.impressions,
      clicks: agg.clicks,
      ctr: ctrOf(agg.clicks, agg.impressions),
      spend: (agg.spendCents / 100).toFixed(2),
      currency: camp.budgetCurrency,
      budgetCents,
      spentCents: spendByCamp.get(camp.id) ?? 0,
      startsAt: camp.startsAt ? camp.startsAt.toISOString() : null,
      endsAt: camp.endsAt ? camp.endsAt.toISOString() : null,
      creators,
    });
  }
  totals.ctr = ctrOf(totals.clicks, totals.impressions);
  const byType = await getTypeBreakdownForCampaigns(campIds, dayList[0]);
  const engagementsByType = await getEngagementByTypeForCampaigns(campIds);
  for (const key of ["VIDEO", "IMAGE", "TEXT"] as const) {
    byType[key].engagements = engagementsByType[key];
  }
  return {
    totals,
    byType,
    campaigns: campaignRows,
    hasData: totals.views > 0 || totals.impressions > 0 || totals.clicks > 0,
  };
}

export type AdminDashboard = {
  totals: {
    views: number;
    impressions: number;
    clicks: number;
    uniqueViewers: number;
    ctr: number | null;
    activeCampaigns: number;
    /** Platform-wide real engagements + reach (FB formula denominator). */
    engagements: number;
    reach: number;
    avgEngagementRate: number | null;
  };
  /** Per content-type breakdown (videos / photos / text posts). */
  byType: TypeBreakdown;
  campaigns: BrandCampaignStat[];
  hasData: boolean;
};

/**
 * Admin dashboard: platform-wide totals + per-campaign table. Admin-only
 * (enforced by adminProcedure at the router layer).
 */
export async function getAdminStats(days = 30): Promise<AdminDashboard> {
  const db = await getDb();
  const empty: AdminDashboard = {
    totals: {
      views: 0,
      impressions: 0,
      clicks: 0,
      uniqueViewers: 0,
      ctr: null,
      activeCampaigns: 0,
      engagements: 0,
      reach: 0,
      avgEngagementRate: null,
    },
    byType: emptyTypeBreakdown(),
    campaigns: [],
    hasData: false,
  };
  if (!db) return empty;
  const dayList = lastNDays(days);
  const camps = await db
    .select({
      id: campaigns.id,
      title: campaigns.title,
      status: campaigns.status,
      runMode: campaigns.runMode,
      budgetTotal: campaigns.budgetTotal,
      budgetCurrency: campaigns.budgetCurrency,
      startsAt: campaigns.startsAt,
      endsAt: campaigns.endsAt,
    })
    .from(campaigns)
    .orderBy(desc(campaigns.createdAt))
    .limit(100);
  for (const camp of camps) {
    for (const day of dayList) {
      await rollupCampaignDay(camp.id, day);
    }
  }
  const campIds = camps.map(c => c.id);
  const stats =
    campIds.length > 0
      ? await db
          .select({
            campaignId: dailyCampaignStats.campaignId,
            views: dailyCampaignStats.views,
            impressions: dailyCampaignStats.impressions,
            clicks: dailyCampaignStats.clicks,
            spend: dailyCampaignStats.spend,
          })
          .from(dailyCampaignStats)
          .where(
            and(
              inArray(dailyCampaignStats.campaignId, campIds),
              gte(dailyCampaignStats.day, dayList[0])
            )
          )
      : [];
  const aggByCamp = new Map<
    number,
    { views: number; impressions: number; clicks: number; spendCents: number }
  >();
  const totals = {
    views: 0,
    impressions: 0,
    clicks: 0,
    uniqueViewers: 0,
    ctr: null as number | null,
    activeCampaigns: camps.filter(c => c.status === "active").length,
    engagements: 0,
    reach: 0,
    avgEngagementRate: null as number | null,
  };
  for (const row of stats) {
    const agg = aggByCamp.get(row.campaignId) ?? {
      views: 0,
      impressions: 0,
      clicks: 0,
      spendCents: 0,
    };
    agg.views += Number(row.views ?? 0);
    agg.impressions += Number(row.impressions ?? 0);
    agg.clicks += Number(row.clicks ?? 0);
    agg.spendCents += Math.round(Number(row.spend ?? 0) * 100);
    aggByCamp.set(row.campaignId, agg);
  }
  const campaignRows: BrandCampaignStat[] = camps.map(camp => {
    const agg = aggByCamp.get(camp.id) ?? {
      views: 0,
      impressions: 0,
      clicks: 0,
      spendCents: 0,
    };
    totals.views += agg.views;
    totals.impressions += agg.impressions;
    totals.clicks += agg.clicks;
    return {
      campaignId: camp.id,
      title: camp.title,
      status: camp.status,
      runMode: (camp.runMode ?? "continuous") as "continuous" | "scheduled",
      views: agg.views,
      impressions: agg.impressions,
      clicks: agg.clicks,
      ctr: ctrOf(agg.clicks, agg.impressions),
      spend: (agg.spendCents / 100).toFixed(2),
      currency: camp.budgetCurrency,
      budgetCents:
        camp.budgetTotal != null ? Math.round(Number(camp.budgetTotal) * 100) : null,
      spentCents: agg.spendCents,
      startsAt: camp.startsAt ? camp.startsAt.toISOString() : null,
      endsAt: camp.endsAt ? camp.endsAt.toISOString() : null,
      // Admin top-campaigns table doesn't show per-creator rows; the
      // breakdown lives on the brand dashboard for the owning brand.
      creators: [],
    };
  });
  totals.ctr = ctrOf(totals.clicks, totals.impressions);
  const byType = await getTypeBreakdownForCampaigns(campIds, dayList[0]);
  const engagementsByType = await getEngagementByTypeForCampaigns(campIds);
  for (const key of ["VIDEO", "IMAGE", "TEXT"] as const) {
    byType[key].engagements = engagementsByType[key];
    totals.engagements += byType[key].engagements;
    totals.reach += byType[key].reach;
  }
  totals.avgEngagementRate = engagementRateOf(totals.engagements, totals.reach);
  return {
    totals,
    byType,
    campaigns: campaignRows,
    hasData:
      totals.views > 0 || totals.impressions > 0 || totals.clicks > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Honest estimate basis (replaces the illustrative multiplier)         */
/* ------------------------------------------------------------------ */

export type EstimateBasis = {
  /** Impressions per 1 unit of creator reward, per currency. */
  impressionsPerUnit: { USD: number; BDT: number };
  sampleVideos: number;
  sampleRewards: { USD: number; BDT: number };
} | null;

/**
 * Derive an estimate basis from REAL platform data:
 *   impressions-per-reward-unit = (avg impressions per video, last 90d)
 *     / (avg approved reward per submission, per currency, last 90d).
 * Returns null when the sample is too thin — the UI then shows an honest
 * "not enough data yet" instead of invented numbers. Always labelled
 * "Estimated — Not Guaranteed" wherever it is displayed.
 */
export async function getEstimateBasis(): Promise<EstimateBasis> {
  const db = await getDb();
  if (!db) return null;
  const since = lastNDays(90)[0];
  const videoStats = await db
    .select({
      videoId: dailyContentStats.videoId,
      impressions: sql<number>`sum(${dailyContentStats.impressions})`,
    })
    .from(dailyContentStats)
    .where(gte(dailyContentStats.day, since))
    .groupBy(dailyContentStats.videoId);
  const videosWithImpressions = videoStats.filter(
    v => Number(v.impressions ?? 0) > 0
  );
  if (videosWithImpressions.length < 10) return null;
  const totalImpressions = videosWithImpressions.reduce(
    (sum, v) => sum + Number(v.impressions ?? 0),
    0
  );
  const avgImpressionsPerVideo =
    totalImpressions / videosWithImpressions.length;

  const rewards = await db
    .select({
      currency: campaignEarnings.currency,
      amount: campaignEarnings.amount,
    })
    .from(campaignEarnings)
    .where(
      and(
        inArray(campaignEarnings.status, ["approved", "paid_recorded"]),
        sql`(${campaignEarnings.decidedAt} at time zone 'utc')::date >= ${since}::date`
      )
    );
  const byCurrency = { USD: [] as number[], BDT: [] as number[] };
  for (const r of rewards) {
    const cur = String(r.currency ?? "").toUpperCase();
    if (cur === "USD" || cur === "BDT") {
      byCurrency[cur].push(Number(r.amount ?? 0));
    }
  }
  if (byCurrency.USD.length < 5 || byCurrency.BDT.length < 5) return null;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    impressionsPerUnit: {
      USD: avgImpressionsPerVideo / Math.max(avg(byCurrency.USD), 0.01),
      BDT: avgImpressionsPerVideo / Math.max(avg(byCurrency.BDT), 0.01),
    },
    sampleVideos: videosWithImpressions.length,
    sampleRewards: { USD: byCurrency.USD.length, BDT: byCurrency.BDT.length },
  };
}
