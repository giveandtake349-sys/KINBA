/**
 * JHILIK temporary Hype/Community rooms (Phase 2 Milestones 1–4, M6 lifecycle).
 *
 * M1: create / get / list active / resolve expiry.
 * M2: join / leave / list members (hype_room_members).
 * M4: messages list/send, host end (live→expired), pin/unpin, removeMember.
 * M6: list filters (live/upcoming/mine), host scheduled-cancel (→archived),
 *     host/create eligibility (default verified company/creator, §16).
 * Lifecycle is server-authoritative from persisted startsAt/endsAt.
 * Flag: time_limited_communities (fail-closed via router gate).
 * No drops, claims, or rewards in this module.
 * M7: durable notifications fire only on actual status transitions (§22).
 */
import { and, asc, eq, inArray, isNull, isNotNull, ne, sql } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
  hypeRoomInvites,
  hypeRoomMembers,
  hypeRoomMessageMentions,
  hypeRoomMessageReactions,
  hypeRoomMessages,
  hypeRooms,
  profiles,
  users,
  hashtags,
  hypeRoomHashtags,
  hypeRoomMessageHashtags,
  type HypeRoomRow,
} from "../drizzle/schema";
import { extractHashtags, extractHypeRoomHashtags } from "./lib/hashtags";
import {
  assertTransition,
  canTransition,
  HYPE_ROOM_TRANSITIONS,
  resolveHypeRoomStatus,
  type HypeRoomStatus,
} from "@shared/stateMachines";
import { getDb } from "./db";
import {
  notifyHypeRoomMessage,
  notifyMemberRemoved,
  notifyRoomExpired,
  notifyRoomInvited,
  notifyRoomMessageHidden,
  notifyRoomWentLive,
} from "./notifications";

/** Membership row from hype_room_members. */
export type HypeRoomMemberRow = typeof hypeRoomMembers.$inferSelect;

/** Message row from hype_room_messages. */
export type HypeRoomMessageRow = typeof hypeRoomMessages.$inferSelect;

/** Membership row joined with basic user display fields. */
export type HypeRoomMemberWithUser = {
  membership: HypeRoomMemberRow;
  user: {
    id: number;
    name: string | null;
    openId: string;
    photoUrl: string | null;
    username: string | null;
  };
};

/** Message row joined with author display fields (nullable author after SET NULL). */
export type HypeRoomMessageWithUser = {
  message: HypeRoomMessageRow;
  user: {
    id: number | null;
    name: string | null;
    openId: string | null;
    photoUrl: string | null;
    username: string | null;
  };
  /** M-A1 — one-level parent snapshot for threading (null for top-level). */
  parent?: {
    id: number;
    body: string | null;
    userId: number | null;
  } | null;
  /** M-A1 — aggregate reactions on this message. */
  reactions?: Array<{
    reaction: string;
    count: number;
    reactedByMe: boolean;
  }>;
  /** M-A1 — mentioned active-member user ids on this message. */
  mentionUserIds?: number[];
};

/** Allowed temporary room durations (matches DB CHECK + product spec §8.3). */
export const ROOM_DURATION_HOURS = [4, 6, 12, 24] as const;
export type RoomDurationHours = (typeof ROOM_DURATION_HOURS)[number];

/** Max lead time before scheduled start (spec §8.4 default 7 days). */
export const ROOM_MAX_LEAD_MS = 7 * 24 * 60 * 60 * 1000;

/** Small tolerance so "start now" survives minor clock skew. */
const START_PAST_TOLERANCE_MS = 2_000;

const HOUR_MS = 60 * 60 * 1000;

export type CreateHypeRoomInput = {
  title: string;
  topic?: string | null;
  description?: string | null;
  durationHours: number;
  visibility?: "public" | "link_only";
  startsAt?: Date | string | null;
};

export function isValidDurationHours(
  value: number
): value is RoomDurationHours {
  return (
    Number.isInteger(value) &&
    (ROOM_DURATION_HOURS as readonly number[]).includes(value)
  );
}

export function assertValidDurationHours(value: number): RoomDurationHours {
  if (!isValidDurationHours(value)) {
    throw new Error(
      `Room duration must be one of: ${ROOM_DURATION_HOURS.join(", ")} hours.`
    );
  }
  return value;
}

/**
 * Sync hashtags for a Hype Room within a transaction.
 */
async function syncHypeRoomHashtags(
  tx: PgTransaction<any, any, any>,
  roomId: number,
  newHashtags: ReturnType<typeof extractHashtags>
) {
  if (newHashtags.length === 0) {
    await tx.delete(hypeRoomHashtags).where(eq(hypeRoomHashtags.roomId, roomId));
    return;
  }

  // Upsert canonical hashtags and get their IDs
  const hashtagRows: { id: number; tag: string }[] = [];
  for (const ht of newHashtags) {
    const [upserted] = await tx
      .insert(hashtags)
      .values({ tag: ht.normalized, displayTag: ht.display })
      .onConflictDoUpdate({
        target: hashtags.tag,
        set: { updatedAt: new Date() },
      })
      .returning({ id: hashtags.id, tag: hashtags.tag });
    hashtagRows.push(upserted);
  }
  const newHashtagIds = new Set(hashtagRows.map(h => h.id));

  // Get existing associations
  const existing = await tx
    .select({ hashtagId: hypeRoomHashtags.hashtagId })
    .from(hypeRoomHashtags)
    .where(eq(hypeRoomHashtags.roomId, roomId));

  const existingHashtagIds = new Set(existing.map(e => e.hashtagId));

  // Remove associations that are no longer present
  const toRemove = [...existingHashtagIds].filter(id => !newHashtagIds.has(id));
  if (toRemove.length > 0) {
    await tx
      .delete(hypeRoomHashtags)
      .where(
        and(
          eq(hypeRoomHashtags.roomId, roomId),
          inArray(hypeRoomHashtags.hashtagId, toRemove)
        )
      );
  }

  // Add new associations
  const toAdd = [...newHashtagIds].filter(id => !existingHashtagIds.has(id));
  if (toAdd.length > 0) {
    await tx.insert(hypeRoomHashtags).values(
      toAdd.map(hashtagId => ({
        roomId,
        hashtagId,
      }))
    );
  }
}

/**
 * Sync hashtags for a Hype Room message within a transaction.
 */
async function syncHypeRoomMessageHashtags(
  tx: PgTransaction<any, any, any>,
  messageId: number,
  newHashtags: ReturnType<typeof extractHashtags>
) {
  if (newHashtags.length === 0) {
    await tx.delete(hypeRoomMessageHashtags).where(eq(hypeRoomMessageHashtags.messageId, messageId));
    return;
  }

  // Upsert canonical hashtags and get their IDs
  const hashtagRows: { id: number; tag: string }[] = [];
  for (const ht of newHashtags) {
    const [upserted] = await tx
      .insert(hashtags)
      .values({ tag: ht.normalized, displayTag: ht.display })
      .onConflictDoUpdate({
        target: hashtags.tag,
        set: { updatedAt: new Date() },
      })
      .returning({ id: hashtags.id, tag: hashtags.tag });
    hashtagRows.push(upserted);
  }
  const newHashtagIds = new Set(hashtagRows.map(h => h.id));

  // Get existing associations
  const existing = await tx
    .select({ hashtagId: hypeRoomMessageHashtags.hashtagId })
    .from(hypeRoomMessageHashtags)
    .where(eq(hypeRoomMessageHashtags.messageId, messageId));

  const existingHashtagIds = new Set(existing.map(e => e.hashtagId));

  // Remove associations that are no longer present
  const toRemove = [...existingHashtagIds].filter(id => !newHashtagIds.has(id));
  if (toRemove.length > 0) {
    await tx
      .delete(hypeRoomMessageHashtags)
      .where(
        and(
          eq(hypeRoomMessageHashtags.messageId, messageId),
          inArray(hypeRoomMessageHashtags.hashtagId, toRemove)
        )
      );
  }

  // Add new associations
  const toAdd = [...newHashtagIds].filter(id => !existingHashtagIds.has(id));
  if (toAdd.length > 0) {
    await tx.insert(hypeRoomMessageHashtags).values(
      toAdd.map(hashtagId => ({
        messageId,
        hashtagId,
      }))
    );
  }
}

/** Deterministic expiry from persisted start + duration (server clock). */
export function computeEndsAt(
  startsAt: Date,
  durationHours: number
): Date {
  const hours = assertValidDurationHours(durationHours);
  return new Date(startsAt.getTime() + hours * HOUR_MS);
}

export function normalizeStartsAt(
  raw: Date | string | null | undefined,
  now: Date = new Date()
): Date {
  if (raw == null || raw === "") return now;
  const startsAt = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw);
  if (Number.isNaN(startsAt.getTime())) {
    throw new Error("Room start time is invalid.");
  }
  if (startsAt.getTime() < now.getTime() - START_PAST_TOLERANCE_MS) {
    throw new Error("Room start must be now or in the future.");
  }
  if (startsAt.getTime() > now.getTime() + ROOM_MAX_LEAD_MS) {
    throw new Error("Room start cannot be more than 7 days ahead.");
  }
  return startsAt;
}

