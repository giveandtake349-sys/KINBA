import { formatCountdown, type RoomCard } from "../HypeRooms";

/** Membership row joined with display fields (mirrors server HypeRoomMemberWithUser). */
export type MemberRow = {
  membership: {
    id: number;
    roomId: number;
    userId: number;
    role: string;
    joinedAt: Date | string;
    leftAt: Date | string | null;
    bannedAt: Date | string | null;
    removedBy: number | null;
  };
  user: {
    id: number;
    name: string | null;
    openId: string;
    photoUrl: string | null;
    username: string | null;
  };
};

/** Message row joined with author + optional parent/reactions/mentions. */
export type MessageRow = {
  message: {
    id: number;
    roomId: number;
    userId: number | null;
    body: string;
    parentId: number | null;
    pinned: boolean;
    createdAt: Date | string;
  };
  user: {
    id: number | null;
    name: string | null;
    openId: string | null;
    photoUrl: string | null;
    username: string | null;
  };
  parent?: {
    id: number;
    body: string | null;
    userId: number | null;
  } | null;
  reactions?: Array<{
    reaction: string;
    count: number;
    reactedByMe: boolean;
  }>;
  mentionUserIds?: number[];
};

export type InviteRow = {
  id: number;
  roomId: number;
  invitedUserId: number;
  createdBy: number;
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  consumedAt: Date | string | null;
};

export type InviteTarget = {
  id: number;
  name: string | null;
  username: string | null;
  photoUrl: string | null;
};

/** Client-facing presentation phase derived from server status + endsAt. */
export type RoomPhase = "upcoming" | "live" | "ending" | "ended" | "archived";

/** Below this remaining time a live room is presented as ENDING. */
export const ENDING_THRESHOLD_MS = 10 * 60 * 1000;

export function displayMemberName(member: MemberRow): string {
  return (
    member.user.username ||
    member.user.name ||
    `Member #${member.user.id}`
  );
}

export function displayMessageName(row: MessageRow): string {
  return (
    row.user.username ||
    row.user.name ||
    (row.user.id != null ? `User #${row.user.id}` : "Removed user")
  );
}

export function displayInviteName(id: number, members: MemberRow[]): string {
  const match = members.find(member => member.user.id === id);
  return match ? displayMemberName(match) : `User #${id}`;
}

export function roleLabel(role: string): string {
  if (role === "host") return "Host";
  if (role === "speaker") return "Speaker";
  if (role === "audience") return "Audience";
  return "Member";
}

export function formatMessageTime(value: Date | string): string {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatMessageClock(value: Date | string): string {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export type RoomCountdown = { label: string; remaining: string } | null;

export function countdownFor(
  room: Pick<RoomCard, "status" | "startsAt" | "endsAt">,
  nowMs: number
): RoomCountdown {
  if (room.status === "scheduled") {
    const target = new Date(room.startsAt).getTime();
    const remainingMs = target - nowMs;
    if (remainingMs <= 0) return null;
    return { label: "Starts in", remaining: formatCountdown(remainingMs) };
  }
  if (room.status === "live") {
    const target = new Date(room.endsAt).getTime();
    const remainingMs = target - nowMs;
    if (remainingMs <= 0) return null;
    return { label: "Ends in", remaining: formatCountdown(remainingMs) };
  }
  return null;
}

/**
 * Pure presentation phase. Server status stays authoritative; "ending" is a
 * client-side emphasis when a live room is close to its real endsAt window.
 * The client never presents "ended" unless the server status says so.
 */
export function roomPhase(
  room: Pick<RoomCard, "status" | "endsAt">,
  nowMs: number
): RoomPhase {
  if (room.status === "scheduled") return "upcoming";
  if (room.status === "expired") return "ended";
  if (room.status === "archived") return "archived";
  if (room.status === "live") {
    const remainingMs = new Date(room.endsAt).getTime() - nowMs;
    if (remainingMs <= ENDING_THRESHOLD_MS) return "ending";
    return "live";
  }
  return "ended";
}

export function roomPhaseLabel(phase: RoomPhase): string {
  if (phase === "upcoming") return "Upcoming";
  if (phase === "live") return "Live";
  if (phase === "ending") return "Ending";
  if (phase === "ended") return "Ended";
  return "Archived";
}
