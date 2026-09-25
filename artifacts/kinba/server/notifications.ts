/**
 * JHILIK durable notifications (Phase 2 Milestone 7).
 *
 * Read APIs: notifications.list / unreadCount / markRead (protected; no flag).
 * Internal insertNotification centralizes durable writes (not a public API).
 * Writers attach only to actual state transitions (§22) — never to reads.
 * home.notifications derived feed is intentionally untouched (server/db.ts).
 * Flags: writers follow parent feature flags (rooms / drops); reads have none.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { notifications, users } from "../drizzle/schema";
import { getDb } from "./db";
import { isFeatureFlagEnabled } from "./featureFlags";

export type NotificationRow = typeof notifications.$inferSelect;

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type TxClient = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
type DbLike = DbClient | TxClient;

export type InsertNotificationInput = {
  userId: number;
  type: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  link?: string | null;
};

/** Spec §22 durable types used by approved M7 writers only. */
export const NOTIFICATION_TYPES = {
  claimFulfilled: "drop_claim_fulfilled",
  claimCancelled: "drop_claim_cancelled",
  dropSoldOut: "drop_sold_out",
  roomStarted: "room_started",
  roomExpired: "room_expired",
  memberRemoved: "room_member_removed",
  /** JHILIK follow writer — attached to the follow-start transition only. */
  newFollower: "new_follower",
} as const;

const TYPE_MAX = 64;
const LINK_MAX = 512;
const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 100;

function validateInsertInput(input: InsertNotificationInput): {
  userId: number;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: number | null;
  link: string | null;
} {
  if (!Number.isInteger(input.userId) || input.userId <= 0) {
    throw new Error("Notification recipient userId is required.");
  }
  const type = (input.type ?? "").trim();
  if (!type || type.length > TYPE_MAX) {
    throw new Error(`Notification type must be 1–${TYPE_MAX} characters.`);
  }
  const title = (input.title ?? "").trim();
  if (!title) {
    throw new Error("Notification title is required.");
  }
  const body =
    input.body == null || input.body === "" ? null : String(input.body);
  const entityType =
    input.entityType == null || input.entityType === ""
      ? null
      : String(input.entityType).slice(0, 48);
  const entityId =
    input.entityId == null || !Number.isInteger(input.entityId)
      ? null
      : input.entityId;
  let link: string | null = null;
  if (input.link != null && input.link !== "") {
    link = String(input.link).slice(0, LINK_MAX);
  }
  return {
    userId: input.userId,
    type,
    title,
    body,
    entityType,
    entityId,
    link,
  };
}

/**
 * Central durable notification insert (internal).
 * Validates payload; no-ops when the recipient user does not exist.
 * Never exposes a path to write under a different authenticated user —
 * callers must pass the intended recipient id explicitly.
 */
export async function insertNotification(
  input: InsertNotificationInput,
  db?: DbLike
): Promise<NotificationRow | null> {
  const row = validateInsertInput(input);
  const client = db ?? (await getDb());
  if (!client) return null;

  const [recipient] = await client
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  if (!recipient) return null;

  const [inserted] = await client
    .insert(notifications)
    .values({
      userId: row.userId,
      type: row.type,
      title: row.title,
      body: row.body,
      entityType: row.entityType,
      entityId: row.entityId,
      link: row.link,
      readAt: null,
    })
    .returning();
  return inserted ?? null;
}

/**
 * Follow-start writer (JHILIK Activity Center).
 *
 * Called by profile.toggleFollow only when a new follow row was created —
 * never on unfollow or on reads. Idempotent per follower: re-following the
 * same person does not stack duplicate alerts (app-level dedupe; no schema
 * change). Best-effort like every other writer: a failure never breaks the
 * follow transition itself.
 */
export async function notifyNewFollower(
  followerId: number,
  followedId: number
): Promise<NotificationRow | null> {
  if (!Number.isInteger(followerId) || !Number.isInteger(followedId)) {
    return null;
  }
  if (followerId === followedId) return null;
  try {
    const db = await getDb();
    if (!db) return null;
    const [follower] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, followerId))
      .limit(1);
    if (!follower) return null;

    const [existing] = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, followedId),
          eq(notifications.type, NOTIFICATION_TYPES.newFollower),
          eq(notifications.entityId, followerId)
        )
      )
      .limit(1);
    if (existing) return null;

    return await insertNotification(
      {
        userId: followedId,
        type: NOTIFICATION_TYPES.newFollower,
        title: "New follower",
        body: `${follower.name?.trim() || "Someone"} started following you.`,
        entityType: "user",
        entityId: followerId,
        link: `/profile/${followerId}`,
      },
      db
    );
  } catch (error) {
    console.warn("[Notifications] Follow writer insert failed:", error);
    return null;
  }
}

/** Parent flag gate for Phase 2 writers (fail closed on errors). */
async function isWriterFlagEnabled(
  flag: "time_limited_communities" | "jhilik_drops"
): Promise<boolean> {
  try {
    return await isFeatureFlagEnabled(flag);
  } catch {
    return false;
  }
}

/**
 * Best-effort writer wrapper: never fails the parent transition.
 * Returns true only when a durable row was inserted.
 */
