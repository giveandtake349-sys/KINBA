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
import { getDb, withDb } from "./db";
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

/**
 * Quoted-reply preview returned by listMessages. Deliberately narrower than a
 * full row: `mediaUrl` is never returned (quotes render a type label only) and
 * a deleted target has `body`/`mediaType` stripped server-side.
 */
export type DMReplyPreview = {
  id: number;
  conversationId: number;
  senderId: number;
  sender: { id: number; name: string | null; username: string | null; photoUrl: string | null };
  body: string | null;
  mediaType: string | null;
  createdAt: Date;
  deletedAt: Date | null;
};

export type DMMessageWithSender = DMMessageRow & {
  sender: { id: number; name: string | null; username: string | null; photoUrl: string | null };
  replyTo?: DMReplyPreview | null;
};

export type DMMessageRequestWithRequester = DMMessageRequestRow & {
  requester: { id: number; name: string | null; username: string | null; photoUrl: string | null };
  conversationId?: number;
};

export type SendMessageRequestResult = DMMessageRequestRow & {
  conversationId?: number;
};

const DM_MESSAGE_MAX_LENGTH = 4000;
const DM_MEDIA_MAX_SIZE = 10 * 1024 * 1024;
const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 100;
// Server-enforced edit window: 30 minutes from message creation.
const DM_EDIT_WINDOW_MS = 30 * 60 * 1000;

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type TxClient = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
type DbLike = DbClient | TxClient;

