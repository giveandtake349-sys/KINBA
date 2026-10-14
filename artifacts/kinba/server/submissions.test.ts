/**
 * JHILIK Ads Phase 4 — submissions, fiat earnings, click tracking.
 *
 * DB-backed behaviors run against a scripted in-memory fake of the drizzle
 * query surface (no test database in this environment): selects resolve
 * queued rows in call order, inserts/updates are captured for assertions.
 * Plus pure unit tests (zod inputs, money math, URL validation, click
 * helpers) and source-level visibility guards following campaigns.test.ts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  campaignAuditLog,
  campaignEarnings,
  campaignSubmissions,
  linkClicks,
  videos,
} from "../drizzle/schema";

const h = vi.hoisted(() => {
  const state = {
    selectQueue: [] as unknown[][],
    inserts: [] as Array<{ table: unknown; values: unknown }>,
    updates: [] as Array<{ table: unknown; values: unknown }>,
    conflictTarget: null as unknown,
    nextId: 100,
  };

  const thenable = (value: unknown) => ({
    then: (
      resolve: (value: unknown) => unknown,
      reject: (reason: unknown) => unknown
    ) => Promise.resolve(value).then(resolve, reject),
  });

  function makeSelect(rows: unknown[]) {
    const chain: Record<string, (...args: unknown[]) => unknown> = {
      then: (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown
      ) => Promise.resolve(rows).then(resolve, reject),
    };
    for (const method of [
      "from",
      "innerJoin",
      "leftJoin",
      "where",
      "orderBy",
      "groupBy",
      "limit",
      "offset",
    ]) {
      chain[method] = () => chain;
    }
    return chain;
  }

  const fakeDb: Record<string, (...args: unknown[]) => unknown> = {
    select: () => makeSelect(state.selectQueue.shift() ?? []),
    insert: (table: unknown) => {
      const chain: Record<string, (...args: unknown[]) => unknown> = {
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown
        ) => Promise.resolve([]).then(resolve, reject),
      };
      chain.values = (values: unknown) => {
        state.inserts.push({ table, values });
        return chain;
      };
      chain.returning = () => thenable([{ id: state.nextId++ }]);
      chain.onConflictDoNothing = (opts: unknown) => {
        state.conflictTarget = opts;
        return thenable([]);
      };
      return chain;
    },
    update: (table: unknown) => ({
      set: (values: unknown) => {
        state.updates.push({ table, values });
        return { where: () => thenable([]) };
      },
    }),
    transaction: async (fn: (tx: unknown) => unknown) => fn(fakeDb),
  };

  return { state, fakeDb };
});

vi.mock("./db", () => ({
  getDb: () => Promise.resolve(h.fakeDb),
}));

const notifyMock = vi.hoisted(() => ({ insertNotification: vi.fn() }));
vi.mock("./notifications", () => ({
  insertNotification: notifyMock.insertNotification,
  NOTIFICATION_TYPES: {
    submissionReceived: "campaign.submission_received",
    submissionApproved: "campaign.submission_approved",
    submissionRejected: "campaign.submission_rejected",
  },
}));

import {
  clickDayUTC,
  createLinkInput,
  getClickTarget,
  hashClickIp,
  listMyEarnings,
  poolFitsCents,
  recordLinkClick,
  reverseEarning,
  reverseEarningInput,
  reviewSubmission,
  reviewSubmissionInput,
  submitDeliverable,
  submitDeliverableInput,
  validateCampaignLink,
} from "./submissions";

beforeEach(() => {
  h.state.selectQueue = [];
  h.state.inserts = [];
  h.state.updates = [];
  h.state.conflictTarget = null;
  h.state.nextId = 100;
  notifyMock.insertNotification.mockClear();
});

const queueSelects = (...rows: unknown[][]) => {
  h.state.selectQueue.push(...rows);
};

const insertsFor = (table: unknown) =>
  h.state.inserts.filter(entry => entry.table === table);

/* ------------------------------------------------------------------ */
/* submitDeliverable                                                     */
/* ------------------------------------------------------------------ */

