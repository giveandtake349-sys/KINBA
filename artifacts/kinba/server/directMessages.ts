/**
 * JHILIK Direct Messaging (Phase 2).
 *
 * Direct Messages + Instagram-style follow-based Message Requests.
 * Schema: dm_conversations, dm_messages, dm_message_requests, dm_conversation_reads.
 * No feature flag required (core social feature).
 * Spec: DMs between mutual followers; requests from non-followers.
 */
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import {
  dmConversationReads,
  dmConversationStatus,
  dmConversations,
  dmMessageRequestStatus,
  dmMessageRequests,
  dmMessages,
  follows,
  profiles,
  type DMConversationRow,
  type DMMessageRow,
  type DMMessageRequestRow,
  type DMConversationReadRow,
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  resolveOwnedDmMedia,
  signDmMessageMediaUrl,
  type DmMessageMedia,
} from "./dmMedia";
import { insertNotification, NOTIFICATION_TYPES } from "./notifications";

export type DMConversationWithPartner = DMConversationRow & {
  partner: { id: number; name: string | null; username: string | null; photoUrl: string | null };
  unreadCount: number;
  lastMessage?: DMMessageRow | null;
};

export type DMMessageWithSender = DMMessageRow & {
  sender: { id: number; name: string | null; username: string | null; photoUrl: string | null };
};

export type DMMessageRequestWithRequester = DMMessageRequestRow & {
  requester: { id: number; name: string | null; username: string | null; photoUrl: string | null };
};

export type SendMessageRequestResult = DMMessageRequestRow & {
  conversationId?: number;
};

const DM_MESSAGE_MAX_LENGTH = 4000;
const DM_MEDIA_MAX_SIZE = 10 * 1024 * 1024;
const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 100;

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type TxClient = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
type DbLike = DbClient | TxClient;

function sortUserPair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

async function getConversationOrThrow(
  db: DbLike,
  conversationId: number,
  userId: number
): Promise<DMConversationRow> {
  const [conv] = await db
    .select()
    .from(dmConversations)
    .where(
      and(
        eq(dmConversations.id, conversationId),
        or(
          eq(dmConversations.userAId, userId),
          eq(dmConversations.userBId, userId)
        ),
        eq(dmConversations.status, "active")
      )
    )
    .limit(1);
  if (!conv) throw new Error("Conversation not found.");
  return conv;
}

async function getPartnerId(conversation: DMConversationRow, userId: number): Promise<number> {
  return conversation.userAId === userId ? conversation.userBId : conversation.userAId;
}

async function ensureConversationExists(
  db: DbLike,
  userId: number,
  otherUserId: number
): Promise<DMConversationRow> {
  if (userId === otherUserId) throw new Error("Cannot message yourself.");
  const [userAId, userBId] = sortUserPair(userId, otherUserId);

  const [existing] = await db
    .select()
    .from(dmConversations)
    .where(
      and(
        eq(dmConversations.userAId, userAId),
        eq(dmConversations.userBId, userBId),
        eq(dmConversations.status, "active")
      )
    )
    .limit(1);

  if (existing) {
    await db
      .insert(dmConversationReads)
      .values([
        { conversationId: existing.id, userId: userAId, unreadCount: 0 },
        { conversationId: existing.id, userId: userBId, unreadCount: 0 },
      ])
      .onConflictDoNothing();
    return existing;
  }

  const [created] = await db
    .insert(dmConversations)
    .values({ userAId, userBId, status: "active" })
    .returning();
  if (!created) throw new Error("Failed to create conversation.");

  await db.insert(dmConversationReads).values([
    { conversationId: created.id, userId: userAId, unreadCount: 0 },
    { conversationId: created.id, userId: userBId, unreadCount: 0 },
  ]);

  return created;
}

async function checkFollows(db: DbLike, followerId: number, followedId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: follows.id })
    .from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followedId, followedId)))
    .limit(1);
  return !!row;
}

