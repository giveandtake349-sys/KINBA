/**
 * M2: typed `video_reactions` / `community_reactions` columns.
 *
 * Binary-compatibility contract: a call that omits the typed argument must
 * behave exactly like the pre-M2 toggle — it inserts/removes a single row whose
 * `reaction` is "like" (the column default every pre-existing row resolves
 * to), row presence still means "reacted", and counts are untouched. Typed
 * calls add replace-in-place while keeping exactly one row per (target, user),
 * which `*_pair_unique` enforces at the database level — the invariant whose
 * absence produced the historical multi-type duplicates in comment_reactions
 * and hype_room_message_reactions.
 *
 * Like the other real-SQL suites (commentLikeIsolation, commentReplyCount),
 * this drives the actual `toggleVideoReaction` / `toggleCommunityReaction`
 * code through a real drizzle instance against in-memory SQLite:
 * - the emitted target-row read carries `for update`;
 * - `begin` … `commit` bracket the mutation (one transaction);
 * - INSERT statements may carry bare `default` tokens (resolved positionally);
 * - SQLite has no `FOR UPDATE`, so the lock is asserted on the raw statement
 *   text recorded before the executable copy is stripped.
 *
 * The migration itself cannot execute on SQLite (PostgreSQL-specific
 * `ADD COLUMN IF NOT EXISTS`), so its safety is asserted statically: exact
 * statement list, additive-only vocabulary, unchanged index set, and no
 * `_journal.json` entry for 0034.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns, getTableName, type Table } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

const holder = vi.hoisted(() => ({
  sqlite: null as unknown as import("node:sqlite").DatabaseSync | null,
  queries: [] as Array<{ text: string; params: unknown[] }>,
  sequence: 0,
  rowId: 1,
}));

vi.mock("pg", async () => {
  const actual = await vi.importActual<typeof import("pg")>("pg");
  // `node:sqlite` is not in Vite's externalised builtins list, so it is loaded
  // through Node's own resolver instead of the module graph.
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

    // Postgres placeholders -> SQLite placeholders (repeated `$n` re-binds).
    // An INSERT may also carry bare `default` values, which SQLite rejects;
    // they are resolved in the same positional pass so the bound array stays
    // aligned with the emitted `?` markers (synthetic row id / null).
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
      // Statements (BEGIN/COMMIT, INSERT, UPDATE, DELETE) run as-is;
      // parameterised ones go through `prepare().run()` so bound values stick.
      if (bound.length > 0)
        sqlite.prepare(rewritten).run(...(bound as never[]));
      else sqlite.exec(rewritten);
      return { rows: [] as unknown[][] };
    }

    // SQLite has no `FOR UPDATE`; the raw text was already recorded above so
    // the lock can be asserted, and only the executable copy is stripped.
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

import {
  communityAnnouncements,
  communityReactions,
  users,
  videoBookmarks,
  videoComments,
  videoReactions,
  videoShares,
  videos,
} from "../drizzle/schema";
import { toggleCommunityReaction, toggleVideoReaction } from "./db";

function createTable(table: Table): string {
  const columns = Object.values(getTableColumns(table))
    .map(column => `"${column.name}"`)
    .join(", ");
  return `CREATE TABLE "${getTableName(table)}" (${columns})`;
}

function videoReactionRows(videoId: number) {
  return holder
    .sqlite!.prepare(
      `SELECT "id", "userId", "reaction", "createdAt"
         FROM "video_reactions" WHERE "videoId" = ?
        ORDER BY "userId"`
    )
    .all(videoId) as Array<{
    id: number | null;
    userId: number;
    reaction: string;
    createdAt: string | null;
  }>;
}

function communityReactionRows(announcementId: number) {
  return holder
    .sqlite!.prepare(
      `SELECT "id", "userId", "reaction", "createdAt"
         FROM "community_reactions" WHERE "announcementId" = ?
        ORDER BY "userId"`
    )
    .all(announcementId) as Array<{
    id: number | null;
    userId: number;
    reaction: string;
    createdAt: string | null;
  }>;
}

function migrationFile(name: string): string {
  return readFileSync(join(process.cwd(), "drizzle", name), "utf8");
}

/**
 * Split a migration file into normalized SQL statements: breakpoint markers
 * first (they are SQL comments), then `--` comments dropped, then `;`.
 */
