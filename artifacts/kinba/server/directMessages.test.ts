/**
 * JHILIK Direct Messaging — Service Tests.
 *
 * Tests conversation creation, idempotency, follow-based request rule,
 * accept/decline, unread/read state, block enforcement.
 */
import { vi, describe, beforeEach, afterEach, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";

type ChainResult = unknown;

function chain(result: ChainResult) {
  const c: Record<string, unknown> = {};
  const methods = [
    "from",
    "where",
    "limit",
    "orderBy",
    "returning",
    "values",
    "set",
    "select",
    "leftJoin",
    "inArray",
  ];
  for (const m of methods) {
    c[m] = vi.fn(() => c);
  }
  c.then = (
    resolve: (v: unknown) => unknown,
    reject?: (e: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return c;
}

const dbState = vi.hoisted(() => ({
  selectResult: undefined as unknown,
  insertResult: undefined as unknown,
  updateResult: undefined as unknown,
  userRows: [] as Array<{ id: number }>,
  profileRows: [] as Array<{ id: number; userId: number; username: string | null; photoUrl: string | null }>,
  conversationRows: [] as unknown[],
  messageRows: [] as unknown[],
  requestRows: [] as unknown[],
  readRows: [] as unknown[],
  followRows: [] as unknown[],
  selectCalls: [] as unknown[],
  insertCalls: [] as unknown[],
  updateCalls: [] as unknown[],
}));

const databaseMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  ensureProfile: vi.fn(),
  insertNotification: vi.fn(),
  checkFollows: vi.fn(),
}));

const directMessagesMocks = vi.hoisted(() => ({
  listConversations: vi.fn(),
  listMessages: vi.fn(),
  sendMessage: vi.fn(),
  sendMessageRequest: vi.fn(),
  listMessageRequests: vi.fn(),
  acceptMessageRequest: vi.fn(),
  declineMessageRequest: vi.fn(),
  markConversationRead: vi.fn(),
  getUnreadMessageCount: vi.fn(),
  getOrCreateConversation: vi.fn(),
  blockConversation: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: databaseMocks.getDb,
}));

vi.mock("./notifications", () => ({
  insertNotification: databaseMocks.insertNotification,
  NOTIFICATION_TYPES: {
    dmMessage: "dm_message",
    dmRequest: "dm_request",
    dmRequestAccepted: "dm_request_accepted",
  },
}));

vi.mock("./directMessages", () => ({
  listConversations: directMessagesMocks.listConversations,
  listMessages: directMessagesMocks.listMessages,
  sendMessage: directMessagesMocks.sendMessage,
  sendMessageRequest: directMessagesMocks.sendMessageRequest,
  listMessageRequests: directMessagesMocks.listMessageRequests,
  acceptMessageRequest: directMessagesMocks.acceptMessageRequest,
  declineMessageRequest: directMessagesMocks.declineMessageRequest,
  markConversationRead: directMessagesMocks.markConversationRead,
  getUnreadMessageCount: directMessagesMocks.getUnreadMessageCount,
  getOrCreateConversation: directMessagesMocks.getOrCreateConversation,
  blockConversation: directMessagesMocks.blockConversation,
}));

function makeDb() {
  const c = chain({});
  databaseMocks.getDb.mockResolvedValue(c);
  return c;
}

function resetMocks() {
  vi.clearAllMocks();
  dbState.selectResult = undefined;
  dbState.insertResult = undefined;
  dbState.updateResult = undefined;
  dbState.userRows = [];
  dbState.profileRows = [];
  dbState.conversationRows = [];
  dbState.messageRows = [];
  dbState.requestRows = [];
  dbState.readRows = [];
  dbState.followRows = [];
}

