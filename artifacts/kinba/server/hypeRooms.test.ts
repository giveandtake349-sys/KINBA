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
  isValidDurationHours: vi.fn(),
  assertValidDurationHours: vi.fn(),
  computeEndsAt: vi.fn(),
  normalizeStartsAt: vi.fn(),
  resolveRoomLifecycle: vi.fn(),
  assertRoomTransition: vi.fn(),
  ROOM_DURATION_HOURS: [4, 6, 12, 24],
  ROOM_MAX_LEAD_MS: 7 * 24 * 60 * 60 * 1000,
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

  it("lists active rooms after flag check", async () => {
    const rooms = [
      { id: 1, status: "live" as const },
      { id: 2, status: "scheduled" as const },
    ];
    hypeRoomsMocks.listActiveHypeRooms.mockResolvedValue(rooms);
    await expect(
      appRouter.createCaller(context()).hypeRooms.list()
    ).resolves.toEqual(rooms);
    expect(hypeRoomsMocks.listActiveHypeRooms).toHaveBeenCalled();
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
