/**
 * Phase 2 M8 — admin Hype Rooms + admin Drops procedures.
 * Covers adminProcedure auth, flag fail-closed, service wiring, error mapping,
 * and service-level lifecycle guards (list/forceEnd/archive/ban/feature/takedown).
 */
import { vi, describe, beforeEach, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";

type ChainResult = unknown;

function chain(result: ChainResult) {
  const c: Record<string, unknown> = {};
  for (const m of [
    "from",
    "where",
    "limit",
    "orderBy",
    "returning",
    "values",
    "set",
  ]) {
    c[m] = vi.fn(() => c);
  }
  c.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return c;
}

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

const notificationWriterMocks = vi.hoisted(() => ({
  insertNotification: vi.fn(),
  listUserNotifications: vi.fn(),
  getUnreadNotificationCount: vi.fn(),
  markUserNotificationsRead: vi.fn(),
  notifyClaimStatusChange: vi.fn(),
  notifyDropSoldOut: vi.fn(),
  notifyRoomWentLive: vi.fn(),
  notifyRoomExpired: vi.fn(),
  notifyMemberRemoved: vi.fn(),
  NOTIFICATION_TYPES: {
    claimFulfilled: "drop_claim_fulfilled",
    claimCancelled: "drop_claim_cancelled",
    dropSoldOut: "drop_sold_out",
    roomStarted: "room_started",
    roomExpired: "room_expired",
    memberRemoved: "room_member_removed",
  },
}));

const featureFlagMocks = vi.hoisted(() => ({
  isFeatureFlagEnabled: vi.fn(async () => true),
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
vi.mock("./notifications", () => notificationWriterMocks);
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

// Real hypeRooms + drops services under test (db/notifications/flags mocked).
import { appRouter } from "./routers";

const user = {
  id: 41,
  openId: "kinba-m8-user",
  name: "KINBA M8 User",
  email: "m8@example.test",
  loginMethod: "email",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const adminUser = { ...user, role: "admin" as const };

function context(activeUser: typeof user | null = user): TrpcContext {
  return {
    user: activeUser,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const now = new Date("2026-09-23T12:00:00.000Z");
const future = new Date("2026-09-23T18:00:00.000Z");
const past = new Date("2026-09-23T06:00:00.000Z");

function baseRoom(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    hostId: 10,
    title: "M8 room",
    topic: null,
    description: null,
    coverUrl: null,
    status: "live",
    durationHours: 6,
    startsAt: past,
    endsAt: future,
    visibility: "public",
    dropId: null,
    pinnedMessageId: null,
    createdAt: past,
    updatedAt: past,
    expiredAt: null,
    archivedAt: null,
    cancelReason: null,
    ...overrides,
  };
}

function baseMembership(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    roomId: 11,
    userId: 55,
    role: "member",
    joinedAt: past,
    leftAt: null,
    bannedAt: null,
    removedBy: null,
    ...overrides,
  };
}

function baseDrop(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    sellerId: 20,
    title: "M8 drop",
    description: "desc",
    terms: "terms",
    mediaUrl: "https://cdn.example.test/d.jpg",
    mediaWidth: null,
    mediaHeight: null,
    currency: "BDT",
    originalPrice: "120.00",
    discountedPrice: "99.50",
    quantity: 10,
    remainingQuantity: 5,
    status: "live",
    startsAt: past,
    endsAt: future,
    featured: false,
    createdAt: past,
    updatedAt: past,
    featuredAt: null,
    endedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function mockDb(handlers: {
  select?: () => unknown;
  update?: () => unknown;
  insert?: () => unknown;
}) {
  const db = {
    select: vi.fn(() => chain(handlers.select ? handlers.select() : [])),
    update: vi.fn(() => chain(handlers.update ? handlers.update() : [])),
    insert: vi.fn(() => chain(handlers.insert ? handlers.insert() : [])),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  databaseMocks.getDb.mockResolvedValue(db);
  return db;
}

describe("M8 admin authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
  });

  const roomOps: Array<[string, (c: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>]> = [
    ["list", c => c.admin.hypeRooms.list()],
    ["forceEnd", c => c.admin.hypeRooms.forceEnd({ roomId: 1 })],
    [
      "archive",
      c => c.admin.hypeRooms.archive({ roomId: 1, cancelReason: "x" }),
    ],
    ["banUser", c => c.admin.hypeRooms.banUser({ roomId: 1, userId: 2 })],
  ];

  const dropOps: Array<[string, (c: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>]> = [
    ["list", c => c.admin.drops.list()],
    ["feature", c => c.admin.drops.feature({ dropId: 1, featured: true })],
    ["forceEnd", c => c.admin.drops.forceEnd({ dropId: 1 })],
    ["takedown", c => c.admin.drops.takedown({ dropId: 1, reason: "spam" })],
  ];

  for (const [name, run] of roomOps) {
    it(`rejects unauthenticated admin.hypeRooms.${name}`, async () => {
      await expect(run(appRouter.createCaller(context(null)))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
    it(`rejects non-admin admin.hypeRooms.${name}`, async () => {
      await expect(run(appRouter.createCaller(context(user)))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  }

  for (const [name, run] of dropOps) {
    it(`rejects unauthenticated admin.drops.${name}`, async () => {
      await expect(run(appRouter.createCaller(context(null)))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
    it(`rejects non-admin admin.drops.${name}`, async () => {
      await expect(run(appRouter.createCaller(context(user)))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  }

  it("rejects admin room ops when time_limited_communities is OFF", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
    await expect(
      appRouter.createCaller(context(adminUser)).admin.hypeRooms.list()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(featureFlagMocks.isFeatureFlagEnabled).toHaveBeenCalledWith(
      "time_limited_communities"
    );
  });

  it("rejects admin drop ops when jhilik_drops is OFF", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
    await expect(
      appRouter.createCaller(context(adminUser)).admin.drops.list()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(featureFlagMocks.isFeatureFlagEnabled).toHaveBeenCalledWith(
      "jhilik_drops"
    );
  });

  it("accepts admin for list when flag is ON", async () => {
    mockDb({ select: () => [] });
    await expect(
      appRouter.createCaller(context(adminUser)).admin.hypeRooms.list()
    ).resolves.toEqual([]);
    await expect(
      appRouter.createCaller(context(adminUser)).admin.drops.list()
    ).resolves.toMatchObject({ drops: [] });
  });
});

describe("M8 admin.hypeRooms service transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    notificationWriterMocks.notifyRoomExpired.mockResolvedValue(true);
    notificationWriterMocks.notifyRoomWentLive.mockResolvedValue(true);
    notificationWriterMocks.notifyMemberRemoved.mockResolvedValue(true);
  });

  it("list returns rooms after lazy resolution", async () => {
    const room = baseRoom({ status: "scheduled", startsAt: future, endsAt: future });
    mockDb({ select: () => [room] });
    await expect(
      appRouter.createCaller(context(adminUser)).admin.hypeRooms.list()
    ).resolves.toMatchObject([{ id: 11, status: "scheduled" }]);
  });

  it("forceEnd live → expired and notifies host", async () => {
    const expired = baseRoom({
      status: "expired",
      expiredAt: now,
      updatedAt: now,
    });
    mockDb({
      select: () => [baseRoom({ status: "live" })],
      update: () => [expired],
    });
    const result = await appRouter
      .createCaller(context(adminUser))
      .admin.hypeRooms.forceEnd({ roomId: 11 });
    expect(result).toMatchObject({ status: "expired", id: 11 });
    expect(notificationWriterMocks.notifyRoomExpired).toHaveBeenCalledWith(
      expect.objectContaining({ id: 11, hostId: 10 }),
      expect.anything()
    );
  });

  it("forceEnd rejects scheduled", async () => {
    mockDb({
      select: () => [baseRoom({ status: "scheduled", startsAt: future, endsAt: future })],
    });
    await expect(
      appRouter.createCaller(context(adminUser)).admin.hypeRooms.forceEnd({ roomId: 11 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(notificationWriterMocks.notifyRoomExpired).not.toHaveBeenCalled();
  });

  it("forceEnd rejects expired", async () => {
    mockDb({
      select: () => [baseRoom({ status: "expired", expiredAt: past })],
    });
    await expect(
      appRouter.createCaller(context(adminUser)).admin.hypeRooms.forceEnd({ roomId: 11 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("archive scheduled → archived with optional cancelReason", async () => {
    const archived = baseRoom({
      status: "scheduled",
      startsAt: future,
      endsAt: future,
      status2: undefined,
    });
    delete (archived as Record<string, unknown>).status2;
    const out = baseRoom({
      status: "archived",
      startsAt: future,
      endsAt: future,
      archivedAt: now,
      cancelReason: "admin archive",
      updatedAt: now,
    });
    mockDb({
      select: () => [baseRoom({ status: "scheduled", startsAt: future, endsAt: future })],
      update: () => [out],
    });
    const result = await appRouter
      .createCaller(context(adminUser))
      .admin.hypeRooms.archive({ roomId: 11, cancelReason: "admin archive" });
    expect(result).toMatchObject({
      status: "archived",
      cancelReason: "admin archive",
    });
  });

  it("archive expired → archived", async () => {
    const out = baseRoom({
      status: "archived",
      archivedAt: now,
      updatedAt: now,
      expiredAt: past,
    });
    mockDb({
      select: () => [baseRoom({ status: "expired", expiredAt: past, endsAt: past })],
      update: () => [out],
    });
    const result = await appRouter
      .createCaller(context(adminUser))
      .admin.hypeRooms.archive({ roomId: 11 });
    expect(result).toMatchObject({ status: "archived" });
  });

  it("archive rejects live", async () => {
    mockDb({ select: () => [baseRoom({ status: "live" })] });
    await expect(
      appRouter.createCaller(context(adminUser)).admin.hypeRooms.archive({ roomId: 11 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("banUser updates existing membership with bannedAt + leftAt", async () => {
    const banned = baseMembership({
      bannedAt: now,
      leftAt: now,
    });
    mockDb({
      select: () => {
        const calls = (mockDb as unknown as { last?: unknown }) && undefined;
        return undefined;
      },
    });
    // Sequence: room select → membership select → update
    let selectCall = 0;
    const db = {
      select: vi.fn(() => {
        selectCall += 1;
        if (selectCall === 1) return chain([baseRoom({ status: "live" })]);
        return chain([baseMembership()]);
      }),
      update: vi.fn(() => chain([banned])),
      insert: vi.fn(() => chain([banned])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    };
    databaseMocks.getDb.mockResolvedValue(db);

    const result = await appRouter
      .createCaller(context(adminUser))
      .admin.hypeRooms.banUser({ roomId: 11, userId: 55 });
    expect(result).toMatchObject({
      bannedAt: expect.any(Date),
      leftAt: expect.any(Date),
    });
    expect(db.update).toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("banUser inserts pre-join membership when none exists", async () => {
    const created = baseMembership({ id: 99, bannedAt: now, leftAt: null });
    let selectCall = 0;
    const db = {
      select: vi.fn(() => {
        selectCall += 1;
        if (selectCall === 1) return chain([baseRoom({ status: "live" })]);
        return chain([]);
      }),
      update: vi.fn(() => chain([])),
      insert: vi.fn(() => chain([created])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    };
    databaseMocks.getDb.mockResolvedValue(db);

    const result = await appRouter
      .createCaller(context(adminUser))
      .admin.hypeRooms.banUser({ roomId: 11, userId: 77 });
    expect(result).toMatchObject({ id: 99, bannedAt: expect.any(Date) });
    expect(db.insert).toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("banUser rejects archived room", async () => {
    mockDb({ select: () => [baseRoom({ status: "archived", archivedAt: past })] });
    await expect(
      appRouter.createCaller(context(adminUser)).admin.hypeRooms.banUser({
        roomId: 11,
        userId: 55,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps missing room to NOT_FOUND", async () => {
    mockDb({ select: () => [] });
    await expect(
      appRouter.createCaller(context(adminUser)).admin.hypeRooms.forceEnd({ roomId: 99 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("M8 admin.drops service transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  });

  it("list returns drops with serverNow", async () => {
    mockDb({ select: () => [baseDrop()] });
    const result = await appRouter
      .createCaller(context(adminUser))
      .admin.drops.list();
    expect(result).toMatchObject({
      drops: [expect.objectContaining({ id: 9, status: "live" })],
      serverNow: expect.any(Date),
    });
  });

  it("feature=true sets featured + featuredAt and does not change status", async () => {
    const featured = baseDrop({
      featured: true,
      featuredAt: now,
      updatedAt: now,
    });
    mockDb({
      select: () => [baseDrop()],
      update: () => [featured],
    });
    const result = await appRouter
      .createCaller(context(adminUser))
      .admin.drops.feature({ dropId: 9, featured: true });
    expect(result).toMatchObject({
      featured: true,
      status: "live",
      featuredAt: expect.any(Date),
    });
  });

  it("feature=false clears featuredAt", async () => {
    const cleared = baseDrop({
      featured: false,
      featuredAt: null,
      updatedAt: now,
    });
    mockDb({
      select: () => [baseDrop({ featured: true, featuredAt: past })],
      update: () => [cleared],
    });
    const result = await appRouter
      .createCaller(context(adminUser))
      .admin.drops.feature({ dropId: 9, featured: false });
    expect(result).toMatchObject({ featured: false, featuredAt: null });
  });

  it("forceEnd scheduled → ended", async () => {
    const ended = baseDrop({ status: "ended", endedAt: now, updatedAt: now });
    mockDb({
      select: () => [
        baseDrop({ status: "scheduled", startsAt: future, endsAt: future }),
      ],
      update: () => [ended],
    });
    const result = await appRouter
      .createCaller(context(adminUser))
      .admin.drops.forceEnd({ dropId: 9 });
    expect(result).toMatchObject({ status: "ended", endedAt: expect.any(Date) });
  });

  it("forceEnd live → ended", async () => {
    const ended = baseDrop({ status: "ended", endedAt: now, updatedAt: now });
    mockDb({
      select: () => [baseDrop({ status: "live" })],
      update: () => [ended],
    });
    const result = await appRouter
      .createCaller(context(adminUser))
      .admin.drops.forceEnd({ dropId: 9 });
    expect(result).toMatchObject({ status: "ended" });
  });

  it("forceEnd sold_out → ended", async () => {
    const ended = baseDrop({
      status: "ended",
      remainingQuantity: 0,
      endedAt: now,
      updatedAt: now,
    });
    mockDb({
      select: () => [baseDrop({ status: "sold_out", remainingQuantity: 0 })],
      update: () => [ended],
    });
    const result = await appRouter
      .createCaller(context(adminUser))
      .admin.drops.forceEnd({ dropId: 9 });
    expect(result).toMatchObject({ status: "ended" });
  });

  it("forceEnd rejects draft", async () => {
    mockDb({ select: () => [baseDrop({ status: "draft" })] });
    await expect(
      appRouter.createCaller(context(adminUser)).admin.drops.forceEnd({ dropId: 9 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("forceEnd rejects ended and archived", async () => {
    mockDb({ select: () => [baseDrop({ status: "ended", endedAt: past })] });
    await expect(
      appRouter.createCaller(context(adminUser)).admin.drops.forceEnd({ dropId: 9 })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    mockDb({ select: () => [baseDrop({ status: "archived", archivedAt: past })] });
    await expect(
      appRouter.createCaller(context(adminUser)).admin.drops.forceEnd({ dropId: 9 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("takedown ends live drop and does not persist reason", async () => {
    const ended = baseDrop({ status: "ended", endedAt: now, updatedAt: now });
    let updateSet: Record<string, unknown> | null = null;
    const db = {
      select: vi.fn(() => chain([baseDrop({ status: "live" })])),
      update: vi.fn(() => {
        const c = chain([ended]);
        const setFn = c.set as ReturnType<typeof vi.fn>;
        setFn.mockImplementation((patch: Record<string, unknown>) => {
          updateSet = patch;
          return c;
        });
        return c;
      }),
      insert: vi.fn(() => chain([])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    };
    databaseMocks.getDb.mockResolvedValue(db);

    const result = await appRouter
      .createCaller(context(adminUser))
      .admin.drops.takedown({ dropId: 9, reason: "policy violation" });
    expect(result).toMatchObject({ status: "ended" });
    expect(updateSet).not.toBeNull();
    expect(updateSet).not.toHaveProperty("reason");
    expect(updateSet).not.toHaveProperty("takedownReason");
    expect(updateSet).toHaveProperty("status", "ended");
    expect(updateSet).toHaveProperty("endedAt", expect.any(Date));
  });

  it("takedown allows optional reason without requiring a column", async () => {
    const ended = baseDrop({ status: "ended", endedAt: now, updatedAt: now });
    mockDb({
      select: () => [baseDrop({ status: "scheduled", startsAt: future })],
      update: () => [ended],
    });
    await expect(
      appRouter.createCaller(context(adminUser)).admin.drops.takedown({
        dropId: 9,
      })
    ).resolves.toMatchObject({ status: "ended" });
  });

  it("maps missing drop to NOT_FOUND", async () => {
    mockDb({ select: () => [] });
    await expect(
      appRouter.createCaller(context(adminUser)).admin.drops.forceEnd({ dropId: 99 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
