/**
 * Image/video caption persistence — publish → database → feed response.
 *
 * Contract under test:
 * - the unified composer publishes with an empty `title` and the caption in
 *   `description`. `createPhotoPost` / `createVideo` have to keep that caption
 *   verbatim, and `home.feed` has to return it, because the feed card reads
 *   `description` first (the stored `title` is only the headline fallback, so
 *   the server's "Untitled photo"/"Untitled video" back-fill can never shadow
 *   the user's words again).
 * - publishing without a caption stores an empty description instead of
 *   inventing "No description provided." text.
 * - rows written before this fix still carry that placeholder; the feed
 *   normalises it to "" so clients fall back to the stored title.
 *
 * Drives the real drizzle queries through a fake `pg` Pool backed by
 * in-memory SQLite (same harness as viewerReactionWiring).
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
      /^(insert\s+into\s+"([^"]+)"\s*\(([^)]*)\)\s*values\s*\()([^)]*)(\))((?:\s*returning\s+([\s\S]+))?)$/i
    );
    if (insert) {
      const table = insert[2];
      const columns = insert[3]
        .split(",")
        .map(column => column.trim().replace(/"/g, ""));
      const values = insert[4].split(",").map((token, index) => {
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
      rewritten = `${insert[1]}${values.join(", ")}${insert[5]}`;
      if (bound.length > 0) sqlite.prepare(rewritten).run(...(bound as never[]));
      else sqlite.exec(rewritten);

      const returning = insert[7];
      if (!returning) return { rows: [] as unknown[][] };
      // SQLite has no INSERT ... RETURNING through this driver shim; the row
      // just written is the newest one, so read it back by rowid.
      const row = sqlite
        .prepare(`select * from "${table}" order by rowid desc limit 1`)
        .get() as Record<string, unknown> | undefined;
      const returningColumns = returning
        .split(",")
        .map(column => column.trim().replace(/"/g, ""));
      return {
        rows: [returningColumns.map(column => row?.[column] ?? null)],
      };
    }

    rewritten = text.replace(/\$([0-9]+)/g, (_match, index: string) => {
      const value = params[Number(index) - 1];
      bound.push(value === undefined ? null : value);
      return "?";
    });

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

import {
  profiles,
  users,
  videoBookmarks,
  videoComments,
  videoReactions,
  videoShares,
  videoSources,
  videos,
} from "../drizzle/schema";
import { createPhotoPost, createVideo, listHomeFeed } from "./db";

function createTable(table: Table): string {
  const columns = Object.values(getTableColumns(table))
    .map(column => `"${column.name}"`)
    .join(", ");
  return `CREATE TABLE "${getTableName(table)}" (${columns})`;
}

const author = {
  id: 81,
  openId: "kinba-caption-81",
  name: "Caption Author",
  email: "caption81@example.test",
  loginMethod: "email",
  role: "user" as const,
  createdAt: new Date("2026-09-01T09:00:00.000Z"),
  updatedAt: new Date("2026-09-01T09:00:00.000Z"),
  lastSignedIn: new Date("2026-09-01T09:00:00.000Z"),
};

/** The photo payload the unified composer publishes (title stays empty). */
const photoInput = {
  title: "",
  description: "Golden hour at the pier",
  imageUrl: "https://cdn.test/post/pier.jpg",
  width: 1024,
  height: 768,
};

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://user:pass@127.0.0.1:5432/kinba-test";

  const sqlite = holder.sqlite!;
  // selectVideos touches the video row plus its owner/profile and the
  // correlated engagement sub-selects, so every one of those tables exists.
  for (const table of [
    users,
    profiles,
    videos,
    videoSources,
    videoReactions,
    videoShares,
    videoComments,
    videoBookmarks,
  ]) {
    sqlite.exec(createTable(table));
  }

  const insertUser = sqlite.prepare(
    `INSERT INTO "users" ("id", "openId", "name") VALUES (?, ?, ?)`
  );
  insertUser.run(author.id, author.openId, author.name);
});

beforeEach(() => {
  const sqlite = holder.sqlite!;
  for (const name of [
    "videos",
    "video_sources",
    "video_reactions",
    "video_shares",
    "video_comments",
    "video_bookmarks",
  ]) {
    sqlite.exec(`DELETE FROM "${name}"`);
  }
});

async function feedRow(mediaType: "IMAGE" | "VIDEO") {
  const rows = await listHomeFeed("videos", author.id);
  const row = rows.find(item => item.mediaType === mediaType);
  expect(row).toBeTruthy();
  return row!;
}

describe("image/video caption persistence", () => {
  it("stores the photo caption and returns it from the feed", async () => {
    await createPhotoPost(author.id, photoInput);

    const stored = holder
      .sqlite!.prepare(`select "title", "description" from "videos"`)
      .get() as { title: string; description: string };
    expect(stored.description).toBe("Golden hour at the pier");

    const row = await feedRow("IMAGE");
    expect(row.description).toBe("Golden hour at the pier");
    expect(row.title).toBe("Untitled photo");
  });

  it("stores the video caption and returns it from the feed", async () => {
    await createVideo(author.id, {
      title: "",
      description: "Three tricks you can learn today",
      videoUrl: "https://cdn.test/post/tricks.mp4",
      thumbnailUrl: null,
      kind: "SHORT",
      durationSeconds: 42,
      width: 720,
      height: 1280,
      sources: [],
    });

    const row = await feedRow("VIDEO");
    expect(row.description).toBe("Three tricks you can learn today");
    expect(row.title).toBe("Untitled video");
  });

  it("trims the caption but never drops it", async () => {
    await createPhotoPost(author.id, {
      ...photoInput,
      description: "  Sunset over the bay  ",
    });

    const row = await feedRow("IMAGE");
    expect(row.description).toBe("Sunset over the bay");
  });

  it("stores an empty description instead of inventing caption text", async () => {
    await createPhotoPost(author.id, { ...photoInput, description: "" });

    const row = await feedRow("IMAGE");
    expect(row.description).toBe("");
  });

  it("normalises the legacy placeholder so the title fallback stays usable", async () => {
    holder
      .sqlite!.prepare(
        `INSERT INTO "videos"
           ("id", "userId", "title", "description", "videoUrl", "mediaType",
            "kind", "durationSeconds", "width", "height", "processingStatus",
            "createdAt")
         VALUES (?, ?, ?, ?, ?, 'IMAGE', 'LONG', 1, 800, 600, 'READY', ?)`
      )
      .run(
        900,
        author.id,
        "Shared photo",
        "No description provided.",
        "https://cdn.test/post/shared.jpg",
        "2026-09-20T09:00:00.000Z"
      );

    const row = await feedRow("IMAGE");
    expect(row.description).toBe("");
    expect(row.title).toBe("Shared photo");
  });
});