/**
 * Pure lifecycle resolution for a stored room row.
 * Never invents transitions outside HYPE_ROOM_TRANSITIONS.
 */
export function resolveRoomLifecycle(
  room: Pick<HypeRoomRow, "status" | "startsAt" | "endsAt">,
  now: Date = new Date()
): {
  status: HypeRoomStatus;
  changed: boolean;
  expiredAt?: Date;
} {
  const next = resolveHypeRoomStatus(
    room.status,
    room.startsAt,
    room.endsAt,
    now
  );
  const changed = next !== room.status;
  if (changed) {
    // Time resolver may collapse scheduled → expired when endsAt already
    // passed (legal per resolveHypeRoomStatus, not listed in the manual map).
    const timeCollapsedToExpired =
      room.status === "scheduled" && next === "expired";
    if (!timeCollapsedToExpired) {
      // Guard: resolution must be a legal transition (defense in depth).
      assertTransition(
        HYPE_ROOM_TRANSITIONS,
        room.status,
        next,
        "hype room"
      );
    }
  }
  if (changed && next === "expired") {
    return { status: next, changed, expiredAt: now };
  }
  return { status: next, changed };
}

/** Reject illegal manual/lazy transitions (e.g. expired → live). */
export function assertRoomTransition(
  from: HypeRoomStatus,
  to: HypeRoomStatus
): void {
  if (!canTransition(HYPE_ROOM_TRANSITIONS, from, to)) {
    assertTransition(HYPE_ROOM_TRANSITIONS, from, to, "hype room");
  }
}

/**
 * Host/create eligibility (spec §16: “default verified company/creator”).
 * Mirrors the verified company/creator matrix used for sellers (§9.6);
 * does not invent new roles, verification classes, or payment gates.
 */
export function isEligibleRoomHost(
  profile:
    | { accountType: string; verificationStatus: string }
    | null
    | undefined
): boolean {
  if (!profile) return false;
  if (
    profile.accountType !== "company" &&
    profile.accountType !== "creator"
  ) {
    return false;
  }
  const v = profile.verificationStatus;
  if (v === "business_verified" || v === "official") return true;
  // Paid-verified creators currently map to `verified` and remain eligible.
  if (profile.accountType === "creator" && v === "verified") return true;
  return false;
}

/** Load profile and enforce host eligibility (admin bypass handled by caller). */
async function assertProfileEligibleRoomHost(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  userId: number
): Promise<void> {
  const [profile] = await db
    .select({
      accountType: profiles.accountType,
      verificationStatus: profiles.verificationStatus,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (!isEligibleRoomHost(profile)) {
    throw new Error(
      "Only verified company/creator accounts can create rooms."
    );
  }
}

/** Host cancel eligibility: only scheduled rooms (§8.4 / §19.1). */
export function canHostCancelScheduled(status: HypeRoomStatus): boolean {
  return status === "scheduled";
}

/** Approved list filters only (spec §18.3). Default = legacy active list. */
export type HypeRoomListFilter = "live" | "upcoming" | "mine";

/** Pure post-resolve membership in a list bucket. */
export function matchesRoomListFilter(
  room: Pick<HypeRoomRow, "status" | "hostId">,
  filter: HypeRoomListFilter | undefined,
  userId: number | null | undefined
): boolean {
  if (filter == null) {
    // Legacy default: active scheduled/live set (M1 behavior).
    return room.status === "scheduled" || room.status === "live";
  }
  if (filter === "live") return room.status === "live";
  if (filter === "upcoming") return room.status === "scheduled";
  // mine — parallel to drops.list mine: rooms this user hosts.
  if (userId == null) return false;
  return room.hostId === userId;
}

/**
 * Discovery visibility (spec §8.4 "public listing vs link-only").
 * Public rooms are discoverable by anyone; link-only rooms are unlisted and
 * only surface to the host or an active member of that room. Anonymous
 * viewers never see a link-only room in a list.
 */
export function canDiscoverRoom(
  room: Pick<HypeRoomRow, "id" | "visibility" | "hostId">,
  viewerId: number | null | undefined,
  memberRoomIds: ReadonlySet<number>
): boolean {
  if (room.visibility === "public") return true;
  if (viewerId == null) return false;
  if (room.hostId === viewerId) return true;
  return memberRoomIds.has(room.id);
}

/** Active (not left, not banned) room ids the viewer belongs to. */
export async function listViewerMemberRoomIds(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  userId: number
): Promise<Set<number>> {
  const rows = await db
    .select({ roomId: hypeRoomMembers.roomId })
    .from(hypeRoomMembers)
    .where(
      and(
        eq(hypeRoomMembers.userId, userId),
        isNull(hypeRoomMembers.leftAt),
        isNull(hypeRoomMembers.bannedAt)
      )
    );
  return new Set(rows.map(row => row.roomId));
}

/** Active participant counts per room (host + joined, non-banned members). */
async function countRoomParticipants(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  roomIds: number[]
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (roomIds.length === 0) return counts;
  const rows = await db
    .select({
      roomId: hypeRoomMembers.roomId,
      value: sql<number>`count(*)::int`,
    })
    .from(hypeRoomMembers)
    .where(
      and(
        inArray(hypeRoomMembers.roomId, roomIds),
        isNull(hypeRoomMembers.leftAt),
        isNull(hypeRoomMembers.bannedAt)
      )
    )
    .groupBy(hypeRoomMembers.roomId);
  for (const row of rows) {
    counts.set(row.roomId, Number(row.value));
  }
  return counts;
}

/** Room row + active participant count (discovery payload). */
export type HypeRoomSummary = HypeRoomRow & { participantCount: number };


async function persistResolvedRoom(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  room: HypeRoomRow,
  now: Date
): Promise<HypeRoomRow> {
  const fromStatus = room.status;
  const resolution = resolveRoomLifecycle(room, now);
  if (!resolution.changed) return room;
  const patch: Partial<typeof hypeRooms.$inferInsert> = {
    status: resolution.status,
    updatedAt: now,
  };
  if (resolution.status === "expired") {
    patch.expiredAt = room.expiredAt ?? resolution.expiredAt ?? now;
  }
  if (resolution.status === "archived") {
    patch.archivedAt = room.archivedAt ?? now;
  }
  const [updated] = await db
    .update(hypeRooms)
    .set(patch)
    .where(
      and(
        eq(hypeRooms.id, room.id),
        eq(hypeRooms.status, room.status)
      )
    )
    .returning();
  if (!updated) {
    // Lost optimistic race — another writer already advanced; do not notify.
    return { ...room, ...patch };
  }
  // §22 writers only on the actual transition row (never on unchanged reads).
  if (fromStatus === "scheduled" && updated.status === "live") {
    await notifyRoomWentLive(
      { id: updated.id, title: updated.title, hostId: updated.hostId },
      await listActiveMemberIds(db, updated.id),
      db
    );
  }
  if (updated.status === "expired" && fromStatus !== "expired") {
    await notifyRoomExpired(
      {
        id: updated.id,
        title: updated.title,
        hostId: updated.hostId,
      },
      db
    );
  }
  return updated;
}

/** Active (not left) member user ids for fanout (host included by writer). */
async function listActiveMemberIds(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  roomId: number
): Promise<number[]> {
  const rows = await db
    .select({ userId: hypeRoomMembers.userId })
    .from(hypeRoomMembers)
    .where(
      and(eq(hypeRoomMembers.roomId, roomId), isNull(hypeRoomMembers.leftAt))
    );
  return rows.map(r => r.userId);
}

/**
 * Create a temporary room. Ends are always computed server-side:
 * endsAt = startsAt + durationHours.
 * Host must be verified company/creator (§16) unless callers pre-check admin.
 */
export async function createHypeRoom(
  hostId: number,
  input: CreateHypeRoomInput,
  opts: { skipEligibility?: boolean } = {}
): Promise<HypeRoomRow> {
  const durationHours = assertValidDurationHours(input.durationHours);
  const now = new Date();
  const startsAt = normalizeStartsAt(input.startsAt, now);
  const endsAt = computeEndsAt(startsAt, durationHours);
  const title = input.title.trim();
  if (title.length < 3 || title.length > 100) {
    throw new Error("Room title must be 3–100 characters.");
  }
  const description = input.description?.trim() || null;
  if (description != null && description.length > 500) {
    throw new Error("Room description must be at most 500 characters.");
  }
  const topic = input.topic?.trim() || null;

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  if (!opts.skipEligibility) {
    const [actor] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, hostId))
      .limit(1);
    // §16: Admin may always create; otherwise default verified company/creator.
    if (actor?.role !== "admin") {
      await assertProfileEligibleRoomHost(db, hostId);
    }
  }

  const [created] = await db.transaction(async (tx) => {
    const [room] = await tx
      .insert(hypeRooms)
      .values({
        hostId,
        title,
        topic,
        description,
        status: "scheduled",
        durationHours,
        startsAt,
        endsAt,
        visibility: input.visibility ?? "public",
        // dropId intentionally left null — no safe room↔drop mutation is wired yet.
        dropId: null,
        pinnedMessageId: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!room) throw new Error("Failed to create room.");

    // Sync hashtags from title + topic + description
    const roomTags = extractHypeRoomHashtags(title, topic, description);
    await syncHypeRoomHashtags(tx, room.id, roomTags);

    return [room];
  });

  // Immediate start → promote scheduled → live (or expired if window already over).
  return persistResolvedRoom(db, created, now);
}

/** Fetch one room, lazily persisting any due lifecycle advance. */
export async function getHypeRoom(
  roomId: number
): Promise<HypeRoomRow | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [room] = await db
    .select()
    .from(hypeRooms)
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!room) return null;
  return persistResolvedRoom(db, room, new Date());
}

