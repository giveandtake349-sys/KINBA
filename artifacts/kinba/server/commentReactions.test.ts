/**
 * Comment single-reaction (Pookie/Love) hardening — toggleCommentReaction
 * semantics and the merged listVideoComments view (comment_reactions ∪ legacy
 * comment_likes, every value normalized to the one supported reaction).
 */
import { vi, describe, beforeEach, expect, it } from "vitest";
import { commentLikes, commentReactions, videoComments } from "../drizzle/schema";

const holder = vi.hoisted(() => ({ db: null as unknown }));

// The pool only has to satisfy createPoolWithRetry's lifecycle handshake
// ('error' listener + a health probe); every query goes through the drizzle
// mock below, never through this class.
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
  listVideoComments,
  toggleCommentLike,
  toggleCommentReaction,
} from "./db";

type SelectRows = unknown[] | undefined;

/**
 * Fake DB whose select().from()... resolves queued rows in order.
 * from() calls are captured so tests can assert which tables were touched.
 */
function makeDb(selectRows: SelectRows[]) {
  const queue = [...selectRows];
  const fromCalls: unknown[] = [];
  const lockCalls: string[] = [];
  const insertValues = vi.fn();
  const deleteWheres = vi.fn();
  const insertReturning = vi.fn(async () => [{ id: 1 }]);
  const asRows = (row: SelectRows): unknown[] => {
    if (row === undefined) return [];
    if (Array.isArray(row)) return row;
    return [row];
  };

  const db = {
    select: vi.fn(() => {
      const row = queue.length > 0 ? queue.shift() : undefined;
      const rows = asRows(row);
      const chain = {
        from: vi.fn((table: unknown) => {
          fromCalls.push(table);
          return chain;
        }),
        innerJoin: vi.fn(() => chain),
        leftJoin: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        for: vi.fn((mode: string) => {
          lockCalls.push(mode);
          return chain;
        }),
        limit: vi.fn(async () => rows),
        then: (
          onFulfilled?: (v: unknown) => unknown,
          onRejected?: (e: unknown) => unknown
        ) => Promise.resolve(rows).then(onFulfilled, onRejected),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((v: unknown) => {
        insertValues(v);
        return {
          returning: insertReturning,
          onConflictDoNothing: vi.fn(() => ({ returning: insertReturning })),
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((...args: unknown[]) => {
        deleteWheres(...args);
        return Promise.resolve(undefined);
      }),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    __insertValues: insertValues,
    __deleteWheres: deleteWheres,
    __insertReturning: insertReturning,
    __fromCalls: fromCalls,
    __lockCalls: lockCalls,
    __queue: queue,
  };
  return db;
}

const commentRow = (over: Record<string, unknown> = {}) => ({
  id: 5,
  videoId: 9,
  userId: 41,
  parentId: null,
  body: "great video",
  audioUrl: null,
  audioDuration: null,
  createdAt: new Date(),
  moderatedAt: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toggleCommentReaction — validation and lookup", () => {
  it("rejects an unknown reaction type before touching the database", async () => {
    holder.db = makeDb([]);
    await expect(toggleCommentReaction(5, 41, "thumb")).rejects.toThrow(
      "Invalid reaction type."
    );
    const db = holder.db as ReturnType<typeof makeDb>;
    expect(db.select).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("throws when the comment does not exist", async () => {
    holder.db = makeDb([[]]);
    await expect(toggleCommentReaction(404, 41, "like")).rejects.toThrow(
      "Comment not found."
    );
  });
});

describe("toggleCommentReaction — activation", () => {
  it("inserts the single Pookie reaction when neither source holds one", async () => {
    const db = makeDb([[commentRow()], [], []]);
    holder.db = db;

    await expect(toggleCommentReaction(5, 41, "like")).resolves.toEqual({
      commentId: 5,
      reaction: "love",
      active: true,
    });
    expect(db.__insertValues).toHaveBeenCalledWith({
      commentId: 5,
      userId: 41,
      reaction: "love",
    });
    expect(db.__deleteWheres).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("coerces a historical input type to the single reaction and still reads the legacy source", async () => {
    const db = makeDb([[commentRow()], [], []]);
    holder.db = db;

    await expect(toggleCommentReaction(5, 41, "fire")).resolves.toEqual({
      commentId: 5,
      reaction: "love",
      active: true,
    });
    expect(db.__insertValues).toHaveBeenCalledWith({
      commentId: 5,
      userId: 41,
      reaction: "love",
    });
    expect(db.__fromCalls).toEqual([videoComments, commentReactions, commentLikes]);
  });
});

describe("toggleCommentReaction — deactivation", () => {
  it("removes an existing typed row no matter which historical type it holds", async () => {
    const db = makeDb([[commentRow()], [{ id: 77, reaction: "fire" }], []]);
    holder.db = db;

    await expect(toggleCommentReaction(5, 41, "clap")).resolves.toEqual({
      commentId: 5,
      reaction: "love",
      active: false,
    });
    expect(db.__deleteWheres).toHaveBeenCalledTimes(1);
    expect(db.__insertValues).not.toHaveBeenCalled();
  });

  it("treats a legacy comment_likes row as an active reaction and removes it instead of duplicating", async () => {
    const db = makeDb([[commentRow()], [], [{ id: 55 }]]);
    holder.db = db;

    await expect(toggleCommentReaction(5, 41, "like")).resolves.toEqual({
      commentId: 5,
      reaction: "love",
      active: false,
    });
    expect(db.__insertValues).not.toHaveBeenCalled();
    expect(db.__deleteWheres).toHaveBeenCalledTimes(1);
    expect(db.__fromCalls).toEqual([
      videoComments,
      commentReactions,
      commentLikes,
    ]);
  });

  it("removes both sources when a row exists in comment_reactions and comment_likes", async () => {
    const db = makeDb([
      [commentRow()],
      [{ id: 77, reaction: "like" }],
      [{ id: 55 }],
    ]);
    holder.db = db;

    await expect(toggleCommentReaction(5, 41, "like")).resolves.toEqual({
      commentId: 5,
      reaction: "love",
      active: false,
    });
    expect(db.__deleteWheres).toHaveBeenCalledTimes(2);
    expect(db.__insertValues).not.toHaveBeenCalled();
  });
});

describe("toggleCommentReaction — one reaction per user per target", () => {
  it("clears a historical row instead of stacking a second one", async () => {
    const db = makeDb([[commentRow()], [{ id: 77, reaction: "fire" }], []]);
    holder.db = db;

    // A legacy 'fire' row already counts as the single reaction, so asking
    // for any accepted type removes it rather than rewriting it in place.
    await expect(toggleCommentReaction(5, 41, "clap")).resolves.toEqual({
      commentId: 5,
      reaction: "love",
      active: false,
    });
    expect(db.__insertValues).not.toHaveBeenCalled();
    expect(db.__deleteWheres).toHaveBeenCalledTimes(1);
  });

  it("always reads the legacy comment_likes source before deciding", async () => {
    const db = makeDb([[commentRow()], [], []]);
    holder.db = db;

    await expect(toggleCommentReaction(5, 41, "fire")).resolves.toEqual({
      commentId: 5,
      reaction: "love",
      active: true,
    });
    expect(db.__deleteWheres).not.toHaveBeenCalled();
    expect(db.__fromCalls).toEqual([videoComments, commentReactions, commentLikes]);
  });

  it("locks the comment row FOR UPDATE inside a single transaction", async () => {
    const db = makeDb([[commentRow()], [{ id: 77, reaction: "fire" }], []]);
    holder.db = db;

    await toggleCommentReaction(5, 41, "clap");
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.__lockCalls).toEqual(["update"]);
  });

  it("deactivating the active reaction never inserts a replacement", async () => {
    const db = makeDb([[commentRow()], [{ id: 77, reaction: "clap" }], []]);
    holder.db = db;

    await expect(toggleCommentReaction(5, 41, "clap")).resolves.toEqual({
      commentId: 5,
      reaction: "love",
      active: false,
    });
    expect(db.__insertValues).not.toHaveBeenCalled();
    expect(db.__deleteWheres).toHaveBeenCalledTimes(1);
  });
});

describe("toggleCommentReaction — unique race", () => {
  it("confirms activation when the insert loses the unique race", async () => {
    const db = makeDb([[commentRow()], [], [], [{ id: 3 }]]);
    holder.db = db;
    db.__insertReturning.mockResolvedValueOnce([]);

    await expect(toggleCommentReaction(5, 41, "like")).resolves.toEqual({
      commentId: 5,
      reaction: "love",
      active: true,
    });
  });

  it("throws when neither the insert nor the confirm read finds a row", async () => {
    const db = makeDb([[commentRow()], [], [], []]);
    holder.db = db;
    db.__insertReturning.mockResolvedValueOnce([]);

    await expect(toggleCommentReaction(5, 41, "like")).rejects.toThrow(
      "Failed to toggle reaction."
    );
  });
});

describe("toggleCommentLike — legacy path (locked)", () => {
  it("inserts the like and reports it, locking the comment row in the transaction", async () => {
    const db = makeDb([[commentRow()], [], [{ count: 4 }]]);
    holder.db = db;

    await expect(toggleCommentLike(5, 41)).resolves.toEqual({
      commentId: 5,
      likeCount: 4,
      viewerLiked: true,
    });
    expect(db.__insertValues).toHaveBeenCalledWith({
      commentId: 5,
      userId: 41,
    });
    expect(db.__deleteWheres).not.toHaveBeenCalled();
    // Target-row lock is taken on the comment, inside the same transaction
    // that performs the comment_likes mutation.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(db.__lockCalls).toEqual(["update"]);
    expect(db.__fromCalls[0]).toBe(videoComments);
  });

  it("removes an existing like and keeps the same return shape", async () => {
    const db = makeDb([[commentRow()], [{ id: 55 }], [{ count: 2 }]]);
    holder.db = db;

    await expect(toggleCommentLike(5, 41)).resolves.toEqual({
      commentId: 5,
      likeCount: 2,
      viewerLiked: false,
    });
    expect(db.__deleteWheres).toHaveBeenCalledTimes(1);
    expect(db.__insertValues).not.toHaveBeenCalled();
    expect(db.__lockCalls).toEqual(["update"]);
  });

  it("keeps the original missing-comment error", async () => {
    const db = makeDb([[]]);
    holder.db = db;

    await expect(toggleCommentLike(404, 41)).rejects.toThrow(
      "Comment not found."
    );
    expect(db.__insertValues).not.toHaveBeenCalled();
    expect(db.__deleteWheres).not.toHaveBeenCalled();
  });
});

describe("listVideoComments — merged reaction view", () => {
  const viewer = 41;
  const baseRow = {
    comment: commentRow(),
    user: { id: 41, name: "Member", email: "m@example.test" },
    profile: { username: "member" },
    likeCount: 2,
    viewerLiked: true,
  };

  it("normalizes every historical row and legacy like into the single Pookie entry", async () => {
    const db = makeDb([
      [baseRow],
      [
        { commentId: 5, userId: 41, reaction: "like" },
        { commentId: 5, userId: 42, reaction: "fire" },
      ],
      [
        { commentId: 5, userId: 41 },
        { commentId: 5, userId: 43 },
      ],
    ]);
    holder.db = db;

    const rows = await listVideoComments(9, viewer);
    expect(rows).toHaveLength(1);
    // Typed rows (41, 42) and legacy likes (41, 43) merge into one reaction.
    expect(rows[0]!.reactions).toEqual([
      { reaction: "love", count: 3, reactedByMe: true },
    ]);
    expect(db.__fromCalls).toEqual([
      videoComments,
      commentReactions,
      commentLikes,
    ]);
  });

  it("keeps legacy likeCount/viewerLiked fields on comment_likes semantics only", async () => {
    const db = makeDb([
      [
        {
          ...baseRow,
          likeCount: 0,
          viewerLiked: false,
        },
      ],
      [{ commentId: 5, userId: 42, reaction: "like" }],
      [],
    ]);
    holder.db = db;

    const rows = await listVideoComments(9, viewer);
    expect(rows[0]!.likeCount).toBe(0);
    expect(rows[0]!.viewerLiked).toBe(false);
    expect(rows[0]!.reactions).toEqual([
      { reaction: "love", count: 1, reactedByMe: false },
    ]);
  });

  it("returns an empty reactions array when neither source has rows", async () => {
    const db = makeDb([
      [{ ...baseRow, likeCount: 0, viewerLiked: false }],
      [],
      [],
    ]);
    holder.db = db;

    const rows = await listVideoComments(9, viewer);
    expect(rows[0]!.reactions).toEqual([]);
    expect(rows[0]!.likeCount).toBe(0);
    expect(rows[0]!.viewerLiked).toBe(false);
  });

  it("marks reactedByMe false for anonymous viewers", async () => {
    const db = makeDb([
      [{ ...baseRow, viewerLiked: false }],
      [{ commentId: 5, userId: 41, reaction: "like" }],
      [],
    ]);
    holder.db = db;

    const rows = await listVideoComments(9);
    expect(rows[0]!.reactions).toEqual([
      { reaction: "love", count: 1, reactedByMe: false },
    ]);
    expect(rows[0]!.viewerLiked).toBe(false);
  });

  it("drops stored values the single-reaction vocabulary does not accept", async () => {
    const db = makeDb([
      [{ ...baseRow, likeCount: 0, viewerLiked: false }],
      [{ commentId: 5, userId: 42, reaction: "haha" }],
      [],
    ]);
    holder.db = db;

    const rows = await listVideoComments(9, viewer);
    expect(rows[0]!.reactions).toEqual([]);
  });

  it("skips the reaction lookups when a video has no comments", async () => {
    const db = makeDb([[]]);
    holder.db = db;

    await expect(listVideoComments(9, viewer)).resolves.toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.__queue).toHaveLength(0);
  });
});
