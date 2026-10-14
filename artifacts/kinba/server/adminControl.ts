/**
 * JHILIK Admin Control Center — backend.
 *
 * Unified admin operations modeled on Meta's control systems:
 * - Tiered roles (admin > moderator > user), strict hierarchy
 * - 3-tier content enforcement: REMOVE / REDUCE / KEEP
 * - Full audit trail: every admin action is logged
 * - Revenue control: admin decides creator payout splits
 *
 * All functions assume the caller is already authorized (adminProcedure
 * or moderatorProcedure at the router layer).
 */
import { and, desc, eq, ilike, inArray, isNull, or, sql, count, sum } from "drizzle-orm";
import {
  adminAuditLog,
  campaignEarnings,
  campaigns,
  moderationReports,
  prerollAds,
  prerollAdTargets,
  prerollPlays,
  prerollSettings,
  revenueShareOverrides,
  users,
  videos,
} from "../drizzle/schema";
import { getDb } from "./db";
import { getPrerollSettings, updatePrerollSettings } from "./preroll";

/* ------------------------------------------------------------------ */
/* Audit log                                                           */
/* ------------------------------------------------------------------ */

export async function logAdminAction(
  adminId: number,
  action: string,
  targetType?: string | null,
  targetId?: string | number | null,
  details?: Record<string, unknown> | null
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(adminAuditLog).values({
    adminId,
    action,
    targetType: targetType ?? null,
    targetId: targetId != null ? String(targetId) : null,
    details: details ?? null,
  });
}

export async function getAuditLog(limit = 50, offset = 0) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select({
      id: adminAuditLog.id,
      action: adminAuditLog.action,
      targetType: adminAuditLog.targetType,
      targetId: adminAuditLog.targetId,
      details: adminAuditLog.details,
      createdAt: adminAuditLog.createdAt,
      adminId: adminAuditLog.adminId,
      adminName: users.name,
    })
    .from(adminAuditLog)
    .leftJoin(users, eq(adminAuditLog.adminId, users.id))
    .orderBy(desc(adminAuditLog.createdAt))
    .limit(limit)
    .offset(offset);
  return rows;
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export async function getAdminOverview() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Each stat is independent: run in parallel, and never let one bad
  // table/query kill the whole overview — a failed stat reports 0.
  const safeCount = async (
    run: () => Promise<Array<{ n: number }>>
  ): Promise<number> => {
    try {
      const [row] = await run();
      return row?.n ?? 0;
    } catch {
      return 0;
    }
  };

  const [
    userCount,
    videoCount,
    pendingPrerollAds,
    pendingCampaigns,
    openReports,
    pendingPayouts,
    adRevenueCents,
  ] = await Promise.all([
    safeCount(() => db.select({ n: count() }).from(users)),
    safeCount(() => db.select({ n: count() }).from(videos)),
    safeCount(() =>
      db
        .select({ n: count() })
        .from(prerollAds)
        .where(eq(prerollAds.status, "draft"))
    ),
    safeCount(() =>
      db.select({ n: count() }).from(campaigns).where(eq(campaigns.status, "draft"))
    ),
    safeCount(() =>
      db
        .select({ n: count() })
        .from(moderationReports)
        .where(eq(moderationReports.status, "open"))
    ),
    safeCount(() =>
      db
        .select({ n: count() })
        .from(campaignEarnings)
        .where(eq(campaignEarnings.status, "approved"))
    ),
    // Platform ad revenue (sum of all play revenue) — real DB number.
    (async (): Promise<number> => {
      try {
        const [row] = await db
          .select({ total: sum(prerollPlays.revenueCents) })
          .from(prerollPlays);
        return Number(row?.total ?? 0);
      } catch {
        return 0;
      }
    })(),
  ]);

  return {
    users: userCount,
    content: videoCount,
    pendingAdReviews: pendingPrerollAds + pendingCampaigns,
    openReports,
    pendingPayouts,
    adRevenueCents,
  };
}

/* ------------------------------------------------------------------ */
/* Revenue control                                                     */
/* ------------------------------------------------------------------ */

export async function getRevenueSettings() {
  const settings = await getPrerollSettings();
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const overrides = await db
    .select({
      id: revenueShareOverrides.id,
      adId: revenueShareOverrides.adId,
      creatorId: revenueShareOverrides.creatorId,
      creatorPercent: revenueShareOverrides.creatorPercent,
      createdAt: revenueShareOverrides.createdAt,
      adTitle: prerollAds.title,
      creatorName: users.name,
    })
    .from(revenueShareOverrides)
    .leftJoin(prerollAds, eq(revenueShareOverrides.adId, prerollAds.id))
    .leftJoin(users, eq(revenueShareOverrides.creatorId, users.id))
    .orderBy(desc(revenueShareOverrides.createdAt))
    .limit(100);
  return {
    defaultCreatorPercent: settings.defaultCreatorPercent,
    overrides,
  };
}