/**
 * List rooms after resolving due expiry.
 * - no filter (legacy default): scheduled + live (M1 active set)
 * - live: currently live
 * - upcoming: scheduled, not yet live
 * - mine: rooms hosted by userId (parallel to drops.list mine)
 * Visibility: link-only rooms are unlisted — only the host or an active
 * member sees them (see canDiscoverRoom).
 * Order: startsAt, id (unchanged from M1).
 */
export async function listActiveHypeRooms(
  opts: {
    filter?: HypeRoomListFilter;
    userId?: number | null;
  } = {}
): Promise<HypeRoomSummary[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();
  const filter = opts.filter;
  const userId = opts.userId ?? null;

  // mine may include expired hosted rooms; other filters stay on active set.
  const baseStatuses =
    filter === "mine"
      ? (["scheduled", "live", "expired", "archived"] as const)
      : (["scheduled", "live"] as const);

  const rows = await db
    .select()
    .from(hypeRooms)
    .where(inArray(hypeRooms.status, [...baseStatuses]))
    .orderBy(asc(hypeRooms.startsAt), asc(hypeRooms.id));

  const memberRoomIds =
    userId != null
      ? await listViewerMemberRoomIds(db, userId)
      : new Set<number>();

  const matched: HypeRoomRow[] = [];
  for (const row of rows) {
    const resolved = await persistResolvedRoom(db, row, now);
    if (
      matchesRoomListFilter(resolved, filter, userId) &&
      canDiscoverRoom(resolved, userId, memberRoomIds)
    ) {
      matched.push(resolved);
    }
  }

  const counts = await countRoomParticipants(
    db,
    matched.map(room => room.id)
  );
  return matched.map(room => ({
    ...room,
    participantCount: counts.get(room.id) ?? 0,
  }));
}

/**
 * Explicit expiry resolver (safe/idempotent). Advances only forward via the
 * shared transition map — cannot revive an expired/archived room.
 */
export async function resolveHypeRoomExpiry(
  roomId: number
): Promise<HypeRoomRow | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [room] = await db
    .select()
    .from(hypeRooms)
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!room) return null;
  return persistResolvedRoom(db, room, new Date());
}

// ---------------------------------------------------------------------------
// M2 — Members (hype_room_members)
// ---------------------------------------------------------------------------

/** Join is allowed only while the room is scheduled or live (spec §8.2). */
export function canJoinRoomStatus(status: HypeRoomStatus): boolean {
  return status === "scheduled" || status === "live";
}

/** Host membership uses role "host"; everyone else is "member". */
export function resolveMemberRole(
  roomHostId: number,
  userId: number
): "host" | "member" {
  return roomHostId === userId ? "host" : "member";
}

/** Existing row + room state → controlled join decision (pure). */
export type JoinAction =
  | "insert"
  | "rejoin"
  | "reject_duplicate"
  | "reject_banned"
  | "reject_closed";

export function decideJoinAction(
  membership: Pick<HypeRoomMemberRow, "leftAt" | "bannedAt"> | null | undefined,
  roomStatus: HypeRoomStatus
): JoinAction {
  if (!canJoinRoomStatus(roomStatus)) return "reject_closed";
  if (membership?.bannedAt) return "reject_banned";
  if (membership && membership.leftAt == null) return "reject_duplicate";
  return membership ? "rejoin" : "insert";
}

/** Pure leave eligibility (spec §18.4 leave row). */
export function canLeaveMembership(
  membership: Pick<HypeRoomMemberRow, "role" | "leftAt" | "userId"> | null | undefined,
  roomHostId: number
): boolean {
  if (!membership || membership.leftAt != null) return false;
  if (membership.role === "host" || membership.userId === roomHostId) return false;
  return true;
}

/**
 * Join a room (pre-join while scheduled, or while live).
 * Reuses UNIQUE(roomId,userId); soft rejoin clears leftAt.
 */
/**
 * Join rules inside an open transaction (shared by joinHypeRoom + invite accept).
 * Caller owns the transaction — do not nest transactions here.
 */
async function joinHypeRoomInTx(
  tx: Parameters<
    Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
  >[0],
  roomId: number,
  userId: number
): Promise<HypeRoomMemberRow> {
  const [room] = await tx
    .select()
    .from(hypeRooms)
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!room) throw new Error("Room not found.");
  const resolved = await persistResolvedRoom(tx as never, room, new Date());
  if (!canJoinRoomStatus(resolved.status)) {
    throw new Error("This room is no longer accepting new members.");
  }

  const [existing] = await tx
    .select()
    .from(hypeRoomMembers)
    .where(
      and(
        eq(hypeRoomMembers.roomId, roomId),
        eq(hypeRoomMembers.userId, userId)
      )
    )
    .limit(1);

  if (existing?.bannedAt) {
    throw new Error("You are banned from this room.");
  }
  if (existing && existing.leftAt == null) {
    throw new Error("You are already a member of this room.");
  }

  if (existing) {
    const [rejoined] = await tx
      .update(hypeRoomMembers)
      .set({ leftAt: null, removedBy: null })
      .where(eq(hypeRoomMembers.id, existing.id))
      .returning();
    if (!rejoined) throw new Error("Failed to rejoin room.");
    return rejoined;
  }

  const role = resolveMemberRole(resolved.hostId, userId);
  const [inserted] = await tx
    .insert(hypeRoomMembers)
    .values({ roomId, userId, role })
    .onConflictDoNothing({
      target: [hypeRoomMembers.roomId, hypeRoomMembers.userId],
    })
    .returning();
  if (inserted) return inserted;

  // Race: concurrent insert won — treat as controlled duplicate.
  throw new Error("You are already a member of this room.");
}

export async function joinHypeRoom(
  roomId: number,
  userId: number
): Promise<HypeRoomMemberRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => joinHypeRoomInTx(tx, roomId, userId));
}

/** Soft-leave a room (sets leftAt). Host cannot leave. */
export async function leaveHypeRoom(
  roomId: number,
  userId: number
): Promise<HypeRoomMemberRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [room] = await tx
      .select()
      .from(hypeRooms)
      .where(eq(hypeRooms.id, roomId))
      .limit(1);
    if (!room) throw new Error("Room not found.");

    const [membership] = await tx
      .select()
      .from(hypeRoomMembers)
      .where(
        and(
          eq(hypeRoomMembers.roomId, roomId),
          eq(hypeRoomMembers.userId, userId)
        )
      )
      .limit(1);

    if (!canLeaveMembership(membership, room.hostId)) {
      if (membership?.role === "host" || membership?.userId === room.hostId) {
        throw new Error("The host cannot leave the room.");
      }
      if (membership?.leftAt != null) {
        throw new Error("You are not an active member of this room.");
      }
      throw new Error("You are not a member of this room.");
    }

    const [left] = await tx
      .update(hypeRoomMembers)
      .set({ leftAt: new Date() })
      .where(
        and(
          eq(hypeRoomMembers.id, membership!.id),
          isNull(hypeRoomMembers.leftAt)
        )
      )
      .returning();
    if (!left) throw new Error("You are not an active member of this room.");
    return left;
  });
}

/**
 * List active (not left, not banned) members for a room (spec §18.4 members).
 * Public read once the flag gate passes; room must exist.
 */
export async function listHypeRoomMembers(
  roomId: number
): Promise<HypeRoomMemberWithUser[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [room] = await db
    .select({ id: hypeRooms.id })
    .from(hypeRooms)
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!room) throw new Error("Room not found.");

  const rows = await db
    .select({
      membership: hypeRoomMembers,
      user: {
        id: users.id,
        name: users.name,
        openId: users.openId,
        photoUrl: profiles.photoUrl,
        username: profiles.username,
      },
    })
    .from(hypeRoomMembers)
    .innerJoin(users, eq(hypeRoomMembers.userId, users.id))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(
        eq(hypeRoomMembers.roomId, roomId),
        isNull(hypeRoomMembers.leftAt),
        isNull(hypeRoomMembers.bannedAt)
      )
    )
    .orderBy(asc(hypeRoomMembers.joinedAt), asc(hypeRoomMembers.id));

  return rows;
}

