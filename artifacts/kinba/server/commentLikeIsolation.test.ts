/**
 * Regression: the legacy `toggleCommentLike` path (comment_likes) must take the
 * same target-row lock as the typed reaction path.
 *
 * `toggleCommentReaction` and `toggleCommentLike` both write `comment_likes`.
 * The typed path locks the `video_comments` row FOR UPDATE inside its
 * transaction before it clears that user's likes; if the legacy path stays
 * lock-free, a racing legacy toggle can re-insert a like the typed path just
 * cleared and leave one user holding two reaction types for the same comment.
 *
 * Every other suite in this repo mocks the drizzle chain, so no test ever
 * executes SQL. This suite drives the real `toggleCommentLike` through a real
 * drizzle instance against an in-memory SQLite database (node:sqlite), which is
 * enough to prove:
 * - the emitted comment read carries `for update`;
 * - `begin` … `commit` bracket the mutation (one transaction);
 * - only the acting user's `comment_likes` row is inserted/removed — another
 *   user's row on the same comment survives both the like and the unlike.
 *
 * SQLite ignores row-level locking, so the lock itself is asserted on the
 * emitted statement text, not on concurrency behaviour.
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
      // Statements (BEGIN/COMMIT, INSERT, DELETE) run as-is; parameterised
      // ones go through `prepare().run()` so the bound values are kept.
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

import { commentLikes, users, videoComments } from "../drizzle/schema";
import { toggleCommentLike } from "./db";

function createTable(table: Table): string {
  const columns = Object.values(getTableColumns(table))
    .map(column => `"${column.name}"`)
    .join(", ");
  return `CREATE TABLE "${getTableName(table)}" (${columns})`;
}

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/kinba-test";

  const sqlite = holder.sqlite!;
  for (const table of [users, videoComments, commentLikes]) {
    sqlite.exec(createTable(table));
  }

  const insertUser = sqlite.prepare(
    `INSERT INTO "users" ("id", "openId", "name") VALUES (?, ?, ?)`
  );
  insertUser.run(41, "open-id-41", "Legacy Liker");
  insertUser.run(42, "open-id-42", "Other Liker");

  const insertComment = sqlite.prepare(
    `INSERT INTO "video_comments"
       ("id", "videoId", "userId", "body", "parentId", "createdAt")
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  insertComment.run(
    5,
    9,
    41,
    "locked target",
    null,
    "2026-09-01T10:00:00.000Z"
  );
  insertComment.run(
    6,
    9,
    41,
    "shared target",
    null,
    "2026-09-01T11:00:00.000Z"
  );
  insertComment.run(
    7,
    9,
    41,
    "untouched target",
    null,
    "2026-09-01T12:00:00.000Z"
  );

  const insertLike = sqlite.prepare(
    `INSERT INTO "comment_likes" ("id", "commentId", "userId") VALUES (?, ?, ?)`
  );
  // comment 5: only the other user liked it.
  insertLike.run(1, 5, 42);
  // comment 6: both users liked it — removing the acting user's row must not
  // disturb the other user's row.
  insertLike.run(2, 6, 41);
  insertLike.run(3, 6, 42);
});

beforeEach(() => {
  holder.queries.length = 0;
});

function likeRows(commentId: number, userId: number): number {
  const row = holder
    .sqlite!.prepare(
      `SELECT count(*) AS n FROM "comment_likes"
        WHERE "commentId" = ? AND "userId" = ?`
    )
    .get(commentId, userId) as { n: number };
  return row.n;
}

describe("toggleCommentLike — legacy path (locked)", () => {
  it("locks the comment row FOR UPDATE inside a single transaction", async () => {
    const result = await toggleCommentLike(5, 41);

    expect(result).toEqual({ commentId: 5, likeCount: 2, viewerLiked: true });

    const texts = holder.queries.map(query => query.text);
    const commentRead = texts.find(
      text => text.includes(`from "video_comments"`) && text.includes(`"id"`)
    );
    expect(
      commentRead,
      "the comment must be read before the legacy mutation runs"
    ).toBeDefined();
    expect(commentRead).toMatch(/\bfor\s+update\b/i);
    expect(texts.some(text => /^\s*begin\b/i.test(text))).toBe(true);
    expect(texts.some(text => /^\s*commit\b/i.test(text))).toBe(true);
    // The lock read precedes any comment_likes statement.
    const firstLike = texts.findIndex(text => text.includes(`"comment_likes"`));
    expect(texts.indexOf(commentRead!)).toBeLessThan(firstLike);

    // The other user's like on the same comment is untouched.
    expect(likeRows(5, 41)).toBe(1);
    expect(likeRows(5, 42)).toBe(1);
  });

  it("removes only the acting user's like", async () => {
    const result = await toggleCommentLike(6, 41);

    expect(result).toEqual({ commentId: 6, likeCount: 1, viewerLiked: false });
    expect(likeRows(6, 41)).toBe(0);
    expect(likeRows(6, 42), "the other user's like must survive").toBe(1);
  });

  it("still toggles the legacy like on and off", async () => {
    await expect(toggleCommentLike(7, 41)).resolves.toEqual({
      commentId: 7,
      likeCount: 1,
      viewerLiked: true,
    });
    expect(likeRows(7, 41)).toBe(1);

    await expect(toggleCommentLike(7, 41)).resolves.toEqual({
      commentId: 7,
      likeCount: 0,
      viewerLiked: false,
    });
    expect(likeRows(7, 41)).toBe(0);
  });

  it("keeps the original missing-comment error and writes nothing", async () => {
    await expect(toggleCommentLike(999, 41)).rejects.toThrow(
      "Comment not found."
    );
    expect(holder.queries.some(query => query.text.includes(`insert`))).toBe(
      false
    );
  });
});
