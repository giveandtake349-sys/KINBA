/**
 * JHILIK Direct Messaging — Service Tests.
 *
 * Tests conversation creation, idempotency, follow-based request rule,
 * unread/read state, block enforcement.
 * Uses fakeDb matching real Drizzle query patterns from directMessages.ts.
 */
import { vi, describe, beforeEach, afterEach, expect, it } from "vitest";
import { eq, and, or, desc, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { readFile } from "node:fs/promises";
import {
  dmConversations,
  dmMessages,
  dmMessageRequests,
  dmConversationReads,
  follows,
  users,
  profiles,
} from "../drizzle/schema";
import type { DMMessageRow, DMMessageRequestRow, DMConversationRow } from "./directMessages";

const databaseMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  withDb: vi.fn(async (fn) => fn(await databaseMocks.getDb())),
}));

const notificationMocks = vi.hoisted(() => ({
  insertNotification: vi.fn(),
  NOTIFICATION_TYPES: {
    dmMessage: "dm_message",
    dmRequest: "dm_request",
    dmRequestAccepted: "dm_request_accepted",
  },
}));

const dmMediaMocks = vi.hoisted(() => ({
  resolveOwnedDmMedia: vi.fn(),
  signDmMessageMediaUrl: vi.fn(),
}));

vi.mock("./db", () => databaseMocks);
vi.mock("./notifications", () => notificationMocks);
vi.mock("./dmMedia", () => dmMediaMocks);

import {
  listConversations,
  listMessages,
  sendMessage,
  sendMessageRequest,
  listMessageRequests,
  acceptMessageRequest,
  declineMessageRequest,
  markConversationRead,
  getUnreadMessageCount,
  getOrCreateConversation,
  blockConversation,
} from "./directMessages";

const FIXED_TIME = new Date("2026-01-15T12:00:00.000Z");

function asRows(row: unknown): unknown[] {
  if (row === undefined) return [];
  if (Array.isArray(row)) return row;
  return [row];
}