// ---------------------------------------------------------------------------
// M4 — Messages, host end, pin/unpin, removeMember
// ---------------------------------------------------------------------------

/** Message body length bounds (reuse comment-style limits; text-only M4). */
export const ROOM_MESSAGE_MIN_LENGTH = 1;
export const ROOM_MESSAGE_MAX_LENGTH = 5000;

export function validateRoomMessageBody(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length < ROOM_MESSAGE_MIN_LENGTH) {
    throw new Error("Message body is required.");
  }
  if (trimmed.length > ROOM_MESSAGE_MAX_LENGTH) {
    throw new Error(
      `Message body must be at most ${ROOM_MESSAGE_MAX_LENGTH} characters.`
    );
  }
  return trimmed;
}

/**
 * Send authorization (product decisions A2 + A5):
 * - room must be live
 * - caller needs an active membership (leftAt null, not banned)
 * - host has no bypass — must also hold an active membership row
 */
export function canSendRoomMessage(
  roomStatus: HypeRoomStatus,
  membership:
    | Pick<HypeRoomMemberRow, "leftAt" | "bannedAt">
    | null
    | undefined
): boolean {
  if (roomStatus !== "live") return false;
  if (!membership) return false;
  if (membership.leftAt != null) return false;
  if (membership.bannedAt != null) return false;
  return true;
}

/** Host control authorization is by room.hostId (not membership bypass for send). */
export function isRoomHost(roomHostId: number, userId: number): boolean {
  return roomHostId === userId;
}

/** Host end (A3): only live → expired. */
export function canHostEndRoom(status: HypeRoomStatus): boolean {
  return status === "live";
}

/**
 * Host cancel before start (spec §8.4 / §19.1): scheduled → archived + reason.
 * Concurrency-safe via optimistic WHERE status='scheduled'.
 * Live/expired/archived rooms are rejected (cannot cancel).
 */
export async function cancelHypeRoom(
  roomId: number,
  userId: number,
  cancelReason?: string | null
): Promise<HypeRoomRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [roomRow] = await db
    .select()
    .from(hypeRooms)
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!roomRow) throw new Error("Room not found.");

  // Resolve first: a due scheduled→live/expired room is no longer cancellable.
  const room = await persistResolvedRoom(db, roomRow, new Date());

  if (!isRoomHost(room.hostId, userId)) {
    throw new Error("Only the host can cancel the room.");
  }
  if (room.status === "live") {
    throw new Error("A live room cannot be cancelled; end it instead.");
  }
  if (room.status === "expired") {
    throw new Error("The room has already ended.");
  }
  if (room.status === "archived") {
    throw new Error("The room is already archived.");
  }
  if (!canHostCancelScheduled(room.status)) {
    throw new Error("Only a scheduled room can be cancelled.");
  }
  assertRoomTransition(room.status, "archived");

  const now = new Date();
  const reason =
    cancelReason == null ? null : cancelReason.trim().slice(0, 500) || null;
  const [updated] = await db
    .update(hypeRooms)
    .set({
      status: "archived",
      cancelReason: reason,
      archivedAt: room.archivedAt ?? now,
      updatedAt: now,
    })
    .where(and(eq(hypeRooms.id, roomId), eq(hypeRooms.status, "scheduled")))
    .returning();
  if (!updated) {
    throw new Error("Room is no longer in scheduled state.");
  }
  return updated;
}

export type RemoveMemberDecision =
  | "ok"
  | "not_host"
  | "target_missing"
  | "target_already_left"
  | "cannot_remove_host";

/** Pure host remove-member decision (soft-remove active non-host only). */
export function decideRemoveMember(
  roomHostId: number,
  actorId: number,
  target:
    | Pick<
        HypeRoomMemberRow,
        "userId" | "leftAt" | "bannedAt" | "role"
      >
    | null
    | undefined
): RemoveMemberDecision {
  if (!isRoomHost(roomHostId, actorId)) return "not_host";
  if (!target) return "target_missing";
  if (target.userId === roomHostId || target.role === "host") {
    return "cannot_remove_host";
  }
  if (target.leftAt != null) return "target_already_left";
  return "ok";
}

async function loadActiveMembership(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>> | Parameters<
    Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
  >[0],
  roomId: number,
  userId: number
): Promise<HypeRoomMemberRow | null> {
  const [membership] = await db
    .select()
    .from(hypeRoomMembers)
    .where(
      and(
        eq(hypeRoomMembers.roomId, roomId),
        eq(hypeRoomMembers.userId, userId)
      )
    )
    .limit(1);
  return membership ?? null;
}

/**
 * Read room transcript (ordered by createdAt).
 * Works while scheduled/live and remains readable after expire (spec §18.4).
 * Hidden/moderated messages (hiddenAt set) are excluded.
 * M-A1: optional viewerUserId enables reactedByMe; parent snapshot + mentions included.
 */
export async function listRoomMessages(
  roomId: number,
  viewerUserId: number | null = null
): Promise<HypeRoomMessageWithUser[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [room] = await db
    .select({ id: hypeRooms.id })
    .from(hypeRooms)
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!room) throw new Error("Room not found.");

  const rows = await db
    .select({
      message: hypeRoomMessages,
      user: {
        id: users.id,
        name: users.name,
        openId: users.openId,
        photoUrl: profiles.photoUrl,
        username: profiles.username,
      },
    })
    .from(hypeRoomMessages)
    .leftJoin(users, eq(hypeRoomMessages.userId, users.id))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(eq(hypeRoomMessages.roomId, roomId), isNull(hypeRoomMessages.hiddenAt))
    )
    .orderBy(asc(hypeRoomMessages.createdAt), asc(hypeRoomMessages.id));

  const messageIds = rows.map(r => r.message.id);
  if (messageIds.length === 0) return [];

  const reactionRows = await db
    .select({
      messageId: hypeRoomMessageReactions.messageId,
      userId: hypeRoomMessageReactions.userId,
      reaction: hypeRoomMessageReactions.reaction,
    })
    .from(hypeRoomMessageReactions)
    .where(inArray(hypeRoomMessageReactions.messageId, messageIds));

  const mentionRows = await db
    .select({
      messageId: hypeRoomMessageMentions.messageId,
      mentionedUserId: hypeRoomMessageMentions.mentionedUserId,
    })
    .from(hypeRoomMessageMentions)
    .where(inArray(hypeRoomMessageMentions.messageId, messageIds));

  const parentIds = [
    ...new Set(
      rows
        .map(r => r.message.parentId)
        .filter((id): id is number => typeof id === "number")
    ),
  ];
  const parentRows =
    parentIds.length > 0
      ? await db
          .select({
            id: hypeRoomMessages.id,
            body: hypeRoomMessages.body,
            userId: hypeRoomMessages.userId,
          })
          .from(hypeRoomMessages)
          .where(
            and(
              inArray(hypeRoomMessages.id, parentIds),
              isNull(hypeRoomMessages.hiddenAt)
            )
          )
      : [];
  const parentById = new Map(parentRows.map(p => [p.id, p]));

  const reactionsByMessage = new Map<
    number,
    Array<{ reaction: string; count: number; reactedByMe: boolean }>
  >();
  const reactionCount = new Map<string, number>();
  for (const row of reactionRows) {
    // Normalize historical multi-reaction values to the single reaction.
    const reaction = normalizeReaction(row.reaction);
    if (!reaction) continue;
    const key = `${row.messageId}:${reaction}`;
    reactionCount.set(key, (reactionCount.get(key) ?? 0) + 1);
  }
  for (const [key, count] of reactionCount) {
    const sep = key.indexOf(":");
    const messageId = Number(key.slice(0, sep));
    const reaction = key.slice(sep + 1);
    const mine =
      viewerUserId != null &&
      reactionRows.some(
        r =>
          r.messageId === messageId &&
          normalizeReaction(r.reaction) === reaction &&
          r.userId === viewerUserId
      );
    const list = reactionsByMessage.get(messageId) ?? [];
    list.push({ reaction, count, reactedByMe: mine });
    reactionsByMessage.set(messageId, list);
  }

  const mentionsByMessage = new Map<number, number[]>();
  for (const row of mentionRows) {
    const list = mentionsByMessage.get(row.messageId) ?? [];
    if (!list.includes(row.mentionedUserId)) list.push(row.mentionedUserId);
    mentionsByMessage.set(row.messageId, list);
  }

  return rows.map(row => {
    const parentId = row.message.parentId;
    const parent = parentId != null ? (parentById.get(parentId) ?? null) : null;
    return {
      message: row.message,
      user: row.user,
      parent: parent
        ? { id: parent.id, body: parent.body, userId: parent.userId }
        : null,
      reactions: reactionsByMessage.get(row.message.id) ?? [],
      mentionUserIds: mentionsByMessage.get(row.message.id) ?? [],
    };
  });
}

