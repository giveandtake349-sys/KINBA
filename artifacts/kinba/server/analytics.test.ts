/**
 * JHILIK Ads Phase 5 — real measurement.
 *
 * DB-backed behaviors run against a scripted in-memory fake of the drizzle
 * query surface (no test database in this environment): selects resolve
 * queued rows in call order, inserts/updates are captured for assertions.
 * Plus pure unit tests (hashing, bot detection, rate math, engagement rate).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dailyContentStats,
  rateLimitBuckets,
  videoImpressions,
  videos,
  videoViewEvents,
} from "../drizzle/schema";

const h = vi.hoisted(() => {
  const state = {
    selectQueue: [] as unknown[][],
    inserts: [] as Array<{ table: unknown; values: unknown }>,
    updates: [] as Array<{ table: unknown; values: unknown }>,
    conflictTarget: null as unknown,
    // Controls what `.returning()` yields after onConflictDoNothing:
    // "new" = row inserted, "duplicate" = conflict (0 rows).
    insertMode: "new" as "new" | "duplicate",
    // Count returned by the rate-limit bucket upsert.
    rateLimitCount: 1,
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
      chain.returning = () => {
        if (table === rateLimitBuckets) {
          return thenable([{ count: state.rateLimitCount }]);
        }
        return thenable([{ id: state.nextId++ }]);
      };
      chain.onConflictDoNothing = (opts: unknown) => {
        state.conflictTarget = opts;
        return {
          returning: () =>
            thenable(state.insertMode === "new" ? [{ id: state.nextId++ }] : []),
        };
      };
      chain.onConflictDoUpdate = () => ({
        returning: () => thenable([{ count: state.rateLimitCount }]),
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown
        ) => Promise.resolve([{ count: state.rateLimitCount }]).then(resolve, reject),
      });
      return chain;
    },
    update: (table: unknown) => ({
      set: (values: unknown) => {
        state.updates.push({ table, values });
        return { where: () => thenable([]) };
      },
    }),
  };

  return { state, fakeDb };
});

vi.mock("./db", () => ({
  getDb: () => Promise.resolve(h.fakeDb),
}));

import {
  BOT_UA_RE,
  checkDbRateLimit,
  engagementRateOf,
  getAdminStats,
  getCreatorBreakdownForCampaign,
  getCreatorStats,
  hashViewerIp,
  isBotUserAgent,
  recordImpressionEvent,
  recordViewEvent,
  viewerDayUTC,
} from "./analytics";

beforeEach(() => {
  h.state.selectQueue = [];
  h.state.inserts = [];
  h.state.updates = [];
  h.state.conflictTarget = null;
  h.state.insertMode = "new";
  h.state.rateLimitCount = 1;
  h.state.nextId = 100;
});

const queueSelects = (...rows: unknown[][]) => {
  h.state.selectQueue.push(...rows);
};

const insertsFor = (table: unknown) =>
  h.state.inserts.filter(entry => entry.table === table);

const VIDEO_ROW = { id: 7, userId: 42, campaignId: null, mediaType: "VIDEO" };

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

describe("viewerDayUTC", () => {
  it("returns YYYY-MM-DD in UTC", () => {
    expect(viewerDayUTC(new Date("2026-10-14T12:00:00Z"))).toBe("2026-10-14");
  });
});

describe("hashViewerIp", () => {
  it("is deterministic for the same ip+salt+day", () => {
    expect(hashViewerIp("1.2.3.4", "salt")).toBe(hashViewerIp("1.2.3.4", "salt"));
  });
  it("differs per ip and per salt, and never contains the raw ip", () => {
    const a = hashViewerIp("1.2.3.4", "salt");
    expect(hashViewerIp("5.6.7.8", "salt")).not.toBe(a);
    expect(hashViewerIp("1.2.3.4", "other")).not.toBe(a);
    expect(a).not.toContain("1.2.3.4");
    expect(a).toHaveLength(64);
  });
});

describe("isBotUserAgent", () => {
  it("flags known bots, passes real browsers", () => {
    expect(isBotUserAgent("Googlebot/2.1")).toBe(true);
    expect(isBotUserAgent("facebookexternalhit/1.1")).toBe(true);
    expect(isBotUserAgent("WhatsApp/2.0")).toBe(true);
    expect(
      isBotUserAgent(
        "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120"
      )
    ).toBe(false);
    expect(isBotUserAgent(null)).toBe(false);
    expect(isBotUserAgent("")).toBe(false);
  });
  it("matches the shared BOT_UA_RE export", () => {
    expect(BOT_UA_RE.test("Discordbot/2.0")).toBe(true);
  });
});

describe("engagementRateOf (Facebook-style: engagements ÷ reach)", () => {
  it("computes percentage with 1 decimal", () => {
    expect(engagementRateOf(50, 1000)).toBe(5);
    expect(engagementRateOf(1, 3)).toBe(33.3);
  });
  it("returns null when reach is zero", () => {
    expect(engagementRateOf(10, 0)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* recordViewEvent                                                       */