describe("submitDeliverable", () => {
  const activeCampaign = {
    id: 10,
    status: "active",
    title: "Winter Launch",
    createdBy: 1,
  };
  const invitation = { id: 3 };
  const ownVideo = { id: 7, userId: 5, campaignId: null };
  const profile = { displayName: "Ayesha", username: "ayesha" };
  const input = {
    campaignId: 10,
    videoId: 7,
    answers: ["I have read and agree to the campaign rules."],
  };

  it("blocks a non-invitee", async () => {
    queueSelects([activeCampaign], [], [ownVideo], []);
    await expect(submitDeliverable(5, input)).rejects.toThrow(/blocked/);
    expect(insertsFor(campaignSubmissions)).toHaveLength(0);
  });

  it("blocks submissions on an inactive campaign", async () => {
    queueSelects([{ ...activeCampaign, status: "draft" }]);
    await expect(submitDeliverable(5, input)).rejects.toThrow(
      /not accepting submissions/
    );
  });

  it("blocks a video the caller does not own", async () => {
    queueSelects(
      [activeCampaign],
      [invitation],
      [{ ...ownVideo, userId: 999 }],
      []
    );
    await expect(submitDeliverable(5, input)).rejects.toThrow(/not found/i);
  });

  it("blocks a duplicate submission for the same video", async () => {
    queueSelects([activeCampaign], [invitation], [ownVideo], [{ id: 9 }]);
    await expect(submitDeliverable(5, input)).rejects.toThrow(
      /already been submitted/
    );
  });

  it("creates the submission and badges the video", async () => {
    queueSelects(
      [activeCampaign],
      [invitation],
      [ownVideo],
      [],
      [profile] // post-transaction notification lookup
    );
    const result = await submitDeliverable(5, input);
    expect(result.submissionId).toBe(100);

    const subs = insertsFor(campaignSubmissions);
    expect(subs).toHaveLength(1);
    expect(subs[0].values).toMatchObject({
      campaignId: 10,
      creatorId: 5,
      videoId: 7,
      reviewStatus: "in_review",
    });

    const videoUpdates = h.state.updates.filter(
      entry => entry.table === videos
    );
    expect(videoUpdates).toHaveLength(1);
    expect(videoUpdates[0].values).toMatchObject({ campaignId: 10 });

    expect(insertsFor(campaignAuditLog)).toHaveLength(1);
    expect(notifyMock.insertNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        type: "campaign.submission_received",
      })
    );
  });

  it("never steals another campaign's badge", async () => {
    queueSelects(
      [activeCampaign],
      [invitation],
      [{ ...ownVideo, campaignId: 42 }],
      [],
      [profile]
    );
    await submitDeliverable(5, input);
    const videoUpdates = h.state.updates.filter(
      entry => entry.table === videos
    );
    expect(videoUpdates).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* reviewSubmission — approve                                           */
/* ------------------------------------------------------------------ */

describe("reviewSubmission approve", () => {
  const submission = {
    id: 1,
    campaignId: 10,
    creatorId: 5,
    reviewStatus: "in_review",
  };
  const campaign = { id: 10, title: "Winter Launch", creatorPool: "100.00" };
  const invitation = { rewardAmount: "60.00", rewardCurrency: "USD" };
  const campaignTitle = [{ title: "Winter Launch" }];

  it("credits a fiat earning on approve", async () => {
    queueSelects(
      [submission],
      [campaign],
      [invitation],
      [{ total: "0" }], // committed earnings sum
      campaignTitle
    );
    const result = await reviewSubmission(1, {
      submissionId: 1,
      decision: "approve",
    });
    expect(result.status).toBe("approved");

    const earnings = insertsFor(campaignEarnings);
    expect(earnings).toHaveLength(1);
    expect(earnings[0].values).toMatchObject({
      campaignId: 10,
      submissionId: 1,
      creatorId: 5,
      amount: "60.00",
      currency: "USD",
      status: "approved",
      idempotencyKey: "earn:sub:1",
      adminId: 1,
    });

    const subUpdates = h.state.updates.filter(
      entry => entry.table === campaignSubmissions
    );
    expect(subUpdates[0].values).toMatchObject({
      reviewStatus: "approved",
      rewardEligible: true,
    });

    expect(notifyMock.insertNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        type: "campaign.submission_approved",
      })
    );
  });

  it("aborts when the pool would be exhausted — pool 100, two 60 rewards", async () => {
    // Second approval: 60 already committed + 60 new > 100 pool.
    queueSelects([submission], [campaign], [invitation], [{ total: "60.00" }]);
    await expect(
      reviewSubmission(1, { submissionId: 1, decision: "approve" })
    ).rejects.toThrow(/exceed.*creator pool/);
    // No money moved: no earning insert at all.
    expect(insertsFor(campaignEarnings)).toHaveLength(0);
    expect(notifyMock.insertNotification).not.toHaveBeenCalled();
  });

  it("uses exact cent math at the boundary (100 pool, 60 + 40 fits)", async () => {
    queueSelects(
      [submission],
      [campaign],
      [{ rewardAmount: "40.00", rewardCurrency: "USD" }],
      [{ total: "60.00" }],
      campaignTitle
    );
    const result = await reviewSubmission(1, {
      submissionId: 1,
      decision: "approve",
    });
    expect(result.status).toBe("approved");
    expect(insertsFor(campaignEarnings)).toHaveLength(1);
  });

  it("rejects double review of an already-approved submission", async () => {
    queueSelects([{ ...submission, reviewStatus: "approved" }], [campaign], [
      invitation,
    ]);
    await expect(
      reviewSubmission(1, { submissionId: 1, decision: "approve" })
    ).rejects.toThrow(/Invalid submission status transition/);
  });
});