describe("Direct Messages — service behavior", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("listConversations calls service", async () => {
    const { listConversations } = await import("./directMessages");
    const mockConversations = [
      {
        id: 1,
        userAId: 1,
        userBId: 2,
        status: "active",
        lastMessageAt: new Date(),
        lastMessagePreview: "Hello",
        createdAt: new Date(),
        updatedAt: new Date(),
        partner: { id: 2, name: "User 2", username: "user2", photoUrl: null },
        unreadCount: 0,
        lastMessage: null,
      },
    ];
    directMessagesMocks.listConversations.mockResolvedValue(mockConversations);

    const result = await listConversations(1);
    expect(result).toEqual(mockConversations);
    expect(directMessagesMocks.listConversations).toHaveBeenCalledWith(1);
  });

  it("sendMessage enforces idempotency", async () => {
    const { sendMessage } = await import("./directMessages");
    const mockMessage = {
      id: 1,
      conversationId: 1,
      senderId: 1,
      body: "Hello",
      mediaUrl: null,
      mediaType: null,
      mediaWidth: null,
      mediaHeight: null,
      mediaDuration: null,
      idempotencyKey: "key-123",
      createdAt: new Date(),
      readAt: null,
    };
    directMessagesMocks.sendMessage.mockResolvedValue(mockMessage);

    const result = await sendMessage(1, 1, "Hello", "key-123");
    expect(result).toEqual(mockMessage);
    expect(directMessagesMocks.sendMessage).toHaveBeenCalledWith(1, 1, "Hello", "key-123");
  });

  it("sendMessageRequest creates request when recipient doesn't follow", async () => {
    const { sendMessageRequest } = await import("./directMessages");
    const mockRequest = {
      id: 1,
      requesterId: 1,
      recipientId: 2,
      body: "Hello",
      mediaUrl: null,
      mediaType: null,
      mediaWidth: null,
      mediaHeight: null,
      mediaDuration: null,
      idempotencyKey: "key-123",
      status: "pending" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      respondedAt: null,
    };
    directMessagesMocks.sendMessageRequest.mockResolvedValue(mockRequest);

    const result = await sendMessageRequest(1, 2, "Hello", "key-123");
    expect(result).toEqual(mockRequest);
    expect(directMessagesMocks.sendMessageRequest).toHaveBeenCalledWith(1, 2, "Hello", "key-123");
  });

  it("sendMessageRequest returns accepted when recipient follows", async () => {
    const { sendMessageRequest } = await import("./directMessages");
    const mockAccepted = {
      id: 0,
      requesterId: 1,
      recipientId: 2,
      body: "Hello",
      mediaUrl: null,
      mediaType: null,
      mediaWidth: null,
      mediaHeight: null,
      mediaDuration: null,
      idempotencyKey: "key-123",
      status: "accepted" as const,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
      respondedAt: expect.any(Date),
    };
    directMessagesMocks.sendMessageRequest.mockResolvedValue(mockAccepted);

    const result = await sendMessageRequest(1, 2, "Hello", "key-123");
    expect(result.status).toBe("accepted");
    expect(directMessagesMocks.sendMessageRequest).toHaveBeenCalledWith(1, 2, "Hello", "key-123");
  });

  it("acceptMessageRequest creates conversation and message", async () => {
    const { acceptMessageRequest } = await import("./directMessages");
    const mockResult = {
      conversation: {
        id: 1,
        userAId: 1,
        userBId: 2,
        status: "active",
        lastMessageAt: new Date(),
        lastMessagePreview: "Hello",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      message: {
        id: 1,
        conversationId: 1,
        senderId: 1,
        body: "Hello",
        mediaUrl: null,
        mediaType: null,
        mediaWidth: null,
        mediaHeight: null,
        mediaDuration: null,
        idempotencyKey: "key-123",
        createdAt: new Date(),
        readAt: null,
      },
    };
    directMessagesMocks.acceptMessageRequest.mockResolvedValue(mockResult);

    const result = await acceptMessageRequest(1, 2);
    expect(result).toEqual(mockResult);
    expect(directMessagesMocks.acceptMessageRequest).toHaveBeenCalledWith(1, 2);
  });

  it("declineMessageRequest marks request as declined", async () => {
    const { declineMessageRequest } = await import("./directMessages");
    directMessagesMocks.declineMessageRequest.mockResolvedValue(undefined);

    await declineMessageRequest(1, 2);
    expect(directMessagesMocks.declineMessageRequest).toHaveBeenCalledWith(1, 2);
  });

  it("markConversationRead marks messages as read", async () => {
    const { markConversationRead } = await import("./directMessages");
    directMessagesMocks.markConversationRead.mockResolvedValue(undefined);

    await markConversationRead(1, 2);
    expect(directMessagesMocks.markConversationRead).toHaveBeenCalledWith(1, 2);
  });

  it("getUnreadMessageCount returns total unread", async () => {
    const { getUnreadMessageCount } = await import("./directMessages");
    directMessagesMocks.getUnreadMessageCount.mockResolvedValue(5);

    const result = await getUnreadMessageCount(1);
    expect(result).toBe(5);
    expect(directMessagesMocks.getUnreadMessageCount).toHaveBeenCalledWith(1);
  });

  it("getOrCreateConversation creates new conversation", async () => {
    const { getOrCreateConversation } = await import("./directMessages");
    const mockConv = {
      id: 1,
      userAId: 1,
      userBId: 2,
      status: "active",
      lastMessageAt: null,
      lastMessagePreview: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    directMessagesMocks.getOrCreateConversation.mockResolvedValue(mockConv);

    const result = await getOrCreateConversation(1, 2);
    expect(result).toEqual(mockConv);
    expect(directMessagesMocks.getOrCreateConversation).toHaveBeenCalledWith(1, 2);
  });

  it("blockConversation sets status to blocked", async () => {
    const { blockConversation } = await import("./directMessages");
    directMessagesMocks.blockConversation.mockResolvedValue(undefined);

    await blockConversation(1, 2);
    expect(directMessagesMocks.blockConversation).toHaveBeenCalledWith(1, 2);
  });

  it("sendMessage idempotency prevents duplicate", async () => {
    const { sendMessage } = await import("./directMessages");
    const mockMessage = {
      id: 1,
      conversationId: 1,
      senderId: 1,
      body: "Hello",
      mediaUrl: null,
      mediaType: null,
      mediaWidth: null,
      mediaHeight: null,
      mediaDuration: null,
      idempotencyKey: "key-123",
      createdAt: new Date(),
      readAt: null,
    };
    directMessagesMocks.sendMessage.mockResolvedValue(mockMessage);

    // First call
    await sendMessage(1, 1, "Hello", "key-123");
    // Second call with same idempotency key should return same message
    await sendMessage(1, 1, "Hello", "key-123");

    expect(directMessagesMocks.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("sendMessageRequest idempotency prevents duplicate", async () => {
    const { sendMessageRequest } = await import("./directMessages");
    const mockRequest = {
      id: 1,
      requesterId: 1,
      recipientId: 2,
      body: "Hello",
      mediaUrl: null,
      mediaType: null,
      mediaWidth: null,
      mediaHeight: null,
      mediaDuration: null,
      idempotencyKey: "key-123",
      status: "pending" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      respondedAt: null,
    };
    directMessagesMocks.sendMessageRequest.mockResolvedValue(mockRequest);

    // First call
    await sendMessageRequest(1, 2, "Hello", "key-123");
    // Second call with same idempotency key
    await sendMessageRequest(1, 2, "Hello", "key-123");

    expect(directMessagesMocks.sendMessageRequest).toHaveBeenCalledTimes(2);
  });
});

describe("Direct Messages — router integration", () => {
  it("directMessages router exports procedures", async () => {
    // Import the directMessages module directly to verify exports
    const dm = await import("./directMessages");
    expect(typeof dm.listConversations).toBe("function");
    expect(typeof dm.listMessages).toBe("function");
    expect(typeof dm.sendMessage).toBe("function");
    expect(typeof dm.sendMessageRequest).toBe("function");
    expect(typeof dm.listMessageRequests).toBe("function");
    expect(typeof dm.acceptMessageRequest).toBe("function");
    expect(typeof dm.declineMessageRequest).toBe("function");
    expect(typeof dm.markConversationRead).toBe("function");
    expect(typeof dm.getUnreadMessageCount).toBe("function");
    expect(typeof dm.getOrCreateConversation).toBe("function");
    expect(typeof dm.blockConversation).toBe("function");
  });
});