function sortUserPair(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Order-independent key for a pair of participant ids.
 *
 * `dm_message_requests` has no conversation id, so a request is tied to a
 * conversation by matching its (requester, recipient) pair against the
 * conversation's two participants, whichever way round they are stored.
 */
function participantPairKey(a: number, b: number): string {
  const [low, high] = sortUserPair(a, b);
  return `${low}:${high}`;
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

/** Inbox preview text, or null when the message was soft-deleted. */
function previewFromMessage(message: DMMessageRow): string | null {
  if (message.deletedAt != null) return null;
  const body = message.body?.trim() ?? "";
  if (body) return body.slice(0, 120);
  return message.mediaUrl ? "Media" : null;
}

/**
 * Deleted rows keep their columns (replies and the read cursor must keep
 * resolving), but nothing but the fact of deletion may leave the server.
 */
function withoutDeletedContent<T extends DMMessageRow>(message: T | null | undefined): T | null {
  if (!message) return null;
  if (message.deletedAt == null) return message;
  return {
    ...message,
    body: null,
    mediaUrl: null,
    mediaType: null,
    mediaWidth: null,
    mediaHeight: null,
    mediaDuration: null,
  };
}

/**
 * One-level reply validation. The parent must exist, live in the same
 * conversation (prevents cross-conversation enumeration), still be live, and
 * must not itself be a reply — mirrors validateReplyParent in hype rooms.
 */
async function assertReplyTarget(
  db: DbLike,
  replyToId: number,
  conversationId: number
): Promise<void> {
  const [parent] = await db
    .select()
    .from(dmMessages)
    .where(eq(dmMessages.id, replyToId))
    .limit(1);
  if (!parent) throw new Error("Reply target not found.");
  if (parent.conversationId !== conversationId) {
    throw new Error("Reply target is not in this conversation.");
  }
  if (parent.deletedAt != null) throw new Error("Cannot reply to a deleted message.");
  if (parent.replyToId != null) throw new Error("Replies can only be one level deep.");
}

async function insertMessage(
  db: DbLike,
  conversationId: number,
  senderId: number,
  body: string,
  idempotencyKey: string,
  media?: DmMessageMedia,
  replyToId?: number | null
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

  if (replyToId != null) {
    await assertReplyTarget(db, replyToId, conversationId);
  }

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
      editedAt: null,
      deletedAt: null,
      replyToId: replyToId ?? null,
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
  return withDb(async (db) => {
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
    // These should be hidden from the normal inbox for the recipient.
    //
    // dm_message_requests stores no conversation id, so the link is derived from
    // the participants: select only columns that exist on the table and match the
    // request's (requesterId, recipientId) pair against each loaded conversation's
    // (userAId, userBId) pair, order-independently. One extra query, no N+1.
    const pendingRequestConversationIds = new Set<number>();
    if (conversations.length > 0) {
      const pendingRequests = await db
        .select({
          requesterId: dmMessageRequests.requesterId,
          recipientId: dmMessageRequests.recipientId,
        })
        .from(dmMessageRequests)
        .where(
          and(
            eq(dmMessageRequests.recipientId, userId),
            eq(dmMessageRequests.status, "pending")
          )
        );

      if (pendingRequests.length > 0) {
        const pendingPairs = new Set(
          pendingRequests.map((r) => participantPairKey(r.requesterId, r.recipientId))
        );
        for (const conversation of conversations) {
          if (
            pendingPairs.has(participantPairKey(conversation.userAId, conversation.userBId))
          ) {
            pendingRequestConversationIds.add(conversation.id);
          }
        }
      }
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
      // A deleted latest message must not keep leaking its text/media in the
      // inbox preview — the row stays, only its content is suppressed.
      lastMessage: withoutDeletedContent(lastMessageMap.get(c.id) ?? null),
    }));
  });
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

  // One extra query for every quoted parent in the page (no N+1). A missing
  // row means the parent was hard-deleted and the FK nulled it — the reply
  // simply has no quote then.
  const replyIds = [
    ...new Set(
      messages
        .map((m) => m.replyToId)
        .filter((id): id is number => id != null && Number.isSafeInteger(id))
    ),
  ];
  let replyTargets: DMMessageRow[] = [];
  if (replyIds.length > 0) {
    replyTargets = await db
      .select()
      .from(dmMessages)
      .where(inArray(dmMessages.id, replyIds));
  }
  const replyMap = new Map(replyTargets.map((r) => [r.id, r]));

  const senderIds = [
    ...new Set([...messages.map((m) => m.senderId), ...replyTargets.map((r) => r.senderId)]),
  ];
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

  const buildReplyPreview = (message: DMMessageRow): DMReplyPreview | null => {
    if (message.replyToId == null) return null;
    const target = replyMap.get(message.replyToId);
    if (!target || target.conversationId !== conversationId) return null;
    const deleted = target.deletedAt != null;
    return {
      id: target.id,
      conversationId: target.conversationId,
      senderId: target.senderId,
      sender: senderMap.get(target.senderId) ?? {
        id: target.senderId,
        name: null,
        username: null,
        photoUrl: null,
      },
      body: deleted ? null : target.body,
      mediaType: deleted ? null : target.mediaType,
      createdAt: target.createdAt,
      deletedAt: target.deletedAt,
    };
  };

  const ordered = messages.reverse();
  // Members only: object keys become short-lived signed read URLs here, after
  // getConversationOrThrow() has already proven the caller belongs to the
  // conversation. Keys are never handed out through any other endpoint.
  return Promise.all(
    ordered.map(async (message) => {
      const replyTo = buildReplyPreview(message);
      // Deleted messages keep their row (read cursor, replies) but never their
      // content: strip before presigning so no signed URL is minted for them.
      if (message.deletedAt != null) {
        return {
          ...withoutDeletedContent(message)!,
          sender: senderMap.get(message.senderId)!,
          replyTo,
        };
      }
      let mediaUrl = message.mediaUrl;
      if (mediaUrl?.startsWith("dm/")) {
        try {
          mediaUrl = await signDmMessageMediaUrl(mediaUrl);
        } catch (error) {
          console.warn("[DM] Media presign failed:", error);
        }
      }
      return { ...message, mediaUrl, sender: senderMap.get(message.senderId)!, replyTo };
    })
  );
}

export async function sendMessage(
  conversationId: number,
  senderId: number,
  body: string,
  idempotencyKey: string,
  media?: DmMessageMedia,
  replyToId?: number | null
): Promise<DMMessageRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return insertMessage(db, conversationId, senderId, body, idempotencyKey, media, replyToId);
}

/**
 * Edit an own message within 30 minutes of creation.
 *
 * Authorization is entirely server-side: membership (getConversationOrThrow),
 * sender ownership, the soft-delete guard and the time window are all derived
 * from the row — nothing is accepted from the client.
 */