import {
  REACTION_TYPES,
  PRIMARY_REACTION,
  isAcceptedReaction,
  normalizeReaction,
  type ReactionType,
} from "@shared/reactions";

/**
 * Explicit small reaction set — arbitrary strings are rejected.
 * Single source: shared/reactions (re-exported so existing imports keep working).
 * The site exposes exactly one reaction (Pookie/Love); historical values are
 * still accepted here for backward compatibility and normalized on write.
 */
export { REACTION_TYPES as HYPE_ROOM_REACTIONS };
export type HypeRoomReaction = ReactionType;

export function isValidHypeRoomReaction(value: string): boolean {
  return isAcceptedReaction(value);
}

/** One-level reply: parent must be a visible top-level message in the same room. */
export function validateReplyParent(
  parentId: number | null | undefined,
  parent:
    | Pick<HypeRoomMessageRow, "id" | "roomId" | "parentId" | "hiddenAt">
    | null,
  roomId: number
): number | null {
  if (parentId == null) return null;
  if (!parent) throw new Error("Message not found.");
  if (parent.hiddenAt) throw new Error("Message not found.");
  if (parent.roomId !== roomId) {
    throw new Error("Reply target is not in this room.");
  }
  if (parent.id === parent.parentId) {
    throw new Error("Cannot reply to itself.");
  }
  if (parent.parentId != null) {
    throw new Error("You can only reply to top-level messages.");
  }
  return parent.id;
}

/** Dedupe mention ids while preserving order; reject non-integers. */
export function normalizeMentionUserIds(ids: readonly number[]): number[] {
  const out: number[] = [];
  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("Invalid mention target.");
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

export type SendHypeRoomMessageOptions = {
  parentId?: number | null;
  mentionedUserIds?: number[];
};

/**
 * Insert a text message while the room is live.
 * Requires active membership (host included — no host bypass).
 * M-A1: optional one-level parentId + mention records (no mention notifications).
 */
export async function sendHypeRoomMessage(
  roomId: number,
  userId: number,
  body: string,
  options: SendHypeRoomMessageOptions = {}
): Promise<HypeRoomMessageRow> {
  const validated = validateRoomMessageBody(body);
  const mentionIds = normalizeMentionUserIds(options.mentionedUserIds ?? []);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const outcome = await db.transaction(async tx => {
    const [roomRow] = await tx
      .select()
      .from(hypeRooms)
      .where(eq(hypeRooms.id, roomId))
      .limit(1);
    if (!roomRow) throw new Error("Room not found.");
    const room = await persistResolvedRoom(tx as never, roomRow, new Date());

    const membership = await loadActiveMembership(tx as never, roomId, userId);
    if (membership?.bannedAt) {
      throw new Error("You are banned from this room.");
    }
    if (!membership || membership.leftAt != null) {
      throw new Error("You are not an active member of this room.");
    }
    if (!canSendRoomMessage(room.status, membership)) {
      throw new Error("Messages can only be sent while the room is live.");
    }

    let parentId: number | null = null;
    let parentAuthorId: number | null = null;
    if (options.parentId != null) {
      const [parent] = await tx
        .select()
        .from(hypeRoomMessages)
        .where(eq(hypeRoomMessages.id, options.parentId))
        .limit(1);
      parentId = validateReplyParent(options.parentId, parent ?? null, roomId);
      parentAuthorId = parent?.userId ?? null;
    }

    // Mentions: only active room members (not left, not banned) may be targeted.
    if (mentionIds.length > 0) {
      const activeMemberRows = await tx
        .select({ userId: hypeRoomMembers.userId })
        .from(hypeRoomMembers)
        .where(
          and(
            eq(hypeRoomMembers.roomId, roomId),
            isNull(hypeRoomMembers.leftAt),
            isNull(hypeRoomMembers.bannedAt)
          )
        );
      const activeIds = new Set(activeMemberRows.map(r => r.userId));
      for (const id of mentionIds) {
        if (!activeIds.has(id)) {
          throw new Error(
            "You can only mention active members of this room."
          );
        }
      }
      // Ensure mentioned users exist (FK will also enforce).
      const userRows = await tx
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, mentionIds));
      if (userRows.length !== mentionIds.length) {
        throw new Error("Invalid mention target.");
      }
    }

    const now = new Date();
    const [inserted] = await tx
      .insert(hypeRoomMessages)
      .values({
        roomId,
        userId,
        body: validated,
        parentId,
        pinned: false,
        createdAt: now,
      })
      .returning();
    if (!inserted) throw new Error("Failed to send message.");

    // Sync hashtags from message body
    const messageTags = extractHashtags(validated);
    await syncHypeRoomMessageHashtags(tx, inserted.id, messageTags);

    if (mentionIds.length > 0) {
      await tx.insert(hypeRoomMessageMentions).values(
        mentionIds.map(mentionedUserId => ({
          roomId,
          messageId: inserted.id,
          mentionedUserId,
          createdAt: now,
        }))
      );
    }
    return {
      message: inserted,
      parentAuthorId,
      room: {
        id: room.id,
        title: room.title,
        hostId: room.hostId,
      },
    };
  });

  // §22-style writers fire only after the send transaction commits; they are
  // best-effort and never fail the parent send (see notifyHypeRoomMessage).
  try {
    await notifyHypeRoomMessage({
      room: outcome.room,
      message: {
        id: outcome.message.id,
        userId,
        parentId: outcome.message.parentId,
      },
      body: validated,
      parentAuthorId: outcome.parentAuthorId,
      mentionedUserIds: mentionIds,
    });
  } catch (error) {
    console.warn("[Notifications] Hype Room message notify failed:", error);
  }

  return outcome.message;
}

export type ReactionToggleResult = {
  messageId: number;
  reaction: HypeRoomReaction;
  active: boolean;
};

/**
 * Toggle a reaction on a room message.
 * Active members only; message must belong to roomId.
 *
 * Single-reaction model: the site exposes one reaction (Pookie/Love).
 * Every accepted value — including historical multi-reaction types —
 * normalizes to the primary reaction, and any row this user already holds
 * (legacy or current) counts as active, so tapping removes it; otherwise the
 * primary reaction is inserted. Unknown types are rejected.
 *
 * Concurrency: the message row is locked FOR UPDATE inside the transaction.
 * All reaction writes for a message funnel through that row, so the
 * read-modify-write below is serialized — the unique index alone cannot stop
 * two different types racing (it only guards (messageId, userId, reaction)).
 * Lock order is always message → reaction rows.
 */
export async function toggleHypeRoomMessageReaction(
  roomId: number,
  userId: number,
  messageId: number,
  reaction: string
): Promise<ReactionToggleResult> {
  if (!isValidHypeRoomReaction(reaction)) {
    throw new Error("Invalid reaction type.");
  }
  const target: HypeRoomReaction = PRIMARY_REACTION;
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [room] = await tx
      .select({ id: hypeRooms.id })
      .from(hypeRooms)
      .where(eq(hypeRooms.id, roomId))
      .limit(1);
    if (!room) throw new Error("Room not found.");

    const membership = await loadActiveMembership(tx as never, roomId, userId);
    if (membership?.bannedAt) {
      throw new Error("You are banned from this room.");
    }
    if (!membership || membership.leftAt != null) {
      throw new Error("You are not an active member of this room.");
    }

    const [message] = await tx
      .select()
      .from(hypeRoomMessages)
      .where(eq(hypeRoomMessages.id, messageId))
      .for("update")
      .limit(1);
    if (!message || message.hiddenAt) {
      throw new Error("Message not found.");
    }
    if (message.roomId !== roomId) {
      throw new Error("Message does not belong to this room.");
    }

    // Every typed reaction this user holds on this message (any value).
    const existingRows = await tx
      .select({
        id: hypeRoomMessageReactions.id,
        reaction: hypeRoomMessageReactions.reaction,
      })
      .from(hypeRoomMessageReactions)
      .where(
        and(
          eq(hypeRoomMessageReactions.messageId, messageId),
          eq(hypeRoomMessageReactions.userId, userId)
        )
      );

    const active = existingRows.some(
      row => normalizeReaction(row.reaction) === target
    );
    if (active) {
      await tx
        .delete(hypeRoomMessageReactions)
        .where(
          and(
            eq(hypeRoomMessageReactions.messageId, messageId),
            eq(hypeRoomMessageReactions.userId, userId)
          )
        );
      return { messageId, reaction: target, active: false };
    }

    // Activating: clear every source first so exactly one reaction survives.
    if (existingRows.length > 0) {
      await tx
        .delete(hypeRoomMessageReactions)
        .where(
          and(
            eq(hypeRoomMessageReactions.messageId, messageId),
            eq(hypeRoomMessageReactions.userId, userId)
          )
        );
    }

    const [inserted] = await tx
      .insert(hypeRoomMessageReactions)
      .values({
        roomId,
        messageId,
        userId,
        reaction: target,
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      return { messageId, reaction: target, active: true };
    }

    // Concurrent identical activation won the unique race — reaction is active.
    const [confirmed] = await tx
      .select()
      .from(hypeRoomMessageReactions)
      .where(
        and(
          eq(hypeRoomMessageReactions.messageId, messageId),
          eq(hypeRoomMessageReactions.userId, userId),
          eq(hypeRoomMessageReactions.reaction, target)
        )
      )
      .limit(1);
    if (confirmed) {
      return { messageId, reaction: target, active: true };
    }
    throw new Error("Failed to toggle reaction.");
  });
}

