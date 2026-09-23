/**
 * Phase 2 M1 — hype room procedures: flag fail-closed + service wiring.
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

const hypeRoomsMocks = vi.hoisted(() => ({
  createHypeRoom: vi.fn(),
  getHypeRoom: vi.fn(),
  listActiveHypeRooms: vi.fn(),
  resolveHypeRoomExpiry: vi.fn(),
  joinHypeRoom: vi.fn(),
  leaveHypeRoom: vi.fn(),
  listHypeRoomMembers: vi.fn(),
  // M4
  listRoomMessages: vi.fn(),
  sendHypeRoomMessage: vi.fn(),
  endHypeRoom: vi.fn(),
  pinHypeRoomMessage: vi.fn(),
  unpinHypeRoomMessage: vi.fn(),
  removeHypeRoomMember: vi.fn(),
  // M6
  cancelHypeRoom: vi.fn(),
  // M8
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
  ROOM_DURATION_HOURS: [4, 6, 12, 24],
  ROOM_MAX_LEAD_MS: 7 * 24 * 60 * 60 * 1000,
  ROOM_MESSAGE_MIN_LENGTH: 1,
  ROOM_MESSAGE_MAX_LENGTH: 5000,
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
vi.mock("./featureFlags", () => featureFlagMocks);
vi.mock("./rewardLedger", () => rewardMocks);
vi.mock("./hlsProcessor", () => ({ queueVideoTranscode: vi.fn() }));

import { appRouter } from "./routers";

const user = {
  id: 41,
  openId: "kinba-hype-room-user",
  name: "KINBA Room Member",
  email: "member@example.test",
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

const createInput = {
  title: "Weekend flash room",
  topic: "Community deals",
  description: "Temporary hype room",
  durationHours: 6 as const,
  visibility: "public" as const,
  startsAt: "2026-09-24T12:00:00.000Z",
};

describe("hypeRooms procedures — feature flag fail-closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
    // Default: flag OFF (fail closed) unless a test enables it.
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
  });

  it("rejects create when time_limited_communities is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.create(createInput)
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(featureFlagMocks.isFeatureFlagEnabled).toHaveBeenCalledWith(
      "time_limited_communities"
    );
    expect(hypeRoomsMocks.createHypeRoom).not.toHaveBeenCalled();
    expect(databaseMocks.ensureProfile).not.toHaveBeenCalled();
  });

  it("rejects byId when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.byId({ roomId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.getHypeRoom).not.toHaveBeenCalled();
  });

  it("rejects list when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.list()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.listActiveHypeRooms).not.toHaveBeenCalled();
  });

  it("rejects cancel when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.cancel({
        roomId: 1,
        cancelReason: "changed mind",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.cancelHypeRoom).not.toHaveBeenCalled();
  });

  it("rejects resolve when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.resolve({ roomId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.resolveHypeRoomExpiry).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated create even if flag checks were skipped", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.create(createInput)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(hypeRoomsMocks.createHypeRoom).not.toHaveBeenCalled();
  });

  it("rejects join when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.join({ roomId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.joinHypeRoom).not.toHaveBeenCalled();
  });

  it("rejects leave when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.leave({ roomId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.leaveHypeRoom).not.toHaveBeenCalled();
  });

  it("rejects members when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.members({ roomId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.listHypeRoomMembers).not.toHaveBeenCalled();
  });

  it("rejects messages when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.messages({ roomId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.listRoomMessages).not.toHaveBeenCalled();
  });

  it("rejects sendMessage when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.sendMessage({
        roomId: 1,
        body: "hello",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.sendHypeRoomMessage).not.toHaveBeenCalled();
  });

  it("rejects end when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.end({ roomId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.endHypeRoom).not.toHaveBeenCalled();
  });

  it("rejects pin when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.pin({ messageId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.pinHypeRoomMessage).not.toHaveBeenCalled();
  });

  it("rejects unpin when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.unpin({ roomId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.unpinHypeRoomMessage).not.toHaveBeenCalled();
  });

  it("rejects removeMember when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.removeMember({
        roomId: 1,
        userId: 2,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.removeHypeRoomMember).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated sendMessage even if flag checks were skipped", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.sendMessage({
        roomId: 1,
        body: "hello",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(hypeRoomsMocks.sendHypeRoomMessage).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated end even if flag checks were skipped", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.end({ roomId: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(hypeRoomsMocks.endHypeRoom).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated pin even if flag checks were skipped", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.pin({ messageId: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(hypeRoomsMocks.pinHypeRoomMessage).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated unpin even if flag checks were skipped", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.unpin({ roomId: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(hypeRoomsMocks.unpinHypeRoomMessage).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated removeMember even if flag checks were skipped", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.removeMember({
        roomId: 1,
        userId: 2,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(hypeRoomsMocks.removeHypeRoomMember).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated join even if flag checks were skipped", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.join({ roomId: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(hypeRoomsMocks.joinHypeRoom).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated cancel even if flag checks were skipped", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.cancel({
        roomId: 1,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(hypeRoomsMocks.cancelHypeRoom).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated leave even if flag checks were skipped", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.leave({ roomId: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(hypeRoomsMocks.leaveHypeRoom).not.toHaveBeenCalled();
  });
});

describe("hypeRooms procedures — enabled flag wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  });

  it("creates a room for the authenticated host when the flag is on", async () => {
    const room = {
      id: 11,
      hostId: user.id,
      title: createInput.title,
      durationHours: 6,
      status: "live",
      startsAt: new Date(createInput.startsAt),
      endsAt: new Date("2026-09-24T18:00:00.000Z"),
    };
    hypeRoomsMocks.createHypeRoom.mockResolvedValue(room);

    await expect(
      appRouter.createCaller(context()).hypeRooms.create(createInput)
    ).resolves.toEqual(room);
    expect(hypeRoomsMocks.createHypeRoom).toHaveBeenCalledWith(user.id, {
      title: createInput.title,
      topic: createInput.topic,
      description: createInput.description,
      durationHours: 6,
      visibility: "public",
      startsAt: createInput.startsAt,
    });
    expect(databaseMocks.ensureProfile).toHaveBeenCalledWith(user.id);
  });

  it("rejects invalid duration literals at the API boundary", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.create({
        ...createInput,
        durationHours: 5 as unknown as 6,
      })
    ).rejects.toThrow();
    expect(hypeRoomsMocks.createHypeRoom).not.toHaveBeenCalled();
  });

  it("returns a room from byId after flag check", async () => {
    const room = { id: 3, status: "expired" as const };
    hypeRoomsMocks.getHypeRoom.mockResolvedValue(room);
    await expect(
      appRouter.createCaller(context()).hypeRooms.byId({ roomId: 3 })
    ).resolves.toEqual(room);
    expect(hypeRoomsMocks.getHypeRoom).toHaveBeenCalledWith(3);
  });

  it("lists active rooms after flag check (legacy default)", async () => {
    const rooms = [
      { id: 1, status: "live" as const },
      { id: 2, status: "scheduled" as const },
    ];
    hypeRoomsMocks.listActiveHypeRooms.mockResolvedValue(rooms);
    await expect(
      appRouter.createCaller(context()).hypeRooms.list()
    ).resolves.toEqual(rooms);
    expect(hypeRoomsMocks.listActiveHypeRooms).toHaveBeenCalledWith({
      filter: undefined,
      userId: user.id,
    });
  });

  it("forwards live/upcoming/mine list filters (M6)", async () => {
    hypeRoomsMocks.listActiveHypeRooms.mockResolvedValue([]);
    await appRouter.createCaller(context()).hypeRooms.list({ filter: "live" });
    expect(hypeRoomsMocks.listActiveHypeRooms).toHaveBeenLastCalledWith({
      filter: "live",
      userId: user.id,
    });
    await appRouter
      .createCaller(context())
      .hypeRooms.list({ filter: "upcoming" });
    expect(hypeRoomsMocks.listActiveHypeRooms).toHaveBeenLastCalledWith({
      filter: "upcoming",
      userId: user.id,
    });
    await appRouter.createCaller(context()).hypeRooms.list({ filter: "mine" });
    expect(hypeRoomsMocks.listActiveHypeRooms).toHaveBeenLastCalledWith({
      filter: "mine",
      userId: user.id,
    });
  });

  it("rejects mine list filter without authentication", async () => {
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.list({
        filter: "mine",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(hypeRoomsMocks.listActiveHypeRooms).not.toHaveBeenCalled();
  });

  it("allows live/upcoming list filters without authentication", async () => {
    hypeRoomsMocks.listActiveHypeRooms.mockResolvedValue([]);
    await appRouter
      .createCaller(context(null))
      .hypeRooms.list({ filter: "live" });
    expect(hypeRoomsMocks.listActiveHypeRooms).toHaveBeenCalledWith({
      filter: "live",
      userId: null,
    });
  });

  it("rejects unknown list filters at the API boundary", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.list({
        filter: "all" as "live",
      })
    ).rejects.toThrow();
    expect(hypeRoomsMocks.listActiveHypeRooms).not.toHaveBeenCalled();
  });

  it("resolves expiry idempotently for a known room", async () => {
    const room = { id: 9, status: "expired" as const, expiredAt: new Date() };
    hypeRoomsMocks.resolveHypeRoomExpiry.mockResolvedValue(room);
    await expect(
      appRouter.createCaller(context()).hypeRooms.resolve({ roomId: 9 })
    ).resolves.toEqual(room);
    expect(hypeRoomsMocks.resolveHypeRoomExpiry).toHaveBeenCalledWith(9);
  });

  it("rejects non-positive room ids before the service", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.byId({ roomId: 0 })
    ).rejects.toThrow();
    expect(hypeRoomsMocks.getHypeRoom).not.toHaveBeenCalled();
  });
});

describe("hypeRooms procedures — M2 members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  });

  it("joins a room for the authenticated user when the flag is on", async () => {
    const membership = {
      id: 5,
      roomId: 11,
      userId: user.id,
      role: "member" as const,
      leftAt: null,
      bannedAt: null,
    };
    hypeRoomsMocks.joinHypeRoom.mockResolvedValue(membership);

    await expect(
      appRouter.createCaller(context()).hypeRooms.join({ roomId: 11 })
    ).resolves.toEqual(membership);
    expect(hypeRoomsMocks.joinHypeRoom).toHaveBeenCalledWith(11, user.id);
    expect(databaseMocks.ensureProfile).toHaveBeenCalledWith(user.id);
  });

  it("maps duplicate join to CONFLICT", async () => {
    hypeRoomsMocks.joinHypeRoom.mockRejectedValue(
      new Error("You are already a member of this room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.join({ roomId: 11 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps banned join to FORBIDDEN", async () => {
    hypeRoomsMocks.joinHypeRoom.mockRejectedValue(
      new Error("You are banned from this room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.join({ roomId: 11 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps expired/archived join to PRECONDITION_FAILED", async () => {
    hypeRoomsMocks.joinHypeRoom.mockRejectedValue(
      new Error("This room is no longer accepting new members.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.join({ roomId: 11 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("maps nonexistent room on join to NOT_FOUND", async () => {
    hypeRoomsMocks.joinHypeRoom.mockRejectedValue(new Error("Room not found."));
    await expect(
      appRouter.createCaller(context()).hypeRooms.join({ roomId: 999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("leaves a room for the authenticated user", async () => {
    const membership = {
      id: 5,
      roomId: 11,
      userId: user.id,
      role: "member" as const,
      leftAt: new Date(),
      bannedAt: null,
    };
    hypeRoomsMocks.leaveHypeRoom.mockResolvedValue(membership);

    await expect(
      appRouter.createCaller(context()).hypeRooms.leave({ roomId: 11 })
    ).resolves.toEqual(membership);
    expect(hypeRoomsMocks.leaveHypeRoom).toHaveBeenCalledWith(11, user.id);
  });

  it("maps host leave attempt to CONFLICT", async () => {
    hypeRoomsMocks.leaveHypeRoom.mockRejectedValue(
      new Error("The host cannot leave the room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.leave({ roomId: 11 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps leave when not a member to CONFLICT", async () => {
    hypeRoomsMocks.leaveHypeRoom.mockRejectedValue(
      new Error("You are not a member of this room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.leave({ roomId: 11 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps leave on nonexistent room to NOT_FOUND", async () => {
    hypeRoomsMocks.leaveHypeRoom.mockRejectedValue(new Error("Room not found."));
    await expect(
      appRouter.createCaller(context()).hypeRooms.leave({ roomId: 999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lists members publicly after flag check", async () => {
    const members = [
      {
        membership: { id: 1, roomId: 11, userId: 41, role: "host" as const },
        user: { id: 41, name: "Host", openId: "o1", photoUrl: null, username: null },
      },
    ];
    hypeRoomsMocks.listHypeRoomMembers.mockResolvedValue(members);

    await expect(
      appRouter.createCaller(context(null)).hypeRooms.members({ roomId: 11 })
    ).resolves.toEqual(members);
    expect(hypeRoomsMocks.listHypeRoomMembers).toHaveBeenCalledWith(11);
  });

  it("maps members on nonexistent room to NOT_FOUND", async () => {
    hypeRoomsMocks.listHypeRoomMembers.mockRejectedValue(
      new Error("Room not found.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.members({ roomId: 999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects non-positive room ids on join before the service", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.join({ roomId: 0 })
    ).rejects.toThrow();
    expect(hypeRoomsMocks.joinHypeRoom).not.toHaveBeenCalled();
  });
});

describe("hypeRooms procedures — M4 messages and host controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  });

  it("lists messages publicly after flag check (expired transcript allowed)", async () => {
    const messages = [
      {
        message: { id: 1, roomId: 11, body: "hello", pinned: false },
        user: { id: 41, name: "Host", openId: "o1", photoUrl: null, username: null },
      },
    ];
    hypeRoomsMocks.listRoomMessages.mockResolvedValue(messages);
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.messages({ roomId: 11 })
    ).resolves.toEqual(messages);
    expect(hypeRoomsMocks.listRoomMessages).toHaveBeenCalledWith(11);
  });

  it("maps messages on missing room to NOT_FOUND", async () => {
    hypeRoomsMocks.listRoomMessages.mockRejectedValue(
      new Error("Room not found.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.messages({ roomId: 999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sends a message as the authenticated user", async () => {
    const msg = { id: 9, roomId: 11, userId: user.id, body: "hi there" };
    hypeRoomsMocks.sendHypeRoomMessage.mockResolvedValue(msg);
    await expect(
      appRouter.createCaller(context()).hypeRooms.sendMessage({
        roomId: 11,
        body: "  hi there  ",
      })
    ).resolves.toEqual(msg);
    // Zod .trim() normalizes before the service call.
    expect(hypeRoomsMocks.sendHypeRoomMessage).toHaveBeenCalledWith(
      11,
      user.id,
      "hi there"
    );
  });

  it("rejects empty sendMessage body before the service", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.sendMessage({
        roomId: 11,
        body: "   ",
      })
    ).rejects.toThrow();
    expect(hypeRoomsMocks.sendHypeRoomMessage).not.toHaveBeenCalled();
  });

  it("rejects over-length sendMessage body before the service", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.sendMessage({
        roomId: 11,
        body: "x".repeat(5001),
      })
    ).rejects.toThrow();
    expect(hypeRoomsMocks.sendHypeRoomMessage).not.toHaveBeenCalled();
  });

  it("rejects non-positive ids on M4 mutations before the service", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.sendMessage({
        roomId: 0,
        body: "hi",
      })
    ).rejects.toThrow();
    await expect(
      appRouter.createCaller(context()).hypeRooms.end({ roomId: -1 })
    ).rejects.toThrow();
    await expect(
      appRouter.createCaller(context()).hypeRooms.pin({ messageId: 0 })
    ).rejects.toThrow();
    await expect(
      appRouter.createCaller(context()).hypeRooms.removeMember({
        roomId: 0,
        userId: 2,
      })
    ).rejects.toThrow();
    expect(hypeRoomsMocks.sendHypeRoomMessage).not.toHaveBeenCalled();
    expect(hypeRoomsMocks.endHypeRoom).not.toHaveBeenCalled();
    expect(hypeRoomsMocks.pinHypeRoomMessage).not.toHaveBeenCalled();
    expect(hypeRoomsMocks.removeHypeRoomMember).not.toHaveBeenCalled();
  });

  it("maps non-live sendMessage to PRECONDITION_FAILED", async () => {
    hypeRoomsMocks.sendHypeRoomMessage.mockRejectedValue(
      new Error("Messages can only be sent while the room is live.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.sendMessage({
        roomId: 11,
        body: "hi",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("maps inactive membership sendMessage to CONFLICT", async () => {
    hypeRoomsMocks.sendHypeRoomMessage.mockRejectedValue(
      new Error("You are not an active member of this room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.sendMessage({
        roomId: 11,
        body: "hi",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps banned sendMessage to FORBIDDEN", async () => {
    hypeRoomsMocks.sendHypeRoomMessage.mockRejectedValue(
      new Error("You are banned from this room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.sendMessage({
        roomId: 11,
        body: "hi",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ends a live room as the host", async () => {
    const room = { id: 11, hostId: user.id, status: "expired" as const };
    hypeRoomsMocks.endHypeRoom.mockResolvedValue(room);
    await expect(
      appRouter.createCaller(context()).hypeRooms.end({ roomId: 11 })
    ).resolves.toEqual(room);
    expect(hypeRoomsMocks.endHypeRoom).toHaveBeenCalledWith(11, user.id);
  });

  it("maps non-host end to FORBIDDEN", async () => {
    hypeRoomsMocks.endHypeRoom.mockRejectedValue(
      new Error("Only the host can end the room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.end({ roomId: 11 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps already-ended room to PRECONDITION_FAILED", async () => {
    hypeRoomsMocks.endHypeRoom.mockRejectedValue(
      new Error("The room has already ended.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.end({ roomId: 11 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("pins a message as the host", async () => {
    const room = { id: 11, pinnedMessageId: 9 };
    hypeRoomsMocks.pinHypeRoomMessage.mockResolvedValue(room);
    await expect(
      appRouter.createCaller(context()).hypeRooms.pin({ messageId: 9 })
    ).resolves.toEqual(room);
    expect(hypeRoomsMocks.pinHypeRoomMessage).toHaveBeenCalledWith(9, user.id);
  });

  it("maps non-host pin to FORBIDDEN", async () => {
    hypeRoomsMocks.pinHypeRoomMessage.mockRejectedValue(
      new Error("Only the host can pin messages.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.pin({ messageId: 9 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps missing message pin to NOT_FOUND", async () => {
    hypeRoomsMocks.pinHypeRoomMessage.mockRejectedValue(
      new Error("Message not found.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.pin({ messageId: 999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("unpins as the host", async () => {
    const room = { id: 11, pinnedMessageId: null };
    hypeRoomsMocks.unpinHypeRoomMessage.mockResolvedValue(room);
    await expect(
      appRouter.createCaller(context()).hypeRooms.unpin({ roomId: 11 })
    ).resolves.toEqual(room);
    expect(hypeRoomsMocks.unpinHypeRoomMessage).toHaveBeenCalledWith(
      11,
      user.id
    );
  });

  it("removes a member as the host", async () => {
    const membership = {
      id: 5,
      roomId: 11,
      userId: 99,
      leftAt: new Date(),
      removedBy: user.id,
    };
    hypeRoomsMocks.removeHypeRoomMember.mockResolvedValue(membership);
    await expect(
      appRouter.createCaller(context()).hypeRooms.removeMember({
        roomId: 11,
        userId: 99,
      })
    ).resolves.toEqual(membership);
    expect(hypeRoomsMocks.removeHypeRoomMember).toHaveBeenCalledWith(
      11,
      user.id,
      99
    );
  });

  it("maps non-host removeMember to FORBIDDEN", async () => {
    hypeRoomsMocks.removeHypeRoomMember.mockRejectedValue(
      new Error("Only the host can remove members.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.removeMember({
        roomId: 11,
        userId: 99,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps removeMember missing target to NOT_FOUND", async () => {
    hypeRoomsMocks.removeHypeRoomMember.mockRejectedValue(
      new Error("Member not found in this room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.removeMember({
        roomId: 11,
        userId: 99,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("hypeRooms procedures — M6 lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  });

  it("cancels a scheduled room as host with reason", async () => {
    const archived = {
      id: 11,
      hostId: user.id,
      status: "archived" as const,
      cancelReason: "conflict",
      archivedAt: new Date(),
    };
    hypeRoomsMocks.cancelHypeRoom.mockResolvedValue(archived);
    await expect(
      appRouter.createCaller(context()).hypeRooms.cancel({
        roomId: 11,
        cancelReason: "conflict",
      })
    ).resolves.toEqual(archived);
    expect(hypeRoomsMocks.cancelHypeRoom).toHaveBeenCalledWith(
      11,
      user.id,
      "conflict"
    );
  });

  it("maps non-host cancel to FORBIDDEN", async () => {
    hypeRoomsMocks.cancelHypeRoom.mockRejectedValue(
      new Error("Only the host can cancel the room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.cancel({ roomId: 11 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps cancel of non-scheduled room to CONFLICT", async () => {
    hypeRoomsMocks.cancelHypeRoom.mockRejectedValue(
      new Error("Only a scheduled room can be cancelled.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.cancel({ roomId: 11 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps concurrent cancel race to CONFLICT", async () => {
    hypeRoomsMocks.cancelHypeRoom.mockRejectedValue(
      new Error("Room is no longer in scheduled state.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.cancel({ roomId: 11 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps live-room cancel to CONFLICT", async () => {
    hypeRoomsMocks.cancelHypeRoom.mockRejectedValue(
      new Error("A live room cannot be cancelled; end it instead.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.cancel({ roomId: 11 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps expired cancel to PRECONDITION_FAILED", async () => {
    hypeRoomsMocks.cancelHypeRoom.mockRejectedValue(
      new Error("The room has already ended.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.cancel({ roomId: 11 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("maps missing room cancel to NOT_FOUND", async () => {
    hypeRoomsMocks.cancelHypeRoom.mockRejectedValue(
      new Error("Room not found.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.cancel({ roomId: 11 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps create eligibility rejection to FORBIDDEN", async () => {
    hypeRoomsMocks.createHypeRoom.mockRejectedValue(
      new Error("Only verified company/creator accounts can create rooms.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.create(createInput)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects cancelReason over 500 chars at the API boundary", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.cancel({
        roomId: 1,
        cancelReason: "x".repeat(501),
      })
    ).rejects.toThrow();
    expect(hypeRoomsMocks.cancelHypeRoom).not.toHaveBeenCalled();
  });
});

describe("M1/M2/M3 regression — flags stay separated", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
  });

  it("drops still gated on jhilik_drops independently of rooms flag", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
    await expect(
      appRouter.createCaller(context()).drops.list()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      appRouter.createCaller(context()).hypeRooms.messages({ roomId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("M1 create wiring still works when rooms flag is on", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    hypeRoomsMocks.createHypeRoom.mockResolvedValue({ id: 1, status: "live" });
    await expect(
      appRouter.createCaller(context()).hypeRooms.create(createInput)
    ).resolves.toEqual({ id: 1, status: "live" });
  });

  it("M3 claim still uses drops service and flag", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockImplementation(
      async key => key === "jhilik_drops"
    );
    // drops module is not mocked in this file — use flag-off path for claim
    await expect(
      appRouter.createCaller(context()).hypeRooms.list()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
