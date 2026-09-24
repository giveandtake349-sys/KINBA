/**
 * Comment multi-reaction hardening — toggleCommentReaction semantics and the
 * merged listVideoComments view (comment_reactions ∪ legacy comment_likes).
 */
import { vi, describe, beforeEach, expect, it } from "vitest";
import { commentLikes, commentReactions, videoComments } from "../drizzle/schema";

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("pg", () => ({ Pool: class {} }));
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

import { listVideoComments, toggleCommentReaction } from "./db";

type SelectRows = unknown[] | undefined;

/**
 * Fake DB whose select().from()... resolves queued rows in order.
 * from() calls are captured so tests can assert which tables were touched.
 */
function makeDb(selectRows: SelectRows[]) {
  const queue = [...selectRows];
  const fromCalls: unknown[] = [];
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
  it("inserts a like when neither source holds one", async () => {
    const db = makeDb([[commentRow()], [], []]);
    holder.db = db;

    await expect(toggleCommentReaction(5, 41, "like")).resolves.toEqual({
      commentId: 5,
      reaction: "like",
      active: true,
    });
    expect(db.__insertValues).toHaveBeenCalledWith({
      commentId: 5,
      userId: 41,
      reaction: "like",
    });
    expect(db.__deleteWheres).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("inserts a non-like reaction without consulting comment_likes", async () => {
    const db = makeDb([[commentRow()], []]);
    holder.db = db;

    await expect(toggleCommentReaction(5, 41, "fire")).resolves.toEqual({
      commentId: 5,
      reaction: "fire",
      active: true,
    });
    expect(db.__insertValues).toHaveBeenCalledWith({
      commentId: 5,
      userId: 41,
      reaction: "fire",
    });
    expect(db.__fromCalls).toEqual([videoComments, commentReactions]);
  });
});

describe("toggleCommentReaction — deactivation", () => {
  it("removes an existing typed reaction", async () => {
    const db = makeDb([[commentRow()], [{ id: 77 }]]);
    holder.db = db;

    await expect(toggleCommentReaction(5, 41, "fire")).resolves.toEqual({
      commentId: 5,
      reaction: "fire",
      active: false,
    });
    expect(db.__deleteWheres).toHaveBeenCalledTimes(1);
    expect(db.__insertValues).not.toHaveBeenCalled();
  });

  it("treats a legacy comment_likes row as an active like and removes it instead of duplicating", async () => {
    const db = makeDb([[commentRow()], [], [{ id: 55 }]]);
    holder.db = db;

    await expect(toggleCommentReaction(5, 41, "like")).resolves.toEqual({
      commentId: 5,
      reaction: "like",
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

  it("removes both sources when a like exists in comment_reactions and comment_likes", async () => {
    const db = makeDb([[commentRow()], [{ id: 77 }], [{ id: 55 }]]);
    holder.db = db;

    await expect(toggleCommentReaction(5, 41, "like")).resolves.toEqual({
      commentId: 5,
      reaction: "like",
      active: false,
    });
    expect(db.__deleteWheres).toHaveBeenCalledTimes(2);
    expect(db.__insertValues).not.toHaveBeenCalled();
  });
});

describe("toggleCommentReaction — unique race", () => {
  it("confirms activation when the insert loses the unique race", async () => {
    const db = makeDb([[commentRow()], [], [], [{ id: 3 }]]);
    holder.db = db;
    db.__insertReturning.mockResolvedValueOnce([]);

    await expect(toggleCommentReaction(5, 41, "like")).resolves.toEqual({
      commentId: 5,
      reaction: "like",
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

describe("listVideoComments — merged reaction view", () => {
  const viewer = 41;
  const baseRow = {
    comment: commentRow(),
    user: { id: 41, name: "Member", email: "m@example.test" },
    profile: { username: "member" },
    likeCount: 2,
    viewerLiked: true,
  };

  it("merges legacy likes into the like entry with a Set union and emits types in vocabulary order", async () => {
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
    expect(rows[0]!.reactions).toEqual([
      { reaction: "like", count: 2, reactedByMe: true },
      { reaction: "fire", count: 1, reactedByMe: false },
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
      { reaction: "like", count: 1, reactedByMe: false },
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
      { reaction: "like", count: 1, reactedByMe: false },
    ]);
    expect(rows[0]!.viewerLiked).toBe(false);
  });

  it("skips the reaction lookups when a video has no comments", async () => {
    const db = makeDb([[]]);
    holder.db = db;

    await expect(listVideoComments(9, viewer)).resolves.toEqual([]);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.__queue).toHaveLength(0);
  });
});
