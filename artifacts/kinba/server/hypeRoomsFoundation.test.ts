/**
 * M-A1 + M-A2 — Hype Room professional foundation (chat depth, roles,
 * settings, invites). Flag fail-closed + service wiring + pure validators.
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

import { appRouter } from "./routers";

const user = {
  id: 41,
  openId: "kinba-m-a1-user",
  name: "M-A1 User",
  email: "ma1@example.test",
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

describe("M-A1/M-A2 — feature flag fail-closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
  });

  const protectedCalls: Array<[string, (c: ReturnType<typeof appRouter.createCaller>) => unknown]> = [
    ["toggleReaction", c =>
      c.hypeRooms.toggleReaction({
        roomId: 1,
        messageId: 1,
        reaction: "like",
      })],
    ["setMemberRole", c =>
      c.hypeRooms.setMemberRole({ roomId: 1, userId: 2, role: "speaker" })],
    ["updateSettings", c =>
      c.hypeRooms.updateSettings({ roomId: 1, title: "New title room" })],
    ["createInvite", c =>
      c.hypeRooms.createInvite({ roomId: 1, invitedUserId: 2 })],
    ["acceptInvite", c => c.hypeRooms.acceptInvite({ inviteId: 1 })],
  ];

  for (const [name, call] of protectedCalls) {
    it(`rejects ${name} when time_limited_communities is disabled`, async () => {
      const caller = appRouter.createCaller(context());
      await expect(call(caller)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(featureFlagMocks.isFeatureFlagEnabled).toHaveBeenCalledWith(
        "time_limited_communities"
      );
    });
  }

  it("rejects listInvites when flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.listInvites({ roomId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.listHypeRoomInvites).not.toHaveBeenCalled();
  });

  it("rejects listMyInvites when flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.listMyInvites()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.listMyHypeRoomInvites).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated new mutations", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.toggleReaction({
        roomId: 1,
        messageId: 1,
        reaction: "like",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.setMemberRole({
        roomId: 1,
        userId: 2,
        role: "speaker",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.updateSettings({
        roomId: 1,
        title: "Nope room",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      appRouter.createCaller(context(null)).hypeRooms.createInvite({
        roomId: 1,
        invitedUserId: 2,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(hypeRoomsMocks.toggleHypeRoomMessageReaction).not.toHaveBeenCalled();
  });
});

describe("M-A1/M-A2 — procedure wiring (flag ON)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  });

  it("sendMessage passes parentId and mentions through", async () => {
    const msg = { id: 9, roomId: 11, parentId: 3, body: "reply" };
    hypeRoomsMocks.sendHypeRoomMessage.mockResolvedValue(msg);
    await expect(
      appRouter.createCaller(context()).hypeRooms.sendMessage({
        roomId: 11,
        body: "reply",
        parentId: 3,
        mentionedUserIds: [41, 41, 42],
      })
    ).resolves.toEqual(msg);
    expect(hypeRoomsMocks.sendHypeRoomMessage).toHaveBeenCalledWith(
      11,
      user.id,
      "reply",
      { parentId: 3, mentionedUserIds: [41, 41, 42] }
    );
  });

  it("rejects invalid reaction type at the API boundary", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.toggleReaction({
        roomId: 1,
        messageId: 1,
        reaction: "nope" as never,
      })
    ).rejects.toThrow();
    expect(hypeRoomsMocks.toggleHypeRoomMessageReaction).not.toHaveBeenCalled();
  });

  it("wires toggleReaction to the service", async () => {
    const result = { messageId: 9, reaction: "like" as const, active: true };
    hypeRoomsMocks.toggleHypeRoomMessageReaction.mockResolvedValue(result);
    await expect(
      appRouter.createCaller(context()).hypeRooms.toggleReaction({
        roomId: 11,
        messageId: 9,
        reaction: "like",
      })
    ).resolves.toEqual(result);
    expect(hypeRoomsMocks.toggleHypeRoomMessageReaction).toHaveBeenCalledWith(
      11,
      user.id,
      9,
      "like"
    );
  });

  it("maps inactive member reaction to CONFLICT", async () => {
    hypeRoomsMocks.toggleHypeRoomMessageReaction.mockRejectedValue(
      new Error("You are not an active member of this room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.toggleReaction({
        roomId: 11,
        messageId: 9,
        reaction: "like",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps banned reaction to FORBIDDEN", async () => {
    hypeRoomsMocks.toggleHypeRoomMessageReaction.mockRejectedValue(
      new Error("You are banned from this room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.toggleReaction({
        roomId: 11,
        messageId: 9,
        reaction: "fire",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps cross-room reply parent to BAD_REQUEST", async () => {
    hypeRoomsMocks.sendHypeRoomMessage.mockRejectedValue(
      new Error("Reply target is not in this room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.sendMessage({
        roomId: 11,
        body: "x",
        parentId: 99,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("maps non-member mention to BAD_REQUEST", async () => {
    hypeRoomsMocks.sendHypeRoomMessage.mockRejectedValue(
      new Error("You can only mention active members of this room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.sendMessage({
        roomId: 11,
        body: "hi @x",
        mentionedUserIds: [999],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects setMemberRole role outside speaker/audience", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.setMemberRole({
        roomId: 1,
        userId: 2,
        role: "host" as never,
      })
    ).rejects.toThrow();
    expect(hypeRoomsMocks.setHypeRoomMemberRole).not.toHaveBeenCalled();
  });

  it("wires setMemberRole and maps non-host to FORBIDDEN", async () => {
    hypeRoomsMocks.setHypeRoomMemberRole.mockRejectedValue(
      new Error("Only the host can change member roles.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.setMemberRole({
        roomId: 11,
        userId: 42,
        role: "speaker",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(hypeRoomsMocks.setHypeRoomMemberRole).toHaveBeenCalledWith(
      11,
      user.id,
      42,
      "speaker"
    );
  });

  it("maps host demotion attempt to FORBIDDEN", async () => {
    hypeRoomsMocks.setHypeRoomMemberRole.mockRejectedValue(
      new Error("The host role cannot be changed.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.setMemberRole({
        roomId: 11,
        userId: user.id,
        role: "audience",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("wires updateSettings without host/lifecycle fields", async () => {
    const room = { id: 11, title: "Updated" };
    hypeRoomsMocks.updateHypeRoomSettings.mockResolvedValue(room);
    await expect(
      appRouter.createCaller(context()).hypeRooms.updateSettings({
        roomId: 11,
        title: "Updated title",
        topic: "t",
        description: null,
        visibility: "link_only",
        hostId: 999,
        status: "expired",
        startsAt: "nope",
      } as never)
    ).resolves.toEqual(room);
    expect(hypeRoomsMocks.updateHypeRoomSettings).toHaveBeenCalledWith(
      11,
      user.id,
      {
        title: "Updated title",
        topic: "t",
        description: null,
        visibility: "link_only",
      }
    );
  });

  it("rejects over-long settings title at the API boundary", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.updateSettings({
        roomId: 1,
        title: "x".repeat(181),
      })
    ).rejects.toThrow();
    expect(hypeRoomsMocks.updateHypeRoomSettings).not.toHaveBeenCalled();
  });

  it("maps non-host settings update to FORBIDDEN", async () => {
    hypeRoomsMocks.updateHypeRoomSettings.mockRejectedValue(
      new Error("Only the host can update room settings.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.updateSettings({
        roomId: 11,
        title: "New title here",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps immutable room settings to CONFLICT", async () => {
    hypeRoomsMocks.updateHypeRoomSettings.mockRejectedValue(
      new Error("This room can no longer be edited.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.updateSettings({
        roomId: 11,
        title: "New title here",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("wires createInvite", async () => {
    const invite = { id: 5, roomId: 11, invitedUserId: 42, status: "pending" };
    hypeRoomsMocks.createHypeRoomInvite.mockResolvedValue(invite);
    await expect(
      appRouter.createCaller(context()).hypeRooms.createInvite({
        roomId: 11,
        invitedUserId: 42,
      })
    ).resolves.toEqual(invite);
    expect(hypeRoomsMocks.createHypeRoomInvite).toHaveBeenCalledWith(
      11,
      user.id,
      42
    );
  });

  it("maps non-host invite create to FORBIDDEN", async () => {
    hypeRoomsMocks.createHypeRoomInvite.mockRejectedValue(
      new Error("Only the host can create invites.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.createInvite({
        roomId: 11,
        invitedUserId: 42,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps duplicate pending invite to CONFLICT", async () => {
    hypeRoomsMocks.createHypeRoomInvite.mockRejectedValue(
      new Error("An invite is already pending for this user.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.createInvite({
        roomId: 11,
        invitedUserId: 42,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps banned invite target to FORBIDDEN", async () => {
    hypeRoomsMocks.createHypeRoomInvite.mockRejectedValue(
      new Error("You are banned from this room.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.createInvite({
        roomId: 11,
        invitedUserId: 42,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("wires acceptInvite", async () => {
    const payload = { invite: { id: 5, status: "accepted" }, membership: {} };
    hypeRoomsMocks.acceptHypeRoomInvite.mockResolvedValue(payload);
    await expect(
      appRouter.createCaller(context()).hypeRooms.acceptInvite({ inviteId: 5 })
    ).resolves.toEqual(payload);
    expect(hypeRoomsMocks.acceptHypeRoomInvite).toHaveBeenCalledWith(
      5,
      user.id
    );
  });

  it("maps replayed invite to CONFLICT", async () => {
    hypeRoomsMocks.acceptHypeRoomInvite.mockRejectedValue(
      new Error("This invite is no longer valid.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.acceptInvite({ inviteId: 5 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps foreign invite to FORBIDDEN", async () => {
    hypeRoomsMocks.acceptHypeRoomInvite.mockRejectedValue(
      new Error("This invite was not created for you.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.acceptInvite({ inviteId: 5 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps missing invite to NOT_FOUND", async () => {
    hypeRoomsMocks.acceptHypeRoomInvite.mockRejectedValue(
      new Error("Invite not found.")
    );
    await expect(
      appRouter.createCaller(context()).hypeRooms.acceptInvite({ inviteId: 999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("wires listInvites and listMyInvites", async () => {
    hypeRoomsMocks.listHypeRoomInvites.mockResolvedValue([]);
    hypeRoomsMocks.listMyHypeRoomInvites.mockResolvedValue([]);
    const caller = appRouter.createCaller(context());
    await expect(
      caller.hypeRooms.listInvites({ roomId: 11 })
    ).resolves.toEqual([]);
    await expect(caller.hypeRooms.listMyInvites()).resolves.toEqual([]);
    expect(hypeRoomsMocks.listHypeRoomInvites).toHaveBeenCalledWith(
      11,
      user.id
    );
    expect(hypeRoomsMocks.listMyHypeRoomInvites).toHaveBeenCalledWith(user.id);
  });

  it("rejects non-positive ids on new mutations before the service", async () => {
    const caller = appRouter.createCaller(context());
    await expect(
      caller.hypeRooms.toggleReaction({
        roomId: 0,
        messageId: 1,
        reaction: "like",
      })
    ).rejects.toThrow();
    await expect(
      caller.hypeRooms.setMemberRole({ roomId: 1, userId: 0, role: "speaker" })
    ).rejects.toThrow();
    await expect(
      caller.hypeRooms.createInvite({ roomId: 1, invitedUserId: 0 })
    ).rejects.toThrow();
    await expect(
      caller.hypeRooms.acceptInvite({ inviteId: 0 })
    ).rejects.toThrow();
    expect(hypeRoomsMocks.toggleHypeRoomMessageReaction).not.toHaveBeenCalled();
    expect(hypeRoomsMocks.setHypeRoomMemberRole).not.toHaveBeenCalled();
    expect(hypeRoomsMocks.createHypeRoomInvite).not.toHaveBeenCalled();
    expect(hypeRoomsMocks.acceptHypeRoomInvite).not.toHaveBeenCalled();
  });
});
