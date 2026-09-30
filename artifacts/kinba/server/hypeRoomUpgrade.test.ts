/**
 * Hype Room upgrade — discovery visibility, participant counts, the optional
 * product/website link (validation + host authorization) and host message
 * hiding, through both the service layer and the tRPC procedures.
 *
 * `./hypeRooms` is NOT mocked here on purpose: error strings and authorization
 * order must be the real ones. Only `./db`, `./notifications` and
 * `./featureFlags` are faked.
 */
import { vi, describe, beforeEach, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";

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

const notificationMocks = vi.hoisted(() => ({
  insertNotification: vi.fn(),
  listUserNotifications: vi.fn(),
  getUnreadNotificationCount: vi.fn(),
  markUserNotificationsRead: vi.fn(),
  notifyClaimStatusChange: vi.fn(),
  notifyDropSoldOut: vi.fn(),
  notifyNewFollower: vi.fn(),
  notifyRoomWentLive: vi.fn(),
  notifyRoomExpired: vi.fn(),
  notifyMemberRemoved: vi.fn(),
  notifyHypeRoomMessage: vi.fn(),
  notifyRoomInvited: vi.fn(),
  notifyRoomMessageHidden: vi.fn(),
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

const rewardMocks = vi.hoisted(() => ({
  getCoinBalance: vi.fn(),
  listRewardHistory: vi.fn(),
}));

vi.mock("./db", () => databaseMocks);
vi.mock("./notifications", () => notificationMocks);
vi.mock("./featureFlags", () => featureFlagMocks);
vi.mock("./rewardLedger", () => rewardMocks);
vi.mock("./hlsProcessor", () => ({ queueVideoTranscode: vi.fn() }));
vi.mock("./moderation", async importOriginal => {
  const actual = await importOriginal<typeof import("./moderation")>();
  return {
    ...actual,
    createModerationReport: vi.fn(),
    listModerationReports: vi.fn(),
    resolveModerationReport: vi.fn(),
    adminHideRoomMessage: vi.fn(),
  };
});

import {
  canDiscoverRoom,
  hideHypeRoomMessage,
  listActiveHypeRooms,
  setHypeRoomLink,
  validateRoomLink,
} from "./hypeRooms";
import { appRouter } from "./routers";

const HOST = 10;
const MEMBER = 41;
const STRANGER = 77;

const roomRow = (over: Record<string, unknown> = {}) => ({
  id: 11,
  hostId: HOST,
  title: "Link room",
  topic: null,
  description: null,
  coverUrl: null,
  visibility: "public",
  status: "live",
  durationHours: 4,
  startsAt: new Date(Date.now() - 60_000),
  endsAt: new Date(Date.now() + 4 * 3600_000),
  linkUrl: null,
  pinnedMessageId: null,
  dropId: null,
  expiredAt: null,
  archivedAt: null,
  cancelReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

const messageRow = (over: Record<string, unknown> = {}) => ({
  id: 3,
  roomId: 11,
  userId: MEMBER,
  body: "hello",
  audioUrl: null,
  audioDuration: null,
  parentId: null,
  pinned: false,
  createdAt: new Date(),
  moderatedAt: null,
  moderatedBy: null,
  hiddenAt: null,
  ...over,
});

/**
 * Fake DB: `select()` pops the next queued result; insert/update/delete are
 * instrumented spies. Chains support `.groupBy()` (participant counts) and
 * awaiting the builder itself (member/audience lookups end at `.where()`).
 */
function fakeDb(selectRows: unknown[]) {
  const queue = [...selectRows];
  const insertValues = vi.fn();
  const updateSets = vi.fn();
  const deleteWheres = vi.fn();
  const insertReturning = vi.fn(async () => [{ id: 1 }]);
  const updateReturning = vi.fn(async () => []);
  const asRows = (row: unknown): unknown[] => {
    if (row === undefined) return [];
    if (Array.isArray(row)) return row;
    return [row];
  };

  const db = {
    select: vi.fn(() => {
      const row = queue.length > 0 ? queue.shift() : undefined;
      const rows = asRows(row);
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
      set: vi.fn((v: unknown) => {
        updateSets(v);
        return {
          where: vi.fn(() => ({ returning: updateReturning })),
          returning: updateReturning,
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((...a: unknown[]) => {
        deleteWheres(...a);
        return Promise.resolve(undefined);
      }),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    __insertValues: insertValues,
    __updateSets: updateSets,
    __deleteWheres: deleteWheres,
    __insertReturning: insertReturning,
    __updateReturning: updateReturning,
    __queue: queue,
  };
  return db;
}

const user = {
  id: STRANGER,
  openId: "kinba-hype-upgrade-user",
  name: "KINBA Upgrade",
  email: "upgrade@example.test",
  loginMethod: "email",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function context(activeUser: typeof user | null = user): TrpcContext {
  return {
    user: activeUser,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  databaseMocks.ensureProfile.mockResolvedValue(undefined);
  // Default: feature ON. Individual tests flip it off.
  featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  notificationMocks.notifyRoomWentLive.mockResolvedValue(undefined);
  notificationMocks.notifyRoomExpired.mockResolvedValue(undefined);
  notificationMocks.notifyMemberRemoved.mockResolvedValue(undefined);
  notificationMocks.notifyHypeRoomMessage.mockResolvedValue(0);
  notificationMocks.notifyRoomInvited.mockResolvedValue(false);
  notificationMocks.notifyRoomMessageHidden.mockResolvedValue(false);
});

describe("discovery visibility (link-only rooms are unlisted)", () => {
  it("canDiscoverRoom: public is always visible", () => {
    const room = { id: 11, visibility: "public" as const, hostId: HOST };
    expect(canDiscoverRoom(room, null, new Set())).toBe(true);
    expect(canDiscoverRoom(room, STRANGER, new Set())).toBe(true);
  });

  it("canDiscoverRoom: link-only hides from anonymous and strangers", () => {
    const room = { id: 11, visibility: "link_only" as const, hostId: HOST };
    expect(canDiscoverRoom(room, null, new Set())).toBe(false);
    expect(canDiscoverRoom(room, STRANGER, new Set())).toBe(false);
    expect(canDiscoverRoom(room, STRANGER, new Set([99]))).toBe(false);
  });

  it("canDiscoverRoom: link-only still reaches the host and members", () => {
    const room = { id: 11, visibility: "link_only" as const, hostId: HOST };
    expect(canDiscoverRoom(room, HOST, new Set())).toBe(true);
    expect(canDiscoverRoom(room, MEMBER, new Set([11]))).toBe(true);
  });

  it("listActiveHypeRooms: anonymous list never contains a link-only room", async () => {
    const rooms = [
      roomRow({ id: 11, visibility: "public" }),
      roomRow({ id: 12, visibility: "link_only" }),
    ];
    // anonymous → no membership select; counts follow the surviving rooms.
    const db = fakeDb([rooms, [{ roomId: 11, value: 3 }]]);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const out = await listActiveHypeRooms();
    expect(out.map(r => r.id)).toEqual([11]);
    expect(out.some(r => r.visibility === "link_only")).toBe(false);
  });

  it("listActiveHypeRooms: non-member list drops the link-only room", async () => {
    const rooms = [
      roomRow({ id: 11, visibility: "public" }),
      roomRow({ id: 12, visibility: "link_only" }),
    ];
    // membership → only room 11; counts → only room 11.
    const db = fakeDb([rooms, [{ roomId: 11 }], [{ roomId: 11, value: 3 }]]);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const out = await listActiveHypeRooms({ userId: STRANGER });
    expect(out.map(r => r.id)).toEqual([11]);
  });

  it("listActiveHypeRooms: host and member still see the link-only room", async () => {
    const rooms = [
      roomRow({ id: 11, visibility: "public" }),
      roomRow({ id: 12, visibility: "link_only" }),
    ];

    const hostDb = fakeDb([
      rooms,
      [], // host need not be a plain member row
      [
        { roomId: 11, value: 3 },
        { roomId: 12, value: 5 },
      ],
    ]);
    databaseMocks.getDb.mockResolvedValue(hostDb as never);
    const asHost = await listActiveHypeRooms({ userId: HOST });
    expect(asHost.map(r => r.id)).toEqual([11, 12]);

    const memberDb = fakeDb([
      rooms,
      [{ roomId: 12 }],
      [
        { roomId: 11, value: 3 },
        { roomId: 12, value: 5 },
      ],
    ]);
    databaseMocks.getDb.mockResolvedValue(memberDb as never);
    const asMember = await listActiveHypeRooms({ userId: MEMBER });
    expect(asMember.map(r => r.id)).toEqual([11, 12]);
  });
});

describe("participant counts on the discovery payload", () => {
  it("attaches participantCount from active (non-left, non-banned) members", async () => {
    const db = fakeDb([[roomRow({ id: 11 })], [], [{ roomId: 11, value: 7 }]]);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const out = await listActiveHypeRooms({ userId: HOST });
    expect(out).toHaveLength(1);
    expect(out[0].participantCount).toBe(7);
    expect(db.__queue).toHaveLength(0);
  });

  it("falls back to 0 when a room has no member rows", async () => {
    const db = fakeDb([[roomRow({ id: 11 })], [], []]);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const out = await listActiveHypeRooms({ userId: HOST });
    expect(out[0].participantCount).toBe(0);
  });
});

describe("validateRoomLink", () => {
  it("treats null, undefined and blank input as 'remove the link'", () => {
    expect(validateRoomLink(null)).toBeNull();
    expect(validateRoomLink(undefined)).toBeNull();
    expect(validateRoomLink("")).toBeNull();
    expect(validateRoomLink("   ")).toBeNull();
  });

  it("accepts https and http and normalizes the URL", () => {
    expect(validateRoomLink("https://shop.example.com/deal")).toBe(
      "https://shop.example.com/deal"
    );
    expect(validateRoomLink("  http://example.org  ")).toBe(
      "http://example.org/"
    );
  });

  it("rejects non-web schemes (XSS vectors)", () => {
    expect(() => validateRoomLink("javascript:alert(1)")).toThrow(
      "Room link must use https:// or http://."
    );
    expect(() =>
      validateRoomLink("data:text/html;base64,PHNjcmlwdD4=")
    ).toThrow("Room link must use https:// or http://.");
    expect(() => validateRoomLink("vbscript:msgbox")).toThrow(
      "Room link must use https:// or http://."
    );
  });

  it("rejects malformed input and oversized links", () => {
    expect(() => validateRoomLink("not a url")).toThrow(
      "Room link must be a valid URL."
    );
    expect(() => validateRoomLink(`https://e.com/${"a".repeat(2048)}`)).toThrow(
      "Room link must be at most 2048 characters."
    );
  });
});

describe("setHypeRoomLink", () => {
  it("lets the host add a link", async () => {
    const db = fakeDb([roomRow({ id: 11, hostId: HOST })]);
    db.__updateReturning.mockResolvedValue([
      roomRow({ id: 11, hostId: HOST, linkUrl: "https://shop.example.com/" }),
    ] as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const out = await setHypeRoomLink(11, HOST, "https://shop.example.com/");
    expect(db.__updateSets).toHaveBeenCalledWith(
      expect.objectContaining({ linkUrl: "https://shop.example.com/" })
    );
    expect(out.linkUrl).toBe("https://shop.example.com/");
  });

  it("lets the host clear the link with null", async () => {
    const db = fakeDb([
      roomRow({ id: 11, hostId: HOST, linkUrl: "https://old.example.com/" }),
    ]);
    db.__updateReturning.mockResolvedValue([
      roomRow({ id: 11, hostId: HOST, linkUrl: null }),
    ] as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const out = await setHypeRoomLink(11, HOST, null);
    expect(db.__updateSets).toHaveBeenCalledWith(
      expect.objectContaining({ linkUrl: null })
    );
    expect(out.linkUrl).toBeNull();
  });

  it("refuses a non-host before any write", async () => {
    const db = fakeDb([roomRow({ id: 11, hostId: HOST })]);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await expect(
      setHypeRoomLink(11, STRANGER, "https://x.example/")
    ).rejects.toThrow("Only the host can update the room link.");
    expect(db.__updateSets).not.toHaveBeenCalled();
  });

  it("refuses an unknown room", async () => {
    const db = fakeDb([]);
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(
      setHypeRoomLink(999, HOST, "https://x.example/")
    ).rejects.toThrow("Room not found.");
  });

  it("refuses a room that can no longer be edited", async () => {
    const db = fakeDb([roomRow({ id: 11, hostId: HOST, status: "expired" })]);
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(
      setHypeRoomLink(11, HOST, "https://x.example/")
    ).rejects.toThrow("This room can no longer be edited.");
    expect(db.__updateSets).not.toHaveBeenCalled();
  });

  it("rejects an unsafe scheme before touching the database", async () => {
    const db = fakeDb([roomRow({ id: 11, hostId: HOST })]);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await expect(
      setHypeRoomLink(11, HOST, "javascript:alert(1)")
    ).rejects.toThrow("Room link must use https:// or http://.");
    expect(db.__updateSets).not.toHaveBeenCalled();
  });
});

describe("hideHypeRoomMessage", () => {
  it("host hides a message and notifies only the author", async () => {
    const db = fakeDb([
      messageRow({ id: 3, roomId: 11, userId: MEMBER, pinned: false }),
      roomRow({ id: 11, hostId: HOST, title: "Room", pinnedMessageId: null }),
    ]);
    db.__updateReturning.mockResolvedValue([
      messageRow({
        id: 3,
        roomId: 11,
        userId: MEMBER,
        hiddenAt: new Date(),
        moderatedBy: HOST,
      }),
    ] as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const out = await hideHypeRoomMessage(3, HOST);
    expect(out.hiddenAt).toBeInstanceOf(Date);
    expect(out.moderatedBy).toBe(HOST);
    expect(notificationMocks.notifyRoomMessageHidden).toHaveBeenCalledTimes(1);
    expect(notificationMocks.notifyRoomMessageHidden).toHaveBeenCalledWith(
      { id: 11, title: "Room", hostId: HOST },
      { id: 3, roomId: 11 },
      MEMBER
    );
  });

  it("refuses a non-host moderator", async () => {
    const db = fakeDb([
      messageRow({ id: 3, roomId: 11, userId: MEMBER }),
      roomRow({ id: 11, hostId: HOST }),
    ]);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await expect(hideHypeRoomMessage(3, STRANGER)).rejects.toThrow(
      "Only the host can hide messages in this room."
    );
    expect(db.__updateSets).not.toHaveBeenCalled();
    expect(notificationMocks.notifyRoomMessageHidden).not.toHaveBeenCalled();
  });

  it("refuses a missing or already-hidden message", async () => {
    const db = fakeDb([]);
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(hideHypeRoomMessage(404, HOST)).rejects.toThrow(
      "Message not found."
    );

    const hiddenDb = fakeDb([messageRow({ id: 3, hiddenAt: new Date() })]);
    databaseMocks.getDb.mockResolvedValue(hiddenDb as never);
    await expect(hideHypeRoomMessage(3, HOST)).rejects.toThrow(
      "Message not found."
    );
  });

  it("clears the room pin when the pinned message is hidden", async () => {
    const db = fakeDb([
      messageRow({ id: 3, roomId: 11, userId: MEMBER, pinned: true }),
      roomRow({ id: 11, hostId: HOST, pinnedMessageId: 3 }),
    ]);
    db.__updateReturning.mockResolvedValue([
      messageRow({ id: 3, userId: MEMBER, hiddenAt: new Date() }),
    ] as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await hideHypeRoomMessage(3, HOST);
    expect(db.__updateSets).toHaveBeenLastCalledWith(
      expect.objectContaining({ pinnedMessageId: null })
    );
  });

  it("does not notify the author when the host hides their own message", async () => {
    const db = fakeDb([
      messageRow({ id: 3, roomId: 11, userId: HOST }),
      roomRow({ id: 11, hostId: HOST, pinnedMessageId: null }),
    ]);
    db.__updateReturning.mockResolvedValue([
      messageRow({ id: 3, userId: HOST, hiddenAt: new Date() }),
    ] as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await hideHypeRoomMessage(3, HOST);
    expect(notificationMocks.notifyRoomMessageHidden).not.toHaveBeenCalled();
  });
});

describe("tRPC surface: hypeRooms.setLink / hypeRooms.hideMessage", () => {
  it("setLink fails closed when the feature flag is off", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
    await expect(
      appRouter.createCaller(context({ ...user, id: HOST })).hypeRooms.setLink({
        roomId: 11,
        url: "https://shop.example.com/",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(databaseMocks.getDb).not.toHaveBeenCalled();
  });

  it("setLink maps a non-host attempt to FORBIDDEN", async () => {
    const db = fakeDb([roomRow({ id: 11, hostId: HOST })]);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await expect(
      appRouter.createCaller(context()).hypeRooms.setLink({
        roomId: 11,
        url: "https://shop.example.com/",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.__updateSets).not.toHaveBeenCalled();
  });

  it("setLink maps an unsafe or malformed URL to BAD_REQUEST", async () => {
    const db = fakeDb([roomRow({ id: 11, hostId: HOST })]);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await expect(
      appRouter
        .createCaller(context({ ...user, id: HOST }))
        .hypeRooms.setLink({ roomId: 11, url: "javascript:alert(1)" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await expect(
      appRouter
        .createCaller(context({ ...user, id: HOST }))
        .hypeRooms.setLink({ roomId: 11, url: "nope" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.__updateSets).not.toHaveBeenCalled();
  });

  it("setLink maps an unknown room to NOT_FOUND", async () => {
    const db = fakeDb([]);
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(
      appRouter
        .createCaller(context({ ...user, id: HOST }))
        .hypeRooms.setLink({ roomId: 999, url: "https://shop.example.com/" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("setLink returns the persisted row for the host", async () => {
    const db = fakeDb([roomRow({ id: 11, hostId: HOST })]);
    db.__updateReturning.mockResolvedValue([
      roomRow({ id: 11, hostId: HOST, linkUrl: "https://shop.example.com/" }),
    ] as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const out = await appRouter
      .createCaller(context({ ...user, id: HOST }))
      .hypeRooms.setLink({ roomId: 11, url: "https://shop.example.com/" });
    expect(out.linkUrl).toBe("https://shop.example.com/");
  });

  it("hideMessage fails closed when the feature flag is off", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
    await expect(
      appRouter
        .createCaller(context({ ...user, id: HOST }))
        .hypeRooms.hideMessage({
          messageId: 3,
        })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(databaseMocks.getDb).not.toHaveBeenCalled();
  });

  it("hideMessage maps a non-host attempt to FORBIDDEN", async () => {
    const db = fakeDb([
      messageRow({ id: 3, roomId: 11, userId: MEMBER }),
      roomRow({ id: 11, hostId: HOST }),
    ]);
    databaseMocks.getDb.mockResolvedValue(db as never);

    await expect(
      appRouter.createCaller(context()).hypeRooms.hideMessage({ messageId: 3 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.__updateSets).not.toHaveBeenCalled();
  });

  it("hideMessage maps an unknown message to NOT_FOUND", async () => {
    const db = fakeDb([]);
    databaseMocks.getDb.mockResolvedValue(db as never);
    await expect(
      appRouter
        .createCaller(context({ ...user, id: HOST }))
        .hypeRooms.hideMessage({
          messageId: 404,
        })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("hideMessage hides for the host and returns the hidden row", async () => {
    const db = fakeDb([
      messageRow({ id: 3, roomId: 11, userId: MEMBER }),
      roomRow({ id: 11, hostId: HOST, title: "Room", pinnedMessageId: null }),
    ]);
    db.__updateReturning.mockResolvedValue([
      messageRow({ id: 3, roomId: 11, userId: MEMBER, hiddenAt: new Date() }),
    ] as never);
    databaseMocks.getDb.mockResolvedValue(db as never);

    const out = await appRouter
      .createCaller(context({ ...user, id: HOST }))
      .hypeRooms.hideMessage({ messageId: 3 });
    expect(out.hiddenAt).toBeInstanceOf(Date);
    expect(notificationMocks.notifyRoomMessageHidden).toHaveBeenCalledTimes(1);
  });
});
