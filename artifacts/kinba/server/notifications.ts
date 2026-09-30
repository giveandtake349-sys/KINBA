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
import { hypeRoomMembers, notifications, users } from "../drizzle/schema";
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
  /** Hype Room conversation writers (see resolveHypeRoomMessageRecipients). */
  roomComment: "room_comment",
  roomReply: "room_reply",
  roomMention: "room_mention",
  /** Hype Room invite writer — attached to invite create/re-open only. */
  roomInvite: "room_invite",
  /** Hype Room moderation writer — host hid the recipient's own message. */
  roomMessageHidden: "room_message_hidden",
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

// ---------------------------------------------------------------------------
// Hype Room conversation + invite writers (JHILIK Hype Room upgrade)
// ---------------------------------------------------------------------------

/**
 * Deep link for a Hype Room message (comment or reply).
 * Falls back to the plain room route in the client when no anchor is needed.
 */
export function hypeRoomMessageLink(roomId: number, messageId: number): string {
  return `/rooms/${roomId}?msg=${messageId}`;
}

export type HypeRoomMessageNotifyInput = {
  room: { id: number; title: string; hostId: number };
  message: { id: number; userId: number; parentId: number | null };
  /** Short excerpt used in the notification body (never required). */
  body?: string | null;
  /** Author of the replied-to message (null for top-level messages). */
  parentAuthorId: number | null;
  /** Mentioned user ids already validated as active room members. */
  mentionedUserIds?: readonly number[];
};

export type HypeRoomMessageRecipient = {
  userId: number;
  type:
    | typeof NOTIFICATION_TYPES.roomComment
    | typeof NOTIFICATION_TYPES.roomReply
    | typeof NOTIFICATION_TYPES.roomMention;
};

/**
 * Pure fan-out rules for one room message — at most ONE notification per
 * recipient per message (mention > reply > host comment), and never for the
 * author of the message itself.
 */
export function resolveHypeRoomMessageRecipients(
  input: HypeRoomMessageNotifyInput
): HypeRoomMessageRecipient[] {
  const actorId = input.message.userId;
  const byUser = new Map<number, HypeRoomMessageRecipient["type"]>();

  for (const rawId of input.mentionedUserIds ?? []) {
    if (!Number.isInteger(rawId) || rawId <= 0) continue;
    if (rawId === actorId) continue;
    byUser.set(rawId, NOTIFICATION_TYPES.roomMention);
  }

  const parentAuthorId = input.parentAuthorId;
  if (
    parentAuthorId != null &&
    Number.isInteger(parentAuthorId) &&
    parentAuthorId !== actorId &&
    !byUser.has(parentAuthorId)
  ) {
    byUser.set(parentAuthorId, NOTIFICATION_TYPES.roomReply);
  }

  // Top-level messages surface to the host; replies stay inside the thread.
  if (
    input.message.parentId == null &&
    Number.isInteger(input.room.hostId) &&
    input.room.hostId !== actorId &&
    !byUser.has(input.room.hostId)
  ) {
    byUser.set(input.room.hostId, NOTIFICATION_TYPES.roomComment);
  }

  return [...byUser].map(([userId, type]) => ({ userId, type }));
}

/** Same (recipient, type, link) triple never stacks a duplicate alert. */
async function hasMatchingNotification(
  client: DbLike,
  userId: number,
  type: string,
  link: string
): Promise<boolean> {
  const [existing] = await client
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, type),
        eq(notifications.link, link)
      )
    )
    .limit(1);
  return existing != null;
}

/**
 * Privacy gate for one room: who may learn anything about its conversation.
 * Active (not left, not banned) members plus the host — nobody else, even
 * when a stale recipient id slips into the fan-out rules. Fails closed: a
 * failed audience read yields an empty set, so no private room activity is
 * ever leaked through a notification.
 */
async function listRoomAudienceIds(
  client: DbLike,
  roomId: number,
  hostId: number
): Promise<Set<number>> {
  try {
    const rows = await client
      .select({ userId: hypeRoomMembers.userId })
      .from(hypeRoomMembers)
      .where(
        and(
          eq(hypeRoomMembers.roomId, roomId),
          isNull(hypeRoomMembers.leftAt),
          isNull(hypeRoomMembers.bannedAt)
        )
      );
    const ids = new Set<number>();
    for (const row of rows) {
      if (Number.isInteger(row.userId) && row.userId > 0) ids.add(row.userId);
    }
    if (Number.isInteger(hostId) && hostId > 0) ids.add(hostId);
    return ids;
  } catch (error) {
    console.warn("[Notifications] Hype Room audience lookup failed:", error);
    return new Set<number>();
  }
}

/**
 * Hype Room comment / reply / mention writer.
 * Fires after the message transaction commits; best-effort like every other
 * writer (never breaks the parent send). Respects the room feature flag,
 * never notifies the actor, restricts delivery to the room audience
 * (host + active members), and de-duplicates per (recipient, type, link).
 */
