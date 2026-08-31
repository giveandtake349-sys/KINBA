import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const databaseMocks = vi.hoisted(() => ({
  createLiveSponsor: vi.fn(),
  getSponsorBidsSession: vi.fn(),
  getSponsorBidsState: vi.fn(),
  joinSponsorBidsSession: vi.fn(),
  listLiveSponsors: vi.fn(),
  listSessionWinners: vi.fn(),
  listSponsorBidsSessions: vi.fn(),
}));

vi.mock("./db", () => databaseMocks);

import { appRouter } from "./routers";

const user = {
  id: 41,
  openId: "kinba-sponsor-bids-user",
  name: "KINBA SponsorBids Member",
  email: "member@example.test",
  loginMethod: "email",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function context(activeUser = user): TrpcContext {
  return {
    user: activeUser,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("SponsorBids procedures", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a requested session through the public procedure", async () => {
    const session = { id: 7, title: "Friday SponsorBids", status: "scheduled" };
    databaseMocks.getSponsorBidsSession.mockResolvedValue(session);

    await expect(
      appRouter.createCaller(context()).sponsorBids.session({ sessionId: 7 })
    ).resolves.toEqual(session);
    expect(databaseMocks.getSponsorBidsSession).toHaveBeenCalledWith(7);
  });

  it("returns the server-authoritative wheel state", async () => {
    const state = { phase: "spin-2nd", serverNow: Date.now(), winners: [], sponsors: [] };
    databaseMocks.getSponsorBidsState.mockResolvedValue(state);

    await expect(
      appRouter.createCaller(context()).sponsorBids.state({ sessionId: 7 })
    ).resolves.toEqual(state);
    expect(databaseMocks.getSponsorBidsState).toHaveBeenCalledWith(7);
  });

  it("joins the authenticated user to a session", async () => {
    const participant = { id: 12, sessionId: 7, userId: user.id };
    databaseMocks.joinSponsorBidsSession.mockResolvedValue(participant);

    await expect(
      appRouter.createCaller(context()).sponsorBids.join({ sessionId: 7 })
    ).resolves.toEqual(participant);
    expect(databaseMocks.joinSponsorBidsSession).toHaveBeenCalledWith(
      7,
      user.id
    );
  });

  it("charges and creates a validated live sponsorship", async () => {
    const result = {
      sponsor: { id: 18, sessionId: 7, sponsoredAmount: "250.00" },
      walletBalance: "750.00",
    };
    databaseMocks.createLiveSponsor.mockResolvedValue(result);

    await expect(
      appRouter.createCaller(context()).sponsorBids.sponsor({
        sessionId: 7,
        logoUrl: "https://cdn.example.com/logo.png",
        externalLink: "https://example.com/brand",
        sponsoredAmount: "250.00",
      })
    ).resolves.toEqual(result);
    expect(databaseMocks.createLiveSponsor).toHaveBeenCalledWith({
      sessionId: 7,
      userId: user.id,
      logoUrl: "https://cdn.example.com/logo.png",
      externalLink: "https://example.com/brand",
      sponsoredAmount: "250.00",
    });
  });

  it("rejects an invalid sponsor link before charging", async () => {
    await expect(
      appRouter.createCaller(context()).sponsorBids.sponsor({
        sessionId: 7,
        logoUrl: "https://cdn.example.com/logo.png",
        externalLink: "not-a-url",
        sponsoredAmount: "250.00",
      })
    ).rejects.toThrow();
    expect(databaseMocks.createLiveSponsor).not.toHaveBeenCalled();
  });

  it("rejects invalid session identifiers before calling the database", async () => {
    await expect(
      appRouter.createCaller(context()).sponsorBids.join({ sessionId: 0 })
    ).rejects.toThrow();
    expect(databaseMocks.joinSponsorBidsSession).not.toHaveBeenCalled();
  });
});

