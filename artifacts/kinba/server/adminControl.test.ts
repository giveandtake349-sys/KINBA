/**
 * JHILIK Admin Control Center — overview resilience tests.
 *
 * getAdminOverview must always resolve with every key, even when a table
 * is empty or a single stat query fails (Issue 1: Overview stuck on
 * "Loading…" forever on the live site).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    selectQueue: [] as unknown[][],
    failOn: -1,
    selectCalls: 0,
    inserts: [] as Array<{ table: unknown; values: unknown }>,
    deletes: [] as Array<{ table: unknown }>,
  };

  function makeSelect(rows: unknown[], callIndex: number) {
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    if (callIndex === state.failOn) {
      chain.then = (
        _resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown
      ) => Promise.reject(new Error("boom")).then(_resolve, reject);
    } else {
      chain.then = (
        resolve: (value: unknown) => unknown,
        reject: (reason: unknown) => unknown
      ) => Promise.resolve(rows).then(resolve, reject);
    }
    for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy", "limit", "offset"]) {
      chain[method] = () => chain;
    }
    return chain;
  }

  const fakeDb: Record<string, (...args: unknown[]) => unknown> = {
    select: () => {
      const idx = state.selectCalls++;
      return makeSelect(state.selectQueue.shift() ?? [], idx);
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        state.inserts.push({ table, values });
        return Promise.resolve([]);
      },
    }),
    delete: (table: unknown) => {
      state.deletes.push({ table });
      return { where: () => Promise.resolve([]) };
    },
  };

  return { state, fakeDb };
});

vi.mock("./db", () => ({
  getDb: () => Promise.resolve(h.fakeDb),
}));

import {
  getAdminOverview,
  getAdTargetDetails,
  setAdTargets,
} from "./adminControl";
import { prerollAdTargets } from "../drizzle/schema";

beforeEach(() => {
  h.state.selectQueue = [];
  h.state.failOn = -1;
  h.state.selectCalls = 0;
  h.state.inserts = [];
  h.state.deletes = [];
});

// Select order in getAdminOverview (Promise.all, synchronous dispatch):
// users, videos, prerollAds, campaigns, moderationReports, campaignEarnings, prerollPlays
const queueAll = (...rows: unknown[][]) => {
  h.state.selectQueue.push(...rows);
};

describe("getAdminOverview", () => {
  it("resolves with all keys even when preroll_plays is empty", async () => {
    queueAll(
      [{ n: 42 }], // users
      [{ n: 17 }], // videos
      [{ n: 2 }], // pending preroll ads
      [{ n: 1 }], // pending campaigns
      [{ n: 0 }], // open reports
      [{ n: 3 }], // pending payouts
      [] // preroll_plays empty → no revenue row
    );
    const o = await getAdminOverview();
    expect(o).toEqual({
      users: 42,
      content: 17,
      pendingAdReviews: 3,
      openReports: 0,
      pendingPayouts: 3,
      adRevenueCents: 0,
    });
  });

  it("sums play revenue from preroll_plays", async () => {
    queueAll(
      [{ n: 1 }],
      [{ n: 1 }],
      [{ n: 0 }],
      [{ n: 0 }],
      [{ n: 0 }],
      [{ n: 0 }],
      [{ total: "9876" }]
    );
    const o = await getAdminOverview();
    expect(o.adRevenueCents).toBe(9876);
  });

  it("survives a single failing stat query (returns 0 for it)", async () => {
    queueAll(
      [{ n: 10 }],
      [{ n: 5 }],
      [{ n: 0 }],
      [{ n: 0 }],
      [{ n: 0 }],
      [{ n: 0 }],
      [{ total: "100" }]
    );
    // Fail the 7th select (prerollPlays revenue query).
    h.state.failOn = 6;
    const o = await getAdminOverview();
    expect(o.users).toBe(10);
    expect(o.content).toBe(5);
    expect(o.adRevenueCents).toBe(0);
  });

  it("survives a failing count query early in the list", async () => {
    queueAll(
      [{ n: 10 }],
      [{ n: 5 }],
      [{ n: 0 }],
      [{ n: 0 }],
      [{ n: 0 }],
      [{ n: 0 }],
      [{ total: "100" }]
    );
    // Fail the 1st select (users count).
    h.state.failOn = 0;
    const o = await getAdminOverview();
    expect(o.users).toBe(0);
    expect(o.content).toBe(5);
    expect(o.adRevenueCents).toBe(100);
  });
});

describe("setAdTargets (admin)", () => {
  it("replaces targets: deletes old, inserts new, logs the action", async () => {
    queueAll(
      [{ id: 9 }], // ad exists
      [{ id: 11 }, { id: 22 }] // both videos exist
    );
    const res = await setAdTargets(1, 9, [11, 22, 11]);
    expect(res).toEqual({ ok: true, count: 2 });
    // Old targets wiped…
    expect(h.state.deletes).toHaveLength(1);
    expect(h.state.deletes[0].table).toBe(prerollAdTargets);
    // …new targets inserted (deduped)…
    const targetInsert = h.state.inserts.find(i => i.table === prerollAdTargets);
    expect(targetInsert?.values).toEqual([
      { adId: 9, videoId: 11 },
      { adId: 9, videoId: 22 },
    ]);
  });

  it("empty list clears targets (back to automatic pool)", async () => {
    queueAll([{ id: 9 }]); // ad exists; no video check needed
    const res = await setAdTargets(1, 9, []);
    expect(res).toEqual({ ok: true, count: 0 });
    expect(h.state.deletes).toHaveLength(1);
    expect(h.state.inserts.filter(i => i.table === prerollAdTargets)).toHaveLength(0);
  });

  it("throws when the ad does not exist", async () => {
    queueAll([]); // no ad row
    await expect(setAdTargets(1, 999, [11])).rejects.toThrow(/Ad not found/);
  });

  it("throws when a video does not exist", async () => {
    queueAll(
      [{ id: 9 }], // ad exists
      [{ id: 11 }] // 99 missing
    );
    await expect(setAdTargets(1, 9, [11, 99])).rejects.toThrow(/not found/);
  });

  it("rejects more than 50 videos", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => i + 1);
    await expect(setAdTargets(1, 9, ids)).rejects.toThrow(/at most 50/i);
  });
});

describe("getAdTargetDetails (admin)", () => {
  it("returns target video details", async () => {
    queueAll([
      {
        videoId: 11,
        title: "My Video",
        thumbnailUrl: "https://cdn.example/t.jpg",
        creatorName: "Ayesha",
      },
    ]);
    const rows = await getAdTargetDetails(9);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ videoId: 11, title: "My Video" });
  });
});
