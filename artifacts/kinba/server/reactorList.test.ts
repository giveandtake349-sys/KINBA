/**
 * M3 — reactor identity pages: offset/limit paging (limit+1 hasMore),
 * MAX(createdAt) DESC / userId DESC ordering, one grouped row per user,
 * stored values normalized to the single Pookie/Love reaction, legacy
 * comment_likes merge, the safe user projection, and the four public tRPC
 * read procedures.
 */
import { vi, describe, beforeEach, expect, it } from "vitest";
import { SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  communityAnnouncements,
  hypeRoomMessages,
  hypeRooms,
  profiles,
  users,
  videoComments,
  videos,
} from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const holder = vi.hoisted(() => ({ db: null as unknown }));
const flagMocks = vi.hoisted(() => ({ isFeatureFlagEnabled: vi.fn() }));

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
vi.mock("./storage", () => ({
  storageDelete: vi.fn(),
  MEDIA_BUCKET: "signal-media",
}));
vi.mock("./featureFlags", async importOriginal => ({
  ...(await importOriginal<typeof import("./featureFlags")>()),
  isFeatureFlagEnabled: flagMocks.isFeatureFlagEnabled,
}));

import {
  listCommentReactors,
  listCommunityReactors,
  listHypeRoomMessageReactors,
  listVideoReactors,
} from "./db";
import { appRouter } from "./routers";

const dialect = new PgDialect();

/** Rendered SQL text (params become $1, $2 …) for assertions. */
function sqlText(value: unknown): string {
  if (value instanceof SQL) return dialect.sqlToQuery(value).sql;
  return String(value);
}

type SelectRows = unknown[] | undefined;

/**
 * Fake DB: each select() dequeues one queued result; the chain records the
 * clauses it was called with so tests can assert query shape without a
 * database.
 */
function makeDb(selectRows: SelectRows[]) {
  const queue = [...selectRows];
  const calls = {
    from: [] as unknown[],
    joins: [] as [string, unknown][],
    where: [] as unknown[],
    groupBy: [] as unknown[][],
    orderBy: [] as unknown[][],
    limit: [] as number[],
    offset: [] as number[],
    insert: 0,
    delete: 0,
  };
  const asRows = (row: SelectRows): unknown[] => {
    if (row === undefined) return [];
    if (Array.isArray(row)) return row;
    return [row];
  };

  const db = {
    select: vi.fn(() => {
      const rows = asRows(queue.length > 0 ? queue.shift() : undefined);
      const chain = {
        from: (table: unknown) => {
          calls.from.push(table);
          return chain;
        },
        innerJoin: (table: unknown) => {
          calls.joins.push(["inner", table]);
          return chain;
        },
        leftJoin: (table: unknown) => {
          calls.joins.push(["left", table]);
          return chain;
        },
        where: (clause: unknown) => {
          calls.where.push(clause);
          return chain;
        },
        groupBy: (...columns: unknown[]) => {
          calls.groupBy.push(columns);
          return chain;
        },
        orderBy: (...exprs: unknown[]) => {
          calls.orderBy.push(exprs);
          return chain;
        },
        // limit() stays chainable (drizzle builds the query); offset() and
        // awaiting the bare chain both resolve the queued rows.
        limit: (n: number) => {
          calls.limit.push(n);
          return chain;
        },
        offset: (n: number) => {
          calls.offset.push(n);
          return Promise.resolve(rows);
        },
        then: (
          onFulfilled?: (v: unknown) => unknown,
          onRejected?: (e: unknown) => unknown
        ) => Promise.resolve(rows).then(onFulfilled, onRejected),
      };
      return chain;
    }),
    insert: vi.fn(() => {
      calls.insert += 1;
      return { values: vi.fn(() => ({})), returning: vi.fn(async () => []) };
    }),
    delete: vi.fn(() => {
      calls.delete += 1;
      return { where: vi.fn(() => Promise.resolve(undefined)) };
    }),
    transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    __calls: calls,
    __queue: queue,
  };
  return db;
}