function fakeDb(selectRows: unknown[]) {
  let selectCallIndex = 0;
  const insertValues = vi.fn();
  const updateSets = vi.fn();
  const deleteWheres = vi.fn();
  const insertReturning = vi.fn(async () => [{ id: 1 }]);
  const updateReturning = vi.fn(async () => []);
  const transactionCalls: Array<{ fn: (tx: unknown) => unknown }> = [];

  const createChain = (rows: unknown[]) => {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => rows),
      orderBy: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      groupBy: vi.fn(() => chain),
      then: (
        onFulfilled?: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => Promise.resolve(rows).then(onFulfilled, onRejected),
    };
    return chain;
  };

  const db: any = {
    select: vi.fn((...cols: unknown[]) => {
      const row = selectCallIndex < selectRows.length ? selectRows[selectCallIndex++] : undefined;
      const rows = asRows(row);
      return createChain(rows);
    }),
    insert: vi.fn(() => ({
      values: vi.fn((v: unknown) => {
        insertValues(v);
        return {
          returning: insertReturning,
          onConflictDoNothing: vi.fn(() => ({
            returning: insertReturning,
          })),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: unknown) => {
        updateSets(v);
        return {
          where: vi.fn(() => ({
            returning: updateReturning,
          })),
          returning: updateReturning,
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((...a: unknown[]) => {
        deleteWheres(...a);
        return Promise.resolve(undefined);
      }),
    })),
    transaction: async (fn: (tx: unknown) => unknown) => {
      transactionCalls.push({ fn });
      return await fn(db);
    },
    __insertValues: insertValues,
    __updateSets: updateSets,
    __deleteWheres: deleteWheres,
    __insertReturning: insertReturning,
    __updateReturning: updateReturning,
    __transactionCalls: transactionCalls,
    __selectCallIndex: () => selectCallIndex,
    __selectRows: selectRows,
  };
  return db;
}

/**
 * Creates a fakeDb with separate queues for outer and transaction selects.
 * Outer selects use outerQueue, transaction selects use txQueue.
 * Mocks (insertReturning, updateReturning, etc.) are shared.
 */
function fakeDbWithTx(outerQueue: unknown[], txQueue: unknown[]) {
  const sharedInsertReturning = vi.fn(async () => [{ id: 1 }]);
  const sharedUpdateReturning = vi.fn(async () => []);
  const sharedInsertValues = vi.fn();
  const sharedUpdateSets = vi.fn();
  const sharedDeleteWheres = vi.fn();
  const outerTransactionCalls: Array<{ fn: (tx: unknown) => unknown }> = [];

  const createChain = (rows: unknown[]) => {
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => rows),
      orderBy: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      groupBy: vi.fn(() => chain),
      then: (
        onFulfilled?: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => Promise.resolve(rows).then(onFulfilled, onRejected),
    };
    return chain;
  };

  const createDb = (queue: unknown[]) => ({
    select: vi.fn((...cols: unknown[]) => {
      const row = queue.length > 0 ? queue.shift() : undefined;
      const rows = asRows(row);
      return createChain(rows);
    }),
    insert: vi.fn(() => ({
      values: vi.fn((v: unknown) => {
        sharedInsertValues(v);
        return {
          returning: sharedInsertReturning,
          onConflictDoNothing: vi.fn(() => ({
            returning: sharedInsertReturning,
          })),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: unknown) => {
        sharedUpdateSets(v);
        return {
          where: vi.fn(() => ({
            returning: sharedUpdateReturning,
          })),
          returning: sharedUpdateReturning,
        };
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn((...a: unknown[]) => {
        sharedDeleteWheres(...a);
        return Promise.resolve(undefined);
      }),
    })),
  });

  const outerDb = createDb(outerQueue);
  const txDb = createDb(txQueue);

  // Add shared mocks and transaction to outerDb
  (outerDb as any).__insertValues = sharedInsertValues;
  (outerDb as any).__updateSets = sharedUpdateSets;
  (outerDb as any).__deleteWheres = sharedDeleteWheres;
  (outerDb as any).__insertReturning = sharedInsertReturning;
  (outerDb as any).__updateReturning = sharedUpdateReturning;
  (outerDb as any).__transactionCalls = outerTransactionCalls;
  (outerDb as any).__queue = outerQueue;

  outerDb.transaction = (fn: (tx: unknown) => unknown) => {
    outerTransactionCalls.push({ fn });
    return fn(txDb);
  };

  return outerDb;
}

function makeUser(id: number, name: string, username: string) {
  return { id, name, username, photoUrl: null, createdAt: FIXED_TIME, updatedAt: FIXED_TIME };
}

function makeProfile(userId: number, username: string) {
  return { id: userId, userId, username, photoUrl: null, bio: null, createdAt: FIXED_TIME, updatedAt: FIXED_TIME };
}

function makeConversation(id: number, userAId: number, userBId: number, over: Partial<DMConversationRow> = {}) {
  return {
    id,
    userAId,
    userBId,
    status: "active",
    lastMessageAt: FIXED_TIME,
    lastMessagePreview: "Preview",
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    ...over,
  };
}

function makeMessage(id: number, conversationId: number, senderId: number, body: string, over: Partial<DMMessageRow> = {}) {
  return {
    id,
    conversationId,
    senderId,
    body,
    mediaUrl: null,
    mediaType: null,
    mediaWidth: null,
    mediaHeight: null,
    mediaDuration: null,
    idempotencyKey: `key-${id}`,
    createdAt: FIXED_TIME,
    readAt: null,
    ...over,
  };
}

function makeRequest(id: number, requesterId: number, recipientId: number, body: string, status: "pending" | "accepted" | "declined" = "pending", over: Partial<DMMessageRequestRow> = {}) {
  return {
    id,
    requesterId,
    recipientId,
    body,
    mediaUrl: null,
    mediaType: null,
    mediaWidth: null,
    mediaHeight: null,
    mediaDuration: null,
    idempotencyKey: `req-key-${id}`,
    status,
    createdAt: FIXED_TIME,
    updatedAt: FIXED_TIME,
    respondedAt: status !== "pending" ? FIXED_TIME : null,
    ...over,
  };
}

function makeRead(conversationId: number, userId: number, unreadCount = 0) {
  return { conversationId, userId, unreadCount, lastReadMessageId: null, lastReadAt: FIXED_TIME };
}

function makeFollow(followerId: number, followedId: number) {
  return { id: followerId * 1000 + followedId, followerId, followedId, createdAt: FIXED_TIME };
}

function resetMocks() {
  vi.clearAllMocks();
  dmMediaMocks.resolveOwnedDmMedia.mockImplementation((userId: number, media?: { mediaUrl: string; mediaType: string; mediaWidth?: number; mediaHeight?: number; mediaDuration?: number }) => {
    if (!media) return undefined;
    return { ...media, mediaUrl: `dm/${userId}/${media.mediaUrl}` };
  });
  dmMediaMocks.signDmMessageMediaUrl.mockImplementation(async (url: string) => `signed-${url}`);
  notificationMocks.insertNotification.mockResolvedValue(undefined);
}

beforeEach(() => {
  resetMocks();
});

describe("Direct Messages — service behavior", () => {
  describe("sendMessageRequest — follow rules", () => {
    it("1. mutual follow (both directions) → creates normal direct conversation/message (accepted)", async () => {
      const conv = makeConversation(10, 1, 2);
      const msg = makeMessage(100, 10, 1, "Hello");
      // Production: getDb() -> checkFollows both directions -> ensureConversationExists -> sendMessage
      const db = fakeDb([
        makeFollow(1, 2), // checkFollows(1, 2) - requester follows recipient
        makeFollow(2, 1), // checkFollows(2, 1) - recipient follows requester
        null, // ensureConversationExists select - no existing
        conv, // getConversationOrThrow in sendMessage
        null, // idempotency check in sendMessage
      ]);
      db.__insertReturning
        .mockResolvedValueOnce([conv]) // ensureConversationExists insert conversation
        .mockResolvedValueOnce([{}]) // ensureConversationExists insert reads (2 rows)
        .mockResolvedValueOnce([msg]); // sendMessage insert message
      db.__updateReturning.mockResolvedValue([{}]); // conversation update, reads update
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result = await sendMessageRequest(1, 2, "Hello", "key-1");

      expect(result.status).toBe("accepted");
      expect(result.conversationId).toBe(10);
      expect(result.body).toBe("Hello");
      expect(db.__insertValues).toHaveBeenCalledTimes(3); // conversation + reads(2) + message
      expect(db.__transactionCalls).toHaveLength(0); // no transaction used
    });

it("2. recipient does NOT follow requester → creates pending request with conversation for sender (transaction)", async () => {
      const req = makeRequest(1, 1, 2, "Hello", "pending", { conversationId: 11 });
      const conv = makeConversation(11, 1, 2);
      const msg = makeMessage(101, 11, 1, "Hello");
      // Production: getDb() -> checkFollows(1,2) -> checkFollows(2,1) -> check existing request -> transaction
      // Inside transaction: ensureConversationExists (select, insert conv, insert reads) -> insertMessage (select, select, insert) -> insert request -> notification select
      // Combined queue: outer selects (3) + transaction selects (4) = 7 total
      const db = fakeDb([
        null, // checkFollows(1, 2) - outer
        null, // checkFollows(2, 1) - outer
        null, // existing request check - outer
        null, // ensureConversationExists select - transaction
        conv, // getConversationOrThrow in insertMessage - transaction
        null, // idempotency check in insertMessage - transaction
        null, // requester name select for notification - transaction
      ]);
      db.__insertReturning
        .mockResolvedValueOnce([conv]) // ensureConversationExists insert conversation
        .mockResolvedValueOnce([msg]) // insertMessage
        .mockResolvedValueOnce([req]); // insert request
      db.__updateReturning.mockResolvedValue([{}]); // conversation update, reads update
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result = await sendMessageRequest(1, 2, "Hello", "key-2");

      expect(result.status).toBe("pending");
      expect(result.conversationId).toBe(11); // conversation created for sender
      expect(result.id).toBe(1);
      expect(db.__insertValues).toHaveBeenCalledTimes(4); // conversation + reads + message + request
      expect(db.__transactionCalls).toHaveLength(1); // transaction used
    });

    it("2b. idempotency: second call with same key returns existing request with conversationId", async () => {
      const req = makeRequest(1, 1, 2, "Hello", "pending", { conversationId: 11, idempotencyKey: "key-2" });
      const conv = makeConversation(11, 1, 2);
      const msg = makeMessage(101, 11, 1, "Hello", { idempotencyKey: "key-2" });
      // Call 1: checkFollows(1,2), checkFollows(2,1), existing request check (none) -> transaction
      //   Transaction: ensureConversationExists select, getConversationOrThrow, idempotency check, requester name select
      // Call 2: checkFollows(1,2), checkFollows(2,1), existing request check (finds existing) x2 (fakeDb double-exec) -> returns early
      const db = fakeDb([
        null, // call 1: checkFollows(1, 2)
        null, // call 1: checkFollows(2, 1)
        null, // call 1: existing request check (no existing)
        null, // call 1 tx: ensureConversationExists select
        conv, // call 1 tx: getConversationOrThrow
        null, // call 1 tx: idempotency check
        null, // call 1 tx: requester name select
        null, // call 2: checkFollows(1, 2)
        null, // call 2: checkFollows(2, 1)
        req,  // call 2: existing request check #1 (finds existing)
        req,  // call 2: existing request check #2 (fakeDb double-exec)
      ]);
      db.__insertReturning
        .mockResolvedValueOnce([conv])
        .mockResolvedValueOnce([msg])
        .mockResolvedValueOnce([req]);
      db.__updateReturning.mockResolvedValue([{}]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result1 = await sendMessageRequest(1, 2, "Hello", "key-2");
      const result2 = await sendMessageRequest(1, 2, "Hello", "key-2");

      expect(result1.status).toBe("pending");
      expect(result2.status).toBe("pending");
      expect(result1.id).toBe(1);
      expect(result2.id).toBe(1);
      expect(result1.conversationId).toBe(11);
      expect(result2.conversationId).toBe(11);
      expect(db.__insertValues).toHaveBeenCalledTimes(4);
      expect(db.__transactionCalls).toHaveLength(1);
    });

    it("3. idempotency prevents duplicate pending request", async () => {
      const req = makeRequest(2, 1, 2, "Hello", "pending", { conversationId: 12, idempotencyKey: "key-3" });
      const conv = makeConversation(12, 1, 2);
      const msg = makeMessage(102, 12, 1, "Hello", { idempotencyKey: "key-3" });
      // Need queue for 2 calls:
      // Call 1: checkFollows(1,2), checkFollows(2,1), existing request check -> transaction
      //   Transaction: ensureConversationExists select, getConversationOrThrow, idempotency check, requester name select
      // Call 2: checkFollows(1,2), checkFollows(2,1), existing request check x2 (fakeDb double-exec) -> returns early
      // Combined queue: 3 + 4 + 4 = 11 total selects
      const db = fakeDb([
        null, // call 1: checkFollows(1, 2)
        null, // call 1: checkFollows(2, 1)
        null, // call 1: existing request check (no existing)
        null, // call 1 tx: ensureConversationExists select
        conv, // call 1 tx: getConversationOrThrow in insertMessage
        null, // call 1 tx: idempotency check in insertMessage
        null, // call 1 tx: requester name select for notification
        null, // call 2: checkFollows(1, 2)
        null, // call 2: checkFollows(2, 1)
        req,  // call 2: existing request check #1 (finds existing)
        req,  // call 2: existing request check #2 (fakeDb double-exec)
      ]);
      db.__insertReturning
        .mockResolvedValueOnce([conv]) // call 1: ensureConversationExists insert conversation
        .mockResolvedValueOnce([msg]) // call 1: insertMessage
        .mockResolvedValueOnce([req]); // call 1: insert request
      db.__updateReturning.mockResolvedValue([{}]); // conversation update, reads update
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result1 = await sendMessageRequest(1, 2, "Hello", "key-3");
      const result2 = await sendMessageRequest(1, 2, "Hello", "key-3");

      expect(result1.id).toBe(2);
      expect(result2.id).toBe(2);
      expect(result1.conversationId).toBe(12);
      expect(result2.conversationId).toBe(12);
      expect(db.__insertValues).toHaveBeenCalledTimes(4); // only first call inserts
      expect(db.__transactionCalls).toHaveLength(1); // only first call uses transaction
    });

    it("4. request with media preserves attachment fields in request", async () => {
      const media = { mediaUrl: "photo.jpg", mediaType: "image", mediaWidth: 800, mediaHeight: 600, mediaDuration: null };
      const req = makeRequest(3, 1, 2, "Hello", "pending", { mediaUrl: "dm/1/photo.jpg", mediaType: "image", mediaWidth: 800, mediaHeight: 600, conversationId: 13 });
      const conv = makeConversation(13, 1, 2);
      const msg = makeMessage(103, 13, 1, "Hello", { mediaUrl: "dm/1/photo.jpg", mediaType: "image", mediaWidth: 800, mediaHeight: 600 });
      const db = fakeDbWithTx(
        [
          null, // checkFollows(1, 2)
          null, // checkFollows(2, 1)
        ],
        [
          null, // ensureConversationExists select (tx)
          conv, // getConversationOrThrow in insertMessage (tx)
          null, // idempotency check in insertMessage (tx)
          null, // requester name select for notification (tx)
        ]
      );
      db.__insertReturning
        .mockResolvedValueOnce([conv]) // ensureConversationExists insert conversation
        .mockResolvedValueOnce([msg]) // insertMessage
        .mockResolvedValueOnce([req]); // insert request
      db.__updateReturning.mockResolvedValue([{}]); // conversation update, reads update
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result = await sendMessageRequest(1, 2, "Hello", "key-attach", media);

      expect(result.mediaUrl).toBe("dm/1/photo.jpg");
      expect(result.mediaType).toBe("image");
      expect(result.mediaWidth).toBe(800);
      expect(result.mediaHeight).toBe(600);
      expect(result.conversationId).toBe(13);
      expect(dmMediaMocks.resolveOwnedDmMedia).toHaveBeenCalledWith(1, media);
      expect(db.__transactionCalls).toHaveLength(1);
    });
  });

  describe("listConversations — pending request filtering", () => {
    it("5. excludes conversations that have pending requests where user is recipient", async () => {
      const conv = makeConversation(20, 1, 2); // use default lastMessageAt to trigger all queries
      const read = makeRead(20, 2, 0);
      const partner = makeUser(1, "User 1", "user1");
      // dm_message_requests has no conversation id: listConversations selects the
      // real (requesterId, recipientId) columns and matches the pair in memory.
      const pendingRequest = makeRequest(10, 1, 2, "Hello", "pending");
      const msg = makeMessage(100, 20, 1, "Hello");

      const db = fakeDb([
        [conv], // 1. conversations
        [pendingRequest], // 2. pending requests (recipientId = 2, status = pending)
        [read], // 3. reads
        [partner], // 4. partners (users join profiles)
        [{ id: 100, conversationId: 20 }], // 5. latest (max message id)
        [msg], // 6. lastMessages
      ]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result = await listConversations(2);

      expect(result).toHaveLength(0);
    });

    it("5b. includes conversations without pending requests", async () => {
      const conv = makeConversation(21, 1, 2);
      const read = makeRead(21, 1, 0);
      const partner = makeUser(2, "User 2", "user2");

      const db = fakeDb([
        [conv], // conversations
        [], // no pending requests for sender
        [read], // reads
        [partner], // users join profiles
      ]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result = await listConversations(1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(21);
    });

    it("5c. includes conversations where user is requester (not recipient of request)", async () => {
      // If user 1 sent a request to user 2, user 1 should still see the conversation
      // (if it exists, e.g. from a previous mutual follow)
      const conv = makeConversation(22, 1, 2);
      const read = makeRead(22, 1, 0);
      const partner = makeUser(2, "User 2", "user2");
      // Request 1 -> 2 exists where user 1 is the requester, not the recipient.
      // listConversations only selects requests with recipientId = user 1, so the
      // pending-request queue below is empty for this caller.

      const db = fakeDb([
        [conv], // conversations
        [], // no pending requests where user 1 is RECIPIENT
        [read], // reads
        [partner], // users join profiles
      ]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result = await listConversations(1);

      // Should NOT be filtered out because user 1 is the requester, not recipient
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(22);
    });
  });

  describe("listMessageRequests", () => {
    it("6. returns pending requests to recipient with requester profile", async () => {
      const req = makeRequest(7, 1, 2, "Hello", "pending");
      const requester = makeUser(1, "Requester", "requester");

      const db = fakeDb([
        [req], // requests (filtered by where status="pending")
        [requester], // users join profiles
      ]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result = await listMessageRequests(2);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(7);
      expect(result[0].requester.id).toBe(1);
      expect(result[0].requester.username).toBe("requester");
    });

    it("6b. returns empty when no pending requests exist", async () => {
      const db = fakeDb([
        [], // no pending requests
      ]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result = await listMessageRequests(2);

      expect(result).toHaveLength(0);
    });

    it("6c. does not return accepted/declined requests (filtered by where clause)", async () => {
      // Production query filters: where(status="pending", recipientId=userId)
      // So accepted/declined are excluded by the where clause
      const db = fakeDb([
        [], // where status="pending" returns empty
      ]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result = await listMessageRequests(2);

      expect(result).toHaveLength(0);
    });
  });

  describe("acceptMessageRequest / declineMessageRequest", () => {
    it("acceptMessageRequest creates conversation and message, updates request", async () => {
      const req = makeRequest(16, 1, 2, "Hello", "pending", { conversationId: 0, mediaUrl: "dm/1/photo.jpg", mediaType: "image" });
      const conv = makeConversation(32, 1, 2);
      const msg = makeMessage(308, 32, 1, "Hello", { mediaUrl: "dm/1/photo.jpg", mediaType: "image" });

      const db = fakeDb([
        req, // fetch request
        conv, // ensureConversationExists
        conv, // getConversationOrThrow in sendMessage
        null, // idempotency check in sendMessage
      ]);
      db.__insertReturning.mockResolvedValueOnce([msg]); // sendMessage
      db.__updateReturning.mockResolvedValueOnce([makeRequest(16, 1, 2, "Hello", "accepted", { conversationId: 32, respondedAt: FIXED_TIME })]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result = await acceptMessageRequest(16, 2);

      expect(result.conversation.id).toBe(32);
      expect(result.message.body).toBe("Hello");
      expect(result.message.mediaUrl).toBe("dm/1/photo.jpg");
    });

    it("declineMessageRequest marks request as declined", async () => {
      const req = makeRequest(17, 1, 2, "Hello", "pending");

      const db = fakeDb([req]);
      db.__updateReturning.mockResolvedValueOnce([makeRequest(17, 1, 2, "Hello", "declined", { respondedAt: FIXED_TIME })]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      await declineMessageRequest(17, 2);

      expect(db.__updateSets).toHaveBeenCalledWith(expect.objectContaining({ status: "declined" }));
    });
  });

  describe("getOrCreateConversation", () => {
    it("7. rejects new conversation without mutual follow", async () => {
      const db = fakeDb([
        null, // no existing conversation
        null, // checkFollows(1, 2) - no follow
        null, // checkFollows(2, 1) - no follow
      ]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      await expect(getOrCreateConversation(1, 2))
        .rejects.toThrow("Cannot create conversation: users must mutually follow each other.");
    });

    it("7b. creates new conversation with mutual follow", async () => {
      const db = fakeDb([
        null, // no existing conversation
        makeFollow(1, 2), // checkFollows(1, 2) - requester follows recipient
        makeFollow(2, 1), // checkFollows(2, 1) - recipient follows requester
      ]);
      db.__insertReturning
        .mockResolvedValueOnce([makeConversation(30, 1, 2)]) // dmConversations insert
        .mockResolvedValueOnce([{}, {}]); // dmConversationReads insert (2 rows)
      databaseMocks.getDb.mockResolvedValue(db as never);

      const conv = await getOrCreateConversation(1, 2);

      expect(conv.id).toBe(30);
      expect(conv.status).toBe("active");
      expect(db.__insertValues).toHaveBeenCalledTimes(2); // conversation + reads
    });

    it("8. existing active conversation remains accessible after follow state changes", async () => {
      const existingConv = makeConversation(31, 1, 2, { status: "active" });

      const db = fakeDb([
        existingConv, // existing conversation found
      ]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      const conv = await getOrCreateConversation(1, 2);

      expect(conv.id).toBe(31);
    });
  });

  describe("sendMessage — normal flow", () => {
    it("sendMessage inserts message and updates conversation/reads", async () => {
      const conv = makeConversation(40, 1, 2);
      const msg = makeMessage(400, 40, 1, "Direct message");

      const db = fakeDb([
        conv, // getConversationOrThrow
        null, // no existing message for idempotency
      ]);
      db.__insertReturning.mockResolvedValueOnce([msg]);
      db.__updateReturning.mockResolvedValue([{}]); // conversation update, reads update
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result = await sendMessage(40, 1, "Direct message", "direct-key-1");

      expect(result.id).toBe(400);
      expect(result.body).toBe("Direct message");
      expect(db.__insertValues).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 40, senderId: 1, body: "Direct message" }));
    });

    it("sendMessage idempotency returns existing message", async () => {
      const conv = makeConversation(41, 1, 2);
      const existingMsg = makeMessage(401, 41, 1, "Direct message", { idempotencyKey: "direct-key-2" });

      const db = fakeDb([
        conv,
        existingMsg, // existing message found
      ]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result = await sendMessage(41, 1, "Direct message", "direct-key-2");

      expect(result.id).toBe(401);
      expect(db.__insertValues).not.toHaveBeenCalled();
    });
  });

  describe("listMessages", () => {
    it("returns messages with sender profiles and signed media URLs", async () => {
      const conv = makeConversation(50, 1, 2);
      const messages = [
        makeMessage(501, 50, 2, "Second"),
        makeMessage(500, 50, 1, "First"),
      ];
      const senders = [makeUser(1, "User 1", "user1"), makeUser(2, "User 2", "user2")];

      const db = fakeDb([
        conv, // getConversationOrThrow
        messages, // messages (already in DESC order)
        senders, // senders
      ]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      const result = await listMessages(50, 1);

      expect(result).toHaveLength(2);
      expect(result[0].sender.id).toBe(1);
      expect(result[1].sender.id).toBe(2);
    });
  });

  describe("markConversationRead / getUnreadMessageCount / blockConversation", () => {
    it("markConversationRead updates reads and messages", async () => {
      const conv = makeConversation(60, 1, 2);
      const latestMsg = makeMessage(600, 60, 2, "Latest");

      const db = fakeDb([
        conv, // getConversationOrThrow
        [latestMsg], // latest message
      ]);
      db.__updateReturning.mockResolvedValue([{}]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      await markConversationRead(60, 1);

      expect(db.__updateSets).toHaveBeenCalledWith(expect.objectContaining({ unreadCount: 0 }));
    });

    it("getUnreadMessageCount sums unread counts", async () => {
      const db = fakeDb([
        [{ unreadCount: 3 }, { unreadCount: 2 }], // reads
      ]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      const count = await getUnreadMessageCount(1);

      expect(count).toBe(5);
    });

    it("blockConversation sets status to blocked", async () => {
      const conv = makeConversation(70, 1, 2);

      const db = fakeDb([conv]);
      db.__updateReturning.mockResolvedValue([{ ...conv, status: "blocked" }]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      await blockConversation(70, 1);

      expect(db.__updateSets).toHaveBeenCalledWith(expect.objectContaining({ status: "blocked" }));
    });
  });

  describe("Transaction behavior", () => {
    it("9. sendMessageRequest does NOT use a transaction (uses db directly)", async () => {
      // Both mutual follow and non-mutual paths use db directly, not transaction
      const conv = makeConversation(80, 1, 2);
      const msg = makeMessage(700, 80, 1, "Hello");

      const db = fakeDb([
        makeFollow(2, 1), // checkFollows(2,1) - mutual follow
        null, // ensureConversationExists select
        conv, // getConversationOrThrow in sendMessage
        null, // idempotency check in sendMessage
      ]);
      db.__insertReturning
        .mockResolvedValueOnce([conv])
        .mockResolvedValueOnce([{}])
        .mockResolvedValueOnce([msg]);
      db.__updateReturning.mockResolvedValue([{}]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      await sendMessageRequest(1, 2, "Hello", "txn-key-1");

      expect(db.__transactionCalls).toHaveLength(0);
    });

    it("10. sendMessage does NOT use a transaction", async () => {
      const conv = makeConversation(81, 1, 2);
      const msg = makeMessage(701, 81, 1, "Hello");

      const db = fakeDb([
        conv, // getConversationOrThrow
        null, // idempotency check
      ]);
      db.__insertReturning.mockResolvedValueOnce([msg]);
      db.__updateReturning.mockResolvedValue([{}]);
      databaseMocks.getDb.mockResolvedValue(db as never);

      await sendMessage(81, 1, "Hello", "txn-key-2");

      expect(db.__transactionCalls).toHaveLength(0);
    });
  });
});

describe("Direct Messages — router integration", () => {
  it("directMessages router exports all procedures", async () => {
    const dm = await import("./directMessages");
    expect(typeof dm.listConversations).toBe("function");
    expect(typeof dm.listMessages).toBe("function");
    expect(typeof dm.sendMessage).toBe("function");
    expect(typeof dm.sendMessageRequest).toBe("function");
    expect(typeof dm.listMessageRequests).toBe("function");
    expect(typeof dm.acceptMessageRequest).toBe("function");
    expect(typeof dm.declineMessageRequest).toBe("function");
    expect(typeof dm.replyToMessageRequest).toBe("function");
    expect(typeof dm.markConversationRead).toBe("function");
    expect(typeof dm.getUnreadMessageCount).toBe("function");
    expect(typeof dm.getOrCreateConversation).toBe("function");
    expect(typeof dm.blockConversation).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Regression: listConversations must only touch columns that exist.
//
// The old implementation read `dmMessageRequests.conversationId`. That column is
// in neither drizzle/schema.ts nor the production table, so Drizzle threw
// `TypeError: Cannot convert undefined or null to object` while building SQL
// (drizzle-orm orderSelectedFields) and every account with at least one active
// conversation received HTTP 500 from directMessages.listConversations.
//
// The fakeDb helpers above never build SQL, so these tests drive the real
// Drizzle schema/query builder against a capturing client. They fail if the
// missing column is referenced again — no fake `conversationId` is added.
// ---------------------------------------------------------------------------

const SQL_TABLES: Record<string, object> = {
  dm_conversations: dmConversations,
  dm_messages: dmMessages,
  dm_message_requests: dmMessageRequests,
  dm_conversation_reads: dmConversationReads,
  users,
  profiles,
};

function knownColumns(tableName: string): Set<string> | undefined {
  const table = SQL_TABLES[tableName];
  if (!table) return undefined;
  return new Set(
    Object.values(getTableColumns(table as never)).map((column) => column.name)
  );
}

function assertSqlOnlyUsesKnownColumns(statements: string[]) {
  for (const statement of statements) {
    const identifiers = statement.matchAll(/"([A-Za-z0-9_]+)"\."([A-Za-z0-9_]+)"/g);
    for (const [, tableName, columnName] of identifiers) {
      const known = knownColumns(tableName);
      if (known && !known.has(columnName)) {
        throw new Error(`Unknown column ${tableName}.${columnName} in SQL:\n${statement}`);
      }
    }
  }
}

describe("listConversations — real Drizzle SQL (regression)", () => {
  // Current user is 2. Conversation 20 joins users 1 & 2; conversation 21 joins
  // users 2 & 5. The pending request is 5 -> 2 (user 2 is the recipient), so it
  // belongs to conversation 21 regardless of participant ordering.
  const conversationForUserOne = makeConversation(20, 1, 2);
  const conversationForUserFive = makeConversation(21, 2, 5);
  const pendingFromUserFive = makeRequest(70, 5, 2, "Hi", "pending");

  function createCapturingClient() {
    const captured: string[] = [];

    const rowsFor = (text: string): unknown[][] => {
      if (text.includes("max(")) return [];
      if (text.includes('"dm_conversations"')) {
        const keys = Object.keys(getTableColumns(dmConversations));
        return [conversationForUserOne, conversationForUserFive].map((row) =>
          keys.map((key) => (row as Record<string, unknown>)[key] ?? null)
        );
      }
      if (text.includes('"dm_message_requests"')) {
        // Column order mirrors the `.select({...})` literal in listConversations.
        return [[pendingFromUserFive.requesterId, pendingFromUserFive.recipientId]];
      }
      return [];
    };

    const client = {
      query: async (first: unknown) => {
        const text =
          typeof first === "string"
            ? first
            : String((first as { text?: string } | null)?.text ?? "");
        captured.push(text);
        return { rows: rowsFor(text) };
      },
    };

    return { client, captured };
  }

  function runWithRealDrizzle() {
    const { client, captured } = createCapturingClient();
    const realDb = drizzle({ client: client as never });
    databaseMocks.withDb.mockImplementationOnce(
      async (fn: (db: unknown) => Promise<unknown>) => fn(realDb)
    );
    return { captured, done: () => listConversations(2, 50) };
  }

  it("builds SQL that only references columns present in the schema", async () => {
    const { captured, done } = runWithRealDrizzle();

    const result = await done();

    expect(captured.length).toBeGreaterThan(0);
    expect(() => assertSqlOnlyUsesKnownColumns(captured)).not.toThrow();
  });

  it("does not reference dm_message_requests.conversationId", async () => {
    const { captured, done } = runWithRealDrizzle();

    await done();

    const requestSql = captured.find((text) => text.includes('"dm_message_requests"'));
    expect(requestSql).toBeDefined();
    expect(requestSql).toContain('"recipientId"');
    expect(requestSql).toContain('"status"');
    expect(requestSql).not.toContain('"conversationId"');
  });

  it("hides only the conversation whose participants match a pending request", async () => {
    const { done } = runWithRealDrizzle();

    const result = await done();

    // Conversation 21 (2 & 5) matches pending request 5 -> 2 and is hidden;
    // conversation 20 (1 & 2) has no pending request and stays visible.
    expect(result.map((conversation) => conversation.id)).toEqual([20]);
  });

  it("directMessages.ts never references dmMessageRequests.conversationId", async () => {
    const source = await readFile(new URL("./directMessages.ts", import.meta.url), "utf8");

    expect(source).not.toContain("dmMessageRequests.conversationId");
  });
});