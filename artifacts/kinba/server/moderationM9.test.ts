/**
 * Phase 2 M9 — moderation reports + admin queue/resolve + message soft-hide.
 * Covers adminProcedure/protected auth, moderation_v1 fail-closed, service
 * validation (E7/E12), resolve/hide audit writes, and error mapping.
 * Real moderation service under test; db/flags/notifications mocked.
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

import { appRouter } from "./routers";
import {
  MODERATION_ACTIONS,
  MODERATION_TARGET_TYPES,
} from "./moderation";

const user = {
  id: 41,
  openId: "kinba-m9-user",
  name: "KINBA M9 User",
  email: "m9@example.test",
  loginMethod: "email",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const adminUser = { ...user, role: "admin" as const, id: 77 };

function context(activeUser: typeof user | null = user): TrpcContext {
  return {
    user: activeUser,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const past = new Date("2026-09-23T06:00:00.000Z");

function baseReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    reporterId: 41,
    targetType: "hype_room",
    targetId: 11,
    reason: "spam",
    details: null,
    status: "open",
    resolvedAt: null,
    resolvedBy: null,
    createdAt: past,
    ...overrides,
  };
}

function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    roomId: 11,
    userId: 41,
    body: "hello",
    audioUrl: null,
    audioDuration: null,
    pinned: false,
    createdAt: past,
    moderatedAt: null,
    moderatedBy: null,
    hiddenAt: null,
    ...overrides,
  };
}

describe("M9 authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
  });

  const adminOps: Array<
    [string, (c: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>]
  > = [
    ["reports.list", c => c.admin.reports.list()],
    [
      "reports.resolve",
      c => c.admin.reports.resolve({ reportId: 1, reason: "ok" }),
    ],
    [
      "messages.hide",
      c => c.admin.messages.hide({ messageId: 1, reason: "ok" }),
    ],
  ];

  for (const [name, run] of adminOps) {
    it(`rejects unauthenticated admin.${name}`, async () => {
      await expect(run(appRouter.createCaller(context(null)))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it(`rejects non-admin admin.${name}`, async () => {
      await expect(run(appRouter.createCaller(context(user)))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  }

  it("rejects unauthenticated reports.create", async () => {
    await expect(
      appRouter.createCaller(context(null)).reports.create({
        targetType: "user",
        targetId: 2,
        reason: "abuse",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("normal user cannot access admin queue", async () => {
    await expect(
      appRouter.createCaller(context(user)).admin.reports.list()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin passes adminProcedure for reports.list", async () => {
    const sequenced = {
      select: vi.fn(() => chain([])),
      update: vi.fn(() => chain([])),
      insert: vi.fn(() => chain([])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          select: sequenced.select,
          update: sequenced.update,
          insert: sequenced.insert,
        })
      ),
    };
    databaseMocks.getDb.mockResolvedValue(sequenced);
    await expect(
      appRouter.createCaller(context(adminUser)).admin.reports.list()
    ).resolves.toEqual({ reports: [], serverNow: expect.any(Date) });
  });
});

describe("M9 moderation_v1 fail-closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(false);
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
  });

  it("rejects reports.create when flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context(user)).reports.create({
        targetType: "drop",
        targetId: 1,
        reason: "scam",
      })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "This feature is currently disabled.",
    });
  });

  it("rejects admin.reports.list when flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context(adminUser)).admin.reports.list()
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects admin.messages.hide when flag is disabled", async () => {
    await expect(
      appRouter.createCaller(context(adminUser)).admin.messages.hide({
        messageId: 1,
        reason: "x",
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("M9 canonical target types (E7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
  });

  it("exposes exactly the four bound target types", () => {
    expect([...MODERATION_TARGET_TYPES].sort()).toEqual(
      ["drop", "hype_room", "hype_room_message", "user"].sort()
    );
    expect(MODERATION_TARGET_TYPES).not.toContain("message");
    expect(MODERATION_TARGET_TYPES).not.toContain("video");
  });

  it("rejects plain message targetType at zod boundary", async () => {
    await expect(
      appRouter.createCaller(context(user)).reports.create({
        // @ts-expect-error invalid target type
        targetType: "message",
        targetId: 1,
        reason: "x",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("M9 reports.create service behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
  });

  it("creates an open report for an existing room target", async () => {
    let n = 0;
    const sequenced = {
      select: vi.fn(() => {
        n += 1;
        return chain(n === 1 ? [{ id: 11 }] : []);
      }),
      update: vi.fn(() => chain([])),
      insert: vi.fn(() => chain([baseReport({ status: "open" })])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          select: sequenced.select,
          update: sequenced.update,
          insert: sequenced.insert,
        })
      ),
    };
    databaseMocks.getDb.mockResolvedValue(sequenced);

    const created = await appRouter
      .createCaller(context(user))
      .reports.create({
        targetType: "hype_room",
        targetId: 11,
        reason: "spam room",
        details: "ads",
      });
    expect(created.status).toBe("open");
    expect(sequenced.insert).toHaveBeenCalled();
  });

  it("rejects self-report when targetType is user (E12)", async () => {
    await expect(
      appRouter.createCaller(context(user)).reports.create({
        targetType: "user",
        targetId: user.id,
        reason: "abuse",
      })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "You cannot report yourself.",
    });
  });

  it("rejects duplicate open report for same reporter+target (E12)", async () => {
    let n = 0;
    const sequenced = {
      select: vi.fn(() => {
        n += 1;
        // 1) target exists, 2) duplicate open found
        return chain(n === 1 ? [{ id: 11 }] : [{ id: 3 }]);
      }),
      update: vi.fn(() => chain([])),
      insert: vi.fn(() => chain([])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          select: sequenced.select,
          update: sequenced.update,
          insert: sequenced.insert,
        })
      ),
    };
    databaseMocks.getDb.mockResolvedValue(sequenced);

    await expect(
      appRouter.createCaller(context(user)).reports.create({
        targetType: "hype_room",
        targetId: 11,
        reason: "again",
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "You already have an open report for this target.",
    });
    expect(sequenced.insert).not.toHaveBeenCalled();
  });

  it("rejects unknown target with NOT_FOUND", async () => {
    let n = 0;
    const sequenced = {
      select: vi.fn(() => {
        n += 1;
        return chain([]);
      }),
      update: vi.fn(() => chain([])),
      insert: vi.fn(() => chain([])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          select: sequenced.select,
          update: sequenced.update,
          insert: sequenced.insert,
        })
      ),
    };
    databaseMocks.getDb.mockResolvedValue(sequenced);

    await expect(
      appRouter.createCaller(context(user)).reports.create({
        targetType: "drop",
        targetId: 999,
        reason: "missing",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects empty reason at zod boundary", async () => {
    await expect(
      appRouter.createCaller(context(user)).reports.create({
        targetType: "user",
        targetId: 2,
        reason: "   ",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("M9 admin report resolve + audit (E10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
  });

  it("resolves open report and inserts report_resolved audit row", async () => {
    const insertCalls: unknown[] = [];
    const sequenced = {
      select: vi.fn(() => chain([baseReport()])),
      update: vi.fn(() => chain([baseReport({ status: "resolved", resolvedBy: adminUser.id })])),
      insert: vi.fn(() => {
        const c = chain([{}]);
        const valuesFn = c.values as ReturnType<typeof vi.fn>;
        valuesFn.mockImplementation((values: unknown) => {
          insertCalls.push(values);
          return c;
        });
        return c;
      }),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          select: sequenced.select,
          update: sequenced.update,
          insert: sequenced.insert,
        })
      ),
    };
    databaseMocks.getDb.mockResolvedValue(sequenced);

    const resolved = await appRouter
      .createCaller(context(adminUser))
      .admin.reports.resolve({ reportId: 5, reason: "handled" });
    expect(resolved.status).toBe("resolved");
    expect(insertCalls).toHaveLength(1);
    const audit = insertCalls[0] as Record<string, unknown>;
    expect(audit.action).toBe(MODERATION_ACTIONS.reportResolved);
    expect(audit.adminId).toBe(adminUser.id);
    expect(audit.targetType).toBe("hype_room");
    expect(audit.targetId).toBe(11);
    expect(audit.reason).toBe("handled");
    expect(audit.metadata).toEqual({ reportId: 5 });
  });

  it("rejects resolving a missing report", async () => {
    const sequenced = {
      select: vi.fn(() => chain([])),
      update: vi.fn(() => chain([])),
      insert: vi.fn(() => chain([])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          select: sequenced.select,
          update: sequenced.update,
          insert: sequenced.insert,
        })
      ),
    };
    databaseMocks.getDb.mockResolvedValue(sequenced);

    await expect(
      appRouter.createCaller(context(adminUser)).admin.reports.resolve({
        reportId: 999,
        reason: "x",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects resolving a non-open report", async () => {
    const sequenced = {
      select: vi.fn(() => chain([baseReport({ status: "resolved" })])),
      update: vi.fn(() => chain([])),
      insert: vi.fn(() => chain([])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          select: sequenced.select,
          update: sequenced.update,
          insert: sequenced.insert,
        })
      ),
    };
    databaseMocks.getDb.mockResolvedValue(sequenced);

    await expect(
      appRouter.createCaller(context(adminUser)).admin.reports.resolve({
        reportId: 5,
        reason: "x",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects empty resolve reason at zod boundary", async () => {
    await expect(
      appRouter.createCaller(context(adminUser)).admin.reports.resolve({
        reportId: 1,
        reason: " ",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("M9 admin message soft-hide + audit (E11)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
  });

  it("soft-hides message using hiddenAt/moderatedAt/moderatedBy and audits", async () => {
    const insertCalls: unknown[] = [];
    const updateSet: Array<Record<string, unknown>> = [];
    const sequenced = {
      select: vi.fn(() => chain([baseMessage()])),
      update: vi.fn(() => {
        const c = chain([baseMessage({
          hiddenAt: new Date(),
          moderatedAt: new Date(),
          moderatedBy: adminUser.id,
        })]);
        const setFn = c.set as ReturnType<typeof vi.fn>;
        setFn.mockImplementation((values: Record<string, unknown>) => {
          updateSet.push(values);
          return c;
        });
        return c;
      }),
      insert: vi.fn(() => {
        const c = chain([{}]);
        const valuesFn = c.values as ReturnType<typeof vi.fn>;
        valuesFn.mockImplementation((values: unknown) => {
          insertCalls.push(values);
          return c;
        });
        return c;
      }),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          select: sequenced.select,
          update: sequenced.update,
          insert: sequenced.insert,
        })
      ),
    };
    databaseMocks.getDb.mockResolvedValue(sequenced);

    const hidden = await appRouter
      .createCaller(context(adminUser))
      .admin.messages.hide({ messageId: 9, reason: "policy" });

    expect(hidden.hiddenAt).toBeInstanceOf(Date);
    expect(updateSet).toHaveLength(1);
    const setPayload = updateSet[0];
    expect(setPayload).toHaveProperty("hiddenAt");
    expect(setPayload).toHaveProperty("moderatedAt");
    expect(setPayload).toHaveProperty("moderatedBy", adminUser.id);
    // E11: no destructive body/pin changes
    expect(setPayload).not.toHaveProperty("body");
    expect(setPayload).not.toHaveProperty("pinned");

    expect(insertCalls).toHaveLength(1);
    const audit = insertCalls[0] as Record<string, unknown>;
    expect(audit.action).toBe(MODERATION_ACTIONS.messageHidden);
    expect(audit.targetType).toBe("hype_room_message");
    expect(audit.targetId).toBe(9);
    expect(audit.reason).toBe("policy");
    expect(audit.metadata).toEqual({ roomId: 11 });
  });

  it("rejects missing message", async () => {
    const sequenced = {
      select: vi.fn(() => chain([])),
      update: vi.fn(() => chain([])),
      insert: vi.fn(() => chain([])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          select: sequenced.select,
          update: sequenced.update,
          insert: sequenced.insert,
        })
      ),
    };
    databaseMocks.getDb.mockResolvedValue(sequenced);

    await expect(
      appRouter.createCaller(context(adminUser)).admin.messages.hide({
        messageId: 999,
        reason: "x",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects already-hidden message", async () => {
    const sequenced = {
      select: vi.fn(() => chain([baseMessage({ hiddenAt: past })])),
      update: vi.fn(() => chain([])),
      insert: vi.fn(() => chain([])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          select: sequenced.select,
          update: sequenced.update,
          insert: sequenced.insert,
        })
      ),
    };
    databaseMocks.getDb.mockResolvedValue(sequenced);

    await expect(
      appRouter.createCaller(context(adminUser)).admin.messages.hide({
        messageId: 9,
        reason: "x",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("M9 admin.reports.list filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    featureFlagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
  });

  it("returns filtered queue rows", async () => {
    const rows = [baseReport(), baseReport({ id: 6, status: "resolved" })];
    const sequenced = {
      select: vi.fn(() => chain(rows)),
      update: vi.fn(() => chain([])),
      insert: vi.fn(() => chain([])),
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          select: sequenced.select,
          update: sequenced.update,
          insert: sequenced.insert,
        })
      ),
    };
    databaseMocks.getDb.mockResolvedValue(sequenced);

    const result = await appRouter
      .createCaller(context(adminUser))
      .admin.reports.list({ status: "open", limit: 10 });
    expect(result.reports).toHaveLength(2);
    expect(result.serverNow).toBeInstanceOf(Date);
  });
});

describe("M9 feature flag default", () => {
  it("moderation_v1 defaults false in shared vocabulary", async () => {
    const shared = await import("@shared/featureFlags");
    expect(shared.FEATURE_FLAG_KEYS).toContain("moderation_v1");
    expect(shared.FEATURE_FLAG_DEFAULTS.moderation_v1).toBe(false);
  });
});