function statementsOf(sql: string): string[] {
  return sql
    .split(/-->\s*statement-breakpoint/)
    .flatMap(chunk => chunk.replace(/^\s*--.*$/gm, "").split(";"))
    .map(part => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const LIKE_ADD_VIDEO = `ALTER TABLE "video_reactions" ADD COLUMN IF NOT EXISTS "reaction" varchar(32) DEFAULT 'like' NOT NULL`;
const LIKE_ADD_COMMUNITY = `ALTER TABLE "community_reactions" ADD COLUMN IF NOT EXISTS "reaction" varchar(32) DEFAULT 'like' NOT NULL`;

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/kinba-test";

  const sqlite = holder.sqlite!;
  for (const table of [
    users,
    videos,
    videoReactions,
    videoShares,
    videoComments,
    videoBookmarks,
    communityAnnouncements,
    communityReactions,
  ]) {
    sqlite.exec(createTable(table));
  }

  // Mirror the production invariant the migration keeps untouched: one row per
  // (target, user), regardless of reaction type.
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
  insertUser.run(81, "open-id-81", "Reaction Actor");
  insertUser.run(82, "open-id-82", "Other Reactor");

  const insertVideo = sqlite.prepare(
    `INSERT INTO "videos" ("id", "userId", "createdAt") VALUES (?, ?, ?)`
  );
  // One target per test so suites never share state.
  for (const videoId of [40, 41, 42, 43, 44, 67]) {
    insertVideo.run(videoId, 81, "2026-09-01T09:00:00.000Z");
  }

  const insertAnnouncement = sqlite.prepare(
    `INSERT INTO "community_announcements" ("id", "userId", "createdAt")
     VALUES (?, ?, ?)`
  );
  for (const announcementId of [60, 61, 62, 63, 64, 65]) {
    insertAnnouncement.run(announcementId, 81, "2026-09-01T09:00:00.000Z");
  }

  // Seeded rows model the post-migration state of historical data: the
  // column default has resolved every pre-existing row to 'like'.
  const insertVideoReaction = sqlite.prepare(
    `INSERT INTO "video_reactions" ("id", "videoId", "userId", "reaction", "createdAt")
     VALUES (?, ?, ?, ?, ?)`
  );
  // video 41: both users reacted — a binary toggle by 81 must spare 82's row.
  insertVideoReaction.run(111, 41, 81, "like", "2026-09-01T10:00:00.000Z");
  insertVideoReaction.run(112, 41, 82, "like", "2026-09-01T10:05:00.000Z");
  // video 43: legacy 'like' replaced in place by a typed call.
  insertVideoReaction.run(113, 43, 81, "like", "2026-09-01T10:10:00.000Z");
  // video 44: stored type re-requested -> remove.
  insertVideoReaction.run(114, 44, 81, "fire", "2026-09-01T10:20:00.000Z");
  // video 67: another user already reacted (uniqueness sequence target).
  insertVideoReaction.run(115, 67, 82, "like", "2026-09-01T10:30:00.000Z");

  const insertCommunityReaction = sqlite.prepare(
    `INSERT INTO "community_reactions" ("id", "announcementId", "userId", "reaction", "createdAt")
     VALUES (?, ?, ?, ?, ?)`
  );
  // announcement 61: both users reacted.
  insertCommunityReaction.run(211, 61, 81, "like", "2026-09-01T11:00:00.000Z");
  insertCommunityReaction.run(212, 61, 82, "like", "2026-09-01T11:05:00.000Z");
  // announcement 63: legacy 'like' replaced in place by a typed call.
  insertCommunityReaction.run(213, 63, 81, "like", "2026-09-01T11:10:00.000Z");
  // announcement 64: stored type re-requested -> remove.
  insertCommunityReaction.run(214, 64, 81, "fire", "2026-09-01T11:20:00.000Z");
  // announcement 65: another user already reacted.
  insertCommunityReaction.run(215, 65, 82, "like", "2026-09-01T11:30:00.000Z");
});

beforeEach(() => {
  holder.queries.length = 0;
});

