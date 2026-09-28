/**
 * M4/M5 backend: typed `videos.react` / `community.react` inputs plus the
 * viewer's active reaction on list payloads.
 *
 * Contract under test:
 * - `videos.react` and `community.react` accept an optional `reaction` drawn
 *   from REACTION_TYPES and forward it to the existing M2 toggles; omitting it
 *   keeps the historical binary "like" behaviour; an unknown type is rejected
 *   by the input schema before any statement runs.
 * - `videos.list` exposes `viewerReaction` (the stored type, or null) alongside
 *   the pre-existing `viewerReacted` flag, for anonymous readers too.
 * - `community.list` / `community.mine` return the real `viewerReacted` (the
 *   previous hardcoded `false` was a client-visible bug) and the matching
 *   `viewerReaction`, while `viewerBookmarked` stays untouched.
 * - `community.mine` keeps filtering to the caller's own announcements.
 *
 * Like videoCommunityReactions/commentLikeIsolation, this drives the real
 * drizzle queries through a fake `pg` Pool backed by in-memory SQLite, so the
 * new correlated subqueries are executed rather than asserted on source text.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, type Table } from "drizzle-orm";

const holder = vi.hoisted(() => ({
  sqlite: null as unknown as import("node:sqlite").DatabaseSync | null,
  queries: [] as Array<{ text: string; params: unknown[] }>,
  sequence: 0,
  rowId: 1,
}));

vi.mock("pg", async () => {
  const actual = await vi.importActual<typeof import("pg")>("pg");
  const { createRequire } = await import("node:module");
  const require = createRequire(process.cwd() + "/package.json");
  const { DatabaseSync } =
    require("node:sqlite") as typeof import("node:sqlite");

  const sqlite = new DatabaseSync(":memory:");
  holder.sqlite = sqlite;
  holder.queries = [];

  const runStatement = (text: string, params: unknown[] = []) => {
    holder.queries.push({ text, params });

    const bound: unknown[] = [];
    let rewritten: string;

    const insert = text.match(
      /^(insert\s+into\s+"[^"]+"\s*\(([^)]*)\)\s*values\s*\()([^)]*)(\))$/i
    );
    if (insert) {
      const columns = insert[2]
        .split(",")
        .map(column => column.trim().replace(/"/g, ""));
      const values = insert[3].split(",").map((token, index) => {
        const placeholder = /^\$([0-9]+)$/.exec(token.trim());
        if (placeholder) {
          const value = params[Number(placeholder[1]) - 1];
          bound.push(value === undefined ? null : value);
          return "?";
        }
        if (/^default$/i.test(token.trim())) {
          bound.push(/(^|_)id$/i.test(columns[index]) ? holder.rowId++ : null);
          return "?";
        }
        return token.trim();
      });
      rewritten = `${insert[1]}${values.join(", ")}${insert[4]}`;
    } else {
      rewritten = text.replace(/\$([0-9]+)/g, (_match, index: string) => {
        const value = params[Number(index) - 1];
        bound.push(value === undefined ? null : value);
        return "?";
      });
    }

    if (!/^\s*select\b/i.test(rewritten)) {
      if (bound.length > 0)
        sqlite.prepare(rewritten).run(...(bound as never[]));
      else sqlite.exec(rewritten);
      return { rows: [] as unknown[][] };
    }

    const locked = rewritten.replace(/\s+for\s+update\b/gi, "");

    const table = `kinba_result_${holder.sequence++}`;
    try {
      sqlite
        .prepare(`create temp table ${table} as ${locked}`)
        .all(...(bound as never[]));
      const statement = sqlite.prepare(`select * from ${table}`);
      const names = statement.columns().map(column => column.name);
      const rows = statement
        .all()
        .map(row => names.map(name => (row as Record<string, unknown>)[name]));
      return { rows };
    } finally {
      sqlite.exec(`drop table if exists ${table}`);
    }
  };

  class FakePool {
    constructor(_options?: unknown) {}
    async query(config: unknown, params: unknown[] = []) {
      const text =
        typeof config === "string" ? config : (config as { text: string }).text;
      const values =
        typeof config === "string"
          ? params
          : ((config as { values?: unknown[] }).values ?? params);
      return runStatement(text, values);
    }
    async connect() {
      const pool = this;
      return {
        query: pool.query.bind(pool),
        release() {},
      };
    }
    on() {
      return this;
    }
    end() {}
  }

  const module = (actual.default ?? actual) as Record<string, unknown>;
  const patched = { ...module, Pool: FakePool };
  return { ...patched, default: patched, Pool: FakePool };
});

vi.mock("./storage", () => ({
  MEDIA_BUCKET: "signal-media",
  storageDelete: vi.fn(),
}));
vi.mock("./hlsProcessor", () => ({ queueVideoTranscode: vi.fn() }));

import {
  communityAnnouncementAttachments,
  communityAnnouncements,
  communityComments,
  communityReactions,
  profiles,
  users,
  videoBookmarks,
  videoComments,
  videoReactions,
  videoShares,
  videoSources,
  videos,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";
import { appRouter } from "./routers";

function createTable(table: Table): string {
  const columns = Object.values(getTableColumns(table))
    .map(column => `"${column.name}"`)
    .join(", ");
  return `CREATE TABLE "${getTableName(table)}" (${columns})`;
}

function reactionRowsOf(
  table: "video_reactions" | "community_reactions",
  targetColumn: "videoId" | "announcementId",
  targetId: number
) {
  return holder
    .sqlite!.prepare(
      `SELECT "userId", "reaction" FROM "${table}"
        WHERE "${targetColumn}" = ? ORDER BY "userId"`
    )
    .all(targetId) as Array<{ userId: number; reaction: string }>;
}

const viewer = {
  id: 81,
  openId: "kinba-viewer-81",
  name: "Viewer Eighty One",
  email: "viewer81@example.test",
  loginMethod: "email",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function context(activeUser: typeof viewer | null = viewer): TrpcContext {
  return {
    user: activeUser,
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/kinba-test";

  const sqlite = holder.sqlite!;
  for (const table of [
    users,
    profiles,
    videos,
    videoSources,
    videoReactions,
    videoShares,
    videoComments,
    videoBookmarks,
    communityAnnouncements,
    communityComments,
    communityAnnouncementAttachments,
    communityReactions,
  ]) {
    sqlite.exec(createTable(table));
  }

  sqlite.exec(
    `CREATE UNIQUE INDEX "video_reactions_pair_unique"
       ON "video_reactions" ("videoId", "userId")`
  );
  sqlite.exec(
    `CREATE UNIQUE INDEX "community_reactions_pair_unique"
       ON "community_reactions" ("announcementId", "userId")`
  );

  const insertUser = sqlite.prepare(
    `INSERT INTO "users" ("id", "openId", "name") VALUES (?, ?, ?)`
  );
  insertUser.run(81, "kinba-viewer-81", "Viewer Eighty One");
  insertUser.run(82, "kinba-other-82", "Other Member");

  const insertVideo = sqlite.prepare(
    `INSERT INTO "videos"
       ("id", "userId", "title", "description", "videoUrl", "mediaType",
        "kind", "durationSeconds", "width", "height", "processingStatus",
        "createdAt")
     VALUES (?, ?, ?, ?, ?, 'VIDEO', 'LONG', 12, 640, 360, 'READY', ?)`
  );
  // 50/56 carry seeded viewer reactions; 51/56 are list-only targets and the
  // 5x series are the react-mutation targets so suites never share state.
  for (const videoId of [50, 51, 52, 53, 54, 55, 56]) {
    insertVideo.run(
      videoId,
      81,
      `Video ${videoId}`,
      `Description ${videoId}`,
      `https://cdn.test/${videoId}.mp4`,
      `2026-09-0${(videoId % 9) + 1}T09:00:00.000Z`
    );
  }

  const insertVideoReaction = sqlite.prepare(
    `INSERT INTO "video_reactions" ("id", "videoId", "userId", "reaction", "createdAt")
     VALUES (?, ?, ?, ?, ?)`
  );
  // video 50: the viewer's active type plus another user's like.
  insertVideoReaction.run(301, 50, 81, "clap", "2026-09-01T10:00:00.000Z");
  insertVideoReaction.run(302, 50, 82, "like", "2026-09-01T10:05:00.000Z");
  // video 56: only another user reacted, so the viewer is inert.
  insertVideoReaction.run(303, 56, 82, "love", "2026-09-01T10:10:00.000Z");

  const insertAnnouncement = sqlite.prepare(
    `INSERT INTO "community_announcements" ("id", "userId", "body", "createdAt")
     VALUES (?, ?, ?, ?)`
  );
  for (const announcementId of [70, 71, 73, 74, 75]) {
    insertAnnouncement.run(
      announcementId,
      81,
      `Announcement ${announcementId}`,
      `2026-09-0${(announcementId % 9) + 1}T09:00:00.000Z`
    );
  }
  // Owned by another user: excluded by community.mine for viewer 81.
  insertAnnouncement.run(
    72,
    82,
    "Announcement 72",
    "2026-09-03T09:00:00.000Z"
  );

  const insertCommunityReaction = sqlite.prepare(
    `INSERT INTO "community_reactions" ("id", "announcementId", "userId", "reaction", "createdAt")
     VALUES (?, ?, ?, ?, ?)`
  );
  // announcement 70: the viewer's active type plus another user's like.
  insertCommunityReaction.run(401, 70, 81, "fire", "2026-09-01T11:00:00.000Z");
  insertCommunityReaction.run(402, 70, 82, "like", "2026-09-01T11:05:00.000Z");
  // announcement 71: only another user reacted.
  insertCommunityReaction.run(403, 71, 82, "love", "2026-09-01T11:10:00.000Z");
});

beforeEach(() => {
  holder.queries.length = 0;
});

describe("typed reaction inputs reach the database", () => {
  it("forwards videos.react's typed reaction to the M2 toggle", async () => {
    const result = await appRouter
      .createCaller(context())
      .videos.react({ videoId: 51, reaction: "fire" });

    expect(result.viewerReacted).toBe(true);
    expect(result.reactionCount).toBe(1);
    expect(reactionRowsOf("video_reactions", "videoId", 51)).toEqual([
      { userId: 81, reaction: "fire" },
    ]);
  });

  it("keeps videos.react binary when the reaction is omitted", async () => {
    const result = await appRouter
      .createCaller(context())
      .videos.react({ videoId: 52 });

    expect(result.viewerReacted).toBe(true);
    expect(reactionRowsOf("video_reactions", "videoId", 52)).toEqual([
      { userId: 81, reaction: "like" },
    ]);
  });

  it("rejects an unknown video reaction before any statement runs", async () => {
    await expect(
      appRouter
        .createCaller(context())
        .videos.react({ videoId: 53, reaction: "thumb" as never })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(reactionRowsOf("video_reactions", "videoId", 53)).toEqual([]);
    expect(holder.queries).toHaveLength(0);
  });

  it("forwards community.react's typed reaction to the M2 toggle", async () => {
    const result = await appRouter
      .createCaller(context())
      .community.react({ announcementId: 73, reaction: "clap" });

    expect(result.viewerReacted).toBe(true);
    expect(reactionRowsOf("community_reactions", "announcementId", 73)).toEqual([
      { userId: 81, reaction: "clap" },
    ]);
  });

  it("keeps community.react binary when the reaction is omitted", async () => {
    const result = await appRouter
      .createCaller(context())
      .community.react({ announcementId: 74 });

    expect(result.viewerReacted).toBe(true);
    expect(
      reactionRowsOf("community_reactions", "announcementId", 74)
    ).toEqual([{ userId: 81, reaction: "like" }]);
  });

  it("rejects an unknown community reaction before any statement runs", async () => {
    await expect(
      appRouter
        .createCaller(context())
        .community.react({ announcementId: 75, reaction: "thumb" as never })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(reactionRowsOf("community_reactions", "announcementId", 75)).toEqual(
      []
    );
    expect(holder.queries).toHaveLength(0);
  });
});

describe("video list carries the viewer's active reaction", () => {
  it("returns the stored type for the signed-in viewer", async () => {
    const list = await appRouter
      .createCaller(context())
      .videos.list({ kind: "LONG" });

    const reactive = list.find(video => video.id === 50)!;
    expect(reactive.viewerReacted).toBe(true);
    expect(reactive.viewerReaction).toBe("clap");
    expect(reactive.reactionCount).toBe(2);

    const inert = list.find(video => video.id === 56)!;
    expect(inert.viewerReacted).toBe(false);
    expect(inert.viewerReaction).toBeNull();
  });

  it("never exposes a viewer reaction to anonymous readers", async () => {
    const list = await appRouter
      .createCaller(context(null))
      .videos.list({ kind: "LONG" });

    const reactive = list.find(video => video.id === 50)!;
    expect(reactive.viewerReacted).toBe(false);
    expect(reactive.viewerReaction).toBeNull();
  });
});

describe("community list carries the viewer's active reaction", () => {
  it("returns the real viewer state on community.list", async () => {
    const list = await appRouter.createCaller(context()).community.list();

    const reactive = list.find(item => item.id === 70)!;
    expect(reactive.viewerReacted).toBe(true);
    expect(reactive.viewerReaction).toBe("fire");
    expect(reactive.reactionCount).toBe(2);
    expect(reactive.viewerBookmarked).toBe(false);

    const inert = list.find(item => item.id === 71)!;
    expect(inert.viewerReacted).toBe(false);
    expect(inert.viewerReaction).toBeNull();
  });

  it("leaves viewer state inert for anonymous readers", async () => {
    const list = await appRouter
      .createCaller(context(null))
      .community.list();

    expect(list.length).toBeGreaterThan(0);
    for (const item of list) {
      expect(item.viewerReacted).toBe(false);
      expect(item.viewerReaction).toBeNull();
    }
  });

  it("keeps community.mine scoped to the caller with viewer state attached", async () => {
    const list = await appRouter.createCaller(context()).community.mine();

    expect(list.map(item => item.id).sort()).toEqual([70, 71, 73, 74, 75]);
    const reactive = list.find(item => item.id === 70)!;
    expect(reactive.viewerReacted).toBe(true);
    expect(reactive.viewerReaction).toBe("fire");
  });
});
