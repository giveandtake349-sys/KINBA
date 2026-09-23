/**
 * Phase 2 M7 — writers fire only on actual state transitions (not reads).
 * Mocks ./notifications writers; exercises real drops/hypeRooms services.
 */
import { vi, describe, beforeEach, expect, it } from "vitest";

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

function chain(result: unknown) {
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

const dbMocks = vi.hoisted(() => ({
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

vi.mock("./db", () => dbMocks);
vi.mock("./featureFlags", () => featureFlagMocks);
vi.mock("./notifications", () => notificationWriterMocks);
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
vi.mock("./rewardLedger", () => ({
  getCoinBalance: vi.fn(),
  listRewardHistory: vi.fn(),
}));

import { fulfillClaim, cancelClaim } from "./drops";
import { endHypeRoom, removeHypeRoomMember, getHypeRoom } from "./hypeRooms";

const sellerId = 10;
const claimerId = 41;
const hostId = 20;
const memberId = 42;

const baseDrop = {
  id: 9,
  sellerId,
  title: "M7 drop",
  status: "live",
  remainingQuantity: 5,
  startsAt: new Date(Date.now() - 1000),
  endsAt: new Date(Date.now() + 60_000),
};

const baseClaim = {
  id: 3,
  dropId: 9,
  userId: claimerId,
  status: "claimed",
  idempotencyKey: "k",
  claimedAt: new Date(),
  updatedAt: new Date(),
  fulfilledAt: null,
  cancelledAt: null,
  notes: null,
};

const baseRoom = {
  id: 11,
  hostId,
  title: "M7 room",
  status: "scheduled",
  startsAt: new Date(Date.now() - 5_000),
  endsAt: new Date(Date.now() + 60_000),
  durationHours: 4,
  visibility: "public",
  dropId: null,
  pinnedMessageId: null,
  cancelReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  expiredAt: null,
  archivedAt: null,
};

function mockDb(handlers: {
  select?: (tableHint?: unknown) => unknown;
  update?: () => unknown;
}) {
  const db = {
    select: vi.fn(() => {
      const r = handlers.select ? handlers.select() : [];
      return chain(r);
    }),
    update: vi.fn(() => chain(handlers.update ? handlers.update() : [])),
    insert: vi.fn(() => chain([])),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };
  dbMocks.getDb.mockResolvedValue(db);
  return db;
}

describe("M7 writers attach to claim terminal transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationWriterMocks.notifyClaimStatusChange.mockResolvedValue(true);
    notificationWriterMocks.notifyDropSoldOut.mockResolvedValue(1);
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  });

  it("fulfillClaim notifies claimer after claimed→fulfilled", async () => {
    let selectCall = 0;
    mockDb({
      select: () => {
        selectCall += 1;
        if (selectCall === 1) return [baseDrop];
        if (selectCall === 2) return [baseClaim];
        return [];
      },
      update: () => [{ ...baseClaim, status: "fulfilled" }],
    });

    await expect(
      fulfillClaim(sellerId, { dropId: 9, claimId: 3 })
    ).resolves.toMatchObject({ status: "fulfilled" });
    expect(notificationWriterMocks.notifyClaimStatusChange).toHaveBeenCalledWith(
      { userId: claimerId, dropId: 9 },
      { title: "M7 drop" },
      "fulfilled",
      expect.anything()
    );
  });

  it("cancelClaim notifies claimer after claimed→cancelled", async () => {
    let selectCall = 0;
    mockDb({
      select: () => {
        selectCall += 1;
        if (selectCall === 1) return [baseDrop];
        if (selectCall === 2) return [baseClaim];
        return [];
      },
      update: () => [{ ...baseClaim, status: "cancelled" }],
    });

    await expect(
      cancelClaim(sellerId, { dropId: 9, claimId: 3 })
    ).resolves.toMatchObject({ status: "cancelled" });
    expect(notificationWriterMocks.notifyClaimStatusChange).toHaveBeenCalledWith(
      { userId: claimerId, dropId: 9 },
      { title: "M7 drop" },
      "cancelled",
      expect.anything()
    );
  });

  it("does not notify when claim transition update loses the race", async () => {
    let selectCall = 0;
    mockDb({
      select: () => {
        selectCall += 1;
        if (selectCall === 1) return [baseDrop];
        if (selectCall === 2) return [baseClaim];
        return [];
      },
      update: () => [],
    });

    await expect(
      fulfillClaim(sellerId, { dropId: 9, claimId: 3 })
    ).rejects.toThrow(/no longer in claimed/i);
    expect(
      notificationWriterMocks.notifyClaimStatusChange
    ).not.toHaveBeenCalled();
  });
});

describe("M7 writers attach to room transitions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationWriterMocks.notifyRoomWentLive.mockResolvedValue(2);
    notificationWriterMocks.notifyRoomExpired.mockResolvedValue(true);
    notificationWriterMocks.notifyMemberRemoved.mockResolvedValue(true);
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  });

  it("getHypeRoom scheduled→live notifies host + active members once", async () => {
    const liveRoom = { ...baseRoom, status: "live" };
    const db = mockDb({ select: () => [baseRoom], update: () => [liveRoom] });
    let n = 0;
    db.select = vi.fn(() => {
      n += 1;
      if (n === 1) return chain([baseRoom]);
      if (n === 2) return chain([{ userId: memberId }, { userId: hostId }]);
      return chain([liveRoom]);
    });
    db.update = vi.fn(() => chain([liveRoom]));

    await getHypeRoom(11);
    expect(notificationWriterMocks.notifyRoomWentLive).toHaveBeenCalledTimes(1);
    expect(notificationWriterMocks.notifyRoomWentLive).toHaveBeenCalledWith(
      expect.objectContaining({ id: 11, hostId }),
      expect.arrayContaining([memberId, hostId]),
      expect.anything()
    );
  });

  it("repeated lifecycle resolution on already-live room does not re-notify", async () => {
    const liveRoom = { ...baseRoom, status: "live" };
    mockDb({
      select: () => [liveRoom],
      update: () => [liveRoom],
    });
    await getHypeRoom(11);
    await getHypeRoom(11);
    expect(notificationWriterMocks.notifyRoomWentLive).not.toHaveBeenCalled();
    expect(notificationWriterMocks.notifyRoomExpired).not.toHaveBeenCalled();
  });

  it("getHypeRoom live→expired (time) notifies host once", async () => {
    const liveRoom = {
      ...baseRoom,
      status: "live",
      startsAt: new Date(Date.now() - 7200_000),
      endsAt: new Date(Date.now() - 1000),
    };
    mockDb({
      select: () => [liveRoom],
      update: () => [{ ...liveRoom, status: "expired" }],
    });
    await getHypeRoom(11);
    expect(notificationWriterMocks.notifyRoomExpired).toHaveBeenCalledTimes(1);
    expect(notificationWriterMocks.notifyRoomExpired).toHaveBeenCalledWith(
      expect.objectContaining({ id: 11, hostId }),
      expect.anything()
    );
    expect(notificationWriterMocks.notifyRoomWentLive).not.toHaveBeenCalled();
  });

  it("repeated expiry resolution on expired room does not re-notify", async () => {
    const expired = { ...baseRoom, status: "expired" };
    mockDb({ select: () => [expired], update: () => [expired] });
    await getHypeRoom(11);
    await getHypeRoom(11);
    expect(notificationWriterMocks.notifyRoomExpired).not.toHaveBeenCalled();
  });

  it("endHypeRoom live→expired notifies host", async () => {
    const liveRoom = {
      ...baseRoom,
      status: "live",
      startsAt: new Date(Date.now() - 1000),
      endsAt: new Date(Date.now() + 60_000),
    };
    mockDb({
      select: () => [liveRoom],
      update: () => [{ ...liveRoom, status: "expired", expiredAt: new Date() }],
    });
    await endHypeRoom(11, hostId);
    expect(notificationWriterMocks.notifyRoomExpired).toHaveBeenCalledTimes(1);
  });

  it("removeHypeRoomMember notifies removed user after successful remove", async () => {
    const roomRow = { ...baseRoom, status: "live" };
    const membership = {
      id: 7,
      roomId: 11,
      userId: memberId,
      role: "member",
      leftAt: null,
      bannedAt: null,
      removedBy: null,
      joinedAt: new Date(),
    };
    const db = mockDb({
      select: () => [roomRow],
      update: () => [{ ...membership, leftAt: new Date(), removedBy: hostId }],
    });
    let n = 0;
    db.select = vi.fn(() => {
      n += 1;
      if (n === 1) return chain([roomRow]);
      return chain([membership]);
    });
    db.update = vi.fn(() =>
      chain([{ ...membership, leftAt: new Date(), removedBy: hostId }])
    );

    await removeHypeRoomMember(11, hostId, memberId);
    expect(notificationWriterMocks.notifyMemberRemoved).toHaveBeenCalledWith(
      { id: 11, title: "M7 room" },
      memberId,
      expect.anything()
    );
  });

  it("does not notify when remove loses optimistic race", async () => {
    const roomRow = { ...baseRoom, status: "live" };
    const membership = {
      id: 7,
      roomId: 11,
      userId: memberId,
      role: "member",
      leftAt: null,
      bannedAt: null,
      removedBy: null,
      joinedAt: new Date(),
    };
    const db = mockDb({ select: () => [roomRow], update: () => [] });
    let n = 0;
    db.select = vi.fn(() => {
      n += 1;
      if (n === 1) return chain([roomRow]);
      return chain([membership]);
    });
    db.update = vi.fn(() => chain([]));

    await expect(
      removeHypeRoomMember(11, hostId, memberId)
    ).rejects.toThrow(/not an active member/i);
    expect(notificationWriterMocks.notifyMemberRemoved).not.toHaveBeenCalled();
  });
});
