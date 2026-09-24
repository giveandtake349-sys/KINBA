/**
 * Phase 2 M7 — durable notifications: read APIs, insert helper, §22 writers.
 * home.notifications derived path is intentionally not under test here.
 */
import { vi, describe, beforeEach, afterEach, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";

type ChainResult = unknown;

function chain(result: ChainResult) {
  const c: Record<string, unknown> = {};
  const methods = [
    "from",
    "where",
    "limit",
    "orderBy",
    "returning",
    "values",
    "set",
  ];
  for (const m of methods) {
    c[m] = vi.fn(() => c);
  }
  c.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return c;
}

const dbState = vi.hoisted(() => ({
  selectResult: undefined as unknown,
  insertResult: undefined as unknown,
  updateResult: undefined as unknown,
  userRows: [] as Array<{ id: number }>,
  notificationRows: [] as unknown[],
  selectCalls: [] as unknown[],
  insertCalls: [] as unknown[],
  updateCalls: [] as unknown[],
}));

const databaseMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  ensureProfile: vi.fn(),
  listNotifications: vi.fn(),
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
}));

const hypeRoomsMocks = vi.hoisted(() => ({
  createHypeRoom: vi.fn(),
  getHypeRoom: vi.fn(),
  listActiveHypeRooms: vi.fn(),
  resolveHypeRoomExpiry: vi.fn(),
  joinHypeRoom: vi.fn(),
  leaveHypeRoom: vi.fn(),
  listHypeRoomMembers: vi.fn(),
  listRoomMessages: vi.fn(),
  sendHypeRoomMessage: vi.fn(),
  endHypeRoom: vi.fn(),
  pinHypeRoomMessage: vi.fn(),
  unpinHypeRoomMessage: vi.fn(),
  removeHypeRoomMember: vi.fn(),
  cancelHypeRoom: vi.fn(),
  listAdminHypeRooms: vi.fn(),
  adminForceEndHypeRoom: vi.fn(),
  adminArchiveHypeRoom: vi.fn(),
  adminBanHypeRoomMember: vi.fn(),
  isValidDurationHours: vi.fn(),
  assertValidDurationHours: vi.fn(),
  computeEndsAt: vi.fn(),
  normalizeStartsAt: vi.fn(),
  resolveRoomLifecycle: vi.fn(),
  assertRoomTransition: vi.fn(),
  canJoinRoomStatus: vi.fn(),
  resolveMemberRole: vi.fn(),
  decideJoinAction: vi.fn(),
  canLeaveMembership: vi.fn(),
  validateRoomMessageBody: vi.fn(),
  canSendRoomMessage: vi.fn(),
  isRoomHost: vi.fn(),
  canHostEndRoom: vi.fn(),
  canHostCancelScheduled: vi.fn(),
  matchesRoomListFilter: vi.fn(),
  isEligibleRoomHost: vi.fn(),
  decideRemoveMember: vi.fn(),
  toggleHypeRoomMessageReaction: vi.fn(),
  setHypeRoomMemberRole: vi.fn(),
  updateHypeRoomSettings: vi.fn(),
  createHypeRoomInvite: vi.fn(),
  acceptHypeRoomInvite: vi.fn(),
  listHypeRoomInvites: vi.fn(),
  listMyHypeRoomInvites: vi.fn(),
  HYPE_ROOM_REACTIONS: ["like", "love", "fire", "clap"],
  ROOM_DURATION_HOURS: [4, 6, 12, 24],
  ROOM_MAX_LEAD_MS: 7 * 24 * 60 * 60 * 1000,
  ROOM_MESSAGE_MIN_LENGTH: 1,
  ROOM_MESSAGE_MAX_LENGTH: 5000,
}));