type FakeDb = ReturnType<typeof makeDb>;

const reactorRow = (over: Record<string, unknown> = {}) => ({
  userId: 41,
  name: "KINBA Member",
  username: "member",
  photoUrl: "https://cdn.test/u.png",
  accountType: "creator",
  isVerified: true,
  // Columns that must never reach the client even if a row carried them.
  email: "member@example.test",
  openId: "kinba-open-id",
  role: "admin",
  ...over,
});

const typeRow = (userId: number, reaction: string) => ({ userId, reaction });

beforeEach(() => {
  vi.clearAllMocks();
  flagMocks.isFeatureFlagEnabled.mockResolvedValue(true);
  holder.db = null;
});

describe("listVideoReactors — paging", () => {
  it("fetches limit+1 rows and reports hasMore when the probe row exists", async () => {
    const db = makeDb([
      [{ id: 7 }],
      [reactorRow({ userId: 41 }), reactorRow({ userId: 42 }), reactorRow({ userId: 43 })],
      [typeRow(41, "fire"), typeRow(42, "like")],
    ]);
    holder.db = db;

    const page = await listVideoReactors(7, { limit: 2, offset: 10 });

    expect(page.limit).toBe(2);
    expect(page.offset).toBe(10);
    expect(page.hasMore).toBe(true);
    expect(page.reactors).toHaveLength(2);
    expect(page.reactors.map(r => r.userId)).toEqual([41, 42]);
    // Target probe (limit 1) then the page probe (limit + 1) at offset 10.
    expect(db.__calls.limit).toEqual([1, 3]);
    expect(db.__calls.offset).toEqual([10]);
    expect(db.__calls.from[0]).toBe(videos);
    expect(db.__calls.insert).toBe(0);
    expect(db.__calls.delete).toBe(0);
  });

  it("reports hasMore false when the probe row is absent", async () => {
    const db = makeDb([
      [{ id: 7 }],
      [reactorRow({ userId: 41 }), reactorRow({ userId: 42 })],
      [typeRow(41, "like")],
    ]);
    holder.db = db;

    const page = await listVideoReactors(7, { limit: 2 });

    expect(page.hasMore).toBe(false);
    expect(page.reactors).toHaveLength(2);
    expect(db.__calls.limit).toEqual([1, 3]);
    expect(db.__calls.offset).toEqual([0]);
  });

  it("defaults to 50 rows and clamps out-of-range limit/offset inputs", async () => {
    const empty = () => makeDb([[{ id: 7 }], []]);
    holder.db = empty();
    await listVideoReactors(7);
    expect((holder.db as FakeDb).__calls.limit).toEqual([1, 51]);

    holder.db = empty();
    await listVideoReactors(7, { limit: 0, offset: -5 });
    expect((holder.db as FakeDb).__calls.limit).toEqual([1, 2]);
    expect((holder.db as FakeDb).__calls.offset).toEqual([0]);
    expect((holder.db as FakeDb).__queue).toHaveLength(0);

    holder.db = empty();
    const clamped = await listVideoReactors(7, { limit: 500, offset: 3.9 });
    expect(clamped.limit).toBe(50);
    expect(clamped.offset).toBe(3);
    expect((holder.db as FakeDb).__calls.limit).toEqual([1, 51]);
  });

  it("skips the type lookup entirely when the page and viewer are empty", async () => {
    const db = makeDb([[{ id: 7 }], []]);
    holder.db = db;

    const page = await listVideoReactors(7);

    expect(page).toEqual({
      reactors: [],
      hasMore: false,
      offset: 0,
      limit: 50,
      viewerReactions: [],
    });
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(db.__queue).toHaveLength(0);
  });

  it("throws the existing video error without reading reaction rows", async () => {
    const db = makeDb([[]]);
    holder.db = db;

    await expect(listVideoReactors(404)).rejects.toThrow("Video not found.");
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.__calls.from).toEqual([videos]);
  });
});

