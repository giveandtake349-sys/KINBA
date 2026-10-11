/**
 * Comment upgrades — editVideoComment (author-only, 30-minute window) and
 * setVideoCommentPinned (post owner only, one pinned root per video).
 * Drives the real db.ts functions through a fake drizzle chain, like
 * commentReactions.test.ts.
 */
import { vi, describe, beforeEach, expect, it } from "vitest";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("pg", () => ({
  Pool: class {
    on() {}
    async query() {
      return { rows: [] };
    }
  },
}));
vi.mock("drizzle-orm/node-postgres", () => ({
  drizzle: vi.fn(
    () =>
      new Proxy(
        {},
        {
          get(_target, prop) {
            const db = holder.db as Record<string, unknown> | null;
            if (!db) throw new Error("fake db not installed");
            const value = db[prop as string];
            return typeof value === "function" ? value.bind(db) : value;
          },
        }
      )
  ),
}));
vi.mock("./databaseConfig", () => ({
  resolvePostgresDatabaseUrl: () => "postgresql://fake",
}));
vi.mock("./storage", () => ({ storageDelete: vi.fn(), MEDIA_BUCKET: "signal-media" }));

import {
  COMMENT_EDIT_WINDOW_MS,
  editVideoComment,
  setVideoCommentPinned,
} from "./db";

/** Fake DB: select().from()...limit() resolves queued rows; update/delete are recorded. */
function makeDb(selectRows: unknown[][]) {
  const queue = [...selectRows];
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: vi.fn(() => {
      const rows = queue.length > 0 ? (queue.shift() ?? []) : [];
      const chain: Record<string, unknown> = {};
      for (const method of ["from", "innerJoin", "leftJoin", "where", "orderBy", "for"]) {
        chain[method] = vi.fn(() => chain);
      }
      chain.limit = vi.fn(async () => rows);
      chain.then = (
        onFulfilled?: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => Promise.resolve(rows).then(onFulfilled, onRejected);
      return chain;
    }),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        updates.push(values);
        return { where: vi.fn(async () => undefined) };
      }),
    })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    __updates: updates,
  };
  return db;
}

const ownComment = (over: Record<string, unknown> = {}) => ({
  id: 5,
  userId: 41,
  body: "first draft",
  audioUrl: null,
  createdAt: new Date(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("editVideoComment", () => {
  it("lets the author edit and stamps editedAt", async () => {
    const db = makeDb([[ownComment()]]);
    holder.db = db;

    const result = await editVideoComment(5, 41, "  better text  ");

    expect(result.commentId).toBe(5);
    expect(result.body).toBe("better text");
    expect(result.editedAt).toBeInstanceOf(Date);
    expect(db.__updates).toEqual([
      { body: "better text", editedAt: expect.any(Date) },
    ]);
  });

  it("throws when the comment does not exist", async () => {
    holder.db = makeDb([[]]);
    await expect(editVideoComment(404, 41, "x")).rejects.toThrow(
      "Comment not found."
    );
  });

  it("rejects an edit from anyone but the author", async () => {
    const db = makeDb([[ownComment({ userId: 7 })]]);
    holder.db = db;
    await expect(editVideoComment(5, 41, "hijack")).rejects.toThrow(
      "not authorized"
    );
    expect(db.__updates).toHaveLength(0);
  });

  it("rejects an edit after the 30-minute window", async () => {
    const db = makeDb([
      [ownComment({ createdAt: new Date(Date.now() - COMMENT_EDIT_WINDOW_MS - 60_000) })],
    ]);
    holder.db = db;
    await expect(editVideoComment(5, 41, "too late")).rejects.toThrow(
      "within 30 minutes"
    );
    expect(db.__updates).toHaveLength(0);
  });

  it("refuses to blank a text-only comment but allows it for a voice comment", async () => {
    holder.db = makeDb([[ownComment()]]);
    await expect(editVideoComment(5, 41, "   ")).rejects.toThrow(
      "cannot be empty"
    );

    const db = makeDb([[ownComment({ audioUrl: "https://cdn.test/a.webm" })]]);
    holder.db = db;
    await expect(editVideoComment(5, 41, "   ")).resolves.toMatchObject({
      commentId: 5,
      body: "",
    });
    expect(db.__updates).toEqual([{ body: null, editedAt: expect.any(Date) }]);
  });

  it("does not mark a comment edited when the text is unchanged", async () => {
    const db = makeDb([[ownComment({ body: "same" })]]);
    holder.db = db;
    await expect(editVideoComment(5, 41, " same ")).resolves.toEqual({
      commentId: 5,
      body: "same",
      editedAt: null,
    });
    expect(db.__updates).toHaveLength(0);
  });
});

describe("setVideoCommentPinned", () => {
  const match = (over: Record<string, unknown> = {}) => ({
    id: 5,
    videoId: 9,
    parentId: null,
    postUserId: 41,
    ...over,
  });

  it("throws when the comment does not exist", async () => {
    holder.db = makeDb([[]]);
    await expect(setVideoCommentPinned(404, 41, true)).rejects.toThrow(
      "Comment not found."
    );
  });

  it("only lets the post owner pin", async () => {
    const db = makeDb([[match({ postUserId: 99 })]]);
    holder.db = db;
    await expect(setVideoCommentPinned(5, 41, true)).rejects.toThrow(
      "Only the post owner"
    );
    expect(db.__updates).toHaveLength(0);
  });

  it("does not pin a reply", async () => {
    const db = makeDb([[match({ parentId: 3 })]]);
    holder.db = db;
    await expect(setVideoCommentPinned(5, 41, true)).rejects.toThrow(
      "Only top-level comments"
    );
    expect(db.__updates).toHaveLength(0);
  });

  it("pinning releases the previous pin first, then pins this comment", async () => {
    const db = makeDb([[match()]]);
    holder.db = db;
    await expect(setVideoCommentPinned(5, 41, true)).resolves.toEqual({
      commentId: 5,
      pinned: true,
    });
    expect(db.__updates).toEqual([
      { pinnedAt: null },
      { pinnedAt: expect.any(Date) },
    ]);
  });

  it("unpinning only clears this comment", async () => {
    const db = makeDb([[match()]]);
    holder.db = db;
    await expect(setVideoCommentPinned(5, 41, false)).resolves.toEqual({
      commentId: 5,
      pinned: false,
    });
    expect(db.__updates).toEqual([{ pinnedAt: null }]);
  });
});
