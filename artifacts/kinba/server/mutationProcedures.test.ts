import { vi, describe, beforeEach, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";

const databaseMocks = vi.hoisted(() => ({
  createAnnouncementComment: vi.fn(),
  createCommunityAnnouncement: vi.fn(),
  createVideo: vi.fn(),
  createVideoComment: vi.fn(),
  ensureProfile: vi.fn(),
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
const hlsMocks = vi.hoisted(() => ({
  queueVideoTranscode: vi.fn(),
}));
vi.mock("./db", () => databaseMocks);
vi.mock("./hlsProcessor", () => hlsMocks);

import { appRouter } from "./routers";

const user = {
  id: 41,
  openId: "kinba-test-user",
  name: "KINBA Test Member",
  email: "member@example.test",
  loginMethod: "email",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};
const adminUser = { ...user, role: "admin" as const };
function context(activeUser = user): TrpcContext {
  return {
    user: activeUser,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("KINBA protected procedures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.ensureProfile.mockResolvedValue(undefined);
  });

  it("returns the persisted video after a valid video mutation", async () => {
    const persistedVideo = { id: 501 };
    databaseMocks.createVideo.mockResolvedValue(persistedVideo);
    await expect(
      appRouter.createCaller(context()).videos.create({
        title: "A real main-feed video",
        description: "A square video for the main Home feed.",
        videoUrl: "https://cdn.example.com/original.mp4",
        thumbnailUrl: null,
        kind: "LONG",
        durationSeconds: 120,
        width: 3840,
        height: 2160,
        sources: [
          {
            quality: "ORIGINAL",
            videoUrl: "https://cdn.example.com/original.mp4",
          },
          { quality: "1080P", videoUrl: "https://cdn.example.com/1080.mp4" },
        ],
      })
    ).resolves.toEqual(persistedVideo);
    expect(databaseMocks.createVideo).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({ kind: "LONG", durationSeconds: 120 })
    );
  });

  it("returns real profile statistics from the profile procedure", async () => {
    const profile = {
      stats: {
        reactionsReceived: 4,
        iconsCount: 2,
        followingCount: 5,
        followersCount: 7,
      },
    };
    databaseMocks.getOwnProfile.mockResolvedValue(profile);
    await expect(
      appRouter.createCaller(context()).profile.me()
    ).resolves.toEqual(profile);
    expect(databaseMocks.ensureProfile).toHaveBeenCalledWith(user.id);
    expect(databaseMocks.getOwnProfile).toHaveBeenCalledWith(user.id);
  });

  it("stores a valid manual verification payment for review", async () => {
    const transaction = { id: 91, status: "pending" };
    databaseMocks.submitVerificationTransaction.mockResolvedValue(transaction);

    await expect(
      appRouter.createCaller(context()).payments.submit({
        amount: "100",
        paymentMethod: "bkash",
        senderNumber: "01779557226",
        transactionId: "TRX-2026-001",
      })
    ).resolves.toEqual(transaction);

    expect(databaseMocks.ensureProfile).toHaveBeenCalledWith(user.id);
    expect(databaseMocks.submitVerificationTransaction).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({
        paymentMethod: "bkash",
        senderNumber: "01779557226",
        transactionId: "TRX-2026-001",
      })
    );
  });

  it("rejects a non-Bangladesh sender number before creating a payment", async () => {
    await expect(
      appRouter.createCaller(context()).payments.submit({
        amount: "100",
        paymentMethod: "nagad",
        senderNumber: "+12025550123",
        transactionId: "TRX-2026-002",
      })
    ).rejects.toThrow("Bangladesh mobile number");
    expect(databaseMocks.submitVerificationTransaction).not.toHaveBeenCalled();
  });

  it("allows only an administrator to approve a pending verification payment", async () => {
    const approved = { id: 91, status: "approved" };
    databaseMocks.approveVerificationTransaction.mockResolvedValue(approved);

    await expect(
      appRouter.createCaller(context(adminUser)).payments.approve({
        transactionId: 91,
        status: "approved",
      })
    ).resolves.toEqual(approved);
    expect(databaseMocks.approveVerificationTransaction).toHaveBeenCalledWith(
      91,
      adminUser.id,
      "approved"
    );

    await expect(
      appRouter.createCaller(context()).payments.approve({
        transactionId: 92,
        status: "rejected",
      })
    ).rejects.toThrow("required permission");
  });

  it("blocks the Admin Dashboard for regular users", async () => {
    await expect(
      appRouter.createCaller(context()).admin.dashboard()
    ).rejects.toThrow("required permission");
    expect(databaseMocks.adminListDashboard).not.toHaveBeenCalled();
  });

  it("allows only database-role admins to create and inspect sessions", async () => {
    const dashboard = { sessions: [], wallets: [], ledger: [], sponsors: [] };
    const session = { id: 9, title: "TimeWheels", status: "scheduled" };
    databaseMocks.adminListDashboard.mockResolvedValue(dashboard);
    databaseMocks.adminCreateSponsorBidsSession.mockResolvedValue(session);

    await expect(
      appRouter.createCaller(context(adminUser)).admin.dashboard()
    ).resolves.toEqual(dashboard);
    await expect(
      appRouter
        .createCaller(context(adminUser))
        .admin.createSession({
          title: "TimeWheels",
          startsAt: "2026-09-01T12:00:00.000Z",
        })
    ).resolves.toEqual(session);
    expect(databaseMocks.adminCreateSponsorBidsSession).toHaveBeenCalledWith({
      title: "TimeWheels",
      startsAt: new Date("2026-09-01T12:00:00.000Z"),
    });
  });

  it("creates a protected video comment", async () => {
    const comment = {
      id: 701,
      videoId: 501,
      userId: user.id,
      body: "Great video",
    };
    databaseMocks.createVideoComment.mockResolvedValue(comment);

    await expect(
      appRouter.createCaller(context()).videos.comments.create({
        videoId: 501,
        body: "Great video",
      })
    ).resolves.toEqual(comment);
    expect(databaseMocks.createVideoComment).toHaveBeenCalledWith(
      501,
      user.id,
      "Great video"
    );
  });

  it("creates a protected community post comment", async () => {
    const comment = {
      id: 702,
      announcementId: 602,
      userId: user.id,
      body: "Thanks for the update",
    };
    databaseMocks.createAnnouncementComment.mockResolvedValue(comment);

    await expect(
      appRouter.createCaller(context()).community.comments.create({
        announcementId: 602,
        body: "Thanks for the update",
      })
    ).resolves.toEqual(comment);
    expect(databaseMocks.createAnnouncementComment).toHaveBeenCalledWith(
      602,
      user.id,
      "Thanks for the update"
    );
  });

  it("passes validated community attachments to the persistence helper", async () => {
    databaseMocks.createCommunityAnnouncement.mockResolvedValue({ id: 602 });
    await expect(
      appRouter.createCaller(context()).community.create({
        body: "An official KINBA update.",
        attachments: [
          {
            mediaType: "IMAGE",
            mediaUrl: "https://cdn.example.com/update.jpg",
            sortOrder: 0,
          },
          {
            mediaType: "VIDEO",
            mediaUrl: "https://cdn.example.com/update.mp4",
            sortOrder: 1,
            durationSeconds: 300,
          },
        ],
      })
    ).resolves.toEqual({ id: 602 });
    expect(databaseMocks.createCommunityAnnouncement).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({
        attachments: expect.arrayContaining([
          expect.objectContaining({ mediaType: "VIDEO" }),
        ]),
      })
    );
  });
});