describe("listVideoReactors — grouping, ordering, projection", () => {
  it("orders by MAX(createdAt) DESC then userId DESC and groups by user + profile", async () => {
    const db = makeDb([
      [{ id: 7 }],
      [reactorRow({ userId: 41 })],
      [typeRow(41, "like")],
    ]);
    holder.db = db;

    await listVideoReactors(7, { limit: 1 });

    const [orderByCreatedAt, orderByUserId] = db.__calls.orderBy[0]!;
    expect(sqlText(orderByCreatedAt).toLowerCase()).toContain(
      'max(reactor_source."createdat") desc'
    );
    expect(sqlText(orderByUserId).toLowerCase()).toContain('"users"."id" desc');
    expect(db.__calls.groupBy[0]!.map(col => sqlText(sql`${col as SQL}`))).toEqual([
      '"users"."id"',
      '"profiles"."id"',
    ]);
    // One reactor row per user: users inner-joined, profiles left-joined.
    expect(db.__calls.joins).toEqual([
      ["inner", users],
      ["left", profiles],
    ]);
    expect(sqlText(db.__calls.from[1])).toBe(
      '(select "userId", "reaction", "createdAt" from "video_reactions" where "videoId" = $1) as "reactor_source"'
    );
  });

  it("returns only the safe projection and never email/openId/auth columns", async () => {
    const db = makeDb([
      [{ id: 7 }],
      [reactorRow()],
      [typeRow(41, "clap")],
    ]);
    holder.db = db;

    const page = await listVideoReactors(7);
    const [entry] = page.reactors;

    expect(Object.keys(entry!).sort()).toEqual([
      "accountType",
      "isVerified",
      "name",
      "photoUrl",
      "reactions",
      "userId",
      "username",
    ]);
    expect(entry).toEqual({
      userId: 41,
      name: "KINBA Member",
      username: "member",
      photoUrl: "https://cdn.test/u.png",
      accountType: "creator",
      isVerified: true,
      reactions: ["love"],
    });
    const serialized = JSON.stringify(page);
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("openId");
    expect(serialized).not.toContain("member@example.test");
  });

  it("normalizes every stored value to the single reaction and drops unknown ones", async () => {
    const db = makeDb([
      [{ id: 7 }],
      [reactorRow()],
      [
        typeRow(41, "clap"),
        typeRow(41, "thumb"),
        typeRow(41, "fire"),
        typeRow(41, "like"),
        typeRow(41, "love"),
      ],
    ]);
    holder.db = db;

    const page = await listVideoReactors(7);
    // Historical multi-reaction values collapse to one Pookie/Love entry;
    // unknown stored strings ("thumb") never surface.
    expect(page.reactors[0]!.reactions).toEqual(["love"]);
  });

  it("reports no reaction types when every stored value is unknown", async () => {
    const db = makeDb([
      [{ id: 7 }],
      [reactorRow()],
      [typeRow(41, "thumb"), typeRow(41, "haha")],
    ]);
    holder.db = db;

    const page = await listVideoReactors(7);
    expect(page.reactors[0]!.reactions).toEqual([]);
  });

  it("defaults a profile-less reactor to the member account type", async () => {
    const db = makeDb([
      [{ id: 7 }],
      [
        reactorRow({
          username: null,
          photoUrl: null,
          accountType: null,
          isVerified: null,
          name: null,
        }),
      ],
      [typeRow(41, "like")],
    ]);
    holder.db = db;

    const page = await listVideoReactors(7);
    expect(page.reactors[0]).toEqual({
      userId: 41,
      name: null,
      username: null,
      photoUrl: null,
      accountType: "member",
      isVerified: false,
      reactions: ["love"],
    });
  });
});