/* ------------------------------------------------------------------ */

describe("recordViewEvent", () => {
  const base = {
    contentId: 7,
    source: "feed",
    userId: 99,
    ip: "9.9.9.9",
    ipSalt: "test-salt",
    userAgent: "Mozilla/5.0",
  };

  it("records a new view with contentType + viewerHash, bumps viewCount", async () => {
    queueSelects([VIDEO_ROW]);
    const result = await recordViewEvent(base);
    expect(result).toEqual({ counted: true });
    const inserts = insertsFor(videoViewEvents);
    expect(inserts).toHaveLength(1);
    const values = inserts[0].values as Record<string, unknown>;
    expect(values.videoId).toBe(7);
    expect(values.contentType).toBe("VIDEO");
    expect(values.viewerHash).toHaveLength(64);
    expect(String(values.viewerHash)).not.toContain("9.9.9.9");
    expect(values.day).toBe(viewerDayUTC());
    // Legacy counter maintained.
    expect(h.state.updates).toHaveLength(1);
    expect(h.state.updates[0].table).toBe(videos);
  });

  it("dedups the same viewer+content+day (DB conflict → not counted)", async () => {
    queueSelects([VIDEO_ROW]);
    h.state.insertMode = "duplicate";
    const result = await recordViewEvent(base);
    expect(result).toEqual({ counted: false, reason: "duplicate" });
    // No legacy counter bump on duplicates.
    expect(h.state.updates).toHaveLength(0);
  });

  it("excludes creator self-views entirely", async () => {
    queueSelects([VIDEO_ROW]);
    const result = await recordViewEvent({ ...base, userId: 42 });
    expect(result).toEqual({ counted: false, reason: "self-view" });
    expect(insertsFor(videoViewEvents)).toHaveLength(0);
  });

  it("skips bots", async () => {
    queueSelects([VIDEO_ROW]);
    const result = await recordViewEvent({
      ...base,
      userAgent: "Googlebot/2.1",
    });
    expect(result).toEqual({ counted: false, reason: "bot" });
    expect(insertsFor(videoViewEvents)).toHaveLength(0);
  });

  it("returns not-found for missing content", async () => {
    queueSelects([]);
    const result = await recordViewEvent(base);
    expect(result).toEqual({ counted: false, reason: "not-found" });
  });

  it("stores the photo/text contentType for non-video content", async () => {
    queueSelects([{ id: 8, userId: 42, campaignId: null, mediaType: "IMAGE" }]);
    const result = await recordViewEvent({ ...base, contentId: 8 });
    expect(result.counted).toBe(true);
    const values = insertsFor(videoViewEvents)[0].values as Record<string, unknown>;
    expect(values.contentType).toBe("IMAGE");
  });
});

/* ------------------------------------------------------------------ */
/* recordImpressionEvent                                                 */
/* ------------------------------------------------------------------ */

describe("recordImpressionEvent", () => {
  const base = {
    contentId: 7,
    userId: 99,
    ip: "9.9.9.9",
    ipSalt: "test-salt",
    userAgent: "Mozilla/5.0",
  };

  it("records a new impression with contentType", async () => {
    queueSelects([VIDEO_ROW]);
    const result = await recordImpressionEvent(base);
    expect(result).toEqual({ counted: true });
    const inserts = insertsFor(videoImpressions);
    expect(inserts).toHaveLength(1);
    expect(
      (inserts[0].values as Record<string, unknown>).contentType
    ).toBe("VIDEO");
    // No legacy counter for impressions.
    expect(h.state.updates).toHaveLength(0);
  });

  it("excludes self-views and bots", async () => {
    queueSelects([VIDEO_ROW]);
    expect(
      (await recordImpressionEvent({ ...base, userId: 42 })).reason
    ).toBe("self-view");
    queueSelects([VIDEO_ROW]);
    expect(
      (await recordImpressionEvent({ ...base, userAgent: "Twitterbot/1.0" }))
        .reason
    ).toBe("bot");
  });
});