describe("toggleVideoReaction — binary + typed", () => {
  it("omitted argument inserts a binary 'like' and keeps the exact return shape", async () => {
    const result = await toggleVideoReaction(40, 81);

    expect(result).toEqual({
      reactionCount: 1,
      shareCount: 0,
      commentCount: 0,
      bookmarkCount: 0,
      viewerReacted: true,
      viewerShared: false,
      viewerBookmarked: false,
    });
    const rows = videoReactionRows(40);
    expect(rows).toHaveLength(1);
    expect(rows[0].reaction).toBe("like");

    // One transaction; the video row is locked FOR UPDATE before any
    // video_reactions statement runs.
    const texts = holder.queries.map(query => query.text);
    const targetRead = texts.find(
      text => text.includes(`from "videos"`) && text.includes(`"id"`)
    );
    expect(
      targetRead,
      "the video row must be read before any reaction write"
    ).toBeDefined();
    expect(targetRead).toMatch(/\bfor\s+update\b/i);
    expect(texts.some(text => /^\s*begin\b/i.test(text))).toBe(true);
    expect(texts.some(text => /^\s*commit\b/i.test(text))).toBe(true);
    const firstReaction = texts.findIndex(text =>
      text.includes(`"video_reactions"`)
    );
    expect(texts.indexOf(targetRead!)).toBeLessThan(firstReaction);
  });

  it("omitted argument removes an existing 'like' and spares another user's row", async () => {
    const before = videoReactionRows(41);
    expect(before.map(row => row.userId)).toEqual([81, 82]);

    const result = await toggleVideoReaction(41, 81);

    expect(result).toEqual({
      reactionCount: 1,
      shareCount: 0,
      commentCount: 0,
      bookmarkCount: 0,
      viewerReacted: false,
      viewerShared: false,
      viewerBookmarked: false,
    });
    const after = videoReactionRows(41);
    expect(after).toHaveLength(1);
    expect(after[0].userId).toBe(82);
    expect(after[0].reaction).toBe("like");
  });

  it("adds a typed reaction on an empty target", async () => {
    const result = await toggleVideoReaction(42, 81, "fire");

    expect(result.viewerReacted).toBe(true);
    expect(result.reactionCount).toBe(1);
    const rows = videoReactionRows(42);
    expect(rows).toHaveLength(1);
    expect(rows[0].reaction).toBe("fire");
  });

  it("replaces 'like' with another type in place (same row id and createdAt)", async () => {
    const seeded = videoReactionRows(43).find(row => row.userId === 81);
    expect(seeded?.reaction).toBe("like");

    const result = await toggleVideoReaction(43, 81, "clap");

    expect(result.viewerReacted).toBe(true);
    expect(result.reactionCount).toBe(1);
    const rows = videoReactionRows(43);
    expect(rows).toHaveLength(1);
    expect(rows[0].reaction).toBe("clap");
    expect(rows[0].id).toBe(seeded!.id);
    expect(rows[0].createdAt).toBe(seeded!.createdAt);
  });

  it("requesting the stored type removes the reaction", async () => {
    expect(videoReactionRows(44)[0].reaction).toBe("fire");

    const result = await toggleVideoReaction(44, 81, "fire");

    expect(result).toEqual({
      reactionCount: 0,
      shareCount: 0,
      commentCount: 0,
      bookmarkCount: 0,
      viewerReacted: false,
      viewerShared: false,
      viewerBookmarked: false,
    });
    expect(videoReactionRows(44)).toHaveLength(0);
  });

  it("keeps exactly one row per (video, user) across typed transitions", async () => {
    await expect(toggleVideoReaction(67, 81)).resolves.toEqual({
      reactionCount: 2,
      shareCount: 0,
      commentCount: 0,
      bookmarkCount: 0,
      viewerReacted: true,
      viewerShared: false,
      viewerBookmarked: false,
    });
    expect(videoReactionRows(67).find(row => row.userId === 81)?.reaction).toBe(
      "like"
    );

    await expect(toggleVideoReaction(67, 81, "fire")).resolves.toMatchObject({
      reactionCount: 2,
      viewerReacted: true,
    });
    expect(videoReactionRows(67)).toHaveLength(2);
    expect(videoReactionRows(67).find(row => row.userId === 81)?.reaction).toBe(
      "fire"
    );

    await expect(toggleVideoReaction(67, 81, "fire")).resolves.toMatchObject({
      reactionCount: 1,
      viewerReacted: false,
    });
    expect(videoReactionRows(67).map(row => row.userId)).toEqual([82]);

    await expect(toggleVideoReaction(67, 81)).resolves.toMatchObject({
      reactionCount: 2,
      viewerReacted: true,
    });
    expect(videoReactionRows(67)).toHaveLength(2);

    // Database-level guard: a second row for the same pair must violate the
    // pair-unique index even when a write bypasses the toggle.
    expect(() =>
      holder
        .sqlite!.prepare(
          `INSERT INTO "video_reactions" ("id", "videoId", "userId", "reaction")
           VALUES (?, ?, ?, ?)`
        )
        .run(999, 67, 81, "love")
    ).toThrow();
    expect(videoReactionRows(67)).toHaveLength(2);
  });

  it("rejects unknown reaction types without touching the database", async () => {
    await expect(toggleVideoReaction(40, 81, "nope" as never)).rejects.toThrow(
      "Invalid reaction type."
    );
    expect(holder.queries).toHaveLength(0);
  });

  it("fails closed when the video does not exist and writes nothing", async () => {
    await expect(toggleVideoReaction(9999, 81)).rejects.toThrow(
      "Video not found."
    );
    const texts = holder.queries.map(query => query.text.trim());
    expect(texts.some(text => /^begin\b/i.test(text))).toBe(true);
    expect(texts.some(text => /^rollback\b/i.test(text))).toBe(true);
    expect(texts.some(text => /^(insert|update|delete)\b/i.test(text))).toBe(
      false
    );
  });
});

