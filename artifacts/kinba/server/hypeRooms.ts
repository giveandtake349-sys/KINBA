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
import { and, asc, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import {
  hypeRoomMembers,
  hypeRoomMessages,
  hypeRooms,
  profiles,
  users,
  type HypeRoomRow,
} from "../drizzle/schema";
import {
  assertTransition,
  canTransition,
  HYPE_ROOM_TRANSITIONS,
  resolveHypeRoomStatus,
  type HypeRoomStatus,
} from "@shared/stateMachines";
import { getDb } from "./db";
import {
  notifyMemberRemoved,
  notifyRoomExpired,
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
  if (title.length < 3 || title.length > 180) {
    throw new Error("Room title must be 3–180 characters.");
  }

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

  const [created] = await db
    .insert(hypeRooms)
    .values({
      hostId,
      title,
      topic: input.topic?.trim() || null,
      description: input.description?.trim() || null,
      status: "scheduled",
      durationHours,
      startsAt,
      endsAt,
      visibility: input.visibility ?? "public",
      dropId: null,
      pinnedMessageId: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!created) throw new Error("Failed to create room.");

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
 * Order: startsAt, id (unchanged from M1).
 */
export async function listActiveHypeRooms(
  opts: {
    filter?: HypeRoomListFilter;
    userId?: number | null;
  } = {}
): Promise<HypeRoomRow[]> {
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

  const matched: HypeRoomRow[] = [];
  for (const row of rows) {
    const resolved = await persistResolvedRoom(db, row, now);
    if (matchesRoomListFilter(resolved, filter, userId)) {
      matched.push(resolved);
    }
  }
  return matched;
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
export async function joinHypeRoom(
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
  });
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
 */
export async function listRoomMessages(
  roomId: number
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

  return rows;
}

/**
 * Insert a text message while the room is live.
 * Requires active membership (host included — no host bypass).
 */
export async function sendHypeRoomMessage(
  roomId: number,
  userId: number,
  body: string
): Promise<HypeRoomMessageRow> {
  const validated = validateRoomMessageBody(body);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
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
      if (room.status !== "live") {
        throw new Error("Messages can only be sent while the room is live.");
      }
      throw new Error("Messages can only be sent while the room is live.");
    }

    const now = new Date();
    const [inserted] = await tx
      .insert(hypeRoomMessages)
      .values({
        roomId,
        userId,
        body: validated,
        pinned: false,
        createdAt: now,
      })
      .returning();
    if (!inserted) throw new Error("Failed to send message.");
    return inserted;
  });
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