describe("listVideoReactors — viewer reactions", () => {
  it("looks up the viewer's types even when they are not on the returned page", async () => {
    const db = makeDb([
      [{ id: 7 }],
      [reactorRow({ userId: 41 })],
      [typeRow(41, "like"), typeRow(99, "love")],
    ]);
    holder.db = db;

    const page = await listVideoReactors(7, { viewerId: 99, limit: 50 });

    expect(page.reactors).toHaveLength(1);
    expect(page.reactors[0]!.userId).toBe(41);
    expect(page.viewerReactions).toEqual(["love"]);
    expect(sqlText(db.__calls.where[1])).toBe(
      'reactor_source."userId" in ($1, $2)'
    );
  });

  it("returns no viewer reactions for anonymous readers", async () => {
    const db = makeDb([
      [{ id: 7 }],
      [reactorRow({ userId: 41 })],
      [typeRow(41, "like")],
    ]);
    holder.db = db;

    const page = await listVideoReactors(7, { viewerId: null });
    expect(page.viewerReactions).toEqual([]);
    expect(sqlText(db.__calls.where[1])).toBe(
      'reactor_source."userId" in ($1)'
    );
  });
});

describe("listCommentReactors — legacy comment_likes merge", () => {
  it("reads comment_reactions and legacy comment_likes from one unioned source", async () => {
    const db = makeDb([
      [{ id: 5 }],
      [reactorRow({ userId: 41 }), reactorRow({ userId: 42 })],
      [typeRow(41, "fire"), typeRow(42, "like")],
    ]);
    holder.db = db;

    const page = await listCommentReactors(5);

    expect(db.__calls.from[0]).toBe(videoComments);
    const source = sqlText(db.__calls.from[1]);
    expect(source).toContain('from "comment_reactions"');
    expect(source).toContain("union all");
    expect(source).toContain('from "comment_likes"');
    expect(source).toContain("'like' as \"reaction\"");
    expect(page.reactors.map(r => r.userId)).toEqual([41, 42]);
    // Read-only: historical rows are never rewritten or cleaned up.
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("dedupes a user holding both a legacy like and a typed like", async () => {
    const db = makeDb([
      [{ id: 5 }],
      [reactorRow({ userId: 41 })],
      [typeRow(41, "like"), typeRow(41, "like")],
    ]);
    holder.db = db;

    const page = await listCommentReactors(5, { viewerId: 41 });
    // The legacy like and the typed like normalize to one Pookie/Love entry.
    expect(page.reactors[0]!.reactions).toEqual(["love"]);
    expect(page.viewerReactions).toEqual(["love"]);
    expect(page.reactors).toHaveLength(1);
  });

  it("throws the existing comment error without reading reaction rows", async () => {
    const db = makeDb([[]]);
    holder.db = db;

    await expect(listCommentReactors(404)).rejects.toThrow("Comment not found.");
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.__calls.from).toEqual([videoComments]);
  });
});

describe("listCommunityReactors — announcement reads", () => {
  it("scopes the source to community_reactions for the announcement", async () => {
    const db = makeDb([
      [{ id: 12 }],
      [reactorRow({ userId: 41 })],
      [typeRow(41, "love")],
    ]);
    holder.db = db;

    const page = await listCommunityReactors(12);

    expect(db.__calls.from[0]).toBe(communityAnnouncements);
    expect(sqlText(db.__calls.from[1])).toBe(
      '(select "userId", "reaction", "createdAt" from "community_reactions" where "announcementId" = $1) as "reactor_source"'
    );
    expect(page.reactors[0]!.reactions).toEqual(["love"]);
  });

  it("throws the existing announcement error without reading reaction rows", async () => {
    const db = makeDb([[]]);
    holder.db = db;

    await expect(listCommunityReactors(404)).rejects.toThrow(
      "Community announcement not found."
    );
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.__calls.from).toEqual([communityAnnouncements]);
  });
});