describe("toggleCommunityReaction — binary + typed", () => {
  it("omitted argument inserts a binary 'like' with the exact return shape", async () => {
    await expect(toggleCommunityReaction(60, 81)).resolves.toEqual({
      viewerReacted: true,
    });
    const rows = communityReactionRows(60);
    expect(rows).toHaveLength(1);
    expect(rows[0].reaction).toBe("like");

    const texts = holder.queries.map(query => query.text);
    const targetRead = texts.find(text =>
      text.includes(`from "community_announcements"`)
    );
    expect(
      targetRead,
      "the announcement row must be read before any reaction write"
    ).toBeDefined();
    expect(targetRead).toMatch(/\bfor\s+update\b/i);
    expect(texts.some(text => /^\s*begin\b/i.test(text))).toBe(true);
    expect(texts.some(text => /^\s*commit\b/i.test(text))).toBe(true);
    const firstReaction = texts.findIndex(text =>
      text.includes(`"community_reactions"`)
    );
    expect(texts.indexOf(targetRead!)).toBeLessThan(firstReaction);
  });

  it("omitted argument removes an existing 'like' and spares another user's row", async () => {
    expect(communityReactionRows(61).map(row => row.userId)).toEqual([81, 82]);

    await expect(toggleCommunityReaction(61, 81)).resolves.toEqual({
      viewerReacted: false,
    });
    const after = communityReactionRows(61);
    expect(after).toHaveLength(1);
    expect(after[0].userId).toBe(82);
    expect(after[0].reaction).toBe("like");
  });

  it("adds a typed reaction on an empty target", async () => {
    await expect(toggleCommunityReaction(62, 81, "love")).resolves.toEqual({
      viewerReacted: true,
    });
    const rows = communityReactionRows(62);
    expect(rows).toHaveLength(1);
    expect(rows[0].reaction).toBe("love");
  });

  it("replaces 'like' with another type in place (same row id and createdAt)", async () => {
    const seeded = communityReactionRows(63).find(row => row.userId === 81);
    expect(seeded?.reaction).toBe("like");

    await expect(toggleCommunityReaction(63, 81, "clap")).resolves.toEqual({
      viewerReacted: true,
    });
    const rows = communityReactionRows(63);
    expect(rows).toHaveLength(1);
    expect(rows[0].reaction).toBe("clap");
    expect(rows[0].id).toBe(seeded!.id);
    expect(rows[0].createdAt).toBe(seeded!.createdAt);
  });

  it("requesting the stored type removes the reaction", async () => {
    expect(communityReactionRows(64)[0].reaction).toBe("fire");

    await expect(toggleCommunityReaction(64, 81, "fire")).resolves.toEqual({
      viewerReacted: false,
    });
    expect(communityReactionRows(64)).toHaveLength(0);
  });

  it("keeps exactly one row per (announcement, user) across typed transitions", async () => {
    await expect(toggleCommunityReaction(65, 81)).resolves.toEqual({
      viewerReacted: true,
    });
    expect(communityReactionRows(65)).toHaveLength(2);
    expect(
      communityReactionRows(65).find(row => row.userId === 81)?.reaction
    ).toBe("like");

    await expect(toggleCommunityReaction(65, 81, "clap")).resolves.toEqual({
      viewerReacted: true,
    });
    const afterReplace = communityReactionRows(65);
    expect(afterReplace).toHaveLength(2);
    expect(afterReplace.find(row => row.userId === 81)?.reaction).toBe("clap");

    await expect(toggleCommunityReaction(65, 81, "clap")).resolves.toEqual({
      viewerReacted: false,
    });
    expect(communityReactionRows(65).map(row => row.userId)).toEqual([82]);

    await expect(toggleCommunityReaction(65, 81)).resolves.toEqual({
      viewerReacted: true,
    });
    expect(communityReactionRows(65)).toHaveLength(2);

    // Database-level guard: a second row for the same pair must violate the
    // pair-unique index even when a write bypasses the toggle.
    expect(() =>
      holder
        .sqlite!.prepare(
          `INSERT INTO "community_reactions" ("id", "announcementId", "userId", "reaction")
           VALUES (?, ?, ?, ?)`
        )
        .run(998, 65, 81, "love")
    ).toThrow();
    expect(communityReactionRows(65)).toHaveLength(2);
  });

  it("rejects unknown reaction types without touching the database", async () => {
    await expect(
      toggleCommunityReaction(60, 81, "nope" as never)
    ).rejects.toThrow("Invalid reaction type.");
    expect(holder.queries).toHaveLength(0);
  });

  it("fails closed when the announcement does not exist and writes nothing", async () => {
    await expect(toggleCommunityReaction(9999, 81)).rejects.toThrow(
      "Community announcement not found."
    );
    const texts = holder.queries.map(query => query.text.trim());
    expect(texts.some(text => /^begin\b/i.test(text))).toBe(true);
    expect(texts.some(text => /^rollback\b/i.test(text))).toBe(true);
    expect(texts.some(text => /^(insert|update|delete)\b/i.test(text))).toBe(
      false
    );
  });
});

