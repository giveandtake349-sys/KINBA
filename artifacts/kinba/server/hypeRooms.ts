/**
 * JHILIK temporary Hype/Community rooms (Phase 2 Milestones 1–2).
 *
 * M1: create / get / list active / resolve expiry.
 * M2: join / leave / list members (hype_room_members).
 * Lifecycle is server-authoritative from persisted startsAt/endsAt.
 * Flag: time_limited_communities (fail-closed via router gate).
 * No drops, claims, rewards, or chat wiring yet.
 */
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  hypeRoomMembers,
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

/** Membership row from hype_room_members. */
export type HypeRoomMemberRow = typeof hypeRoomMembers.$inferSelect;

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

async function persistResolvedRoom(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  room: HypeRoomRow,
  now: Date
): Promise<HypeRoomRow> {
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
  return updated ?? { ...room, ...patch };
}

/**
 * Create a temporary room. Ends are always computed server-side:
 * endsAt = startsAt + durationHours.
 */
export async function createHypeRoom(
  hostId: number,
  input: CreateHypeRoomInput
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
 * List active (scheduled/live) rooms after resolving due expiry.
 * Expired/archived rooms are excluded from this listing.
 */
export async function listActiveHypeRooms(): Promise<HypeRoomRow[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();
  const rows = await db
    .select()
    .from(hypeRooms)
    .where(inArray(hypeRooms.status, ["scheduled", "live"]))
    .orderBy(asc(hypeRooms.startsAt), asc(hypeRooms.id));

  const active: HypeRoomRow[] = [];
  for (const row of rows) {
    const resolved = await persistResolvedRoom(db, row, now);
    if (resolved.status === "scheduled" || resolved.status === "live") {
      active.push(resolved);
    }
  }
  return active;
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
