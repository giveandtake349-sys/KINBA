/**
 * Phase 2 M3 — drops procedures: flag fail-closed, auth, Zod, service wiring.
 * Pure lifecycle/validation/eligibility/idempotency live in dropsLifecycle.test.ts.
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
  ROOM_DURATION_HOURS: [4, 6, 12, 24],
  ROOM_MAX_LEAD_MS: 7 * 24 * 60 * 60 * 1000,
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
  validateDropOffer: vi.fn(),
  resolveDropLifecycle: vi.fn(),
  assertDropTransition: vi.fn(),
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

import { appRouter } from "./routers";

const user = {
  id: 41,
  openId: "kinba-drops-user",
  name: "KINBA Drop Claimer",
  email: "claimer@example.test",
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

const draftInput = {
  title: "Limited sneaker drop",
  description: "First 50 pairs at launch pricing",
  terms: "Claim interest only; no online payment.",
  mediaUrl: "https://cdn.example.test/drops/sneaker.jpg",
  originalPrice: "120.00",
  discountedPrice: "99.50",
  quantity: 50,
};

const claimInput = { dropId: 7 };

describe("drops procedures — feature flag fail-closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
  });

  it("rejects list when jhilik_drops is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).drops.list()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dropsMocks.listDrops).not.toHaveBeenCalled();
    expect(featureFlagMocks.isFeatureFlagEnabled).toHaveBeenCalledWith(
      "jhilik_drops"
    );
  });

  it("rejects byId when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).drops.byId({ dropId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dropsMocks.getDrop).not.toHaveBeenCalled();
  });

  it("rejects claim when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).drops.claim(claimInput)
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dropsMocks.claimDrop).not.toHaveBeenCalled();
  });

  it("rejects myClaim when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).drops.myClaim(claimInput)
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dropsMocks.getMyClaim).not.toHaveBeenCalled();
  });

  it("rejects saveDraft when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).drops.saveDraft(draftInput)
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dropsMocks.saveDraftDrop).not.toHaveBeenCalled();
  });

  it("rejects publish when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).drops.publish({ dropId: 3 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dropsMocks.publishDrop).not.toHaveBeenCalled();
  });

  it("rejects schedule when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).drops.schedule({ dropId: 3 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dropsMocks.scheduleDrop).not.toHaveBeenCalled();
  });

  it("rejects end when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).drops.end({ dropId: 3 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dropsMocks.endDrop).not.toHaveBeenCalled();
  });

  it("rejects claims when the flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context()).drops.claims({ dropId: 3 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(dropsMocks.assertDropOwner).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated claim even if flag checks were skipped", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).drops.claim(claimInput)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(dropsMocks.claimDrop).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated saveDraft even if flag checks were skipped", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).drops.saveDraft(draftInput)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(dropsMocks.saveDraftDrop).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated myClaim even if flag checks were skipped", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).drops.myClaim(claimInput)
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(dropsMocks.getMyClaim).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated end even if flag checks were skipped", async () => {
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    await expect(
      appRouter.createCaller(context(null)).drops.end({ dropId: 3 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(dropsMocks.endDrop).not.toHaveBeenCalled();
  });
});

describe("drops procedures — enabled flag wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  });

  it("lists drops for a public caller", async () => {
    const payload = { drops: [{ id: 1 }], serverNow: new Date() };
    dropsMocks.listDrops.mockResolvedValue(payload);
    await expect(
      appRouter.createCaller(context()).drops.list()
    ).resolves.toEqual(payload);
    expect(dropsMocks.listDrops).toHaveBeenCalledWith({
      filter: "live",
      userId: user.id,
      limit: undefined,
    });
  });

  it("returns NOT_FOUND when byId misses", async () => {
    dropsMocks.getDrop.mockResolvedValue(null);
    await expect(
      appRouter.createCaller(context()).drops.byId({ dropId: 99 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns a drop from byId after flag check", async () => {
    const drop = { id: 3, status: "live" as const };
    dropsMocks.getDrop.mockResolvedValue(drop);
    const result = await appRouter.createCaller(context()).drops.byId({
      dropId: 3,
    });
    expect(result.drop).toEqual(drop);
    expect(result.serverNow).toBeInstanceOf(Date);
    expect(dropsMocks.getDrop).toHaveBeenCalledWith(3);
  });

  it("creates a draft for the authenticated eligible seller", async () => {
    const row = { id: 12, status: "draft" as const, sellerId: user.id };
    dropsMocks.saveDraftDrop.mockResolvedValue(row);
    await expect(
      appRouter.createCaller(context()).drops.saveDraft(draftInput)
    ).resolves.toEqual(row);
    expect(dropsMocks.saveDraftDrop).toHaveBeenCalledWith(user.id, draftInput);
    expect(databaseMocks.ensureProfile).toHaveBeenCalledWith(user.id);
  });

  it("rejects invalid Zod price before the service", async () => {
    await expect(
      appRouter.createCaller(context()).drops.saveDraft({
        ...draftInput,
        discountedPrice: "not-a-price",
      })
    ).rejects.toThrow();
    expect(dropsMocks.saveDraftDrop).not.toHaveBeenCalled();
  });

  it("rejects non-positive quantity before the service", async () => {
    await expect(
      appRouter.createCaller(context()).drops.saveDraft({
        ...draftInput,
        quantity: 0,
      })
    ).rejects.toThrow();
    expect(dropsMocks.saveDraftDrop).not.toHaveBeenCalled();
  });

  it("rejects non-positive dropId before the service", async () => {
    await expect(
      appRouter.createCaller(context()).drops.byId({ dropId: 0 })
    ).rejects.toThrow();
    await expect(
      appRouter.createCaller(context()).drops.byId({ dropId: -3 })
    ).rejects.toThrow();
    expect(dropsMocks.getDrop).not.toHaveBeenCalled();
  });

  it("claims a live drop as the authenticated user (no room membership input)", async () => {
    const result = {
      claim: { id: 1, dropId: 7, userId: user.id, status: "claimed" },
      drop: { id: 7, status: "live", remainingQuantity: 4 },
      created: true,
      serverNow: new Date(),
    };
    dropsMocks.claimDrop.mockResolvedValue(result);
    await expect(
      appRouter.createCaller(context()).drops.claim({
        dropId: 7,
        idempotencyKey: "claim:7:41",
      })
    ).resolves.toEqual(result);
    expect(dropsMocks.claimDrop).toHaveBeenCalledWith(
      7,
      user.id,
      "claim:7:41"
    );
  });

  it("maps service sold-out claim to CONFLICT", async () => {
    dropsMocks.claimDrop.mockRejectedValue(
      new Error("This drop is sold out.")
    );
    await expect(
      appRouter.createCaller(context()).drops.claim(claimInput)
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("maps service not-live claim to PRECONDITION_FAILED", async () => {
    dropsMocks.claimDrop.mockRejectedValue(
      new Error("This drop is not live yet.")
    );
    await expect(
      appRouter.createCaller(context()).drops.claim(claimInput)
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("maps service drop not found to NOT_FOUND", async () => {
    dropsMocks.claimDrop.mockRejectedValue(new Error("Drop not found."));
    await expect(
      appRouter.createCaller(context()).drops.claim(claimInput)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("returns myClaim for the authenticated user", async () => {
    const claim = { id: 5, dropId: 7, userId: user.id };
    dropsMocks.getMyClaim.mockResolvedValue(claim);
    await expect(
      appRouter.createCaller(context()).drops.myClaim({ dropId: 7 })
    ).resolves.toEqual(claim);
    expect(dropsMocks.getMyClaim).toHaveBeenCalledWith(7, user.id);
  });

  it("publishes a drop owner-only via service", async () => {
    const drop = { id: 3, status: "live" as const };
    dropsMocks.publishDrop.mockResolvedValue(drop);
    await expect(
      appRouter.createCaller(context()).drops.publish({
        dropId: 3,
        mode: "publish",
      })
    ).resolves.toEqual(drop);
    expect(dropsMocks.publishDrop).toHaveBeenCalledWith(user.id, {
      dropId: 3,
      mode: "publish",
    });
  });

  it("maps non-owner publish to FORBIDDEN", async () => {
    dropsMocks.publishDrop.mockRejectedValue(
      new Error("You do not own this drop.")
    );
    await expect(
      appRouter.createCaller(context()).drops.publish({ dropId: 3 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("maps ineligible seller saveDraft to FORBIDDEN", async () => {
    dropsMocks.saveDraftDrop.mockRejectedValue(
      new Error("Only eligible sellers can manage drops")
    );
    await expect(
      appRouter.createCaller(context()).drops.saveDraft(draftInput)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ends a drop via service", async () => {
    const drop = { id: 3, status: "ended" as const };
    dropsMocks.endDrop.mockResolvedValue(drop);
    await expect(
      appRouter.createCaller(context()).drops.end({ dropId: 3 })
    ).resolves.toEqual(drop);
    expect(dropsMocks.endDrop).toHaveBeenCalledWith(user.id, 3);
  });

  it("lists claims only after owner assertion", async () => {
    const claims = [{ id: 1 }];
    dropsMocks.assertDropOwner.mockResolvedValue({ id: 3 });
    dropsMocks.listDropClaims.mockResolvedValue(claims);
    await expect(
      appRouter.createCaller(context()).drops.claims({ dropId: 3 })
    ).resolves.toEqual(claims);
    expect(dropsMocks.assertDropOwner).toHaveBeenCalledWith(3, user.id);
    expect(dropsMocks.listDropClaims).toHaveBeenCalledWith(3);
  });

  it("maps claims non-owner to FORBIDDEN and skips list", async () => {
    dropsMocks.assertDropOwner.mockRejectedValue(
      new Error("You do not own this drop.")
    );
    await expect(
      appRouter.createCaller(context()).drops.claims({ dropId: 3 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(dropsMocks.listDropClaims).not.toHaveBeenCalled();
  });

  it("does not require room membership input on claim", async () => {
    dropsMocks.claimDrop.mockResolvedValue({
      claim: {},
      drop: {},
      created: true,
      serverNow: new Date(),
    });
    await appRouter.createCaller(context()).drops.claim({ dropId: 7 });
    const [dropId, userId] = dropsMocks.claimDrop.mock.calls[0]!;
    expect(dropId).toBe(7);
    expect(userId).toBe(user.id);
    expect(dropsMocks.claimDrop.mock.calls[0]!.length).toBe(3);
  });
});

describe("M1/M2 regression — hypeRooms still gated on time_limited_communities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
  });

  it("hypeRooms.create still fails closed", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.create({
        title: "Weekend flash room",
        durationHours: 6,
        visibility: "public",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.createHypeRoom).not.toHaveBeenCalled();
    expect(featureFlagMocks.isFeatureFlagEnabled).toHaveBeenCalledWith(
      "time_limited_communities"
    );
  });

  it("hypeRooms.join still fails closed", async () => {
    await expect(
      appRouter.createCaller(context()).hypeRooms.join({ roomId: 1 })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(hypeRoomsMocks.joinHypeRoom).not.toHaveBeenCalled();
  });

  it("does not conflate drops flag with rooms flag", async () => {
    // drops ON, rooms OFF → hypeRooms still blocked
    featureFlagMocks.isFeatureFlagEnabled.mockImplementation(async key =>
      key === "jhilik_drops"
    );
    dropsMocks.listDrops.mockResolvedValue({ drops: [], serverNow: new Date() });
    await expect(
      appRouter.createCaller(context()).hypeRooms.list()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(
      appRouter.createCaller(context()).drops.list()
    ).resolves.toMatchObject({ drops: [] });
  });
});