async function safeInsert(
  flag: "time_limited_communities" | "jhilik_drops",
  input: InsertNotificationInput,
  db?: DbLike
): Promise<boolean> {
  if (!(await isWriterFlagEnabled(flag))) return false;
  try {
    const created = await insertNotification(input, db);
    return created != null;
  } catch (error) {
    console.warn("[Notifications] Writer insert failed:", error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Durable read APIs (protected; no feature flag)
// ---------------------------------------------------------------------------

/**
 * Current user's durable notifications (newest first).
 * Mirrors listRewardHistory paging: limit 1–100, default 50.
 */
export async function listUserNotifications(
  userId: number,
  limit: number = LIST_DEFAULT_LIMIT
): Promise<NotificationRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const safeLimit = Math.min(Math.max(limit, 1), LIST_MAX_LIMIT);
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(safeLimit);
}

/** Unread durable count for the authenticated user only. */
export async function getUnreadNotificationCount(
  userId: number
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row?.value ?? 0);
}

/**
 * Mark durable notifications read for the authenticated user only.
 * Idempotent: already-read rows are not rewritten (WHERE readAt IS NULL).
 * When `ids` is omitted, marks all unread rows for that user.
 */
export async function markUserNotificationsRead(
  userId: number,
  ids?: number[]
): Promise<{ updated: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();
  const conditions = [
    eq(notifications.userId, userId),
    isNull(notifications.readAt),
  ];
  if (ids && ids.length > 0) {
    const safeIds = [
      ...new Set(ids.filter(id => Number.isInteger(id) && id > 0)),
    ].slice(0, 200);
    if (safeIds.length === 0) return { updated: 0 };
    conditions.push(inArray(notifications.id, safeIds));
  }
  const rows = await db
    .update(notifications)
    .set({ readAt: now })
    .where(and(...conditions))
    .returning({ id: notifications.id });
  return { updated: rows.length };
}

// ---------------------------------------------------------------------------
// §22 writers — only on actual state transitions (called from drops/hypeRooms)
// ---------------------------------------------------------------------------

/** A/B — claim fulfilled or cancelled → claimer. */
export async function notifyClaimStatusChange(
  claim: { userId: number; dropId: number },
  drop: { title: string },
  status: "fulfilled" | "cancelled",
  db?: DbLike
): Promise<boolean> {
  const type =
    status === "fulfilled"
      ? NOTIFICATION_TYPES.claimFulfilled
      : NOTIFICATION_TYPES.claimCancelled;
  const title =
    status === "fulfilled" ? "Claim fulfilled" : "Claim cancelled";
  const body =
    status === "fulfilled"
      ? `Your claim for “${drop.title}” was fulfilled.`
      : `Your claim for “${drop.title}” was cancelled.`;
  return safeInsert(
    "jhilik_drops",
    {
      userId: claim.userId,
      type,
      title,
      body,
      entityType: "drop",
      entityId: claim.dropId,
    },
    db
  );
}

/** C — drop live → sold_out → all existing claimers (distinct). */
export async function notifyDropSoldOut(
  drop: { id: number; title: string },
  claimerUserIds: number[],
  db?: DbLike
): Promise<number> {
  const unique = [
    ...new Set(
      claimerUserIds.filter(id => Number.isInteger(id) && id > 0)
    ),
  ];
  let written = 0;
  for (const userId of unique) {
    const ok = await safeInsert(
      "jhilik_drops",
      {
        userId,
        type: NOTIFICATION_TYPES.dropSoldOut,
        title: "Drop sold out",
        body: `“${drop.title}” is sold out. Existing claims remain valid.`,
        entityType: "drop",
        entityId: drop.id,
      },
      db
    );
    if (ok) written += 1;
  }
  return written;
}

/** D — scheduled → live → host + active members. */
export async function notifyRoomWentLive(
  room: { id: number; title: string; hostId: number },
  recipientUserIds: number[],
  db?: DbLike
): Promise<number> {
  const unique = [
    ...new Set(
      [room.hostId, ...recipientUserIds].filter(
        id => Number.isInteger(id) && id > 0
      )
    ),
  ];
  let written = 0;
  for (const userId of unique) {
    const ok = await safeInsert(
      "time_limited_communities",
      {
        userId,
        type: NOTIFICATION_TYPES.roomStarted,
        title: "Room is live",
        body: `“${room.title}” is live now.`,
        entityType: "hype_room",
        entityId: room.id,
      },
      db
    );
    if (ok) written += 1;
  }
  return written;
}

/** E — live/scheduled → expired → host only. */
export async function notifyRoomExpired(
  room: { id: number; title: string; hostId: number },
  db?: DbLike
): Promise<boolean> {
  return safeInsert(
    "time_limited_communities",
    {
      userId: room.hostId,
      type: NOTIFICATION_TYPES.roomExpired,
      title: "Room ended",
      body: `“${room.title}” has ended.`,
      entityType: "hype_room",
      entityId: room.id,
    },
    db
  );
}

/** F — host removes member → removed user. */
export async function notifyMemberRemoved(
  room: { id: number; title: string },
  removedUserId: number,
  db?: DbLike
): Promise<boolean> {
  return safeInsert(
    "time_limited_communities",
    {
      userId: removedUserId,
      type: NOTIFICATION_TYPES.memberRemoved,
      title: "Removed from room",
      body: `You were removed from “${room.title}”.`,
      entityType: "hype_room",
      entityId: room.id,
    },
    db
  );
}