export async function notifyHypeRoomMessage(
  input: HypeRoomMessageNotifyInput,
  db?: DbLike
): Promise<number> {
  const recipients = resolveHypeRoomMessageRecipients(input);
  if (recipients.length === 0) return 0;
  const link = hypeRoomMessageLink(input.room.id, input.message.id);
  const client = db ?? (await getDb());
  if (!client) return 0;
  if (!(await isWriterFlagEnabled("time_limited_communities"))) return 0;

  const audience = await listRoomAudienceIds(
    client,
    input.room.id,
    input.room.hostId
  );

  let written = 0;
  for (const recipient of recipients) {
    try {
      if (!audience.has(recipient.userId)) continue;
      if (await hasMatchingNotification(client, recipient.userId, recipient.type, link)) {
        continue;
      }
      const created = await insertNotification(
        {
          userId: recipient.userId,
          type: recipient.type,
          title: titleForHypeRoomMessage(recipient.type),
          body: bodyForHypeRoomMessage(input, recipient.type),
          entityType: "hype_room",
          entityId: input.room.id,
          link,
        },
        client
      );
      if (created) written += 1;
    } catch (error) {
      console.warn("[Notifications] Hype Room message writer failed:", error);
    }
  }
  return written;
}

function titleForHypeRoomMessage(
  type: HypeRoomMessageRecipient["type"]
): string {
  if (type === NOTIFICATION_TYPES.roomReply) return "New reply";
  if (type === NOTIFICATION_TYPES.roomMention) return "You were mentioned";
  return "New comment in your room";
}

function bodyForHypeRoomMessage(
  input: HypeRoomMessageNotifyInput,
  type: HypeRoomMessageRecipient["type"]
): string {
  const excerpt = input.body;
  const snippet = excerpt ? `: “${excerpt.slice(0, 120)}”` : "";
  if (type === NOTIFICATION_TYPES.roomReply) {
    return `Someone replied to your message in “${input.room.title}”${snippet}.`;
  }
  if (type === NOTIFICATION_TYPES.roomMention) {
    return `You were mentioned in “${input.room.title}”${snippet}.`;
  }
  return `New comment in “${input.room.title}”${snippet}.`;
}

/**
 * Hype Room invite writer — only on invite create/re-open transitions.
 * Never notifies the inviter about their own invite, and never stacks a
 * second invite alert for the same room (de-duplicated on the room link).
 */
export async function notifyRoomInvited(
  room: { id: number; title: string },
  invitedUserId: number,
  inviterId: number,
  db?: DbLike
): Promise<boolean> {
  if (!Number.isInteger(invitedUserId) || invitedUserId <= 0) return false;
  if (invitedUserId === inviterId) return false;
  const client = db ?? (await getDb());
  if (!client) return false;
  if (!(await isWriterFlagEnabled("time_limited_communities"))) return false;

  const link = `/rooms/${room.id}`;
  try {
    if (
      await hasMatchingNotification(
        client,
        invitedUserId,
        NOTIFICATION_TYPES.roomInvite,
        link
      )
    ) {
      return false;
    }
    const created = await insertNotification(
      {
        userId: invitedUserId,
        type: NOTIFICATION_TYPES.roomInvite,
        title: "Room invite",
        body: `You were invited to “${room.title}”.`,
        entityType: "hype_room",
        entityId: room.id,
        link,
      },
      client
    );
    return created != null;
  } catch (error) {
    console.warn("[Notifications] Hype Room invite writer failed:", error);
    return false;
  }
}

/**
 * Hype Room moderation writer — §22 "message removed by moderation".
 * Targets only the author of the hidden message, never the host who acted,
 * and only while that author still belongs to the room audience.
 */
export async function notifyRoomMessageHidden(
  room: { id: number; title: string; hostId: number },
  message: { id: number; roomId: number },
  authorId: number,
  db?: DbLike
): Promise<boolean> {
  if (!Number.isInteger(authorId) || authorId <= 0) return false;
  if (authorId === room.hostId) return false;
  const client = db ?? (await getDb());
  if (!client) return false;
  if (!(await isWriterFlagEnabled("time_limited_communities"))) return false;

  const audience = await listRoomAudienceIds(client, message.roomId, room.hostId);
  if (!audience.has(authorId)) return false;

  const link = hypeRoomMessageLink(message.roomId, message.id);
  try {
    if (
      await hasMatchingNotification(
        client,
        authorId,
        NOTIFICATION_TYPES.roomMessageHidden,
        link
      )
    ) {
      return false;
    }
    const created = await insertNotification(
      {
        userId: authorId,
        type: NOTIFICATION_TYPES.roomMessageHidden,
        title: "Message removed",
        body: `A message you sent in “${room.title}” was removed by the host.`,
        entityType: "hype_room",
        entityId: room.id,
        link,
      },
      client
    );
    return created != null;
  } catch (error) {
    console.warn("[Notifications] Hype Room moderation writer failed:", error);
    return false;
  }
}