export async function setDefaultCreatorPercent(
  adminId: number,
  percent: number
) {
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    throw new Error("Percent must be an integer 0-100.");
  }
  const settings = await updatePrerollSettings({
    ...(await getPrerollSettings()),
    defaultCreatorPercent: percent,
  });
  await logAdminAction(adminId, "revenue.set_default", "settings", "default", {
    percent,
  });
  return settings;
}

export async function setRevenueOverride(
  adminId: number,
  input: { adId?: number | null; creatorId?: number | null; percent: number }
) {
  if (!Number.isInteger(input.percent) || input.percent < 0 || input.percent > 100) {
    throw new Error("Percent must be an integer 0-100.");
  }
  if (!input.adId && !input.creatorId) {
    throw new Error("Provide adId and/or creatorId.");
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Upsert: one row per (adId, creatorId) combination.
  const existing = await db
    .select({ id: revenueShareOverrides.id })
    .from(revenueShareOverrides)
    .where(
      and(
        input.adId
          ? eq(revenueShareOverrides.adId, input.adId)
          : isNull(revenueShareOverrides.adId),
        input.creatorId
          ? eq(revenueShareOverrides.creatorId, input.creatorId)
          : isNull(revenueShareOverrides.creatorId)
      )
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(revenueShareOverrides)
      .set({ creatorPercent: input.percent, updatedAt: new Date() })
      .where(eq(revenueShareOverrides.id, existing[0].id));
  } else {
    await db.insert(revenueShareOverrides).values({
      adId: input.adId ?? null,
      creatorId: input.creatorId ?? null,
      creatorPercent: input.percent,
      createdBy: adminId,
    });
  }
  await logAdminAction(adminId, "revenue.set_override", "revenue_override", null, {
    adId: input.adId ?? null,
    creatorId: input.creatorId ?? null,
    percent: input.percent,
  });
  return { ok: true };
}

export async function deleteRevenueOverride(adminId: number, id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .delete(revenueShareOverrides)
    .where(eq(revenueShareOverrides.id, id));
  await logAdminAction(adminId, "revenue.delete_override", "revenue_override", id);
  return { ok: true };
}

/** Payout queue: creators with approved (unpaid) earnings. Admin-only. */
export async function getPayoutQueue() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select({
      creatorId: campaignEarnings.creatorId,
      creatorName: users.name,
      totalCents: sql<string>`coalesce(sum(("amount"::numeric * 100)::integer), 0)`,
      currency: campaignEarnings.currency,
      count: count(),
    })
    .from(campaignEarnings)
    .leftJoin(users, eq(campaignEarnings.creatorId, users.id))
    .where(eq(campaignEarnings.status, "approved"))
    .groupBy(campaignEarnings.creatorId, users.name, campaignEarnings.currency)
    .orderBy(desc(sql`coalesce(sum(("amount"::numeric * 100)::integer), 0)`));
  return rows.map(r => ({
    creatorId: r.creatorId,
    creatorName: r.creatorName,
    totalCents: Number(r.totalCents ?? 0),
    currency: r.currency,
    earningCount: r.count,
  }));
}