async function insertMessage(
  db: DbLike,
  conversationId: number,
  senderId: number,
  body: string,
  idempotencyKey: string,
  media?: DmMessageMedia
): Promise<DMMessageRow> {
  const conversation = await getConversationOrThrow(db, conversationId, senderId);
  const partnerId = await getPartnerId(conversation, senderId);

  const trimmedBody = body?.trim() ?? "";
  if (!trimmedBody && !media?.mediaUrl) {
    throw new Error("Message body or media is required.");
  }
  if (trimmedBody.length > DM_MESSAGE_MAX_LENGTH) {
    throw new Error(`Message must be at most ${DM_MESSAGE_MAX_LENGTH} characters.`);
  }
  const attachment = media ? resolveOwnedDmMedia(senderId, media) : undefined;

  const [existing] = await db
    .select()
    .from(dmMessages)
    .where(
      and(
        eq(dmMessages.conversationId, conversationId),
        eq(dmMessages.senderId, senderId),
        eq(dmMessages.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existing) return existing;

  const now = new Date();
  const [message] = await db
    .insert(dmMessages)
    .values({
      conversationId,
      senderId,
      body: trimmedBody || null,
      mediaUrl: attachment?.mediaUrl ?? null,
      mediaType: attachment?.mediaType ?? null,
      mediaWidth: attachment?.mediaWidth ?? null,
      mediaHeight: attachment?.mediaHeight ?? null,
      mediaDuration: attachment?.mediaDuration ?? null,
      idempotencyKey,
      createdAt: now,
      readAt: null,
    })
    .returning();
  if (!message) throw new Error("Failed to send message.");

  await db
    .update(dmConversations)
    .set({
      lastMessageAt: now,
      lastMessagePreview: trimmedBody.slice(0, 120) || "Media",
      updatedAt: now,
    })
    .where(eq(dmConversations.id, conversationId));

  await db
    .update(dmConversationReads)
    .set({
      unreadCount: sql`${dmConversationReads.unreadCount} + 1`,
      lastReadAt: now,
    })
    .where(
      and(
        eq(dmConversationReads.conversationId, conversationId),
        eq(dmConversationReads.userId, partnerId)
      )
    );

  try {
    const [sender] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, senderId))
      .limit(1);
    if (sender) {
      await insertNotification(
        {
          userId: partnerId,
          type: NOTIFICATION_TYPES.dmMessage,
          title: "New message",
          body: trimmedBody
            ? `${sender.name?.trim() || "Someone"}: ${trimmedBody.slice(0, 100)}`
            : `${sender.name?.trim() || "Someone"} sent media.`,
          entityType: "dm_conversation",
          entityId: conversationId,
          link: `/messages/${conversationId}`,
        },
        db
      );
    }
  } catch (error) {
    console.warn("[DM] Notification insert failed:", error);
  }

  return message;
}

