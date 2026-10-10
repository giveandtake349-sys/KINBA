/**
 * Regression: correlated `replyCount` in `listVideoComments` (server/db.ts).
 *
 * Every other suite in this repo mocks the drizzle chain, so no test ever
 * executes SQL. That is how an uncorrelated subquery shipped: the inner
 * `video_comments` shadowed the outer table of the same name, the predicate
 * collapsed to `parentId = id`, every comment reported 0 replies, and the
 * "View replies" affordance (gated on `replyCount > 0` in MediaHub) never
 * rendered.
 *
 * This suite drives the real `listVideoComments` code path through a real
 * drizzle instance, so the exact statement the server emits is executed —
 * against an in-memory SQLite database (node:sqlite), no database credentials
 * required. SQLite applies the same innermost-scope identifier resolution as
 * PostgreSQL, so the un-aliased form reproduces as 0 and the aliased form
 * returns the true count.
 *
 * Harness notes:
 * - `pg.Pool` is replaced by a shim that runs the emitted statement on SQLite
 *   (`$1` placeholders are rewritten to `?`).
 * - SQLite exposes result rows as objects keyed by column name, which collapses
 *   the duplicate names drizzle relies on (`"video_comments"."id"`, `"users"."id"`,
 *   …). Materialising the statement into a temp table makes SQLite de-duplicate
 *   the names (`id`, `id:1`, …) so rows can be rebuilt positionally, exactly as
 *   pg's `rowMode: "array"` would deliver them to drizzle.
 * - Assertions are order-independent; SQLite does not promise to keep row order
 *   through a `CREATE TABLE AS`.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, type Table } from "drizzle-orm";

const holder = vi.hoisted(() => ({
  sqlite: null as unknown as import("node:sqlite").DatabaseSync | null,
  queries: [] as Array<{ text: string; params: unknown[] }>,
  sequence: 0,
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

    // Postgres placeholders -> SQLite placeholders (repeated `$n` re-binds).
    const bound: unknown[] = [];
    const rewritten = text.replace(/\$([0-9]+)/g, (_match, index: string) => {
      const value = params[Number(index) - 1];
      bound.push(value === undefined ? null : value);
      return "?";
    });

    if (!/^\s*select\b/i.test(rewritten)) {
      sqlite.exec(rewritten);
      return { rows: [] as unknown[][] };
    }

    const table = `kinba_result_${holder.sequence++}`;
    try {
      sqlite
        .prepare(`create temp table ${table} as ${rewritten}`)
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
      return runStatement(text, params);
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
  commentLikes,
  commentReactions,
  profiles,
  users,
  videoComments,
} from "../drizzle/schema";
import { listVideoComments } from "./db";

function createTable(table: Table): string {
  const columns = Object.values(getTableColumns(table))
    .map(column => `"${column.name}"`)
    .join(", ");
  return `CREATE TABLE "${getTableName(table)}" (${columns})`;
}

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/kinba-test";

  const sqlite = holder.sqlite!;
  for (const table of [
    users,
    profiles,
    videoComments,
    commentLikes,
    commentReactions,
  ]) {
    sqlite.exec(createTable(table));
  }

  // The listing inner-joins `users`, so the author must exist.
  sqlite
    .prepare(`INSERT INTO "users" ("id", "openId", "name") VALUES (?, ?, ?)`)
    .run(7, "open-id-7", "Reply Auditor");

  const insertComment = sqlite.prepare(
    `INSERT INTO "video_comments"
       ("id", "videoId", "userId", "body", "parentId", "createdAt")
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  // video 10: one root with two replies, one root with none.
  insertComment.run(
    1,
    10,
    7,
    "root with replies",
    null,
    "2026-09-01T10:00:00.000Z"
  );
  insertComment.run(2, 10, 7, "reply one", 1, "2026-09-01T11:00:00.000Z");
  insertComment.run(3, 10, 7, "reply two", 1, "2026-09-01T12:00:00.000Z");
  insertComment.run(
    4,
    10,
    7,
    "root without replies",
    null,
    "2026-09-01T13:00:00.000Z"
  );
  // video 11: unrelated, must never leak into video 10 counts.
  insertComment.run(
    5,
    11,
    7,
    "other video root",
    null,
    "2026-09-02T10:00:00.000Z"
  );
  insertComment.run(
    6,
    11,
    7,
    "other video reply",
    5,
    "2026-09-02T11:00:00.000Z"
  );

  sqlite
    .prepare(
      `INSERT INTO "comment_likes" ("id", "commentId", "userId") VALUES (?, ?, ?)`
    )
    .run(1, 1, 99);
});

beforeEach(() => {
  holder.queries.length = 0;
});

function rootListingSql(): string {
  const query = holder.queries.find(
    candidate =>
      candidate.text.includes(`from "video_comments"`) &&
      candidate.text.includes("join") &&
      candidate.text.includes("is null")
  );
  expect(query, "expected the root comment listing query to run").toBeDefined();
  return query!.text;
}

describe("listVideoComments — correlated replyCount (regression)", () => {
  it("counts a root comment's direct replies instead of returning 0", async () => {
    const rows = await listVideoComments(10);

    const rootWithReplies = rows.find(row => row.id === 1);
    expect(rootWithReplies, "root comment 1 must be listed").toBeDefined();
    // The shipped bug: an uncorrelated subquery reported 0 for every comment.
    expect(rootWithReplies!.replyCount).toBe(2);

    const rootWithoutReplies = rows.find(row => row.id === 4);
    expect(rootWithoutReplies, "root comment 4 must be listed").toBeDefined();
    expect(rootWithoutReplies!.replyCount).toBe(0);
  });

  it("never counts replies from another video", async () => {
    const rows = await listVideoComments(10);

    expect(rows.map(row => row.id).sort((a, b) => a - b)).toEqual([1, 4]);
    expect(rows.find(row => row.id === 1)!.replyCount).toBe(2);
  });

  it("keeps replies out of the root listing", async () => {
    const rows = await listVideoComments(10);

    expect(rows.some(row => row.parentId != null)).toBe(false);
  });

  it("still pages direct replies for an expanded thread", async () => {
    const rows = await listVideoComments(10, undefined, {
      parentId: 1,
      limit: 50,
    });

    expect(rows.map(row => row.id).sort((a, b) => a - b)).toEqual([2, 3]);
    expect(rows.every(row => row.parentId === 1)).toBe(true);
    // A reply has no children — it must not borrow the parent's count.
    expect(rows.every(row => row.replyCount === 0)).toBe(true);
  });

  it("returns no reply batch when the parent belongs to another video", async () => {
    await expect(
      listVideoComments(11, undefined, { parentId: 1, limit: 50 })
    ).resolves.toEqual([]);
  });

  it("emits a subquery whose inner table is aliased and correlated to the row", async () => {
    await listVideoComments(10);
    const sql = rootListingSql();

    expect(sql).toMatch(/from\s+video_comments\s+rc\b/);
    expect(sql).toMatch(/rc\."parentId"\s*=\s*"?video_comments"?\."id"/);
    // The exact shape of the shipped bug.
    expect(sql).not.toMatch(
      /video_comments\."parentId"\s*=\s*"?video_comments"?\."id"/
    );
  });

  it("leaves the legacy like/reaction projections intact", async () => {
    const rows = await listVideoComments(10);

    expect(rows.find(row => row.id === 1)!.likeCount).toBe(1);
    expect(rows.find(row => row.id === 4)!.likeCount).toBe(0);
    expect(rows.find(row => row.id === 1)!.reactions).toEqual([
      { reaction: "love", count: 1, reactedByMe: false },
    ]);
    expect(rows.find(row => row.id === 4)!.reactions).toEqual([]);
  });
});