describe("listHypeRoomMessageReactors — moderated message reads", () => {
  const messageRow = (over: Record<string, unknown> = {}) => ({
    roomExists: 3,
    messageId: 8,
    messageRoomId: 3,
    messageHiddenAt: null,
    ...over,
  });

  it("keeps the room-existence read and scopes reactions to the message", async () => {
    const db = makeDb([
      [messageRow()],
      [reactorRow({ userId: 41 })],
      [typeRow(41, "fire")],
    ]);
    holder.db = db;

    const page = await listHypeRoomMessageReactors(3, 8);

    expect(db.__calls.from[0]).toBe(hypeRooms);
    expect(db.__calls.joins).toEqual([
      ["left", hypeRoomMessages],
      ["inner", users],
      ["left", profiles],
    ]);
    expect(sqlText(db.__calls.from[1])).toBe(
      '(select "userId", "reaction", "createdAt" from "hype_room_message_reactions" where "messageId" = $1) as "reactor_source"'
    );
    // A historical 'fire' row still paints as the single Pookie reaction.
    expect(page.reactors[0]!.reactions).toEqual(["love"]);
  });

  it("throws the existing room error when the room is missing", async () => {
    const db = makeDb([[]]);
    holder.db = db;

    await expect(listHypeRoomMessageReactors(3, 8)).rejects.toThrow(
      "Room not found."
    );
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("hides a missing message behind the existing message error", async () => {
    const db = makeDb([[messageRow({ messageId: null, messageRoomId: null })]]);
    holder.db = db;

    await expect(listHypeRoomMessageReactors(3, 8)).rejects.toThrow(
      "Message not found."
    );
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("hides a moderated message behind the existing message error", async () => {
    const db = makeDb([
      [messageRow({ messageHiddenAt: new Date("2026-09-20T10:00:00Z") })],
    ]);
    holder.db = db;

    await expect(listHypeRoomMessageReactors(3, 8)).rejects.toThrow(
      "Message not found."
    );
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(db.__calls.from).toEqual([hypeRooms]);
  });

  it("rejects a message bound to another room", async () => {
    const db = makeDb([[messageRow({ messageRoomId: 77 })]]);
    holder.db = db;

    await expect(listHypeRoomMessageReactors(3, 8)).rejects.toThrow(
      "Message does not belong to this room."
    );
    expect(db.select).toHaveBeenCalledTimes(1);
  });
});

describe("reactor procedures — contract and wiring", () => {
  const user = {
    id: 41,
    openId: "kinba-reactor-user",
    name: "KINBA Member",
    email: "member@example.test",
    loginMethod: "email",
    role: "user" as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  function context(activeUser: typeof user | null = user): TrpcContext {
    return {
      user: activeUser,
      req: {} as TrpcContext["req"],
      res: {} as TrpcContext["res"],
    };
  }

  it("serves videos.reactors publicly and forwards the viewer id", async () => {
    const db = makeDb([
      [{ id: 7 }],
      [reactorRow({ userId: 41 })],
      [typeRow(41, "love")],
    ]);
    holder.db = db;

    const page = await appRouter
      .createCaller(context())
      .videos.reactors({ videoId: 7, limit: 1, offset: 0 });

    expect(page).toEqual({
      reactors: [
        {
          userId: 41,
          name: "KINBA Member",
          username: "member",
          photoUrl: "https://cdn.test/u.png",
          accountType: "creator",
          isVerified: true,
          reactions: ["love"],
        },
      ],
      hasMore: false,
      offset: 0,
      limit: 1,
      viewerReactions: ["love"],
    });
  });

  it("serves videos.reactors to anonymous readers", async () => {
    const db = makeDb([[{ id: 7 }], [], []]);
    holder.db = db;

    const page = await appRouter
      .createCaller(context(null))
      .videos.reactors({ videoId: 7 });

    expect(page.reactors).toEqual([]);
    expect(page.viewerReactions).toEqual([]);
    expect(page.hasMore).toBe(false);
    expect(page.limit).toBe(50);
  });

  it("rejects reactor page inputs outside limit 1–50 / offset >= 0", async () => {
    const db = makeDb([]);
    holder.db = db;
    const caller = appRouter.createCaller(context());

    await expect(
      caller.videos.reactors({ videoId: 7, limit: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.videos.reactors({ videoId: 7, limit: 51 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.videos.reactors({ videoId: 7, offset: -1 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.videos.reactors({ videoId: 0 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(db.select).not.toHaveBeenCalled();
  });

  it("serves videos.comments.reactors with the merged legacy view", async () => {
    const db = makeDb([
      [{ id: 5 }],
      [reactorRow({ userId: 42 })],
      [typeRow(42, "clap"), typeRow(42, "like")],
    ]);
    holder.db = db;

    const page = await appRouter
      .createCaller(context())
      .videos.comments.reactors({ commentId: 5 });

    // 'clap' and 'like' both normalize into the single Pookie/Love entry.
    expect(page.reactors[0]!.reactions).toEqual(["love"]);
    expect(sqlText(db.__calls.from[1])).toContain('from "comment_likes"');
  });

  it("serves community.reactors without authentication", async () => {
    const db = makeDb([[{ id: 12 }], [reactorRow({ userId: 7 })], []]);
    holder.db = db;

    const page = await appRouter
      .createCaller(context(null))
      .community.reactors({ announcementId: 12, limit: 5 });

    expect(page.reactors).toHaveLength(1);
    expect(page.viewerReactions).toEqual([]);
    expect(db.__calls.limit).toEqual([1, 6]);
  });

  it("gates hypeRooms.messageReactors behind the existing room flag", async () => {
    const db = makeDb([[{ id: 3 }], [], []]);
    holder.db = db;
    flagMocks.isFeatureFlagEnabled.mockResolvedValue(false);

    await expect(
      appRouter.createCaller(context()).hypeRooms.messageReactors({
        roomId: 3,
        messageId: 8,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(flagMocks.isFeatureFlagEnabled).toHaveBeenCalledWith(
      "time_limited_communities"
    );
    expect(db.select).not.toHaveBeenCalled();
  });

  it("maps hypeRooms.messageReactors moderation errors to NOT_FOUND", async () => {
    const db = makeDb([
      [
        {
          roomExists: 3,
          messageId: 8,
          messageRoomId: 3,
          messageHiddenAt: new Date("2026-09-20T10:00:00Z"),
        },
      ],
    ]);
    holder.db = db;

    await expect(
      appRouter.createCaller(context()).hypeRooms.messageReactors({
        roomId: 3,
        messageId: 8,
      })
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Message not found.",
    });
  });

  it("maps a missing hype room to NOT_FOUND", async () => {
    const db = makeDb([[]]);
    holder.db = db;

    await expect(
      appRouter.createCaller(context()).hypeRooms.messageReactors({
        roomId: 404,
        messageId: 8,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Room not found." });
  });

  it("serves hypeRooms.messageReactors once the flag is enabled", async () => {
    const db = makeDb([
      [
        {
          roomExists: 3,
          messageId: 8,
          messageRoomId: 3,
          messageHiddenAt: null,
        },
      ],
      [reactorRow({ userId: 41 })],
      [typeRow(41, "like")],
    ]);
    holder.db = db;

    const page = await appRouter
      .createCaller(context())
      .hypeRooms.messageReactors({ roomId: 3, messageId: 8, offset: 5 });

    expect(page.offset).toBe(5);
    expect(page.hasMore).toBe(false);
    // A stored 'like' row normalizes to the single Pookie reaction for the
    // viewer who holds it.
    expect(page.viewerReactions).toEqual(["love"]);
    expect(flagMocks.isFeatureFlagEnabled).toHaveBeenCalledWith(
      "time_limited_communities"
    );
  });
});