export type HypeRoomAssignableRole = "speaker" | "audience";

/**
 * Host promotes/demotes speaker ↔ audience.
 * Legacy "member" rows are treated as audience-equivalent for eligibility.
 * Host identity is room.hostId — never demoted via this mutation.
 */
export async function setHypeRoomMemberRole(
  roomId: number,
  actorId: number,
  targetUserId: number,
  role: HypeRoomAssignableRole
): Promise<HypeRoomMemberRow> {
  if (role !== "speaker" && role !== "audience") {
    throw new Error("Invalid room role.");
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [room] = await tx
      .select()
      .from(hypeRooms)
      .where(eq(hypeRooms.id, roomId))
      .limit(1);
    if (!room) throw new Error("Room not found.");

    if (!isRoomHost(room.hostId, actorId)) {
      throw new Error("Only the host can change member roles.");
    }
    if (targetUserId === room.hostId) {
      throw new Error("The host role cannot be changed.");
    }

    const [target] = await tx
      .select()
      .from(hypeRoomMembers)
      .where(
        and(
          eq(hypeRoomMembers.roomId, roomId),
          eq(hypeRoomMembers.userId, targetUserId)
        )
      )
      .limit(1);
    if (!target) throw new Error("Member not found in this room.");
    if (target.bannedAt) {
      throw new Error("You are banned from this room.");
    }
    if (target.leftAt != null) {
      throw new Error("You are not an active member of this room.");
    }
    if (target.role === "host") {
      throw new Error("The host role cannot be changed.");
    }

    const current = target.role;
    if (role === "speaker") {
      if (current === "speaker") return target;
      // audience-equivalent: legacy "member" or explicit "audience"
      if (current !== "member" && current !== "audience") {
        throw new Error("Invalid room role.");
      }
    } else {
      // demote to audience — only speakers (or already-audience no-op)
      if (current === "member" || current === "audience") {
        if (current === "audience") return target;
        // Keep legacy "member" as-is when already non-speaker audience-equivalent.
        return target;
      }
      if (current !== "speaker") {
        throw new Error("Invalid room role.");
      }
    }

    const [updated] = await tx
      .update(hypeRoomMembers)
      .set({ role })
      .where(
        and(
          eq(hypeRoomMembers.id, target.id),
          isNull(hypeRoomMembers.leftAt),
          isNull(hypeRoomMembers.bannedAt),
          ne(hypeRoomMembers.role, "host")
        )
      )
      .returning();
    if (!updated) throw new Error("You are not an active member of this room.");
    return updated;
  });
}

export type UpdateHypeRoomSettingsInput = {
  title?: string;
  topic?: string | null;
  description?: string | null;
  visibility?: "public" | "link_only";
};

/** Settings editable only while the room is still active for the host. */
export function canUpdateRoomSettings(status: HypeRoomStatus): boolean {
  return status === "scheduled" || status === "live";
}

/**
 * Host-only settings mutation. Allowed fields only: title, topic, description,
 * visibility. Does not change host, lifecycle, startsAt/endsAt, or id.
 */
export async function updateHypeRoomSettings(
  roomId: number,
  userId: number,
  input: UpdateHypeRoomSettingsInput
): Promise<HypeRoomRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [roomRow] = await db
    .select()
    .from(hypeRooms)
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!roomRow) throw new Error("Room not found.");
  // Host check before lifecycle persist: hostId is immutable across resolve,
  // so non-host callers never trigger status writes/notifications here.
  if (!isRoomHost(roomRow.hostId, userId)) {
    throw new Error("Only the host can update room settings.");
  }
  const room = await persistResolvedRoom(db, roomRow, new Date());
  if (!canUpdateRoomSettings(room.status)) {
    throw new Error("This room can no longer be edited.");
  }

  const patch: Partial<typeof hypeRooms.$inferInsert> = { updatedAt: new Date() };
  let touched = false;

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title.length < 3 || title.length > 100) {
      throw new Error("Room title must be 3–100 characters.");
    }
    patch.title = title;
    touched = true;
  }
  if (input.topic !== undefined) {
    const topic = input.topic == null ? null : input.topic.trim();
    if (topic != null && topic.length > 120) {
      throw new Error("Room topic must be at most 120 characters.");
    }
    patch.topic = topic || null;
    touched = true;
  }
  if (input.description !== undefined) {
    const description =
      input.description == null ? null : input.description.trim();
    if (description != null && description.length > 500) {
      throw new Error("Room description must be at most 500 characters.");
    }
    patch.description = description || null;
    touched = true;
  }
  if (input.visibility !== undefined) {
    if (input.visibility !== "public" && input.visibility !== "link_only") {
      throw new Error("Invalid room visibility.");
    }
    patch.visibility = input.visibility;
    touched = true;
  }

  if (!touched) {
    throw new Error("No settings provided.");
  }

  const [updated] = await db.transaction(async (tx) => {
    const [room] = await tx
      .update(hypeRooms)
      .set(patch)
      .where(eq(hypeRooms.id, roomId))
      .returning();
    if (!room) throw new Error("Room not found.");

    // Sync hashtags from title + topic + description
    const title = room.title;
    const topic = room.topic;
    const description = room.description;
    const roomTags = extractHypeRoomHashtags(title, topic, description);
    await syncHypeRoomHashtags(tx, room.id, roomTags);

    return [room];
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Optional product / website link (creator-configurable, max one per room)
// ---------------------------------------------------------------------------

/** Matches the DB column length (varchar(2048)). */
export const ROOM_LINK_MAX_LENGTH = 2048;

/** Only web schemes are allowed — rejects javascript:, data:, vbscript:, etc. */
export const ROOM_LINK_PROTOCOLS = ["https:", "http:"] as const;

/**
 * Server-side URL validation for a room product/website link.
 * Returns the normalized (trimmed) URL, or null when the input means "remove".
 * HTTPS is the preferred scheme; plain http stays allowed because the existing
 * product already accepts http external links (sponsor externalLink).
 */
export function validateRoomLink(
  raw: string | null | undefined
): string | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (value.length > ROOM_LINK_MAX_LENGTH) {
    throw new Error(
      `Room link must be at most ${ROOM_LINK_MAX_LENGTH} characters.`
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Room link must be a valid URL.");
  }
  if (!(ROOM_LINK_PROTOCOLS as readonly string[]).includes(parsed.protocol)) {
    throw new Error("Room link must use https:// or http://.");
  }
  if (!parsed.hostname) {
    throw new Error("Room link must include a host.");
  }
  return parsed.toString();
}

/**
 * Host-only add / edit / remove of the room's single product/website link.
 * Authorization (room.hostId === userId) is checked server-side before any
 * lifecycle work; empty/null clears the link.
 */
export async function setHypeRoomLink(
  roomId: number,
  userId: number,
  raw: string | null | undefined
): Promise<HypeRoomRow> {
  const linkUrl = validateRoomLink(raw);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [roomRow] = await db
    .select()
    .from(hypeRooms)
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!roomRow) throw new Error("Room not found.");
  // Host check before lifecycle persist (hostId is immutable across resolve).
  if (!isRoomHost(roomRow.hostId, userId)) {
    throw new Error("Only the host can update the room link.");
  }
  const room = await persistResolvedRoom(db, roomRow, new Date());
  if (!canUpdateRoomSettings(room.status)) {
    throw new Error("This room can no longer be edited.");
  }

  const [updated] = await db
    .update(hypeRooms)
    .set({ linkUrl, updatedAt: new Date() })
    .where(eq(hypeRooms.id, roomId))
    .returning();
  if (!updated) throw new Error("Room not found.");
  return updated;
}

export type HypeRoomInviteRow = typeof hypeRoomInvites.$inferSelect;
/**
 * Host creates (or re-opens) a user-targeted invite.
 * Unique(roomId, invitedUserId). No public share tokens.
 */
export async function createHypeRoomInvite(
  roomId: number,
  hostId: number,
  invitedUserId: number
): Promise<HypeRoomInviteRow> {
  if (!Number.isInteger(invitedUserId) || invitedUserId <= 0) {
    throw new Error("Invalid invite target.");
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const { invite, roomTitle } = await db.transaction(async tx => {
    const [roomRow] = await tx
      .select()
      .from(hypeRooms)
      .where(eq(hypeRooms.id, roomId))
      .limit(1);
    if (!roomRow) throw new Error("Room not found.");
    // Host check before lifecycle persist (hostId immutable — no unauthorized write).
    if (!isRoomHost(roomRow.hostId, hostId)) {
      throw new Error("Only the host can create invites.");
    }
    const room = await persistResolvedRoom(tx as never, roomRow, new Date());
    if (invitedUserId === room.hostId) {
      throw new Error("The host cannot be invited.");
    }
    if (!canJoinRoomStatus(room.status)) {
      throw new Error("This room is no longer accepting invites.");
    }

    const [invitee] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, invitedUserId))
      .limit(1);
    if (!invitee) throw new Error("Invite target not found.");

    const [existingMembership] = await tx
      .select()
      .from(hypeRoomMembers)
      .where(
        and(
          eq(hypeRoomMembers.roomId, roomId),
          eq(hypeRoomMembers.userId, invitedUserId)
        )
      )
      .limit(1);
    if (existingMembership?.bannedAt) {
      throw new Error("You are banned from this room.");
    }
    if (existingMembership && existingMembership.leftAt == null) {
      throw new Error("This user is already a member of this room.");
    }

    const now = new Date();
    const [existing] = await tx
      .select()
      .from(hypeRoomInvites)
      .where(
        and(
          eq(hypeRoomInvites.roomId, roomId),
          eq(hypeRoomInvites.invitedUserId, invitedUserId)
        )
      )
      .limit(1);

    if (existing) {
      if (existing.status === "accepted") {
        throw new Error("This user has already been invited and accepted.");
      }
      if (existing.status === "pending") {
        throw new Error("An invite is already pending for this user.");
      }
      // revoked/declined → re-open as pending
      const [reopened] = await tx
        .update(hypeRoomInvites)
        .set({ status: "pending", updatedAt: now, consumedAt: null })
        .where(eq(hypeRoomInvites.id, existing.id))
        .returning();
      if (!reopened) throw new Error("Failed to create invite.");
      return { invite: reopened, roomTitle: room.title };
    }

    const [created] = await tx
      .insert(hypeRoomInvites)
      .values({
        roomId,
        invitedUserId,
        createdBy: hostId,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw new Error("Failed to create invite.");
    return { invite: created, roomTitle: room.title };
  });

  // §22-style writer fires only after the invite transaction commits; it is
  // best-effort and never fails the parent invite (see notifyRoomInvited).
  try {
    await notifyRoomInvited(
      { id: roomId, title: roomTitle },
      invitedUserId,
      hostId
    );
  } catch (error) {
    console.warn("[Notifications] Hype Room invite notify failed:", error);
  }

  return invite;
}

/**
 * Invited user consumes a pending invite → joins under normal rules.
 * Atomic: membership change + pending→accepted share one transaction, so a
 * successful join cannot leave a permanently pending invite (and vice versa).
 * Concurrent accepts: unique membership + status='pending' guard; loser rolls back.
 */
export async function acceptHypeRoomInvite(
  inviteId: number,
  userId: number
): Promise<{ invite: HypeRoomInviteRow; membership: HypeRoomMemberRow }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [invite] = await tx
      .select()
      .from(hypeRoomInvites)
      .where(eq(hypeRoomInvites.id, inviteId))
      .limit(1);
    if (!invite) throw new Error("Invite not found.");
    if (invite.invitedUserId !== userId) {
      throw new Error("This invite was not created for you.");
    }
    if (invite.status !== "pending") {
      throw new Error("This invite is no longer valid.");
    }

    // Join validates lifecycle, bans, duplicates — same rules as joinHypeRoom.
    const membership = await joinHypeRoomInTx(tx, invite.roomId, userId);

    const now = new Date();
    const [updated] = await tx
      .update(hypeRoomInvites)
      .set({ status: "accepted", consumedAt: now, updatedAt: now })
      .where(
        and(
          eq(hypeRoomInvites.id, inviteId),
          eq(hypeRoomInvites.status, "pending")
        )
      )
      .returning();
    if (!updated) {
      throw new Error("This invite is no longer valid.");
    }
    return { invite: updated, membership };
  });
}