export async function editMessage(
  messageId: number,
  userId: number,
  body: string
): Promise<DMMessageRow> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [message] = await db
    .select()
    .from(dmMessages)
    .where(eq(dmMessages.id, messageId))
    .limit(1);
  if (!message) throw new Error("Message not found.");

  await getConversationOrThrow(db, message.conversationId, userId);
  if (message.senderId !== userId) throw new Error("Not allowed.");
  if (message.deletedAt != null) throw new Error("Message already deleted.");

  const createdAt = new Date(message.createdAt).getTime();
  if (Date.now() - createdAt > DM_EDIT_WINDOW_MS) {
    throw new Error("Message can no longer be edited.");
  }

  const trimmedBody = body?.trim() ?? "";
  if (!trimmedBody) throw new Error("Message body or media is required.");
  if (trimmedBody.length > DM_MESSAGE_MAX_LENGTH) {
    throw new Error(`Message must be at most ${DM_MESSAGE_MAX_LENGTH} characters.`);
  }

  const now = new Date();
  await db
    .update(dmMessages)
    .set({ body: trimmedBody, editedAt: now })
    .where(eq(dmMessages.id, messageId));

  // Only the conversation's newest message drives the inbox preview.
  const [latest] = await db
    .select({ id: dmMessages.id })
    .from(dmMessages)
    .where(eq(dmMessages.conversationId, message.conversationId))
    .orderBy(desc(dmMessages.id))
    .limit(1);
  if (latest && Number(latest.id) === message.id) {
    await db
      .update(dmConversations)
      .set({ lastMessagePreview: trimmedBody.slice(0, 120), updatedAt: now })
      .where(eq(dmConversations.id, message.conversationId));
  }

  return { ...message, body: trimmedBody, editedAt: now };
}

/**
 * Soft-delete an own message: the row survives (replies and
 * dm_conversation_reads.lastReadMessageId both point at it) and content is
 * stripped on every read path. Idempotent — deleting twice is a no-op.
 * Neither readAt nor any dm_conversation_reads row is touched.
 */
export async function deleteMessage(messageId: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [message] = await db
    .select()
    .from(dmMessages)
    .where(eq(dmMessages.id, messageId))
    .limit(1);
  if (!message) throw new Error("Message not found.");

  await getConversationOrThrow(db, message.conversationId, userId);
  if (message.senderId !== userId) throw new Error("Not allowed.");
  if (message.deletedAt != null) return;

  const [latest] = await db
    .select({ id: dmMessages.id })
    .from(dmMessages)
    .where(eq(dmMessages.conversationId, message.conversationId))
    .orderBy(desc(dmMessages.id))
    .limit(1);
  const wasLatest = !!latest && Number(latest.id) === message.id;

  const now = new Date();
  await db
    .update(dmMessages)
    .set({ deletedAt: now })
    .where(eq(dmMessages.id, messageId));

  if (wasLatest) {
    // Recompute the preview from the newest message that is still live (or
    // null when none remains). lastMessageAt is deliberately left alone so a
    // delete never reorders the inbox.
    const [newestLive] = await db
      .select()
      .from(dmMessages)
      .where(
        and(eq(dmMessages.conversationId, message.conversationId), isNull(dmMessages.deletedAt))
      )
      .orderBy(desc(dmMessages.id))
      .limit(1);
    await db
      .update(dmConversations)
      .set({
        lastMessagePreview: newestLive ? previewFromMessage(newestLive) : null,
        updatedAt: now,
      })
      .where(eq(dmConversations.id, message.conversationId));
  }
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
  return withDb(async (db) => {
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

    // Look up conversationId for each request by matching (requesterId, recipientId)
    // against conversation participants (userAId, userBId), order-independently.
    const conversationIds = new Map<string, number>();
    if (requests.length > 0) {
      const requestPairs = new Set(
        requests.map((r) => participantPairKey(r.requesterId, r.recipientId))
      );
      // Fetch only conversations where the recipient (userId) is a participant.
      // Uses indexes dm_conversations_userA_idx / dm_conversations_userB_idx.
      const conversations = await db
        .select({
          id: dmConversations.id,
          userAId: dmConversations.userAId,
          userBId: dmConversations.userBId,
        })
        .from(dmConversations)
        .where(
          and(
            eq(dmConversations.status, "active"),
            or(
              eq(dmConversations.userAId, userId),
              eq(dmConversations.userBId, userId)
            )
          )
        );
      for (const conv of conversations) {
        const pairKey = participantPairKey(conv.userAId, conv.userBId);
        if (requestPairs.has(pairKey)) {
          conversationIds.set(pairKey, conv.id);
        }
      }
    }

    return requests.map((r) => ({
      ...r,
      requester: requesterMap.get(r.requesterId)!,
      conversationId: conversationIds.get(participantPairKey(r.requesterId, r.recipientId)),
    }));
  });
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
  return withDb(async (db) => {
    const reads = await db
      .select({ unreadCount: dmConversationReads.unreadCount })
      .from(dmConversationReads)
      .where(eq(dmConversationReads.userId, userId));

    return reads.reduce((sum, r) => sum + (r.unreadCount ?? 0), 0);
  });
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