/* ------------------------------------------------------------------ */
/* checkDbRateLimit                                                      */
/* ------------------------------------------------------------------ */

describe("checkDbRateLimit", () => {
  it("allows requests under the limit", async () => {
    h.state.rateLimitCount = 5;
    const result = await checkDbRateLimit({
      key: "k",
      windowMs: 60_000,
      max: 60,
    });
    expect(result.allowed).toBe(true);
    expect(insertsFor(rateLimitBuckets)).toHaveLength(1);
  });

  it("blocks over the limit with a retry-after", async () => {
    h.state.rateLimitCount = 61;
    const result = await checkDbRateLimit({
      key: "k",
      windowMs: 60_000,
      max: 60,
    });
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it("scopes buckets per key (no cross-key interference)", async () => {
    h.state.rateLimitCount = 61;
    await checkDbRateLimit({ key: "a", windowMs: 60_000, max: 60 });
    await checkDbRateLimit({ key: "b", windowMs: 60_000, max: 60 });
    const keys = insertsFor(rateLimitBuckets).map(
      i => (i.values as Record<string, unknown>).key
    );
    expect(keys).toEqual(["a", "b"]);
  });
});

/* ------------------------------------------------------------------ */
/* rollupVideoDay                                                         */
/* ------------------------------------------------------------------ */

describe("rollupVideoDay", () => {
  it("aggregates events into daily_content_stats with contentType", async () => {
    const { rollupVideoDay } = await import("./analytics");
    // select video → view agg → impression agg → click agg
    queueSelects(
      [{ mediaType: "TEXT" }],
      [{ views: "3", uniqueViewers: "2" }],
      [{ impressions: "10" }],
      [{ clicks: "1" }]
    );
    await rollupVideoDay(9, "2026-10-14");
    const inserts = insertsFor(dailyContentStats);
    expect(inserts).toHaveLength(1);
    const values = inserts[0].values as Record<string, unknown>;
    expect(values).toMatchObject({
      videoId: 9,
      day: "2026-10-14",
      contentType: "TEXT",
      views: 3,
      impressions: 10,
      clicks: 1,
      uniqueViewers: 2,
    });
  });
});

/* ------------------------------------------------------------------ */
/* getCreatorBreakdownForCampaign                                       */
/* ------------------------------------------------------------------ */

describe("getCreatorBreakdownForCampaign", () => {
  it("aggregates per-creator views, reach, engagements and rewards, sorted by views", async () => {
    queueSelects(
      // 1. accepted invitees + public profiles
      [
        {
          userId: 11,
          rewardAmount: "120.00",
          rewardCurrency: "USD",
          displayName: "Rahim",
          username: "rahim",
        },
        {
          userId: 12,
          rewardAmount: "85.00",
          rewardCurrency: "USD",
          displayName: "Sara",
          username: "sara",
        },
      ],
      // 2. views per creator (rolled-up)
      [
        { userId: 11, views: "48" },
        { userId: 12, views: "31" },
      ],
      // 3. reach per creator (deduped events)
      [
        { userId: 11, reach: "40" },
        { userId: 12, reach: "25" },
      ],
      // 4. campaign videos grouped by creator
      [
        { id: 101, userId: 11 },
        { id: 102, userId: 12 },
      ],
      // 5-7. engagement tables (reactions, comments, shares)
      [
        { videoId: 101, n: "20" },
        { videoId: 102, n: "15" },
      ],
      [
        { videoId: 101, n: "8" },
        { videoId: 102, n: "5" },
      ],
      [
        { videoId: 101, n: "4" },
        { videoId: 102, n: "2" },
      ]
    );
    const rows = await getCreatorBreakdownForCampaign(9, "2026-10-07");
    expect(rows).toHaveLength(2);
    // Sorted by views desc.
    expect(rows[0].userId).toBe(11);
    expect(rows[0].views).toBe(48);
    expect(rows[0].reach).toBe(40);
    expect(rows[0].engagements).toBe(32); // 20 + 8 + 4
    expect(rows[0].engagementRate).toBe(80); // 32/40 — FB formula
    expect(rows[0].rewardAmount).toBe("120.00");
    expect(rows[0].rewardCurrency).toBe("USD");
    expect(rows[0].username).toBe("rahim");
    expect(rows[1].userId).toBe(12);
    expect(rows[1].engagements).toBe(22); // 15 + 5 + 2
    expect(rows[1].engagementRate).toBe(88); // 22/25
  });

  it("returns [] when no creators accepted the campaign", async () => {
    queueSelects([]);
    const rows = await getCreatorBreakdownForCampaign(9, "2026-10-07");
    expect(rows).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* getCreatorStats — engagement split in totals                         */
/* ------------------------------------------------------------------ */

describe("getCreatorStats engagement split", () => {
  it("exposes real reactions/comments/shares totals for the hero bars", async () => {
    const rollupSelects: unknown[][] = [];
    for (let i = 0; i < 7; i++) {
      rollupSelects.push(
        [{ mediaType: "VIDEO" }],
        [{ views: "10", uniqueViewers: "8" }],
        [{ impressions: "20" }],
        [{ clicks: "2" }]
      );
    }
    queueSelects(
      [{ id: 7, title: "T", mediaType: "VIDEO" }], // ownVideos
      ...rollupSelects, // 7 × rollupVideoDay
      [{ videoId: 7, n: "5" }], // engagementByVideo: reactions
      [{ videoId: 7, n: "3" }], // comments
      [{ videoId: 7, n: "1" }], // shares
      [
        {
          videoId: 7,
          day: "2026-10-14",
          contentType: "VIDEO",
          views: "10",
          impressions: "20",
          clicks: "2",
          uniqueViewers: "8",
        },
      ], // stats
      [{ n: "5" }], // reactions count
      [{ n: "3" }], // comments count
      [{ n: "1" }], // shares count
      [{ reach: "8" }], // total reach
      [{ videoId: 7, reach: "8" }], // reach by video
      [{ contentType: "VIDEO", reach: "8" }] // reach by type
    );
    const dash = await getCreatorStats(11, 7);
    expect(dash.hasData).toBe(true);
    expect(dash.totals.reactions).toBe(5);
    expect(dash.totals.comments).toBe(3);
    expect(dash.totals.shares).toBe(1);
    expect(dash.totals.engagements).toBe(9);
    expect(dash.totals.engagementRate).toBe(112.5); // 9/8 — FB formula
  });
});

/* ------------------------------------------------------------------ */
/* getAdminStats — platform-wide engagement totals                       */
/* ------------------------------------------------------------------ */

describe("getAdminStats engagement totals", () => {
  it("sums real engagements and reach across types for the avg eng. KPI", async () => {
    const rollupSelects: unknown[][] = [];
    for (let i = 0; i < 30; i++) {
      rollupSelects.push(
        [{ views: "10", uniqueViewers: "8" }],
        [{ impressions: "40" }],
        [{ clicks: "2" }],
        [{ spend: "5.00" }]
      );
    }
    queueSelects(
      [{ id: 9, title: "C1", status: "active", budgetCurrency: "USD" }], // camps
      ...rollupSelects, // 30 × rollupCampaignDay
      [{ campaignId: 9, views: "10", impressions: "40", clicks: "2", spend: "5.00" }], // stats
      [{ contentType: "VIDEO", views: "10", impressions: "40", clicks: "2" }], // byType rows
      [{ contentType: "VIDEO", reach: "8" }], // byType reach
      [{ contentType: "VIDEO", n: "6" }], // engagement: reactions
      [{ contentType: "VIDEO", n: "3" }], // comments
      [{ contentType: "VIDEO", n: "1" }] // shares
    );
    const dash = await getAdminStats(30);
    expect(dash.hasData).toBe(true);
    expect(dash.totals.engagements).toBe(10); // 6 + 3 + 1
    expect(dash.totals.reach).toBe(8);
    expect(dash.totals.avgEngagementRate).toBe(125); // 10/8 — FB formula
    // Admin top-campaigns table doesn't carry per-creator rows.
    expect(dash.campaigns[0].creators).toEqual([]);
  });
});
