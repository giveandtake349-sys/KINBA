import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const databaseMocks = vi.hoisted(() => ({
  areUsersBlocked: vi.fn(),
  blockUser: vi.fn(),
  createConnection: vi.fn(),
  createMessage: vi.fn(),
  createReport: vi.fn(),
  createSignal: vi.fn(),
  ensureProfile: vi.fn(),
  getConnectionForParticipant: vi.fn(),
  getOwnProfile: vi.fn(),
  getPublicProfile: vi.fn(),
  getUserById: vi.fn(),
  getSignalById: vi.fn(),
  listConnections: vi.fn(),
  listMatches: vi.fn(),
  listMessages: vi.fn(),
  listOwnSignals: vi.fn(),
  listSignals: vi.fn(),
  setConnectionStatus: vi.fn(),
  updateProfile: vi.fn(),
}));

vi.mock("./db", () => databaseMocks);

import { appRouter } from "./routers";

const user = {
  id: 41,
  openId: "nivo-test-user",
  name: "NIVO Test Member",
  email: "member@example.test",
  loginMethod: "email",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function context(): TrpcContext {
  return { user, req: {} as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("NIVO protected mutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.areUsersBlocked.mockResolvedValue(false);
    databaseMocks.getUserById.mockResolvedValue({ id: 42 });
  });

  it("returns the persisted signal identifier after a valid signal mutation", async () => {
    databaseMocks.createSignal.mockResolvedValue({ id: 501 });
    const caller = appRouter.createCaller(context());

    await expect(caller.signals.create({
      type: "need",
      title: "Need production API verification",
      description: "Looking for help verifying the NIVO PostgreSQL signal publishing flow.",
      category: "Technology",
      language: "English",
      location: null,
    })).resolves.toEqual({ id: 501 });
    expect(databaseMocks.createSignal).toHaveBeenCalledWith(user.id, expect.objectContaining({ type: "need" }));
  });

  it("returns the updated profile from the database mutation helper", async () => {
    const persistedProfile = { user, profile: { userId: user.id, country: "Kenya" } };
    databaseMocks.updateProfile.mockResolvedValue(persistedProfile);
    const caller = appRouter.createCaller(context());

    await expect(caller.profile.update({
      country: "Kenya",
      languages: ["English"],
      about: "Testing the production profile update flow.",
      skills: ["QA"],
      interests: ["Product quality"],
      photoUrl: null,
    })).resolves.toEqual(persistedProfile);
  });

  it("returns a controlled conflict when connection persistence fails", async () => {
    databaseMocks.createConnection.mockRejectedValue(new Error("NIVO PostgreSQL database is unavailable."));
    const caller = appRouter.createCaller(context());

    await expect(caller.connections.request({
      recipientId: 42,
      signalId: null,
      note: "I would like to connect about this request.",
    })).rejects.toMatchObject({ code: "CONFLICT", message: "NIVO PostgreSQL database is unavailable." });
  });
});