describe("schema + 0034 migration — additive safety (static)", () => {
  it("declares reaction varchar(32) NOT NULL DEFAULT 'like' on both tables", () => {
    const videoColumn = getTableColumns(videoReactions).reaction;
    expect(videoColumn.default).toBe("like");
    expect(videoColumn.notNull).toBe(true);
    expect(videoColumn.length).toBe(32);

    const communityColumn = getTableColumns(communityReactions).reaction;
    expect(communityColumn.default).toBe("like");
    expect(communityColumn.notNull).toBe(true);
    expect(communityColumn.length).toBe(32);
  });

  it("keeps the existing index set unchanged on both tables", () => {
    const videoIndexes = getTableConfig(videoReactions)
      .indexes.map(index => index.config.name)
      .sort();
    expect(videoIndexes).toEqual([
      "video_reactions_pair_unique",
      "video_reactions_user_idx",
      "video_reactions_video_idx",
    ]);

    const communityIndexes = getTableConfig(communityReactions)
      .indexes.map(index => index.config.name)
      .sort();
    expect(communityIndexes).toEqual([
      "community_reactions_announcement_idx",
      "community_reactions_pair_unique",
      "community_reactions_user_idx",
    ]);
  });

  it("canonical 0034 is exactly the two guarded ADD COLUMN statements", () => {
    const statements = statementsOf(
      migrationFile("0034_jhilik_unified_binary_reactions.sql")
    );
    expect(statements).toEqual([LIKE_ADD_VIDEO, LIKE_ADD_COMMUNITY]);
    expect(statements.join("\n")).toContain("IF NOT EXISTS");
  });

  it("APPLY wraps the same statements in BEGIN/COMMIT for rerun-safe execution", () => {
    const statements = statementsOf(
      migrationFile("0034_jhilik_unified_binary_reactions_APPLY.sql")
    );
    expect(statements).toEqual([
      "BEGIN",
      LIKE_ADD_VIDEO,
      LIKE_ADD_COMMUNITY,
      "COMMIT",
    ]);
    expect(statements.join("\n")).toContain("IF NOT EXISTS");
  });

  it("never drops, truncates, renames, or alters indexes/constraints", () => {
    for (const name of [
      "0034_jhilik_unified_binary_reactions.sql",
      "0034_jhilik_unified_binary_reactions_APPLY.sql",
    ]) {
      const text = statementsOf(migrationFile(name)).join("\n");
      expect(text).not.toMatch(/\b(drop|truncate|rename)\b/i);
      expect(text).not.toMatch(
        /\b(create\s+(unique\s+)?index|drop\s+index|add\s+(unique\s+)?constraint)\b/i
      );
      // Only the two reaction tables may be referenced.
      const tables = [...text.matchAll(/ALTER TABLE "([^"]+)"/g)].map(
        match => match[1]
      );
      expect(tables).toEqual(["video_reactions", "community_reactions"]);
    }
  });

  it("does not register 0034 in the drizzle journal", () => {
    const journal = JSON.parse(
      readFileSync(
        join(process.cwd(), "drizzle", "meta", "_journal.json"),
        "utf8"
      )
    ) as { entries: Array<{ tag: string }> };
    expect(journal.entries.some(entry => entry.tag.includes("0034"))).toBe(
      false
    );
  });
});