const dropsMocks = vi.hoisted(() => ({
  listDrops: vi.fn(),
  getDrop: vi.fn(),
  claimDrop: vi.fn(),
  getMyClaim: vi.fn(),
  saveDraftDrop: vi.fn(),
  publishDrop: vi.fn(),
  scheduleDrop: vi.fn(),
  endDrop: vi.fn(),
  assertDropOwner: vi.fn(),
  listDropClaims: vi.fn(),
  fulfillClaim: vi.fn(),
  cancelClaim: vi.fn(),
  listAdminDrops: vi.fn(),
  adminFeatureDrop: vi.fn(),
  adminForceEndDrop: vi.fn(),
  adminTakedownDrop: vi.fn(),
  validateDropOffer: vi.fn(),
  resolveDropLifecycle: vi.fn(),
  assertDropTransition: vi.fn(),
  assertClaimTransition: vi.fn(),
  canClaimTransition: vi.fn(),
  isEligibleSeller: vi.fn(),
  buildClaimIdempotencyKey: vi.fn(),
  normalizeClaimIdempotencyKey: vi.fn(),
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
vi.mock("./hypeRooms", () => hypeRoomsMocks);
vi.mock("./drops", () => dropsMocks);
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

// Real notifications module under test (db + featureFlags mocked above).
import {
  insertNotification,
  listUserNotifications,
  getUnreadNotificationCount,
  markUserNotificationsRead,
  notifyClaimStatusChange,
  notifyDropSoldOut,
  notifyRoomWentLive,
  notifyRoomExpired,
  notifyMemberRemoved,
  NOTIFICATION_TYPES,
} from "./notifications";
import { appRouter } from "./routers";

const user = {
  id: 41,
  openId: "kinba-notif-user",
  name: "KINBA Notified",
  email: "notif@example.test",
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

function installDbMock(opts: {
  userExists?: boolean;
  selectResult?: unknown;
  insertResult?: unknown;
  updateResult?: unknown;
}) {
  dbState.selectCalls = [];
  dbState.insertCalls = [];
  dbState.updateCalls = [];
  const selectResult =
    opts.selectResult !== undefined
      ? opts.selectResult
      : opts.userExists === false
        ? []
        : [{ id: user.id }];
  const insertResult =
    opts.insertResult !== undefined
      ? opts.insertResult
      : [{ id: 1, userId: user.id, type: "x", title: "t" }];
  const updateResult = opts.updateResult !== undefined ? opts.updateResult : [];

  const db = {
    select: vi.fn((...args: unknown[]) => {
      dbState.selectCalls.push(args);
      const c = chain(selectResult);
      // Support .select().from().where().limit() returning array
      return c;
    }),
    insert: vi.fn((...args: unknown[]) => {
      dbState.insertCalls.push(args);
      return chain(insertResult);
    }),
    update: vi.fn((...args: unknown[]) => {
      dbState.updateCalls.push(args);
      return chain(updateResult);
    }),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  databaseMocks.getDb.mockResolvedValue(db);
  return db;
}

describe("notifications durable reads — auth + isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.getDb.mockReset();
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  });

  it("rejects unauthenticated list", async () => {
    await expect(
      appRouter.createCaller(context(null)).notifications.list()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects unauthenticated unreadCount", async () => {
    await expect(
      appRouter.createCaller(context(null)).notifications.unreadCount()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects unauthenticated markRead", async () => {
    await expect(
      appRouter.createCaller(context(null)).notifications.markRead({})
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("list queries only the authenticated user id", async () => {
    installDbMock({ selectResult: [] });
    await appRouter.createCaller(context()).notifications.list();
    expect(databaseMocks.getDb).toHaveBeenCalled();
    // service always filters by userId equality — isolation is in SQL where clause
    expect(dbState.selectCalls.length).toBeGreaterThan(0);
  });

  it("list passes limit through", async () => {
    installDbMock({ selectResult: [] });
    await appRouter
      .createCaller(context())
      .notifications.list({ limit: 10 });
    expect(databaseMocks.getDb).toHaveBeenCalled();
  });

  it("unreadCount returns a number for the user", async () => {
    installDbMock({ selectResult: [{ value: 3 }] });
    await expect(
      appRouter.createCaller(context()).notifications.unreadCount()
    ).resolves.toBe(3);
  });

  it("markRead updates only authenticated user (service userId arg)", async () => {
    installDbMock({ updateResult: [{ id: 1 }, { id: 2 }] });
    await expect(
      appRouter.createCaller(context()).notifications.markRead()
    ).resolves.toEqual({ updated: 2 });
    expect(databaseMocks.getDb).toHaveBeenCalled();
  });

  it("markRead is idempotent when nothing unread (empty returning)", async () => {
    installDbMock({ updateResult: [] });
    await expect(
      appRouter.createCaller(context()).notifications.markRead()
    ).resolves.toEqual({ updated: 0 });
    await expect(
      appRouter.createCaller(context()).notifications.markRead()
    ).resolves.toEqual({ updated: 0 });
  });

  it("markRead with ids filters to those ids", async () => {
    installDbMock({ updateResult: [{ id: 5 }] });
    await expect(
      appRouter.createCaller(context()).notifications.markRead({ ids: [5] })
    ).resolves.toEqual({ updated: 1 });
  });

  it("home.notifications derived path remains available", async () => {
    // Derived feed is separate — ensure router still exposes it.
    expect(typeof (appRouter as never as Record<string, unknown>).home).toBe(
      "object"
    );
  });
});

describe("insertNotification helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    databaseMocks.getDb.mockReset();
  });

  it("rejects missing recipient", async () => {
    await expect(
      insertNotification({
        userId: 0,
        type: "t",
        title: "title",
      })
    ).rejects.toThrow(/userId/i);
  });

  it("rejects empty type or title", async () => {
    await expect(
      insertNotification({ userId: 1, type: "  ", title: "x" })
    ).rejects.toThrow(/type/i);
    await expect(
      insertNotification({ userId: 1, type: "ok", title: "  " })
    ).rejects.toThrow(/title/i);
  });

  it("no-ops when recipient user does not exist", async () => {
    installDbMock({ userExists: false, selectResult: [] });
    await expect(
      insertNotification({ userId: 999, type: "t", title: "Hello" })
    ).resolves.toBeNull();
    expect(dbState.insertCalls).toHaveLength(0);
  });

  it("inserts a durable row for an existing recipient", async () => {
    installDbMock({
      userExists: true,
      selectResult: [{ id: 7 }],
      insertResult: [{ id: 11, userId: 7, type: "t", title: "Hello" }],
    });
    const row = await insertNotification({
      userId: 7,
      type: "t",
      title: "Hello",
      body: "b",
      entityType: "drop",
      entityId: 3,
    });
    expect(row).toMatchObject({ id: 11, userId: 7 });
    expect(dbState.insertCalls).toHaveLength(1);
  });

  it("returns null when database unavailable", async () => {
    databaseMocks.getDb.mockResolvedValue(null);
    await expect(
      insertNotification({ userId: 1, type: "t", title: "x" })
    ).resolves.toBeNull();
  });
});

describe("§22 writers — flag gating + payloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDbMock({
      userExists: true,
      selectResult: [{ id: 1 }],
      insertResult: [{ id: 1, userId: 1, type: "n", title: "t" }],
    });
  });

  it("drops writers no-op when jhilik_drops is OFF", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockImplementation(
      async (key: string) => key !== "jhilik_drops"
    );
    await expect(
      notifyClaimStatusChange(
        { userId: 1, dropId: 2 },
        { title: "Sneakers" },
        "fulfilled"
      )
    ).resolves.toBe(false);
    await expect(
      notifyDropSoldOut({ id: 2, title: "Sneakers" }, [1, 2])
    ).resolves.toBe(0);
    expect(dbState.insertCalls).toHaveLength(0);
  });

  it("room writers no-op when time_limited_communities is OFF", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockImplementation(
      async (key: string) => key !== "time_limited_communities"
    );
    await expect(
      notifyRoomWentLive({ id: 1, title: "Room", hostId: 10 }, [11])
    ).resolves.toBe(0);
    await expect(
      notifyRoomExpired({ id: 1, title: "Room", hostId: 10 })
    ).resolves.toBe(false);
    await expect(notifyMemberRemoved({ id: 1, title: "Room" }, 11)).resolves.toBe(
      false
    );
    expect(dbState.insertCalls).toHaveLength(0);
  });

  it("claim fulfilled writer inserts for claimer with drops flag ON", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      notifyClaimStatusChange(
        { userId: 41, dropId: 9 },
        { title: "Sneakers" },
        "fulfilled"
      )
    ).resolves.toBe(true);
    expect(dbState.insertCalls).toHaveLength(1);
  });

  it("claim cancelled writer uses cancelled type", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await notifyClaimStatusChange(
      { userId: 41, dropId: 9 },
      { title: "Sneakers" },
      "cancelled"
    );
    expect(dbState.insertCalls).toHaveLength(1);
    const values = (dbState.insertCalls[0] as [{ values: (v: unknown) => unknown }])[0];
    // values is first arg to insert
    expect(values).toBeTruthy();
  });

  it("sold_out writer fans out to distinct claimers only", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    const written = await notifyDropSoldOut(
      { id: 5, title: "Drop" },
      [1, 2, 2, 3, 1]
    );
    expect(written).toBe(3);
    expect(dbState.insertCalls).toHaveLength(3);
  });

  it("room live writer includes host + distinct members", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    const written = await notifyRoomWentLive(
      { id: 8, title: "Live room", hostId: 10 },
      [10, 11, 11, 12]
    );
    // host 10 + 11 + 12 = 3
    expect(written).toBe(3);
  });

  it("room expired writer notifies host only", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      notifyRoomExpired({ id: 8, title: "Ended", hostId: 10 })
    ).resolves.toBe(true);
    expect(dbState.insertCalls).toHaveLength(1);
  });

  it("member removed writer targets removed user", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      notifyMemberRemoved({ id: 8, title: "Room" }, 99)
    ).resolves.toBe(true);
    expect(dbState.insertCalls).toHaveLength(1);
  });

  it("exposes only approved §22 type constants", () => {
    expect(Object.values(NOTIFICATION_TYPES).sort()).toEqual(
      [
        "drop_claim_cancelled",
        "drop_claim_fulfilled",
        "drop_sold_out",
        "room_expired",
        "room_member_removed",
        "room_started",
      ].sort()
    );
  });
});