/** Host lists invites for a room. */
export async function listHypeRoomInvites(
  roomId: number,
  actorId: number
): Promise<HypeRoomInviteRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [room] = await db
    .select()
    .from(hypeRooms)
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!room) throw new Error("Room not found.");
  if (!isRoomHost(room.hostId, actorId)) {
    throw new Error("Only the host can list invites.");
  }

  return db
    .select()
    .from(hypeRoomInvites)
    .where(eq(hypeRoomInvites.roomId, roomId))
    .orderBy(asc(hypeRoomInvites.createdAt), asc(hypeRoomInvites.id));
}

/** Authenticated user lists their pending invites. */
export async function listMyHypeRoomInvites(
  userId: number
): Promise<HypeRoomInviteRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db
    .select()
    .from(hypeRoomInvites)
    .where(
      and(
        eq(hypeRoomInvites.invitedUserId, userId),
        eq(hypeRoomInvites.status, "pending")
      )
    )
    .orderBy(asc(hypeRoomInvites.createdAt), asc(hypeRoomInvites.id));
}

/**
 * Host end early: live → expired only (product decision A3).
 * Owner is room.hostId. Scheduled cancel is cancelHypeRoom (M6).
 */
export async function endHypeRoom(
  roomId: number,
  userId: number
): Promise<HypeRoomRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [roomRow] = await db
    .select()
    .from(hypeRooms)
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!roomRow) throw new Error("Room not found.");
  const room = await persistResolvedRoom(db, roomRow, new Date());

  if (!isRoomHost(room.hostId, userId)) {
    throw new Error("Only the host can end the room.");
  }
  if (!canHostEndRoom(room.status)) {
    if (room.status === "expired") {
      throw new Error("The room has already ended.");
    }
    throw new Error("Only a live room can be ended by the host.");
  }
  assertRoomTransition(room.status, "expired");

  const now = new Date();
  const [updated] = await db
    .update(hypeRooms)
    .set({
      status: "expired",
      expiredAt: room.expiredAt ?? now,
      updatedAt: now,
    })
    .where(and(eq(hypeRooms.id, roomId), eq(hypeRooms.status, "live")))
    .returning();
  if (!updated) throw new Error("Only a live room can be ended by the host.");
  // §22 — host expired notification only on successful live→expired transition.
  await notifyRoomExpired(
    { id: updated.id, title: updated.title, hostId: updated.hostId },
    db
  );
  return updated;
}

/** Host pins an existing message that belongs to their room. */
export async function pinHypeRoomMessage(
  messageId: number,
  userId: number
): Promise<HypeRoomRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [message] = await tx
      .select()
      .from(hypeRoomMessages)
      .where(eq(hypeRoomMessages.id, messageId))
      .limit(1);
    if (!message) throw new Error("Message not found.");
    if (message.hiddenAt) throw new Error("Message not found.");

    const [roomRow] = await tx
      .select()
      .from(hypeRooms)
      .where(eq(hypeRooms.id, message.roomId))
      .limit(1);
    if (!roomRow) throw new Error("Room not found.");
    if (!isRoomHost(roomRow.hostId, userId)) {
      throw new Error("Only the host can pin messages.");
    }

    const now = new Date();
    // Clear previous pin flags in this room, set the new pin.
    await tx
      .update(hypeRoomMessages)
      .set({ pinned: false })
      .where(
        and(eq(hypeRoomMessages.roomId, roomRow.id), eq(hypeRoomMessages.pinned, true))
      );
    const [pinnedMsg] = await tx
      .update(hypeRoomMessages)
      .set({ pinned: true })
      .where(eq(hypeRoomMessages.id, messageId))
      .returning();
    if (!pinnedMsg) throw new Error("Message not found.");

    const [updated] = await tx
      .update(hypeRooms)
      .set({ pinnedMessageId: messageId, updatedAt: now })
      .where(eq(hypeRooms.id, roomRow.id))
      .returning();
    if (!updated) throw new Error("Failed to pin message.");
    return updated;
  });
}

/** Host clears the room pin. */
export async function unpinHypeRoomMessage(
  roomId: number,
  userId: number
): Promise<HypeRoomRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [roomRow] = await tx
      .select()
      .from(hypeRooms)
      .where(eq(hypeRooms.id, roomId))
      .limit(1);
    if (!roomRow) throw new Error("Room not found.");
    if (!isRoomHost(roomRow.hostId, userId)) {
      throw new Error("Only the host can pin messages.");
    }

    const now = new Date();
    if (roomRow.pinnedMessageId != null) {
      await tx
        .update(hypeRoomMessages)
        .set({ pinned: false })
        .where(
          and(
            eq(hypeRoomMessages.roomId, roomId),
            eq(hypeRoomMessages.pinned, true)
          )
        );
    }
    const [updated] = await tx
      .update(hypeRooms)
      .set({ pinnedMessageId: null, updatedAt: now })
      .where(eq(hypeRooms.id, roomId))
      .returning();
    if (!updated) throw new Error("Room not found.");
    return updated;
  });
}

