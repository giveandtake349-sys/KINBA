/**
 * JHILIK Ads Phase 6 — video pre-roll ads.
 *
 * DB-backed behaviors run against a scripted in-memory fake of the drizzle
 * query surface (no test database in this environment): selects resolve
 * queued rows in call order, inserts/updates are captured for assertions.
 * Plus pure unit tests (revenue split math, transitions, input validation).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  campaignEarnings,
  prerollAds,
  prerollPlays,
  prerollSettings,
} from "../drizzle/schema";

const h = vi.hoisted(() => {
  const state = {
    selectQueue: [] as unknown[][],
    inserts: [] as Array<{ table: unknown; values: unknown }>,
    updates: [] as Array<{ table: unknown; values: unknown }>,
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
      "for",
    ]) {
      chain[method] = () => chain;
    }
    return chain;
  }

  const fakeDb: Record<string, (...args: unknown[]) => unknown> = {
    select: () => makeSelect(state.selectQueue.shift() ?? []),
    insert: (table: unknown) => {
      const chain: Record<string, (...args: unknown[]) => unknown> = {};
      chain.values = (values: unknown) => {
        state.inserts.push({ table, values });
        return chain;
      };
      chain.returning = () => thenable([{ id: state.nextId++ }]);
      chain.onConflictDoNothing = () => chain;
      return chain;
    },
    update: (table: unknown) => ({
      set: (values: unknown) => {
        state.updates.push({ table, values });
        return {
          where: () => ({ returning: () => thenable([{ id: 7 }]) }),
        };
      },
    }),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
  };

  return { state, fakeDb };
});

vi.mock("./db", () => ({
  getDb: () => Promise.resolve(h.fakeDb),
}));

vi.mock("./storage", () => ({
  storageCreateUploadUrl: () =>
    Promise.resolve({
      key: "k",
      url: "https://upload.example/u",
      publicUrl: "https://cdn.example/ad.mp4",
    }),
}));

import {
  assertTransition,
  PREROLL_AD_TRANSITIONS,
} from "../shared/stateMachines";
import {
  createAd,
  createAdInput,
  getPrerollSettings,
  isCreatorEligible,
  getAdForVideo,
  reportPlay,
  splitRevenueCents,
  updateAdStatus,
  updateSettingsInput,
} from "./preroll";

beforeEach(() => {
  h.state.selectQueue = [];
  h.state.inserts = [];
  h.state.updates = [];
  h.state.nextId = 100;
});

const queueSelects = (...rows: unknown[][]) => {
  h.state.selectQueue.push(...rows);
};

const insertsFor = (table: unknown) =>
  h.state.inserts.filter(entry => entry.table === table);
const updatesFor = (table: unknown) =>
  h.state.updates.filter(entry => entry.table === table);

describe("revenue split (55/45)", () => {
  it("splits 2c into 1c creator + 1c platform", () => {
    expect(splitRevenueCents(2)).toEqual({
      creatorShareCents: 1,
      platformShareCents: 1,
    });
  });
  it("splits 100c into 55c + 45c", () => {
    expect(splitRevenueCents(100)).toEqual({
      creatorShareCents: 55,
      platformShareCents: 45,
    });
  });
  it("splits always sum back to the full charge", () => {
    for (const c of [1, 3, 7, 199, 1000]) {
      const s = splitRevenueCents(c);
      expect(s.creatorShareCents + s.platformShareCents).toBe(c);
    }
  });
});

describe("ad lifecycle transitions", () => {
  it("allows draft→active, active→paused, paused→active, *→ended", () => {
    expect(() =>
      assertTransition(PREROLL_AD_TRANSITIONS, "draft", "active", "ad")
    ).not.toThrow();
    expect(() =>
      assertTransition(PREROLL_AD_TRANSITIONS, "active", "paused", "ad")
    ).not.toThrow();
    expect(() =>
      assertTransition(PREROLL_AD_TRANSITIONS, "paused", "active", "ad")
    ).not.toThrow();
    expect(() =>
      assertTransition(PREROLL_AD_TRANSITIONS, "active", "ended", "ad")
    ).not.toThrow();
  });
  it("rejects ended→active and draft→paused", () => {
    expect(() =>
      assertTransition(PREROLL_AD_TRANSITIONS, "ended", "active", "ad")
    ).toThrow();
    expect(() =>
      assertTransition(PREROLL_AD_TRANSITIONS, "draft", "paused", "ad")
    ).toThrow();
  });
});

describe("input validation", () => {
  it("rejects budgets below $1 and non-https video URLs", () => {
    const base = {
      title: "Sale",
      videoUrl: "https://cdn.example/ad.mp4",
      budgetCents: 500,
      currency: "USD" as const,
    };
    expect(() => createAdInput.parse(base)).not.toThrow();
    expect(() =>
      createAdInput.parse({ ...base, budgetCents: 50 })
    ).toThrow();
    expect(() =>
      createAdInput.parse({ ...base, videoUrl: "http://x.example/a.mp4" })
    ).toThrow();
    expect(() => createAdInput.parse({ ...base, title: "" })).toThrow();
    expect(
      createAdInput.parse({
        ...base,
        linkUrl: "https://brand.example/product",
      }).linkUrl
    ).toBe("https://brand.example/product");
    expect(() =>
      createAdInput.parse({ ...base, linkUrl: "http://brand.example/product" })
    ).toThrow();
  });
  it("normalizes blank optional fields before the preroll INSERT", async () => {
    const base = {
      title: "Sale",
      videoUrl: "https://cdn.example/ad.mp4",
      budgetCents: 500,
      currency: "USD" as const,
      startsAt: "2026-10-14T00:00:00.000Z",
    };
    const parsed = createAdInput.parse({
      ...base,
      thumbnailUrl: "",
      dropId: "",
    } as never);
    expect(parsed.thumbnailUrl).toBeUndefined();
    expect(parsed.dropId).toBeUndefined();

    await createAd(327, {
      ...base,
      thumbnailUrl: "",
      dropId: "",
      linkUrl: "https://brand.example/product",
    } as never);

    const values = insertsFor(prerollAds)[0].values as Record<string, unknown>;
    console.info("createAd final insert optionals", {
      thumbnailUrl: values.thumbnailUrl,
      dropId: values.dropId,
    });
    expect(values.thumbnailUrl).toBeNull();
    expect(values.dropId).toBeNull();
    expect(values.linkUrl).toBe("https://brand.example/product");
  });
  it("rejects invalid settings", () => {
    expect(() =>
      updateSettingsInput.parse({
        minFollowers: 100,
        minViews: 1000,
        costPerPlayCents: 2,
        maxPlaysPerViewerPerDay: 20,
      })
    ).not.toThrow();
    expect(() =>
      updateSettingsInput.parse({
        minFollowers: -1,
        minViews: 1000,
        costPerPlayCents: 2,
        maxPlaysPerViewerPerDay: 20,
      })
    ).toThrow();
    expect(() =>
      updateSettingsInput.parse({
        minFollowers: 100,
        minViews: 1000,
        costPerPlayCents: 0,
        maxPlaysPerViewerPerDay: 20,
      })
    ).toThrow();
  });
});

describe("getPrerollSettings", () => {
  it("seeds defaults when the row is missing", async () => {
    queueSelects([]); // no row
    const s = await getPrerollSettings();
    expect(s.minFollowers).toBe(1000);
    expect(s.minViews).toBe(10000);
    expect(s.costPerPlayCents).toBe(2);
    expect(insertsFor(prerollSettings)).toHaveLength(1);
  });
  it("returns the stored row when present", async () => {
    queueSelects([
      {
        minFollowers: 500,
        minViews: 5000,
        costPerPlayCents: 5,
        maxPlaysPerViewerPerDay: 10,
      },
    ]);
    const s = await getPrerollSettings();
    expect(s.minFollowers).toBe(500);
    expect(s.costPerPlayCents).toBe(5);
    expect(insertsFor(prerollSettings)).toHaveLength(0);
  });
});

describe("isCreatorEligible", () => {
  const settings = {
    minFollowers: 1000,
    minViews: 10000,
    costPerPlayCents: 2,
    maxPlaysPerViewerPerDay: 20,
  };
  it("eligible when both thresholds met", async () => {
    h.state.selectQueue = [[{ n: 1500 }], [{ n: 25000 }]];
    const r = await isCreatorEligible(42, settings);
    expect(r.eligible).toBe(true);
    expect(r.followers).toBe(1500);
    expect(r.totalViews).toBe(25000);
  });
  it("ineligible when followers below threshold", async () => {
    h.state.selectQueue = [[{ n: 10 }], [{ n: 50000 }]];
    const r = await isCreatorEligible(42, settings);
    expect(r.eligible).toBe(false);
  });
  it("ineligible when views below threshold", async () => {
    h.state.selectQueue = [[{ n: 5000 }], [{ n: 100 }]];
    const r = await isCreatorEligible(42, settings);
    expect(r.eligible).toBe(false);
  });
});

describe("getAdForVideo", () => {
  const settings = {
    minFollowers: 1000,
    minViews: 10000,
    costPerPlayCents: 2,
    maxPlaysPerViewerPerDay: 20,
  };
  it("returns null when the video does not exist", async () => {
    h.state.selectQueue = [[], []];
    // getPrerollSettings select + video select
    const out = await getAdForVideo(999, "vh");
    expect(out).toBeNull();
  });
  it("returns null for an ineligible creator", async () => {
    h.state.selectQueue = [
      [
        {
          minFollowers: 1000,
          minViews: 10000,
          costPerPlayCents: 2,
          maxPlaysPerViewerPerDay: 20,
        },
      ],
      [{ id: 1, userId: 42 }],
      [{ n: 5 }],
      [{ n: 50 }],
    ];
    const out = await getAdForVideo(1, "vh");
    expect(out).toBeNull();
    expect(settings.minFollowers).toBe(1000);
  });
  it("returns null when the viewer hit the daily cap", async () => {
    h.state.selectQueue = [
      [
        {
          minFollowers: 1000,
          minViews: 10000,
          costPerPlayCents: 2,
          maxPlaysPerViewerPerDay: 20,
        },
      ],
      [{ id: 1, userId: 42 }],
      [{ n: 2000 }],
      [{ n: 30000 }],
      [{ n: 20 }],
    ];
    const out = await getAdForVideo(1, "vh");
    expect(out).toBeNull();
  });
  it("returns the ad with drop summary when eligible", async () => {
    h.state.selectQueue = [
      [
        {
          minFollowers: 1000,
          minViews: 10000,
          costPerPlayCents: 2,
          maxPlaysPerViewerPerDay: 20,
        },
      ],
      [{ id: 1, userId: 42 }],
      [{ n: 2000 }],
      [{ n: 30000 }],
      [{ n: 3 }],
      [
        {
          id: 9,
          title: "Summer Sale",
          videoUrl: "https://cdn.example/ad.mp4",
          dropId: 77,
          brandName: "FreshTea",
        },
      ],
      [
        {
          id: 77,
          title: "Summer Combo",
          price: "12.99",
          currency: "USD",
          mediaUrl: "https://cdn.example/drop.jpg",
        },
      ],
    ];
    const out = await getAdForVideo(1, "vh");
    expect(out?.id).toBe(9);
    expect(out?.brandName).toBe("FreshTea");
    expect(out?.drop?.id).toBe(77);
    expect(out?.drop?.title).toBe("Summer Combo");
  });
});

describe("reportPlay", () => {
  it("records the play, bumps spend, and credits the creator 55%", async () => {
    h.state.selectQueue = [
      [
        {
          minFollowers: 1000,
          minViews: 10000,
          costPerPlayCents: 2,
          maxPlaysPerViewerPerDay: 20,
        },
      ],
      [
        {
          id: 9,
          status: "active",
          spentCents: 100,
          budgetCents: 50000,
          currency: "USD",
          startsAt: null,
        },
      ],
      [{ id: 1, userId: 42 }],
    ];
    const out = await reportPlay({
      adId: 9,
      videoId: 1,
      watchedSecs: 8,
      skipped: false,
      viewerHash: "vh",
    });
    expect(out.revenueCents).toBe(2);
    expect(out.creatorShareCents).toBe(1);
    expect(out.platformShareCents).toBe(1);

    const plays = insertsFor(prerollPlays);
    expect(plays).toHaveLength(1);
    const pv = plays[0].values as Record<string, unknown>;
    expect(pv.adId).toBe(9);
    expect(pv.creatorId).toBe(42);
    expect(pv.revenueCents).toBe(2);
    expect(pv.creatorShareCents).toBe(1);
    expect(pv.completed).toBe(true);

    const adUpdates = updatesFor(prerollAds);
    expect(adUpdates).toHaveLength(1);

    const earnings = insertsFor(campaignEarnings);
    expect(earnings).toHaveLength(1);
    const ev = earnings[0].values as Record<string, unknown>;
    expect(ev.campaignId).toBeNull();
    expect(ev.creatorId).toBe(42);
    expect(ev.status).toBe("approved");
    expect(ev.amount).toBe("0.01");
    expect(String(ev.idempotencyKey)).toMatch(/^preroll:/);
  });
  it("marks skipped plays not completed", async () => {
    h.state.selectQueue = [
      [
        {
          minFollowers: 1000,
          minViews: 10000,
          costPerPlayCents: 2,
          maxPlaysPerViewerPerDay: 20,
        },
      ],
      [
        {
          id: 9,
          status: "active",
          spentCents: 0,
          budgetCents: 50000,
          currency: "USD",
          startsAt: null,
        },
      ],
      [{ id: 1, userId: 42 }],
    ];
    await reportPlay({
      adId: 9,
      videoId: 1,
      watchedSecs: 6,
      skipped: true,
      viewerHash: "vh",
    });
    const pv = insertsFor(prerollPlays)[0].values as Record<string, unknown>;
    expect(pv.skipped).toBe(true);
    expect(pv.completed).toBe(false);
  });
  it("aborts when the budget is exhausted", async () => {
    h.state.selectQueue = [
      [
        {
          minFollowers: 1000,
          minViews: 10000,
          costPerPlayCents: 2,
          maxPlaysPerViewerPerDay: 20,
        },
      ],
      [
        {
          id: 9,
          status: "active",
          spentCents: 50000,
          budgetCents: 50000,
          currency: "USD",
          startsAt: null,
        },
      ],
    ];
    await expect(
      reportPlay({
        adId: 9,
        videoId: 1,
        watchedSecs: 8,
        skipped: false,
        viewerHash: "vh",
      })
    ).rejects.toThrow("budget exhausted");
    expect(insertsFor(prerollPlays)).toHaveLength(0);
    expect(insertsFor(campaignEarnings)).toHaveLength(0);
  });
  it("aborts when the ad is not active", async () => {
    h.state.selectQueue = [
      [
        {
          minFollowers: 1000,
          minViews: 10000,
          costPerPlayCents: 2,
          maxPlaysPerViewerPerDay: 20,
        },
      ],
      [
        {
          id: 9,
          status: "paused",
          spentCents: 0,
          budgetCents: 50000,
          currency: "USD",
          startsAt: null,
        },
      ],
    ];
    await expect(
      reportPlay({
        adId: 9,
        videoId: 1,
        watchedSecs: 8,
        skipped: false,
        viewerHash: "vh",
      })
    ).rejects.toThrow("not active");
  });
});

describe("updateAdStatus", () => {
  it("moves active→paused", async () => {
    h.state.selectQueue = [[{ id: 9, userId: 5, status: "active" }]];
    const out = await updateAdStatus(5, 9, "paused");
    expect(updatesFor(prerollAds)).toHaveLength(1);
    expect(out.id).toBe(7); // fake returning id
  });
  it("blocks advertiser self-approval of drafts", async () => {
    h.state.selectQueue = [[{ id: 9, userId: 5, status: "draft" }]];
    await expect(updateAdStatus(5, 9, "active")).rejects.toThrow(
      "Only an admin"
    );
  });
  it("rejects another user's ad", async () => {
    h.state.selectQueue = [[{ id: 9, userId: 6, status: "draft" }]];
    await expect(updateAdStatus(5, 9, "active")).rejects.toThrow("not found");
  });
  it("rejects an illegal transition", async () => {
    h.state.selectQueue = [[{ id: 9, userId: 5, status: "ended" }]];
    await expect(updateAdStatus(5, 9, "active")).rejects.toThrow();
  });
});