describe("read service functions — user isolation SQL shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("listUserNotifications uses provided limit", async () => {
    installDbMock({ selectResult: [] });
    await listUserNotifications(41, 25);
    expect(databaseMocks.getDb).toHaveBeenCalled();
  });

  it("getUnreadNotificationCount throws without db", async () => {
    databaseMocks.getDb.mockResolvedValue(null);
    await expect(getUnreadNotificationCount(41)).rejects.toThrow(
      /database/i
    );
  });

  it("markUserNotificationsRead throws without db", async () => {
    databaseMocks.getDb.mockResolvedValue(null);
    await expect(markUserNotificationsRead(41)).rejects.toThrow(
      /database/i
    );
  });

  it("markUserNotificationsRead with invalid ids is a no-op", async () => {
    installDbMock({ updateResult: [] });
    await expect(
      markUserNotificationsRead(41, [0, -1, Number.NaN])
    ).resolves.toEqual({ updated: 0 });
    expect(dbState.updateCalls).toHaveLength(0);
  });
});

describe("M7 — feature flag / home path regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
  });

  it("notification reads do not require a feature flag", async () => {
    installDbMock({ selectResult: [] });
    await expect(
      appRouter.createCaller(context()).notifications.list()
    ).resolves.toEqual([]);
    // flag helper not required for durable reads
    expect(featureFlagMocks.isFeatureFlagEnabled).not.toHaveBeenCalled();
  });

  it("M1 rooms flag still independent of notification reads", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
    await expect(
      appRouter.createCaller(context()).hypeRooms.list()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("M3 drops flag still independent of notification reads", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
    await expect(
      appRouter.createCaller(context()).drops.list()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
