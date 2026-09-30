/**
 * Hype Room upgrade — §22 notification rules for conversation, invite and
 * moderation writers: fan-out priority, one alert per recipient per message,
 * self-exclusion, audience privacy, de-duplication and flag gating.
 *
 * Real `./notifications` module under test; only `./db` and `./featureFlags`
 * are faked. Every writer gets an explicit fake client so the select queue is
 * fully deterministic.
 */
import { vi, describe, beforeEach, expect, it } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  ensureProfile: vi.fn(),
  createAnnouncementComment: vi.fn(),
  createCommunityAnnouncement: vi.fn(),
  createVideo: vi.fn(),
  createVideoComment: vi.fn(),
  getOwnProfile: vi.fn(),
  listAnnouncementComments: vi.fn(),
  listVideoComments: vi.fn(),
  submitVerificationTransaction: vi.fn(),
  approveVerificationTransaction: vi.fn(),
  adminListDashboard: vi.fn(),
  adminCreateSponsorBidsSession: vi.fn(),
  adminStartSponsorBidsSession: vi.fn(),
  adminSetSponsorStatus: vi.fn(),
  getDb: vi.fn(),
}));

const featureFlagMocks = vi.hoisted(() => ({
  isFeatureFlagEnabled: vi.fn(),
  getActiveFeatureFlags: vi.fn(),
  listFeatureFlagRows: vi.fn(),
  setFeatureFlag: vi.fn(),
  FEATURE_FLAG_KEYS: [
    "discover_v2",
    "jhilik_now",
    "time_limited_communities",
    "jhilik_drops",
    "jhilik_rewards",
    "video_rewards",
    "milestone_rewards",
    "free_verification",
    "moderation_v1",
  ],
  FEATURE_FLAG_DEFAULTS: {},
  isFeatureFlagKey: vi.fn(),
}));

vi.mock("./db", () => databaseMocks);
vi.mock("./featureFlags", () => featureFlagMocks);

import {
  hypeRoomMessageLink,
  notifyHypeRoomMessage,
  notifyRoomInvited,
  notifyRoomMessageHidden,
  resolveHypeRoomMessageRecipients,
} from "./notifications";

const HOST = 10;
const MEMBER = 41;
const OTHER = 55;
const STRANGER = 77;

const room = { id: 11, title: "Launch room", hostId: HOST };

function message(over: Record<string, unknown> = {}) {
  return { id: 3, userId: MEMBER, parentId: null, ...over };
}

function fakeDb(selectRows: unknown[]) {
  const queue = [...selectRows];
  const insertValues = vi.fn();
  const insertReturning = vi.fn(async () => [{ id: 1, userId: 1 }]);
  const asRows = (row: unknown): unknown[] => {
    if (row === undefined) return [];
    if (Array.isArray(row)) return row;
    return [row];
  };

  const db = {
    select: vi.fn(() => {
      const rows = asRows(queue.shift());
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => rows),
        orderBy: vi.fn(async () => rows),
        groupBy: vi.fn(() => chain),
        leftJoin: vi.fn(() => chain),
        innerJoin: vi.fn(() => chain),
        for: vi.fn(() => chain),
        then: (
          onFulfilled?: (v: unknown) => unknown,
          onRejected?: (e: unknown) => unknown
        ) => Promise.resolve(rows).then(onFulfilled, onRejected),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((v: unknown) => {
        insertValues(v);
        return {
          returning: insertReturning,
          onConflictDoNothing: vi.fn(() => ({ returning: insertReturning })),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn(async () => []) })),
        returning: vi.fn(async () => []),
      })),
    })),
    delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    __insertValues: insertValues,
    __queue: queue,
  };
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  databaseMocks.getDb.mockResolvedValue(null);
});

describe("hypeRoomMessageLink (client deep link)", () => {
  it("anchors a room route at the specific message", () => {
    expect(hypeRoomMessageLink(11, 3)).toBe("/rooms/11?msg=3");
  });
});

describe("resolveHypeRoomMessageRecipients (pure fan-out)", () => {
  it("notifies the host for a top-level comment", () => {
    expect(
      resolveHypeRoomMessageRecipients({ room, message: message() })
    ).toEqual([{ userId: HOST, type: "room_comment" }]);
  });

  it("does not notify the host when the host wrote the message", () => {
    expect(
      resolveHypeRoomMessageRecipients({
        room,
        message: message({ userId: HOST }),
        mentionedUserIds: [MEMBER],
      })
    ).toEqual([{ userId: MEMBER, type: "room_mention" }]);
  });

  it("keeps replies inside the thread (no host comment)", () => {
    expect(
      resolveHypeRoomMessageRecipients({
        room,
        message: message({ parentId: 9 }),
        parentAuthorId: OTHER,
      })
    ).toEqual([{ userId: OTHER, type: "room_reply" }]);
  });

  it("never notifies the author of their own message", () => {
    expect(
      resolveHypeRoomMessageRecipients({
        room,
        message: message({ parentId: 9 }),
        parentAuthorId: MEMBER,
        mentionedUserIds: [MEMBER, HOST],
      })
    ).toEqual([{ userId: HOST, type: "room_mention" }]);
  });

  it("gives one recipient exactly one notification, mention > reply", () => {
    const out = resolveHypeRoomMessageRecipients({
      room,
      message: message({ parentId: 9 }),
      parentAuthorId: OTHER,
      mentionedUserIds: [OTHER],
    });
    expect(out).toEqual([{ userId: OTHER, type: "room_mention" }]);
  });

  it("gives one recipient exactly one notification, mention > host comment", () => {
    const out = resolveHypeRoomMessageRecipients({
      room,
      message: message(),
      mentionedUserIds: [HOST],
    });
    expect(out).toEqual([{ userId: HOST, type: "room_mention" }]);
  });

  it("drops invalid mention ids", () => {
    const out = resolveHypeRoomMessageRecipients({
      room,
      message: message({ parentId: null }),
      mentionedUserIds: [0, -3, 1.5, "x" as unknown as number, OTHER],
    });
    expect(out).toEqual([
      { userId: OTHER, type: "room_mention" },
      { userId: HOST, type: "room_comment" },
    ]);
  });
});