export async function listConversations(
  userId: number,
  limit: number = LIST_DEFAULT_LIMIT
): Promise<DMConversationWithPartner[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const safeLimit = Math.min(Math.max(limit, 1), LIST_MAX_LIMIT);

  const conversations = await db
    .select()
    .from(dmConversations)
    .where(
      and(
        or(eq(dmConversations.userAId, userId), eq(dmConversations.userBId, userId)),
        eq(dmConversations.status, "active")
      )
    )
    .orderBy(desc(dmConversations.lastMessageAt))
    .limit(safeLimit);

  // Find conversations that have a pending request where the current user is the recipient
  // These should be hidden from the normal inbox for the recipient
  const conversationIds = conversations.map((c) => c.id);
  let pendingRequestConversationIds = new Set<number>();
  if (conversationIds.length > 0) {
    const pendingRequests = await db
      .select({ conversationId: dmMessageRequests.conversationId })
      .from(dmMessageRequests)
      .where(
        and(
          eq(dmMessageRequests.recipientId, userId),
          eq(dmMessageRequests.status, "pending"),
          inArray(dmMessageRequests.conversationId, conversationIds)
        )
      );
    pendingRequestConversationIds = new Set(pendingRequests.map((r) => r.conversationId));
  }

  // Filter out conversations with pending requests for this recipient
  const filteredConversations = conversations.filter(
    (c) => !pendingRequestConversationIds.has(c.id)
  );

  const reads = await db
    .select()
    .from(dmConversationReads)
    .where(
      and(
        eq(dmConversationReads.userId, userId),
        inArray(
          dmConversationReads.conversationId,
          filteredConversations.map((c) => c.id)
        )
      )
    );

  const readMap = new Map(reads.map((r) => [r.conversationId, r.unreadCount]));

  const partnerIds = filteredConversations.map((c) =>
    c.userAId === userId ? c.userBId : c.userAId
  );
  const partners = await db
    .select({
      id: users.id,
      name: users.name,
      username: profiles.username,
      photoUrl: profiles.photoUrl,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(inArray(users.id, partnerIds));

  const partnerMap = new Map(partners.map((p) => [p.id, p]));

  const lastMessageConversationIds = filteredConversations
    .filter((c) => c.lastMessageAt)
    .map((c) => c.id);
  let lastMessages: DMMessageRow[] = [];
  if (lastMessageConversationIds.length > 0) {
    // Latest message per conversation (preview must survive read receipts —
    // the previous readAt-filtered query dropped previews once messages were
    // opened, which also hid sent attachments from the inbox).
    const latest = await db
      .select({
        id: sql<number>`max(${dmMessages.id})`,
        conversationId: dmMessages.conversationId,
      })
      .from(dmMessages)
      .where(inArray(dmMessages.conversationId, lastMessageConversationIds))
      .groupBy(dmMessages.conversationId);
    const latestIds = latest
      .map((row) => Number(row.id))
      .filter((id) => Number.isSafeInteger(id) && id > 0);
    if (latestIds.length > 0) {
      lastMessages = await db
        .select()
        .from(dmMessages)
        .where(inArray(dmMessages.id, latestIds));
    }
  }
  const lastMessageMap = new Map(lastMessages.map((m) => [m.conversationId, m]));

  return filteredConversations.map((c) => ({
    ...c,
    partner: partnerMap.get(c.userAId === userId ? c.userBId : c.userAId)!,
    unreadCount: readMap.get(c.id) ?? 0,
    lastMessage: lastMessageMap.get(c.id) ?? null,
  }));
}

export async function listMessages(
  conversationId: number,
  userId: number,
  opts: { limit?: number; beforeId?: number } = {}
): Promise<DMMessageWithSender[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await getConversationOrThrow(db, conversationId, userId);

  const safeLimit = Math.min(Math.max(opts.limit ?? LIST_DEFAULT_LIMIT, 1), LIST_MAX_LIMIT);
  const conditions = [eq(dmMessages.conversationId, conversationId)];
  if (opts.beforeId != null) {
    conditions.push(lt(dmMessages.id, opts.beforeId));
  }

  const messages = await db
    .select()
    .from(dmMessages)
    .where(and(...conditions))
    .orderBy(desc(dmMessages.id))
    .limit(safeLimit);

  const senderIds = [...new Set(messages.map((m) => m.senderId))];
  const senders = await db
    .select({
      id: users.id,
      name: users.name,
      username: profiles.username,
      photoUrl: profiles.photoUrl,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(inArray(users.id, senderIds));
  const senderMap = new Map(senders.map((s) => [s.id, s]));

  const ordered = messages.reverse();
  // Members only: object keys become short-lived signed read URLs here, after
  // getConversationOrThrow() has already proven the caller belongs to the
  // conversation. Keys are never handed out through any other endpoint.
  return Promise.all(
    ordered.map(async (message) => {
      let mediaUrl = message.mediaUrl;
      if (mediaUrl?.startsWith("dm/")) {
        try {
          mediaUrl = await signDmMessageMediaUrl(mediaUrl);
        } catch (error) {
          console.warn("[DM] Media presign failed:", error);
        }
      }
      return { ...message, mediaUrl, sender: senderMap.get(message.senderId)! };
    })
  );
}

export async function sendMessage(
  conversationId: number,
  senderId: number,
  body: string,
  idempotencyKey: string,
  media?: DmMessageMedia
): Promise<DMMessageRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return insertMessage(db, conversationId, senderId, body, idempotencyKey, media);
}

export async function sendMessageRequest(
  requesterId: number,
  recipientId: number,
  body: string,
  idempotencyKey: string,
  media?: DmMessageMedia
): Promise<SendMessageRequestResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  if (requesterId === recipientId) throw new Error("Cannot message yourself.");

  const trimmedBody = body?.trim() ?? "";
  // Same ownership/type/size rules as a normal message, enforced once here so
  // both branches are safe.
  const attachment = media ? resolveOwnedDmMedia(requesterId, media) : undefined;

  // Check MUTUAL follow: requester follows recipient AND recipient follows requester
  const requesterFollowsRecipient = await checkFollows(db, requesterId, recipientId);
  const recipientFollowsRequester = await checkFollows(db, recipientId, requesterId);
  const isMutualFollow = requesterFollowsRecipient && recipientFollowsRequester;

  if (isMutualFollow) {
    // Mutual follow -> normal direct message for both
    const conversation = await ensureConversationExists(db, requesterId, recipientId);

    await sendMessage(
      conversation.id,
      requesterId,
      body,
      idempotencyKey,
      attachment
    );
    return {
      id: 0,
      requesterId,
      recipientId,
      body: trimmedBody,
      mediaUrl: attachment?.mediaUrl ?? null,
      mediaType: attachment?.mediaType ?? null,
      mediaWidth: attachment?.mediaWidth ?? null,
      mediaHeight: attachment?.mediaHeight ?? null,
      mediaDuration: attachment?.mediaDuration ?? null,
      idempotencyKey,
      status: "accepted" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      respondedAt: new Date(),
      conversationId: conversation.id,
    } as SendMessageRequestResult;
  }

  // NOT mutual follow -> sender gets conversation immediately, recipient gets request
  if (!trimmedBody && !attachment?.mediaUrl) {
    throw new Error("Message body or media is required.");
  }
  if (trimmedBody.length > DM_MESSAGE_MAX_LENGTH) {
    throw new Error(`Message must be at most ${DM_MESSAGE_MAX_LENGTH} characters.`);
  }

  // Check for existing request with same idempotency key
  const [existingRequest] = await db
    .select()
    .from(dmMessageRequests)
    .where(
      and(
        eq(dmMessageRequests.requesterId, requesterId),
        eq(dmMessageRequests.recipientId, recipientId),
        eq(dmMessageRequests.idempotencyKey, idempotencyKey)
      )
    )
    .limit(1);
  if (existingRequest) return existingRequest as SendMessageRequestResult;

  // Use a transaction to ensure atomicity of conversation creation, message insertion, and request creation
  return await db.transaction(async (tx) => {
    // Create/get conversation so sender can see their message immediately
    const conversation = await ensureConversationExists(tx, requesterId, recipientId);

    // Insert sender's message into the conversation (idempotent) using tx for atomicity
    await insertMessage(
      tx,
      conversation.id,
      requesterId,
      body,
      idempotencyKey,
      attachment
    );

    // Create the pending request row for the recipient
    const now = new Date();
    const [request] = await tx
      .insert(dmMessageRequests)
      .values({
        requesterId,
        recipientId,
        body: trimmedBody,
        mediaUrl: attachment?.mediaUrl ?? null,
        mediaType: attachment?.mediaType ?? null,
        mediaWidth: attachment?.mediaWidth ?? null,
        mediaHeight: attachment?.mediaHeight ?? null,
        mediaDuration: attachment?.mediaDuration ?? null,
        idempotencyKey,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!request) throw new Error("Failed to send message request.");

    // Notification is sent outside the transaction (non-critical)
    try {
      const [requester] = await tx
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, requesterId))
        .limit(1);
      if (requester) {
        await insertNotification(
          {
            userId: recipientId,
            type: NOTIFICATION_TYPES.dmRequest,
            title: "Message request",
            body: `${requester.name?.trim() || "Someone"} wants to message you.`,
            entityType: "dm_message_request",
            entityId: request.id,
            link: `/messages/requests`,
          },
          tx
        );
      }
    } catch (error) {
      console.warn("[DM] Request notification insert failed:", error);
    }

    return { ...request, conversationId: conversation.id } as SendMessageRequestResult;
  });
}

export async function listMessageRequests(
  userId: number,
  limit: number = LIST_DEFAULT_LIMIT
): Promise<DMMessageRequestWithRequester[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const safeLimit = Math.min(Math.max(limit, 1), LIST_MAX_LIMIT);

  const requests = await db
    .select()
    .from(dmMessageRequests)
    .where(
      and(
        eq(dmMessageRequests.recipientId, userId),
        eq(dmMessageRequests.status, "pending")
      )
    )
    .orderBy(desc(dmMessageRequests.createdAt))
    .limit(safeLimit);

  const requesterIds = [...new Set(requests.map((r) => r.requesterId))];
  const requesters = await db
    .select({
      id: users.id,
      name: users.name,
      username: profiles.username,
      photoUrl: profiles.photoUrl,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(inArray(users.id, requesterIds));
  const requesterMap = new Map(requesters.map((r) => [r.id, r]));

  return requests.map((r) => ({
    ...r,
    requester: requesterMap.get(r.requesterId)!,
  }));
}

export async function acceptMessageRequest(
  requestId: number,
  userId: number
): Promise<{ conversation: DMConversationRow; message: DMMessageRow }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [request] = await db
    .select()
    .from(dmMessageRequests)
    .where(
      and(
        eq(dmMessageRequests.id, requestId),
        eq(dmMessageRequests.recipientId, userId),
        eq(dmMessageRequests.status, "pending")
      )
    )
    .limit(1);
  if (!request) throw new Error("Message request not found.");

  const conversation = await ensureConversationExists(
    db,
    request.requesterId,
    request.recipientId
  );

  const message = await sendMessage(
    conversation.id,
    request.requesterId,
    request.body,
    request.idempotencyKey,
    request.mediaUrl
      ? {
          mediaUrl: request.mediaUrl,
          mediaType: request.mediaType ?? "",
          mediaWidth: request.mediaWidth ?? undefined,
          mediaHeight: request.mediaHeight ?? undefined,
          mediaDuration: request.mediaDuration ?? undefined,
        }
      : undefined
  );

  await db
    .update(dmMessageRequests)
    .set({
      status: "accepted",
      respondedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(dmMessageRequests.id, requestId));

  try {
    const [recipient] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, request.recipientId))
      .limit(1);
    if (recipient) {
      await insertNotification(
        {
          userId: request.requesterId,
          type: NOTIFICATION_TYPES.dmRequestAccepted,
          title: "Request accepted",
          body: `${recipient.name?.trim() || "Someone"} accepted your message request.`,
          entityType: "dm_conversation",
          entityId: conversation.id,
          link: `/messages/${conversation.id}`,
        },
        db
      );
    }
  } catch (error) {
    console.warn("[DM] Accept notification insert failed:", error);
  }

  return { conversation, message };
}

export async function declineMessageRequest(
  requestId: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  await db
    .update(dmMessageRequests)
    .set({
      status: "declined",
      respondedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(dmMessageRequests.id, requestId),
        eq(dmMessageRequests.recipientId, userId),
        eq(dmMessageRequests.status, "pending")
      )
    );
}

export async function replyToMessageRequest(
  requestId: number,
  userId: number,
  body: string,
  idempotencyKey: string,
  media?: DmMessageMedia
): Promise<{ conversation: DMConversationRow; message: DMMessageRow }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Fetch the request and verify the caller is the recipient
  const [request] = await db
    .select()
    .from(dmMessageRequests)
    .where(
      and(
        eq(dmMessageRequests.id, requestId),
        eq(dmMessageRequests.recipientId, userId),
        eq(dmMessageRequests.status, "pending")
      )
    )
    .limit(1);
  if (!request) throw new Error("Message request not found or already handled.");

  // Ensure conversation exists (should already exist from sendMessageRequest)
  const conversation = await ensureConversationExists(
    db,
    request.requesterId,
    request.recipientId
  );

  // Check if the original request message already exists in the conversation
  // (it should have been inserted by sendMessageRequest, but verify to avoid duplicates)
  const [existingOriginalMessage] = await db
    .select()
    .from(dmMessages)
    .where(
      and(
        eq(dmMessages.conversationId, conversation.id),
        eq(dmMessages.senderId, request.requesterId),
        eq(dmMessages.idempotencyKey, request.idempotencyKey)
      )
    )
    .limit(1);

  let originalMessage: DMMessageRow;
  if (existingOriginalMessage) {
    originalMessage = existingOriginalMessage;
  } else {
    // Insert the original request message if it doesn't exist yet
    const attachment = request.mediaUrl
      ? {
          mediaUrl: request.mediaUrl,
          mediaType: request.mediaType ?? "",
          mediaWidth: request.mediaWidth ?? undefined,
          mediaHeight: request.mediaHeight ?? undefined,
          mediaDuration: request.mediaDuration ?? undefined,
        }
      : undefined;
    const [msg] = await db
      .insert(dmMessages)
      .values({
        conversationId: conversation.id,
        senderId: request.requesterId,
        body: request.body,
        mediaUrl: attachment?.mediaUrl ?? null,
        mediaType: attachment?.mediaType ?? null,
        mediaWidth: attachment?.mediaWidth ?? null,
        mediaHeight: attachment?.mediaHeight ?? null,
        mediaDuration: attachment?.mediaDuration ?? null,
        idempotencyKey: request.idempotencyKey,
        createdAt: request.createdAt,
        readAt: null,
      })
      .returning();
    if (!msg) throw new Error("Failed to insert original request message.");
    originalMessage = msg;
  }

  // Insert the recipient's reply
  const attachment = media ? resolveOwnedDmMedia(userId, media) : undefined;
  const replyMessage = await sendMessage(
    conversation.id,
    userId,
    body,
    idempotencyKey,
    attachment
  );

  // Update request status to "accepted" (promoted by reply)
  await db
    .update(dmMessageRequests)
    .set({
      status: "accepted",
      respondedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(dmMessageRequests.id, requestId));

  // Notify the requester that their request was replied to (promoted)
  try {
    const [recipient] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (recipient) {
      await insertNotification(
        {
          userId: request.requesterId,
          type: NOTIFICATION_TYPES.dmRequestAccepted,
          title: "Request accepted",
          body: `${recipient.name?.trim() || "Someone"} replied to your message request.`,
          entityType: "dm_conversation",
          entityId: conversation.id,
          link: `/messages/${conversation.id}`,
        },
        db
      );
    }
  } catch (error) {
    console.warn("[DM] Reply notification insert failed:", error);
  }

  return { conversation, message: replyMessage };
}

export async function markConversationRead(
  conversationId: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const conversation = await getConversationOrThrow(db, conversationId, userId);

  const [latestMessage] = await db
    .select()
    .from(dmMessages)
    .where(eq(dmMessages.conversationId, conversationId))
    .orderBy(desc(dmMessages.id))
    .limit(1);

  const now = new Date();
  await db
    .update(dmConversationReads)
    .set({
      lastReadMessageId: latestMessage?.id ?? null,
      lastReadAt: now,
      unreadCount: 0,
    })
    .where(
      and(
        eq(dmConversationReads.conversationId, conversationId),
        eq(dmConversationReads.userId, userId)
      )
    );

  await db
    .update(dmMessages)
    .set({ readAt: now })
    .where(
      and(
        eq(dmMessages.conversationId, conversationId),
        isNull(dmMessages.readAt),
        // Don't mark sender's own messages as read
        or(eq(dmMessages.senderId, userId), gt(dmMessages.senderId, 0))
      )
    );
}

export async function getUnreadMessageCount(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const reads = await db
    .select({ unreadCount: dmConversationReads.unreadCount })
    .from(dmConversationReads)
    .where(eq(dmConversationReads.userId, userId));

  return reads.reduce((sum, r) => sum + (r.unreadCount ?? 0), 0);
}

export async function getOrCreateConversation(
  userId: number,
  otherUserId: number
): Promise<DMConversationRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // First check if a conversation already exists between these users
  const [userAId, userBId] = sortUserPair(userId, otherUserId);
  const [existing] = await db
    .select()
    .from(dmConversations)
    .where(
      and(
        eq(dmConversations.userAId, userAId),
        eq(dmConversations.userBId, userBId),
        eq(dmConversations.status, "active")
      )
    )
    .limit(1);

  if (existing) {
    // Conversation already exists - allow access regardless of current follow state
    // (don't retroactively disable existing conversations)
    return existing;
  }

  // No existing conversation - enforce mutual follow for new conversations
  const requesterFollowsRecipient = await checkFollows(db, userId, otherUserId);
  const recipientFollowsRequester = await checkFollows(db, otherUserId, userId);
  const isMutualFollow = requesterFollowsRecipient && recipientFollowsRequester;

  if (!isMutualFollow) {
    throw new Error("Cannot create conversation: users must mutually follow each other.");
  }

  return ensureConversationExists(db, userId, otherUserId);
}

export async function blockConversation(
  conversationId: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const conversation = await getConversationOrThrow(db, conversationId, userId);
  if (conversation.status === "blocked") return;

  await db
    .update(dmConversations)
    .set({ status: "blocked", updatedAt: new Date() })
    .where(eq(dmConversations.id, conversationId));
}