/* ------------------------------------------------------------------ */
/* reviewSubmission — reject                                            */
/* ------------------------------------------------------------------ */

describe("reviewSubmission reject", () => {
  const submission = {
    id: 2,
    campaignId: 10,
    creatorId: 5,
    reviewStatus: "in_review",
  };
  const campaign = { id: 10, title: "Winter Launch", creatorPool: "100.00" };
  const invitation = { rewardAmount: "60.00", rewardCurrency: "USD" };
  const campaignTitle = [{ title: "Winter Launch" }];

  it("mints no earning on reject", async () => {
    queueSelects(
      [submission],
      [campaign],
      [invitation],
      [], // no stray earning row
      campaignTitle
    );
    const result = await reviewSubmission(1, {
      submissionId: 2,
      decision: "reject",
      note: "Off brief.",
    });
    expect(result.status).toBe("rejected");
    expect(insertsFor(campaignEarnings)).toHaveLength(0);
    const subUpdates = h.state.updates.filter(
      entry => entry.table === campaignSubmissions
    );
    expect(subUpdates[0].values).toMatchObject({ reviewStatus: "rejected" });
    expect(notifyMock.insertNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 5,
        type: "campaign.submission_rejected",
      })
    );
  });

  it("inserts an append-only reversal when an earning already exists", async () => {
    queueSelects(
      [submission],
      [campaign],
      [invitation],
      [{ id: 44, amount: "60.00", currency: "USD", status: "approved" }],
      campaignTitle
    );
    const result = await reviewSubmission(1, {
      submissionId: 2,
      decision: "reject",
    });
    expect(result.reversed).toBe(true);
    const earnings = insertsFor(campaignEarnings);
    expect(earnings).toHaveLength(1);
    expect(earnings[0].values).toMatchObject({
      status: "reversed",
      amount: "60.00",
      currency: "USD",
      idempotencyKey: "rev:sub:2",
    });
    // The original row is never updated — compensation is a new row.
    expect(h.state.updates.filter(e => e.table === campaignEarnings)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* reverseEarning                                                       */
/* ------------------------------------------------------------------ */

describe("reverseEarning", () => {
  it("appends a reversal row and never touches the original", async () => {
    queueSelects([
      {
        id: 20,
        campaignId: 10,
        submissionId: 1,
        creatorId: 5,
        amount: "60.00",
        currency: "USD",
        status: "approved",
      },
    ]);
    const result = await reverseEarning(1, {
      earningId: 20,
      reason: "Duplicate credit.",
    });
    expect(result.earningId).toBe(20);

    const earnings = insertsFor(campaignEarnings);
    expect(earnings).toHaveLength(1);
    const reversal = earnings[0].values as Record<string, unknown>;
    expect(reversal.status).toBe("reversed");
    expect(reversal.amount).toBe("60.00");
    expect(reversal.currency).toBe("USD");
    expect(String(reversal.idempotencyKey)).toMatch(/^rev:earn:20:\d+$/);
    expect(reversal.reason).toBe("Duplicate credit.");

    // Original money row untouched: zero updates to campaign_earnings.
    expect(
      h.state.updates.filter(entry => entry.table === campaignEarnings)
    ).toHaveLength(0);
    expect(insertsFor(campaignAuditLog)).toHaveLength(1);
  });

  it("refuses to reverse an already-reversed earning", async () => {
    queueSelects([{ id: 21, status: "reversed" }]);
    await expect(
      reverseEarning(1, { earningId: 21, reason: "Again." })
    ).rejects.toThrow(/Invalid earning status transition/);
  });
});

/* ------------------------------------------------------------------ */
/* Click tracking                                                       */
/* ------------------------------------------------------------------ */

describe("click tracking", () => {
  it("dedups on (linkId, ipHash, day) via onConflictDoNothing", async () => {
    await recordLinkClick({
      linkId: 3,
      campaignId: 10,
      ip: "203.0.113.7",
      ipSalt: "test-salt",
      userAgent: "Mozilla/5.0",
      referrer: "https://example.com/",
    });
    const clicks = insertsFor(linkClicks);
    expect(clicks).toHaveLength(1);
    const values = clicks[0].values as Record<string, unknown>;
    expect(values.linkId).toBe(3);
    expect(String(values.ipHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(values.day).toBe(clickDayUTC());

    // Same inputs → same key: conflict target is the dedup unique index.
    expect(h.state.conflictTarget).toMatchObject({
      target: [linkClicks.linkId, linkClicks.ipHash, linkClicks.day],
    });
  });

  it("hashClickIp is stable per salt and 64 hex chars", () => {
    const a = hashClickIp("203.0.113.7", "s1");
    const b = hashClickIp("203.0.113.7", "s1");
    const c = hashClickIp("203.0.113.7", "s2");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("clickDayUTC is a UTC calendar day", () => {
    expect(clickDayUTC(new Date("2026-10-14T23:59:59+06:00"))).toBe(
      "2026-10-14"
    );
    expect(clickDayUTC()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("getClickTarget returns null for a missing link", async () => {
    queueSelects([]);
    await expect(getClickTarget(999)).resolves.toBeNull();
  });

  it("getClickTarget normalizes the URL and rejects unsafe schemes", async () => {
    queueSelects([{ url: "https://brand.example/promo?utm=1" }]);
    await expect(getClickTarget(3)).resolves.toBe(
      "https://brand.example/promo?utm=1"
    );

    queueSelects([{ url: "javascript:alert(1)" }]);
    await expect(getClickTarget(3)).resolves.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Pure helpers + input schemas                                         */
/* ------------------------------------------------------------------ */

describe("poolFitsCents", () => {
  it("fits exactly at the boundary, never over", () => {
    expect(poolFitsCents(10000, 6000, 4000)).toBe(true);
    expect(poolFitsCents(10000, 6000, 4001)).toBe(false);
    expect(poolFitsCents(10000, 0, 10000)).toBe(true);
  });
});

describe("validateCampaignLink", () => {
  it("accepts http/https", () => {
    expect(validateCampaignLink("https://brand.example/x")).toBe(
      "https://brand.example/x"
    );
    expect(validateCampaignLink("http://brand.example/x")).toBe(
      "http://brand.example/x"
    );
  });

  it("rejects javascript:, data: and garbage", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "not a url",
      "",
    ]) {
      expect(() => validateCampaignLink(bad), bad).toThrow();
    }
  });
});

describe("input schemas", () => {
  it("submitDeliverableInput requires a non-empty checklist", () => {
    expect(
      submitDeliverableInput.safeParse({
        campaignId: 1,
        videoId: 2,
        answers: [],
      }).success
    ).toBe(false);
    expect(
      submitDeliverableInput.parse({
        campaignId: 1,
        videoId: 2,
        answers: ["I confirm."],
      }).answers
    ).toEqual(["I confirm."]);
  });

  it("reviewSubmissionInput only allows approve/reject", () => {
    expect(
      reviewSubmissionInput.safeParse({ submissionId: 1, decision: "maybe" })
        .success
    ).toBe(false);
    expect(
      reviewSubmissionInput.parse({ submissionId: 1, decision: "approve" })
        .decision
    ).toBe("approve");
  });

  it("reverseEarningInput requires a real reason", () => {
    expect(
      reverseEarningInput.safeParse({ earningId: 1, reason: "  " }).success
    ).toBe(false);
  });

  it("createLinkInput accepts a valid link", () => {
    expect(
      createLinkInput.parse({
        campaignId: 1,
        label: "Promo",
        url: "https://brand.example/",
      }).url
    ).toBe("https://brand.example/");
  });
});

/* ------------------------------------------------------------------ */
/* Visibility guards (source-level, like campaigns.test.ts)            */
/* ------------------------------------------------------------------ */

describe("creator visibility guard", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "submissions.ts"), "utf8");

  const fnBody = (name: string): string => {
    const start = source.indexOf(`export async function ${name}`);
    if (start === -1) throw new Error(`${name} not found`);
    const next = source.indexOf("export async function", start + 10);
    return source.slice(start, next === -1 ? undefined : next);
  };

  it("listMyEarnings never selects pool/budget columns", () => {
    const body = fnBody("listMyEarnings");
    for (const col of ["creatorPool", "budgetTotal", "serviceFee"]) {
      expect(body, col).not.toContain(col);
    }
    expect(body).toContain("campaignEarnings.amount");
    expect(body).toContain("campaignEarnings.currency");
    expect(body).toContain("campaignEarnings.status");
  });

  it("listMySubmissions never selects pool/budget columns", () => {
    const body = fnBody("listMySubmissions");
    for (const col of ["creatorPool", "budgetTotal", "serviceFee"]) {
      expect(body, col).not.toContain(col);
    }
  });

  it("listReviewQueue exposes only public creator profile fields", () => {
    const body = fnBody("listReviewQueue");
    for (const field of ["profiles.username", "profiles.displayName", "profiles.photoUrl"]) {
      expect(body, field).toContain(field);
    }
    expect(body).not.toContain("users.email");
  });
});

describe("listMyEarnings projection", () => {
  it("returns only amount/currency/status + campaign title keys", async () => {
    queueSelects([
      {
        id: 1,
        amount: "60.00",
        currency: "USD",
        status: "approved",
        campaignId: 10,
        campaignTitle: "Winter Launch",
        createdAt: new Date(),
      },
    ]);
    const rows = await listMyEarnings(5);
    expect(rows).toHaveLength(1);
    const keys = Object.keys(rows[0] as Record<string, unknown>).sort();
    expect(keys).toEqual(
      [
        "id",
        "amount",
        "currency",
        "status",
        "campaignId",
        "campaignTitle",
        "createdAt",
      ].sort()
    );
    for (const forbidden of ["creatorPool", "budgetTotal", "serviceFee"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});