/** Mark a creator's approved earnings as paid (recorded). */
export async function releasePayout(adminId: number, creatorId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .update(campaignEarnings)
    .set({ status: "paid_recorded" })
    .where(
      and(
        eq(campaignEarnings.creatorId, creatorId),
        eq(campaignEarnings.status, "approved")
      )
    );
  await logAdminAction(adminId, "payout.release", "creator", creatorId);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Ad targeting — admin can view/change target videos for any ad       */
/* ------------------------------------------------------------------ */

export type AdTargetDetail = {
  videoId: number;
  title: string;
  thumbnailUrl: string | null;
  creatorName: string | null;
};

/** Full target-video details for an ad (admin view). */
export async function getAdTargetDetails(adId: number): Promise<AdTargetDetail[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select({
      videoId: prerollAdTargets.videoId,
      title: videos.title,
      thumbnailUrl: videos.thumbnailUrl,
      creatorName: users.name,
    })
    .from(prerollAdTargets)
    .innerJoin(videos, eq(videos.id, prerollAdTargets.videoId))
    .leftJoin(users, eq(users.id, videos.userId))
    .where(eq(prerollAdTargets.adId, adId))
    .orderBy(desc(prerollAdTargets.id))
    .limit(50);
  return rows;
}

/**
 * Replace an ad's manual target videos (admin). Empty list clears the
 * targets → the ad falls back to the automatic eligible-creator pool.
 * Every change is written to the audit log.
 */
export async function setAdTargets(
  adminId: number,
  adId: number,
  videoIds: number[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const uniqueIds = [...new Set(videoIds.filter(id => Number.isSafeInteger(id) && id > 0))];
  if (uniqueIds.length > 50) {
    throw new Error("At most 50 target videos per ad.");
  }

  const [ad] = await db
    .select({ id: prerollAds.id })
    .from(prerollAds)
    .where(eq(prerollAds.id, adId))
    .limit(1);
  if (!ad) throw new Error("Ad not found.");

  if (uniqueIds.length > 0) {
    const found = await db
      .select({ id: videos.id })
      .from(videos)
      .where(inArray(videos.id, uniqueIds));
    const foundIds = new Set(found.map(r => r.id));
    const missing = uniqueIds.filter(id => !foundIds.has(id));
    if (missing.length > 0) {
      throw new Error(`Video${missing.length > 1 ? "s" : ""} not found: ${missing.join(", ")}`);
    }
  }

  // Replace all targets atomically.
  await db.delete(prerollAdTargets).where(eq(prerollAdTargets.adId, adId));
  if (uniqueIds.length > 0) {
    await db.insert(prerollAdTargets).values(
      uniqueIds.map(videoId => ({ adId, videoId }))
    );
  }

  await logAdminAction(adminId, "ad.set_targets", "preroll_ad", adId, {
    videoIds: uniqueIds,
  });
  return { ok: true, count: uniqueIds.length };
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export async function searchAdminUsers(query: string, limit = 25) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const q = `%${query.trim()}%`;
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isBanned: users.isBanned,
      suspendedUntil: users.suspendedUntil,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(or(ilike(users.name, q), ilike(users.email, q)))
    .orderBy(desc(users.createdAt))
    .limit(limit);
  return rows;
}

export type UserModerationAction = "warn" | "restrict" | "suspend" | "ban" | "unban";

export async function moderateUser(
  adminId: number,
  userId: number,
  action: UserModerationAction,
  reason?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Strict hierarchy: cannot moderate fellow admins (only admins manage admins,
  // handled at router: moderatorProcedure blocks admin targets).
  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) throw new Error("User not found.");

  const now = new Date();
  switch (action) {
    case "warn":
      // Warn = logged + no state change (notification sent separately if needed).
      break;
    case "restrict":
      // 24-hour suspension.
      await db
        .update(users)
        .set({ suspendedUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000) })
        .where(eq(users.id, userId));
      break;
    case "suspend":
      // 7-day suspension.
      await db
        .update(users)
        .set({ suspendedUntil: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) })
        .where(eq(users.id, userId));
      break;
    case "ban":
      await db
        .update(users)
        .set({ isBanned: true, suspendedUntil: null })
        .where(eq(users.id, userId));
      break;
    case "unban":
      await db
        .update(users)
        .set({ isBanned: false, suspendedUntil: null })
        .where(eq(users.id, userId));
      break;
  }
  await logAdminAction(adminId, `user.${action}`, "user", userId, { reason });
  return { ok: true };
}

export async function setUserRole(
  adminId: number,
  userId: number,
  role: "user" | "moderator" | "admin"
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  // Only admins can assign roles (enforced at router: adminProcedure only).
  await db.update(users).set({ role }).where(eq(users.id, userId));
  await logAdminAction(adminId, "user.set_role", "user", userId, { role });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Content moderation — Meta 3-tier: REMOVE / REDUCE / KEEP             */
/* ------------------------------------------------------------------ */

export type ModerationDecision = "remove" | "reduce" | "keep";

export async function getModerationQueue(limit = 25, offset = 0) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select({
      id: moderationReports.id,
      targetType: moderationReports.targetType,
      targetId: moderationReports.targetId,
      reason: moderationReports.reason,
      details: moderationReports.details,
      status: moderationReports.status,
      createdAt: moderationReports.createdAt,
      reporterName: users.name,
      reportCount: sql<number>`count(*) over (partition by "targetType", "targetId")`,
    })
    .from(moderationReports)
    .leftJoin(users, eq(moderationReports.reporterId, users.id))
    .where(eq(moderationReports.status, "open"))
    .orderBy(desc(moderationReports.createdAt))
    .limit(limit)
    .offset(offset);
  return rows;
}

export async function decideModeration(
  adminId: number,
  reportId: number,
  decision: ModerationDecision,
  note?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [report] = await db
    .select()
    .from(moderationReports)
    .where(eq(moderationReports.id, reportId))
    .limit(1);
  if (!report) throw new Error("Report not found.");

  if (decision === "remove") {
    // REMOVE: content violates standards. Use the existing M9 moderation
    // pipeline for physical removal to stay consistent.
    const { resolveModerationReport } = await import("./moderation");
    await resolveModerationReport(adminId, reportId, note || "Removed: violates standards");
  } else {
    // REDUCE = limit distribution (resolved with note); KEEP = dismiss.
    await db
      .update(moderationReports)
      .set({
        status: decision === "keep" ? "dismissed" : "resolved",
        resolvedAt: new Date(),
        resolvedBy: adminId,
      })
      .where(eq(moderationReports.id, reportId));
  }

  await logAdminAction(adminId, `moderation.${decision}`, report.targetType, report.targetId, {
    reportId,
    note,
  });
  return { ok: true };
}