describe("notifyHypeRoomMessage", () => {
  const input = {
    room,
    message: message(),
    body: "Deal is live",
    parentAuthorId: null,
  };

  it("fails closed when the room feature flag is off", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
    const db = fakeDb([]);

    expect(await notifyHypeRoomMessage(input, db)).toBe(0);
    expect(db.__insertValues).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("writes one room_comment notification for the host", async () => {
    // queue: audience, dedupe probe, recipient-exists probe
    const db = fakeDb([[{ userId: MEMBER }], [], [{ id: HOST }]]);

    expect(await notifyHypeRoomMessage(input, db)).toBe(1);
    expect(db.__insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: HOST,
        type: "room_comment",
        entityType: "hype_room",
        entityId: room.id,
        link: "/rooms/11?msg=3",
      })
    );
    expect(db.__queue).toHaveLength(0);
  });

  it("never leaks to a recipient outside the room audience", async () => {
    const db = fakeDb([[{ userId: MEMBER }]]);

    const written = await notifyHypeRoomMessage(
      {
        room,
        message: message({ parentId: 9 }),
        parentAuthorId: STRANGER,
      },
      db
    );

    expect(written).toBe(0);
    expect(db.__insertValues).not.toHaveBeenCalled();
    expect(db.__queue).toHaveLength(0);
  });

  it("de-duplicates on (recipient, type, link) so alerts never stack", async () => {
    const db = fakeDb([[{ userId: MEMBER }], [{ id: 9 }]]);

    expect(await notifyHypeRoomMessage(input, db)).toBe(0);
    expect(db.__insertValues).not.toHaveBeenCalled();
    expect(db.__queue).toHaveLength(0);
  });
});

describe("notifyRoomInvited", () => {
  it("never notifies the inviter about their own invite", async () => {
    const db = fakeDb([]);
    expect(await notifyRoomInvited(room, HOST, HOST, db)).toBe(false);
    expect(db.__insertValues).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects a non-positive invitee id", async () => {
    const db = fakeDb([]);
    expect(await notifyRoomInvited(room, 0, HOST, db)).toBe(false);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("fails closed when the room feature flag is off", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
    const db = fakeDb([]);

    expect(await notifyRoomInvited(room, OTHER, HOST, db)).toBe(false);
    expect(db.__insertValues).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("does not stack a second invite alert for the same room", async () => {
    const db = fakeDb([[{ id: 4 }]]);
    expect(await notifyRoomInvited(room, OTHER, HOST, db)).toBe(false);
    expect(db.__insertValues).not.toHaveBeenCalled();
  });

  it("writes one room_invite notification for the invitee", async () => {
    const db = fakeDb([[], [{ id: OTHER }]]);

    expect(await notifyRoomInvited(room, OTHER, HOST, db)).toBe(true);
    expect(db.__insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: OTHER,
        type: "room_invite",
        entityType: "hype_room",
        entityId: room.id,
        link: "/rooms/11",
      })
    );
  });
});

describe("notifyRoomMessageHidden (moderation)", () => {
  const messageRef = { id: 3, roomId: room.id };

  it("never tells the host who performed the hide", async () => {
    const db = fakeDb([]);
    expect(await notifyRoomMessageHidden(room, messageRef, HOST, db)).toBe(
      false
    );
    expect(db.__insertValues).not.toHaveBeenCalled();
  });

  it("rejects a non-positive author id", async () => {
    const db = fakeDb([]);
    expect(await notifyRoomMessageHidden(room, messageRef, -1, db)).toBe(false);
  });

  it("fails closed when the room feature flag is off", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
    const db = fakeDb([]);

    expect(await notifyRoomMessageHidden(room, messageRef, MEMBER, db)).toBe(
      false
    );
    expect(db.__insertValues).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("does not notify an author who already left the room", async () => {
    const db = fakeDb([[{ userId: HOST }]]);

    expect(await notifyRoomMessageHidden(room, messageRef, MEMBER, db)).toBe(
      false
    );
    expect(db.__insertValues).not.toHaveBeenCalled();
    expect(db.__queue).toHaveLength(0);
  });

  it("does not repeat an existing removal alert", async () => {
    const db = fakeDb([[{ userId: MEMBER }], [{ id: 2 }]]);
    expect(await notifyRoomMessageHidden(room, messageRef, MEMBER, db)).toBe(
      false
    );
    expect(db.__insertValues).not.toHaveBeenCalled();
  });

  it("tells only the author their message was removed", async () => {
    // queue: audience, dedupe probe, recipient-exists probe
    const db = fakeDb([[{ userId: MEMBER }], [], [{ id: MEMBER }]]);

    expect(await notifyRoomMessageHidden(room, messageRef, MEMBER, db)).toBe(
      true
    );
    expect(db.__insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: MEMBER,
        type: "room_message_hidden",
        entityType: "hype_room",
        entityId: room.id,
        link: "/rooms/11?msg=3",
      })
    );
    expect(db.__queue).toHaveLength(0);
  });
});