/**
 * Host soft-hides a message in their own room (sets hiddenAt + moderatedAt
 * + moderatedBy) through the existing message architecture — the same
 * hiddenAt column admin moderation uses, so listRoomMessages keeps excluding
 * it. Host-scoped: admins keep their own admin.messages.hide path.
 */
export async function hideHypeRoomMessage(
  messageId: number,
  actorId: number
): Promise<HypeRoomMessageRow> {
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw new Error("Message id is required.");
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const { hidden, room } = await db.transaction(async tx => {
    const [message] = await tx
      .select()
      .from(hypeRoomMessages)
      .where(eq(hypeRoomMessages.id, messageId))
      .limit(1);
    if (!message || message.hiddenAt) throw new Error("Message not found.");

    const [roomRow] = await tx
      .select()
      .from(hypeRooms)
      .where(eq(hypeRooms.id, message.roomId))
      .limit(1);
    if (!roomRow) throw new Error("Room not found.");
    // Server-side host authorization — never trusts a client-provided host id.
    if (!isRoomHost(roomRow.hostId, actorId)) {
      throw new Error("Only the host can hide messages in this room.");
    }

    const now = new Date();
    const [hiddenRow] = await tx
      .update(hypeRoomMessages)
      .set({ hiddenAt: now, moderatedAt: now, moderatedBy: actorId })
      .where(
        and(
          eq(hypeRoomMessages.id, messageId),
          isNull(hypeRoomMessages.hiddenAt)
        )
      )
      .returning();
    if (!hiddenRow) throw new Error("Message not found.");

    // Keep the room pin consistent when the pinned message is hidden.
    if (roomRow.pinnedMessageId === messageId) {
      await tx
        .update(hypeRooms)
        .set({ pinnedMessageId: null, updatedAt: now })
        .where(eq(hypeRooms.id, roomRow.id));
    }
    return {
      hidden: hiddenRow,
      room: { id: roomRow.id, title: roomRow.title, hostId: roomRow.hostId },
    };
  });

  // §22 "content removed" writer — only the message author is told, never the
  // host who performed the hide. Best-effort; never fails the moderation action.
  const authorId = hidden.userId;
  if (authorId != null && authorId !== actorId) {
    try {
      await notifyRoomMessageHidden(
        room,
        { id: hidden.id, roomId: hidden.roomId },
        authorId
      );
    } catch (error) {
      console.warn("[Notifications] Hype Room hide notify failed:", error);
    }
  }

  return hidden;
}

/**
 * Host soft-removes an active non-host member (sets leftAt + removedBy).
 * Cannot remove self/host; already-left is a controlled conflict.
 */
export async function removeHypeRoomMember(
  roomId: number,
  actorId: number,
  targetUserId: number
): Promise<HypeRoomMemberRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [roomRow] = await tx
      .select()
      .from(hypeRooms)
      .where(eq(hypeRooms.id, roomId))
      .limit(1);
    if (!roomRow) throw new Error("Room not found.");

    const target = await loadActiveMembership(tx as never, roomId, targetUserId);
    const decision = decideRemoveMember(roomRow.hostId, actorId, target);
    if (decision === "not_host") {
      throw new Error("Only the host can remove members.");
    }
    if (decision === "target_missing") {
      throw new Error("Member not found in this room.");
    }
    if (decision === "cannot_remove_host") {
      throw new Error("The host cannot be removed from the room.");
    }
    if (decision === "target_already_left") {
      throw new Error("You are not an active member of this room.");
    }

    const now = new Date();
    const [removed] = await tx
      .update(hypeRoomMembers)
      .set({ leftAt: now, removedBy: actorId })
      .where(
        and(
          eq(hypeRoomMembers.id, target!.id),
          isNull(hypeRoomMembers.leftAt),
          isNotNull(hypeRoomMembers.id)
        )
      )
      .returning();
    if (!removed) throw new Error("You are not an active member of this room.");
    // §22 — notify removed user only after successful soft-remove.
    await notifyMemberRemoved(
      { id: roomRow.id, title: roomRow.title },
      removed.userId,
      tx as never
    );
    return removed;
  });
}

/**
 * M8 — admin room list: all statuses (optional status filter), lazy lifecycle
 * resolution preserved from listActiveHypeRooms / getHypeRoom.
 */
export async function listAdminHypeRooms(
  opts: { status?: HypeRoomStatus } = {}
): Promise<HypeRoomRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();
  const rows = opts.status
    ? await db
        .select()
        .from(hypeRooms)
        .where(eq(hypeRooms.status, opts.status))
        .orderBy(asc(hypeRooms.startsAt), asc(hypeRooms.id))
    : await db
        .select()
        .from(hypeRooms)
        .orderBy(asc(hypeRooms.startsAt), asc(hypeRooms.id));

  const matched: HypeRoomRow[] = [];
  for (const row of rows) {
    matched.push(await persistResolvedRoom(db, row, now));
  }
  return matched;
}

/**
 * M8 — admin force end: ONLY live → expired (optimistic WHERE status='live').
 * Bypasses host ownership; reuses notifyRoomExpired (no new notification type).
 */
export async function adminForceEndHypeRoom(
  roomId: number
): Promise<HypeRoomRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [roomRow] = await db
    .select()
    .from(hypeRooms)
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!roomRow) throw new Error("Room not found.");
  const room = await persistResolvedRoom(db, roomRow, new Date());

  if (room.status === "expired") {
    throw new Error("The room has already ended.");
  }
  if (room.status === "archived") {
    throw new Error("The room is already archived.");
  }
  if (room.status !== "live") {
    throw new Error("Only a live room can be force-ended.");
  }
  assertRoomTransition(room.status, "expired");

  const now = new Date();
  const [updated] = await db
    .update(hypeRooms)
    .set({
      status: "expired",
      expiredAt: room.expiredAt ?? now,
      updatedAt: now,
    })
    .where(and(eq(hypeRooms.id, roomId), eq(hypeRooms.status, "live")))
    .returning();
  if (!updated) {
    throw new Error("Only a live room can be force-ended.");
  }
  await notifyRoomExpired(
    { id: updated.id, title: updated.title, hostId: updated.hostId },
    db
  );
  return updated;
}

/**
 * M8 — admin archive: scheduled → archived | expired → archived only.
 * Optional cancelReason matches host-cancel validation (≤500). Transcript kept.
 */
export async function adminArchiveHypeRoom(
  roomId: number,
  cancelReason?: string | null
): Promise<HypeRoomRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [roomRow] = await db
    .select()
    .from(hypeRooms)
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!roomRow) throw new Error("Room not found.");
  const room = await persistResolvedRoom(db, roomRow, new Date());

  if (room.status === "archived") {
    throw new Error("The room is already archived.");
  }
  if (room.status === "live") {
    throw new Error("A live room cannot be archived.");
  }
  if (room.status !== "scheduled" && room.status !== "expired") {
    throw new Error("Only scheduled or expired rooms can be archived.");
  }
  assertRoomTransition(room.status, "archived");

  const now = new Date();
  const reason =
    cancelReason == null ? null : cancelReason.trim().slice(0, 500) || null;
  const [updated] = await db
    .update(hypeRooms)
    .set({
      status: "archived",
      archivedAt: room.archivedAt ?? now,
      updatedAt: now,
      ...(room.status === "scheduled" ? { cancelReason: reason } : {}),
    })
    .where(and(eq(hypeRooms.id, roomId), eq(hypeRooms.status, room.status)))
    .returning();
  if (!updated) {
    throw new Error("Room is no longer in expected state.");
  }
  return updated;
}

/**
 * M8 — room-scoped membership ban (not a global account ban).
 * Pre-join bans supported: insert membership with bannedAt when no row exists.
 * Existing join/send already reject when bannedAt is set.
 */
export async function adminBanHypeRoomMember(
  roomId: number,
  targetUserId: number
): Promise<HypeRoomMemberRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [room] = await db
    .select()
    .from(hypeRooms)
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!room) throw new Error("Room not found.");
  if (room.status === "archived") {
    throw new Error("Cannot ban members in an archived room.");
  }

  const now = new Date();
  const [existing] = await db
    .select()
    .from(hypeRoomMembers)
    .where(
      and(
        eq(hypeRoomMembers.roomId, roomId),
        eq(hypeRoomMembers.userId, targetUserId)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(hypeRoomMembers)
      .set({ bannedAt: existing.bannedAt ?? now, leftAt: now })
      .where(eq(hypeRoomMembers.id, existing.id))
      .returning();
    if (!updated) throw new Error("Failed to ban member.");
    return updated;
  }

  const [created] = await db
    .insert(hypeRoomMembers)
    .values({
      roomId,
      userId: targetUserId,
      role: resolveMemberRole(room.hostId, targetUserId),
      bannedAt: now,
      joinedAt: now,
      leftAt: null,
      removedBy: null,
    })
    .returning();
  if (!created) throw new Error("Failed to ban member.");
  return created;
}
