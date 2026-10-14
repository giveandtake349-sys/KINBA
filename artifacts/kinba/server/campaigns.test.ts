/**
 * JHILIK Ads Phase 3 — campaign validation, transitions, visibility.
 * Pure tests: zod input schemas, state machines, and a source-level guard
 * proving creator-facing selects never touch budget columns. No DB.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertTransition,
  CAMPAIGN_INVITATION_TRANSITIONS,
  CAMPAIGN_TRANSITIONS,
} from "../shared/stateMachines";
import {
  createCampaignInput,
  inviteCreatorInput,
  respondInvitationInput,
  setCampaignStatusInput,
  updateCampaignInput,
} from "./campaigns";

const validCreate = {
  applicationId: 7,
  title: "Aarong Dairy — Winter Launch",
  brief: "Make a cozy winter Shorts.",
  concepts: ["Morning routine"],
  rules: "Mention the promo link.",
  validationQuestions: ["Is the product visible?"],
  creatorPool: "3500.00",
  serviceFee: "1500.00",
};

describe("createCampaignInput", () => {
  it("accepts a valid campaign", () => {
    const parsed = createCampaignInput.parse(validCreate);
    expect(parsed.title).toBe("Aarong Dairy — Winter Launch");
    // The brand can never set these — they're admin-only by schema absence.
    expect("budgetTotal" in parsed).toBe(false);
    expect("status" in parsed).toBe(false);
  });

  it("rejects end date before start date", () => {
    const result = createCampaignInput.safeParse({
      ...validCreate,
      startsAt: "2026-12-10T00:00:00.000Z",
      endsAt: "2026-12-01T00:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });

  it("rejects bad money", () => {
    for (const creatorPool of ["-5", "0", "abc", "10.999"]) {
      const result = createCampaignInput.safeParse({
        ...validCreate,
        creatorPool,
      });
      expect(result.success, creatorPool).toBe(false);
    }
  });

  it("requires a title", () => {
    const result = createCampaignInput.safeParse({ ...validCreate, title: "  " });
    expect(result.success).toBe(false);
  });
});

describe("updateCampaignInput", () => {
  it("accepts a partial patch", () => {
    const parsed = updateCampaignInput.parse({ id: 3, title: "New title" });
    expect(parsed.title).toBe("New title");
    expect(parsed.creatorPool).toBeUndefined();
  });

  it("never allows status changes through update", () => {
    const result = updateCampaignInput.safeParse({ id: 3, status: "active" });
    // zod strips unknown keys by default — status must not survive parsing.
    expect(result.success).toBe(true);
    if (result.success) {
      expect("status" in result.data).toBe(false);
    }
  });
});

describe("inviteCreatorInput", () => {
  it("accepts a valid invite", () => {
    const parsed = inviteCreatorInput.parse({
      campaignId: 1,
      userId: 42,
      rewardAmount: "120.00",
      message: "We'd love you!",
    });
    expect(parsed.rewardAmount).toBe("120.00");
  });

  it("rejects zero/negative rewards", () => {
    for (const rewardAmount of ["0", "-10"]) {
      const result = inviteCreatorInput.safeParse({
        campaignId: 1,
        userId: 42,
        rewardAmount,
      });
      expect(result.success, rewardAmount).toBe(false);
    }
  });

  it("caps the message length", () => {
    const result = inviteCreatorInput.safeParse({
      campaignId: 1,
      userId: 42,
      rewardAmount: "10",
      message: "x".repeat(1001),
    });
    expect(result.success).toBe(false);
  });
});

describe("respondInvitationInput / setCampaignStatusInput", () => {
  it("accepts accept/decline", () => {
    expect(
      respondInvitationInput.parse({ invitationId: 5, accept: true }).accept
    ).toBe(true);
  });

  it("only allows the manual scheduler transitions", () => {
    expect(
      setCampaignStatusInput.parse({ id: 1, toStatus: "active" }).toStatus
    ).toBe("active");
    // "draft" is not a valid target — campaigns start as drafts, never move back.
    const result = setCampaignStatusInput.safeParse({
      id: 1,
      toStatus: "draft",
    });
    expect(result.success).toBe(false);
  });
});

describe("campaign state machines", () => {
  it("draft → active → paused → active → ended", () => {
    assertTransition(CAMPAIGN_TRANSITIONS, "draft", "active", "campaign");
    assertTransition(CAMPAIGN_TRANSITIONS, "active", "paused", "campaign");
    assertTransition(CAMPAIGN_TRANSITIONS, "paused", "active", "campaign");
    assertTransition(CAMPAIGN_TRANSITIONS, "active", "ended", "campaign");
  });

  it("draft can never jump straight to ended", () => {
    expect(() =>
      assertTransition(CAMPAIGN_TRANSITIONS, "draft", "ended", "campaign")
    ).toThrow();
  });

  it("ended is terminal", () => {
    expect(() =>
      assertTransition(CAMPAIGN_TRANSITIONS, "ended", "active", "campaign")
    ).toThrow();
  });

  it("invitation: pending → accepted/declined, then terminal", () => {
    assertTransition(
      CAMPAIGN_INVITATION_TRANSITIONS,
      "pending",
      "accepted",
      "invitation"
    );
    assertTransition(
      CAMPAIGN_INVITATION_TRANSITIONS,
      "pending",
      "declined",
      "invitation"
    );
    expect(() =>
      assertTransition(
        CAMPAIGN_INVITATION_TRANSITIONS,
        "accepted",
        "declined",
        "invitation"
      )
    ).toThrow();
    expect(() =>
      assertTransition(
        CAMPAIGN_INVITATION_TRANSITIONS,
        "declined",
        "accepted",
        "invitation"
      )
    ).toThrow();
  });
});

describe("creator visibility guard", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "campaigns.ts"), "utf8");

  const fnBody = (name: string): string => {
    const start = source.indexOf(`export async function ${name}`);
    if (start === -1) throw new Error(`${name} not found`);
    const next = source.indexOf("export async function", start + 10);
    return source.slice(start, next === -1 ? undefined : next);
  };

  it("listMyInvitations never selects budget columns", () => {
    const body = fnBody("listMyInvitations");
    for (const col of ["budgetTotal", "creatorPool", "serviceFee"]) {
      expect(body, col).not.toContain(col);
    }
    // …but the creator's own reward is present.
    expect(body).toContain("rewardAmount");
  });

  it("listMyCampaigns never selects budget columns", () => {
    const body = fnBody("listMyCampaigns");
    for (const col of [
      "budgetTotal",
      "creatorPool",
      "serviceFee",
      "rewardAmount",
    ]) {
      expect(body, col).not.toContain(col);
    }
  });

  it("getCampaignForBrand never selects the pool/fee split", () => {
    const body = fnBody("getCampaignForBrand");
    for (const col of ["creatorPool", "serviceFee"]) {
      expect(body, col).not.toContain(col);
    }
    // The brand's own total is fine — they proposed it.
    expect(body).toContain("budgetTotal");
  });
});

describe("runMode (Phase 6 retrofit)", () => {
  it("defaults to continuous", () => {
    const parsed = createCampaignInput.parse(validCreate);
    expect(parsed.runMode).toBe("continuous");
  });

  it("accepts explicit scheduled with an end date", () => {
    const parsed = createCampaignInput.parse({
      ...validCreate,
      runMode: "scheduled",
      startsAt: "2026-10-20T00:00:00.000Z",
      endsAt: "2026-11-20T00:00:00.000Z",
    });
    expect(parsed.runMode).toBe("scheduled");
  });

  it("rejects scheduled without an end date", () => {
    const result = createCampaignInput.safeParse({
      ...validCreate,
      runMode: "scheduled",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown run mode", () => {
    const result = createCampaignInput.safeParse({
      ...validCreate,
      runMode: "forever",
    });
    expect(result.success).toBe(false);
  });
});
