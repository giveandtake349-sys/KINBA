import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  communityAnnouncementAttachments,
  communityAnnouncements,
  communityBookmarks,
  communityComments,
  communityReactions,
  liveSponsors,
  participants,
  sessionWinners,
  sponsorBidsDraws,
  sponsorBidsSessions,
  wallets,
  walletTransactions,
  follows,
  hypeRoomMessages,
  hypeRoomMessageReactions,
  hypeRooms,
  profileAccountType,
  profiles,
  type InsertUser,
  users,
  videoBookmarks,
  videoComments,
  commentLikes,
  commentReactions,
  videoReactions,
  videoShares,
  videoSources,
  videos,
  transactions,
  rawPulsePolls,
  rawPulseOptions,
  rawPulseVotes,
  drops,
  blocks,
  hashtags,
  videoHashtags,
  videoCommentHashtags,
  announcementHashtags,
  communityCommentHashtags,
  hypeRoomHashtags,
  hypeRoomMessageHashtags,
  dropHashtags,
} from "../drizzle/schema";
import {
  REACTION_TYPES,
  isValidReaction,
  type ReactionType,
} from "@shared/reactions";
import { normalizeUsername, validateUsername, RESERVED_USERNAMES } from "../shared/username";
import { ENV } from "./_core/env";
import { resolvePostgresDatabaseUrl } from "./databaseConfig";
import { selectNomineeIds, selectSecondaryWinnerId } from "./sponsorBidsDraw";
import { storageDelete } from "./storage";
import { extractHashtags, extractVideoHashtags, extractTextHashtags, extractHypeRoomHashtags, extractDropHashtags } from "./lib/hashtags";
import { canDiscoverRoom, listViewerMemberRoomIds } from "./hypeRooms";

/**
 * The viewer's stored reaction, narrowed to the shared vocabulary so no raw
 * database string can leak into the client's `ReactionType` unions.
 */
function narrowReaction(value: string | null | undefined): ReactionType | null {
  return value != null && isValidReaction(value) ? value : null;
}

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;
// Single-flight guard for cold starts: concurrent getDb() callers share exactly
// one creation promise so at most one pool is ever published and none can be
// orphaned outside _pool (where invalidateDbPool() would never reach it).
let _creating: Promise<ReturnType<typeof drizzle>> | null = null;

const GET_DB_MAX_RETRIES = 3;
const GET_DB_BASE_DELAY_MS = 100;

function isTransientConnectionError(error: unknown): boolean {
  if (!error) return false;
  const code = (error as { code?: unknown }).code;
  const errno = (error as { errno?: unknown }).errno;
  return (
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "08006" ||
    code === "08001" ||
    code === "08003" ||
    code === "08007" ||
    code === "53300" ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03" ||
    errno === "ECONNREFUSED" ||
    errno === "ETIMEDOUT" ||
    errno === "ENOTFOUND" ||
    errno === "EHOSTUNREACH" ||
    errno === "ENETUNREACH" ||
    errno === "ECONNRESET" ||
    errno === "EPIPE"
  );
}

/**
 * pg-pool lifecycle failures raised as plain `Error` objects. They carry no
 * `code`/`errno`, so `isTransientConnectionError` cannot see them, yet they are
 * connection-level: the query was never dispatched (or the connection dropped
 * mid-flight), so running it once more cannot duplicate work.
 */
const RETRYABLE_POOL_ERROR_MESSAGES = new Set([
  "Cannot use a pool after calling end on the pool",
  "timeout exceeded when trying to connect",
  "Connection terminated due to connection timeout",
  "Connection terminated unexpectedly",
  "Connection terminated",
]);

function isRetryablePoolError(error: unknown): boolean {
  if (isTransientConnectionError(error)) return true;
  return error instanceof Error && RETRYABLE_POOL_ERROR_MESSAGES.has(error.message);
}

async function createPoolWithRetry(
  connectionString: string,
  attempt: number
): Promise<ReturnType<typeof drizzle>> {
  try {
    const pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // pg-pool re-emits idle-client failures on the pool itself. An EventEmitter
    // 'error' with no listener throws, so absorb it defensively.
    pool.on("error", (error: unknown) => {
      console.warn(
        "[Database] Pool error:",
        error instanceof Error ? error.message : String(error)
      );
    });
    const db = drizzle({ client: pool });
    await pool.query("SELECT 1");
    return db;
  } catch (error) {
    if (attempt < GET_DB_MAX_RETRIES && isTransientConnectionError(error)) {
      const delay = GET_DB_BASE_DELAY_MS * 2 ** attempt;
      console.warn(
        `[Database] Connection attempt ${attempt + 1} failed (transient), retrying in ${delay}ms:`,
        error instanceof Error ? error.message : String(error)
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return createPoolWithRetry(connectionString, attempt + 1);
    }
    console.warn("[Database] Failed to connect after retries:", error);
    throw error;
  }
}

async function validatePool(db: ReturnType<typeof drizzle>): Promise<boolean> {
  try {
    const pool = (db as { $client: Pool }).$client;
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * End exactly `target`, and clear the cached globals only while they still
 * reference that same pool.
 *
 * Ownership matters: a request that proved one pool unusable must not tear down
 * a newer pool that a concurrent request published in the meantime, and it must
 * not unregister that newer pool from the module either.
 */
function retirePool(target: Pool | null | undefined): void {
  if (!target) return;
  if (_pool === target) {
    _pool = null;
    _db = null;
  }
  // pg-pool rejects a second end(); the rejection is intentionally swallowed.
  target.end().catch(() => {});
}

export function invalidateDbPool(): void {
  retirePool(_pool);
}

/**
 * Type that represents either a database client or a transaction client.
 * Both share the same query interface in Drizzle.
 */
type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type TxClient = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
type DbLike = DbClient | TxClient;

/**
 * Hashtag synchronization helpers.
 * All functions are designed to be called within an existing transaction.
 */

async function upsertHashtagRows(
  db: DbLike,
  extractedHashtags: ReturnType<typeof extractHashtags>
) {
  if (extractedHashtags.length === 0) return [];

  const results: { id: number; tag: string }[] = [];
  for (const ht of extractedHashtags) {
    const [upserted] = await db
      .insert(hashtags)
      .values({ tag: ht.normalized, displayTag: ht.display })
      .onConflictDoUpdate({
        target: hashtags.tag,
        set: { updatedAt: new Date() },
      })
      .returning({ id: hashtags.id, tag: hashtags.tag });
    results.push(upserted);
  }
  return results;
}

async function syncVideoHashtags(
  db: DbLike,
  videoId: number,
  newHashtags: ReturnType<typeof extractHashtags>
) {
  if (newHashtags.length === 0) {
    await db.delete(videoHashtags).where(eq(videoHashtags.videoId, videoId));
    return;
  }
  const hashtagRows = await upsertHashtagRows(db, newHashtags);
  const newHashtagIds = new Set(hashtagRows.map(h => h.id));
  const existing = await db.select({ hashtagId: videoHashtags.hashtagId }).from(videoHashtags).where(eq(videoHashtags.videoId, videoId));
  const existingHashtagIds = new Set(existing.map(e => e.hashtagId));
  const toRemove = [...existingHashtagIds].filter(id => !newHashtagIds.has(id));
  if (toRemove.length > 0) {
    await db.delete(videoHashtags).where(and(eq(videoHashtags.videoId, videoId), inArray(videoHashtags.hashtagId, toRemove)));
  }
  const toAdd = [...newHashtagIds].filter(id => !existingHashtagIds.has(id));
  if (toAdd.length > 0) {
    await db.insert(videoHashtags).values(toAdd.map(hashtagId => ({ videoId, hashtagId })));
  }
}

async function syncVideoCommentHashtags(
  db: DbLike,
  commentId: number,
  newHashtags: ReturnType<typeof extractHashtags>
) {
  if (newHashtags.length === 0) {
    await db.delete(videoCommentHashtags).where(eq(videoCommentHashtags.commentId, commentId));
    return;
  }
  const hashtagRows = await upsertHashtagRows(db, newHashtags);
  const newHashtagIds = new Set(hashtagRows.map(h => h.id));
  const existing = await db.select({ hashtagId: videoCommentHashtags.hashtagId }).from(videoCommentHashtags).where(eq(videoCommentHashtags.commentId, commentId));
  const existingHashtagIds = new Set(existing.map(e => e.hashtagId));
  const toRemove = [...existingHashtagIds].filter(id => !newHashtagIds.has(id));
  if (toRemove.length > 0) {
    await db.delete(videoCommentHashtags).where(and(eq(videoCommentHashtags.commentId, commentId), inArray(videoCommentHashtags.hashtagId, toRemove)));
  }
  const toAdd = [...newHashtagIds].filter(id => !existingHashtagIds.has(id));
  if (toAdd.length > 0) {
    await db.insert(videoCommentHashtags).values(toAdd.map(hashtagId => ({ commentId, hashtagId })));
  }
}

async function syncAnnouncementHashtags(
  db: DbLike,
  announcementId: number,
  newHashtags: ReturnType<typeof extractHashtags>
) {
  if (newHashtags.length === 0) {
    await db.delete(announcementHashtags).where(eq(announcementHashtags.announcementId, announcementId));
    return;
  }
  const hashtagRows = await upsertHashtagRows(db, newHashtags);
  const newHashtagIds = new Set(hashtagRows.map(h => h.id));
  const existing = await db.select({ hashtagId: announcementHashtags.hashtagId }).from(announcementHashtags).where(eq(announcementHashtags.announcementId, announcementId));
  const existingHashtagIds = new Set(existing.map(e => e.hashtagId));
  const toRemove = [...existingHashtagIds].filter(id => !newHashtagIds.has(id));
  if (toRemove.length > 0) {
    await db.delete(announcementHashtags).where(and(eq(announcementHashtags.announcementId, announcementId), inArray(announcementHashtags.hashtagId, toRemove)));
  }
  const toAdd = [...newHashtagIds].filter(id => !existingHashtagIds.has(id));
  if (toAdd.length > 0) {
    await db.insert(announcementHashtags).values(toAdd.map(hashtagId => ({ announcementId, hashtagId })));
  }
}

async function syncCommunityCommentHashtags(
  db: DbLike,
  commentId: number,
  newHashtags: ReturnType<typeof extractHashtags>
) {
  if (newHashtags.length === 0) {
    await db.delete(communityCommentHashtags).where(eq(communityCommentHashtags.commentId, commentId));
    return;
  }
  const hashtagRows = await upsertHashtagRows(db, newHashtags);
  const newHashtagIds = new Set(hashtagRows.map(h => h.id));
  const existing = await db.select({ hashtagId: communityCommentHashtags.hashtagId }).from(communityCommentHashtags).where(eq(communityCommentHashtags.commentId, commentId));
  const existingHashtagIds = new Set(existing.map(e => e.hashtagId));
  const toRemove = [...existingHashtagIds].filter(id => !newHashtagIds.has(id));
  if (toRemove.length > 0) {
    await db.delete(communityCommentHashtags).where(and(eq(communityCommentHashtags.commentId, commentId), inArray(communityCommentHashtags.hashtagId, toRemove)));
  }
  const toAdd = [...newHashtagIds].filter(id => !existingHashtagIds.has(id));
  if (toAdd.length > 0) {
    await db.insert(communityCommentHashtags).values(toAdd.map(hashtagId => ({ commentId, hashtagId })));
  }
}

async function syncHypeRoomHashtags(
  db: DbLike,
  roomId: number,
  newHashtags: ReturnType<typeof extractHashtags>
) {
  if (newHashtags.length === 0) {
    await db.delete(hypeRoomHashtags).where(eq(hypeRoomHashtags.roomId, roomId));
    return;
  }
  const hashtagRows = await upsertHashtagRows(db, newHashtags);
  const newHashtagIds = new Set(hashtagRows.map(h => h.id));
  const existing = await db.select({ hashtagId: hypeRoomHashtags.hashtagId }).from(hypeRoomHashtags).where(eq(hypeRoomHashtags.roomId, roomId));
  const existingHashtagIds = new Set(existing.map(e => e.hashtagId));
  const toRemove = [...existingHashtagIds].filter(id => !newHashtagIds.has(id));
  if (toRemove.length > 0) {
    await db.delete(hypeRoomHashtags).where(and(eq(hypeRoomHashtags.roomId, roomId), inArray(hypeRoomHashtags.hashtagId, toRemove)));
  }
  const toAdd = [...newHashtagIds].filter(id => !existingHashtagIds.has(id));
  if (toAdd.length > 0) {
    await db.insert(hypeRoomHashtags).values(toAdd.map(hashtagId => ({ roomId, hashtagId })));
  }
}

async function syncHypeRoomMessageHashtags(
  db: DbLike,
  messageId: number,
  newHashtags: ReturnType<typeof extractHashtags>
) {
  if (newHashtags.length === 0) {
    await db.delete(hypeRoomMessageHashtags).where(eq(hypeRoomMessageHashtags.messageId, messageId));
    return;
  }
  const hashtagRows = await upsertHashtagRows(db, newHashtags);
  const newHashtagIds = new Set(hashtagRows.map(h => h.id));
  const existing = await db.select({ hashtagId: hypeRoomMessageHashtags.hashtagId }).from(hypeRoomMessageHashtags).where(eq(hypeRoomMessageHashtags.messageId, messageId));
  const existingHashtagIds = new Set(existing.map(e => e.hashtagId));
  const toRemove = [...existingHashtagIds].filter(id => !newHashtagIds.has(id));
  if (toRemove.length > 0) {
    await db.delete(hypeRoomMessageHashtags).where(and(eq(hypeRoomMessageHashtags.messageId, messageId), inArray(hypeRoomMessageHashtags.hashtagId, toRemove)));
  }
  const toAdd = [...newHashtagIds].filter(id => !existingHashtagIds.has(id));
  if (toAdd.length > 0) {
    await db.insert(hypeRoomMessageHashtags).values(toAdd.map(hashtagId => ({ messageId, hashtagId })));
  }
}

async function syncDropHashtags(
  db: DbLike,
  dropId: number,
  newHashtags: ReturnType<typeof extractHashtags>
) {
  if (newHashtags.length === 0) {
    await db.delete(dropHashtags).where(eq(dropHashtags.dropId, dropId));
    return;
  }
  const hashtagRows = await upsertHashtagRows(db, newHashtags);
  const newHashtagIds = new Set(hashtagRows.map(h => h.id));
  const existing = await db.select({ hashtagId: dropHashtags.hashtagId }).from(dropHashtags).where(eq(dropHashtags.dropId, dropId));
  const existingHashtagIds = new Set(existing.map(e => e.hashtagId));
  const toRemove = [...existingHashtagIds].filter(id => !newHashtagIds.has(id));
  if (toRemove.length > 0) {
    await db.delete(dropHashtags).where(and(eq(dropHashtags.dropId, dropId), inArray(dropHashtags.hashtagId, toRemove)));
  }
  const toAdd = [...newHashtagIds].filter(id => !existingHashtagIds.has(id));
  if (toAdd.length > 0) {
    await db.insert(dropHashtags).values(toAdd.map(hashtagId => ({ dropId, hashtagId })));
  }
}

/**
 * Warm path is deliberately synchronous: `if (_db) return _db` contains no
 * `await`, so the returned instance is decided atomically and can never be a
 * different (or null) global than the one that was just observed.
 *
 * Health is signalled by the application's own query, not by a per-call probe:
 * pg-pool evicts a failed client on release and re-dials lazily, and `withDb`
 * retries once after probing the pool it actually used.
 */
export async function getDb() {
  if (_db) return _db;

  if (!_creating) {
    const connectionString = resolvePostgresDatabaseUrl();
    if (!connectionString) {
      console.error(
        "[Database] PostgreSQL is not configured. Set SUPABASE_DATABASE_URL or a PostgreSQL DATABASE_URL."
      );
      throw new Error("PostgreSQL is not configured. Set SUPABASE_DATABASE_URL or a PostgreSQL DATABASE_URL.");
    }
    _creating = createPoolWithRetry(connectionString, 0)
      .then((created) => {
        _db = created;
        _pool = (created as { $client: Pool }).$client;
        return created;
      })
      .finally(() => {
        _creating = null;
      });
  }

  const created = await _creating;
  return _db ?? created;
}

export async function withDb<T>(
  fn: (db: ReturnType<typeof drizzle>) => Promise<T>
): Promise<T> {
  let db: ReturnType<typeof drizzle>;
  try {
    db = await getDb();
  } catch (error) {
    if (isRetryablePoolError(error)) {
      console.warn("[Database] Transient error getting connection, will retry:", error);
      db = await getDb();
    } else {
      throw error;
    }
  }

  try {
    return await fn(db);
  } catch (error) {
    if (!isRetryablePoolError(error)) throw error;

    console.warn("[Database] Transient error during query, will retry once:", error);
    // Probe the exact pool this operation used. Retire it only when the probe
    // proves it unusable — a healthy pool stays untouched so concurrent
    // requests are never interrupted by a one-off client-level blip.
    if (!(await validatePool(db))) {
      retirePool((db as { $client: Pool }).$client);
    }
    const retryDb = await getDb();
    return await fn(retryDb);
  }
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db)
    throw new Error(
      "JHILIK PostgreSQL database is unavailable. Configure SUPABASE_DATABASE_URL or a PostgreSQL DATABASE_URL."
    );
  const values: InsertUser = {
    openId: user.openId,
    lastSignedIn: user.lastSignedIn ?? new Date(),
  };
  const updateSet: Partial<InsertUser> = { lastSignedIn: values.lastSignedIn };
  (["name", "email", "loginMethod"] as const).forEach(field => {
    if (user[field] !== undefined) {
      values[field] = user[field];
      updateSet[field] = user[field] ?? null;
    }
  });
  // Preserve an existing database role during routine login upserts. The prior
  // implementation wrote the fallback `user` role on every login, which could
  // silently demote administrators configured directly in PostgreSQL.
  if (user.role !== undefined) values.role = user.role;
  else if (user.openId === ENV.ownerOpenId) values.role = "admin";
  await db
    .insert(users)
    .values(values)
    .onConflictDoUpdate({ target: users.openId, set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  return result[0];
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return result[0];
}

export async function ensureProfile(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(profiles)
    .values({
      userId,
      languages: JSON.stringify([]),
      skills: JSON.stringify([]),
      interests: JSON.stringify([]),
    })
    .onConflictDoNothing({ target: profiles.userId });
}

export async function getProfileStats(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [stats] = await db
    .select({
      reactionsReceived: sql<number>`(select count(*) from video_reactions inner join videos on video_reactions."videoId" = videos.id where videos."userId" = ${userId})`,
      iconsCount: sql<number>`(select count(*) from videos where videos."userId" = ${userId})`,
      followingCount: sql<number>`(select count(*) from follows where follows."followerId" = ${userId})`,
      followersCount: sql<number>`(select count(*) from follows where follows."followedId" = ${userId})`,
    })
    .from(users)
    .where(eq(users.id, userId));
  return {
    reactionsReceived: Number(stats?.reactionsReceived ?? 0),
    iconsCount: Number(stats?.iconsCount ?? 0),
    followingCount: Number(stats?.followingCount ?? 0),
    followersCount: Number(stats?.followersCount ?? 0),
  };
}

export async function getOwnProfile(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [result, stats] = await Promise.all([
    db
      .select({ user: users, profile: profiles })
      .from(users)
      .leftJoin(profiles, eq(users.id, profiles.userId))
      .where(eq(users.id, userId))
      .limit(1),
    getProfileStats(userId),
  ]);
  if (!result[0]) return undefined;
  return { ...result[0], stats };
}

export async function getPublicProfile(userId: number) {
  if (!Number.isInteger(userId) || userId < 1) return undefined;
  return getOwnProfile(userId);
}

export async function updateOwnProfile(
  userId: number,
  input: { username?: string | null; photoUrl?: string | null; about?: string | null; displayName?: string | null; birthday?: string | null }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const hasUsername = Object.prototype.hasOwnProperty.call(input, "username");
  const hasPhotoUrl = Object.prototype.hasOwnProperty.call(input, "photoUrl");
  const hasAbout = Object.prototype.hasOwnProperty.call(input, "about");
  const hasDisplayName = Object.prototype.hasOwnProperty.call(input, "displayName");
  const hasBirthday = Object.prototype.hasOwnProperty.call(input, "birthday");

  const username = hasUsername
    ? input.username?.trim().toLowerCase() || null
    : undefined;

  if (username) {
    const validation = validateUsername(username);
    if (!validation.valid) throw new Error(validation.error);
    if (RESERVED_USERNAMES.has(username)) {
      throw new Error("That username is reserved.");
    }
    const [existing] = await db
      .select({ userId: profiles.userId })
      .from(profiles)
      .where(
        and(
          eq(profiles.username, username),
          sql`${profiles.userId} <> ${userId}`
        )
      )
      .limit(1);
    if (existing) throw new Error("That username is already taken.");
  }

  const displayName = hasDisplayName
    ? input.displayName?.trim() || null
    : undefined;

  const birthday = hasBirthday
    ? input.birthday || null
    : undefined;

  if (birthday) {
    const date = new Date(birthday);
    if (isNaN(date.getTime()) || date > new Date()) {
      throw new Error("Birthday cannot be in the future.");
    }
  }

  const updateSet: Partial<typeof profiles.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (hasUsername) updateSet.username = username ?? null;
  if (hasPhotoUrl) updateSet.photoUrl = input.photoUrl ?? null;
  if (hasAbout) updateSet.about = input.about?.trim() || null;
  if (hasDisplayName) updateSet.displayName = displayName ?? null;
  if (hasBirthday) updateSet.birthday = birthday;

  const insertValues: typeof profiles.$inferInsert = {
    userId,
    username: username ?? null,
    photoUrl: hasPhotoUrl ? (input.photoUrl ?? null) : null,
    about: hasAbout ? (input.about?.trim() || null) : undefined,
    displayName: hasDisplayName ? (displayName ?? null) : undefined,
    birthday: hasBirthday ? birthday : undefined,
  };
  await db
    .insert(profiles)
    .values(insertValues)
    .onConflictDoUpdate({ target: profiles.userId, set: updateSet });
  return getOwnProfile(userId);
}

export async function claimUsername(userId: number, username: string): Promise<{ success: boolean; username: string }> {
  const normalized = normalizeUsername(username);
  const validation = validateUsername(normalized);
  if (!validation.valid) throw new Error(validation.error);
  if (RESERVED_USERNAMES.has(normalized)) throw new Error("That username is reserved.");

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [existing] = await db
    .select({ userId: profiles.userId })
    .from(profiles)
    .where(eq(profiles.username, normalized))
    .limit(1);
  if (existing) throw new Error("That username is already taken.");

  const [current] = await db
    .select({ username: profiles.username })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (current?.username) throw new Error("Username already claimed.");

  await db
    .insert(profiles)
    .values({ userId, username: normalized })
    .onConflictDoUpdate({ target: profiles.userId, set: { username: normalized, updatedAt: new Date() } });

  return { success: true, username: normalized };
}

export async function updateDisplayName(userId: number, displayName: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const trimmed = displayName?.trim() ?? null;
  await db
    .insert(profiles)
    .values({ userId, displayName: trimmed })
    .onConflictDoUpdate({ target: profiles.userId, set: { displayName: trimmed, updatedAt: new Date() } });
}

export async function setBirthday(userId: number, birthday: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  if (birthday) {
    const date = new Date(birthday);
    if (isNaN(date.getTime()) || date > new Date()) {
      throw new Error("Birthday cannot be in the future.");
    }
  }

  await db
    .insert(profiles)
    .values({ userId, birthday: birthday || null })
    .onConflictDoUpdate({ target: profiles.userId, set: { birthday: birthday || null, updatedAt: new Date() } });
}

export async function getVerificationStatus(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [profile] = await db
    .select({
      isVerified: profiles.isVerified,
      verificationStatus: profiles.verificationStatus,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  const [latest] = await db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.createdAt))
    .limit(1);
  return {
    isVerified: Boolean(profile?.isVerified),
    verificationStatus:
      profile?.verificationStatus ??
      (profile?.isVerified ? "verified" : "none"),
    latestTransaction: latest ?? null,
  };
}

function normalizeBangladeshiPhone(value: string) {
  const digits = value.replace(/[^0-9]/g, "");
  if (/^01\d{9}$/.test(digits)) return `+88${digits}`;
  if (/^8801\d{9}$/.test(digits)) return `+${digits}`;
  throw new Error("Enter a valid Bangladesh mobile number.");
}

export async function submitVerificationTransaction(
  userId: number,
  input: {
    amount: string;
    paymentMethod: "bkash" | "nagad";
    senderNumber: string;
    transactionId: string;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const [profile] = await db
    .select({ isVerified: profiles.isVerified })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (profile?.isVerified) {
    throw new Error("This account is already verified.");
  }

  const [pending] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(eq(transactions.userId, userId), eq(transactions.status, "pending"))
    )
    .limit(1);
  if (pending) {
    throw new Error("A verification payment is already pending review.");
  }

  const transactionId = input.transactionId.trim();
  const [duplicate] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.transactionId, transactionId))
    .limit(1);
  if (duplicate) {
    throw new Error("This transaction ID has already been submitted.");
  }

  const [created] = await db
    .insert(transactions)
    .values({
      userId,
      amount: input.amount,
      paymentMethod: input.paymentMethod,
      senderNumber: normalizeBangladeshiPhone(input.senderNumber),
      transactionId,
      status: "pending",
    })
    .returning();
  await db
    .update(profiles)
    .set({ verificationStatus: "pending", updatedAt: new Date() })
    .where(eq(profiles.userId, userId));
  return created;
}

export async function listVerificationTransactions() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ transaction: transactions, user: users, profile: profiles })
    .from(transactions)
    .innerJoin(users, eq(transactions.userId, users.id))
    .leftJoin(profiles, eq(transactions.userId, profiles.userId))
    .orderBy(desc(transactions.createdAt));
}

export async function approveVerificationTransaction(
  transactionId: number,
  adminId: number,
  status: "approved" | "rejected",
  accountType: "creator" | "company" = "creator"
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const [transaction] = await tx
      .select()
      .from(transactions)
      .where(eq(transactions.id, transactionId))
      .limit(1);
    if (!transaction) throw new Error("Transaction not found.");
    if (transaction.status !== "pending") {
      throw new Error("This transaction has already been reviewed.");
    }
    const [updated] = await tx
      .update(transactions)
      .set({
        status,
        approvedBy: adminId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.status, "pending")
        )
      )
      .returning();
    if (!updated) {
      throw new Error("This transaction has already been reviewed.");
    }
    if (status === "approved") {
      await tx
        .update(profiles)
        .set({
          isVerified: true,
          phoneVerified: true,
          accountType,
          verificationStatus:
            accountType === "company" ? "business_verified" : "verified",
          updatedAt: new Date(),
        })
        .where(eq(profiles.userId, transaction.userId));
    } else {
      await tx
        .update(profiles)
        .set({ verificationStatus: "none", updatedAt: new Date() })
        .where(
          and(
            eq(profiles.userId, transaction.userId),
            eq(profiles.verificationStatus, "pending")
          )
        );
    }
    return updated;
  });
}

export type VideoKind = "LONG" | "SHORT" | "WHEEL";
export type MediaType = "VIDEO" | "IMAGE" | "TEXT";
export type VideoQuality = "ORIGINAL" | "1080P" | "720P" | "480P" | "240P";
export type VideoSourceInput = { quality: VideoQuality; videoUrl: string };
export type VideoAttachmentInput = {
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  sortOrder: number;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
};
export type HomeFeedTab =
  | "all"
  | "videos"
  | "trendy"
  | "following"
  | "icons"
  | "shorts"
  | "wheels";

function requiredText(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized || fallback;
}

function optionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

/** Placeholder older rows stored when a post had no caption at all. */
const EMPTY_DESCRIPTION_PLACEHOLDER = "No description provided.";

/**
 * Captions are user text, never a fabricated string. Older rows stored
 * EMPTY_DESCRIPTION_PLACEHOLDER when the caller published without a caption,
 * so that placeholder is stripped before a description reaches a client.
 */
function captionText(value: string | null | undefined) {
  const text = value ?? "";
  return text.trim() === EMPTY_DESCRIPTION_PLACEHOLDER ? "" : text;
}

function withSourceMap<T extends { id: number }>(
  rows: T[],
  sources: (typeof videoSources.$inferSelect)[]
) {
  const sourcesByVideo = new Map<
    number,
    (typeof videoSources.$inferSelect)[]
  >();
  sources.forEach(source => {
    const existing = sourcesByVideo.get(source.videoId) ?? [];
    existing.push(source);
    sourcesByVideo.set(source.videoId, existing);
  });
  return rows.map(row => ({
    ...row,
    sources: (sourcesByVideo.get(row.id) ?? []).map(source => ({
      quality: source.quality,
      videoUrl: publicMediaUrl(source.videoUrl) ?? "",
    })),
  }));
}

async function loadVideoSources(videoIds: number[]) {
  const db = await getDb();
  if (!db || !videoIds.length) return [];
  return db
    .select()
    .from(videoSources)
    .where(inArray(videoSources.videoId, videoIds));
}

function publicMediaUrl(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) return null;
  const baseUrl = ENV.r2PublicBaseUrl?.trim().replace(/\/+$/, "");
  if (!baseUrl) return normalized;
  try {
    const parsed = new URL(normalized);
    const publicBase = new URL(`${baseUrl}/`);
    if (parsed.origin === publicBase.origin) return parsed.toString();
    const endpoint = ENV.r2Endpoint ? new URL(ENV.r2Endpoint) : null;
    if (endpoint && parsed.origin === endpoint.origin) {
      const bucket = (ENV.r2BucketName || "kinba-media").replace(/^\/+|\/+$/g, "");
      const prefix = `/${bucket}/`;
      const pathname = decodeURIComponent(parsed.pathname);
      const key = pathname.startsWith(prefix)
        ? pathname.slice(prefix.length)
        : pathname.replace(/^\/+/, "");
      return `${baseUrl}/${key.split("/").filter(Boolean).map(encodeURIComponent).join("/")}`;
    }
    return parsed.toString();
  } catch {
    const key = normalized.replace(/^\/+/, "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
    return `${baseUrl}/${key}`;
  }
}

function shapeVideoRow(row: any) {
  return {
    ...row.video,
    description: captionText(row.video.description),
    videoUrl: publicMediaUrl(row.video.videoUrl) ?? "",
    thumbnailUrl: publicMediaUrl(row.video.thumbnailUrl),
    hlsMasterUrl: publicMediaUrl(row.video.hlsMasterUrl),
    mediaType: row.video.mediaType === "IMAGE" ? "IMAGE" : row.video.mediaType === "TEXT" ? "TEXT" : "VIDEO",
    processingStatus: row.video.processingStatus ?? "READY",
    reactionCount: Number(row.reactionCount),
    shareCount: Number(row.shareCount),
    commentCount: Number(row.commentCount),
    bookmarkCount: Number(row.bookmarkCount),
    viewCount: Number(row.video.viewCount ?? 0),
    viewerReacted: Boolean(row.viewerReacted),
    viewerReaction: narrowReaction(row.viewerReaction),
    viewerShared: Boolean(row.viewerShared),
    viewerBookmarked: Boolean(row.viewerBookmarked),
    owner: {
      id: row.user.id,
      name: row.user.name,
      username: row.profile?.username ?? null,
      photoUrl: row.profile?.photoUrl ?? null,
      accountType: row.profile?.accountType ?? "member",
      isVerified: Boolean(row.profile?.isVerified),
    },
  };
}

async function selectVideos(
  conditions: any[],
  viewerId: number | undefined,
  orderBy: "recent" | "trendy"
) {
  const db = await getDb();
  if (!db) return [];
  const reactionCount = sql<number>`(select count(*) from video_reactions where video_reactions."videoId" = ${videos.id})`;
  const shareCount = sql<number>`(select count(*) from video_shares where video_shares."videoId" = ${videos.id})`;
  const commentCount = sql<number>`(select count(*) from video_comments where video_comments."videoId" = ${videos.id})`;
  const bookmarkCount = sql<number>`(select count(*) from video_bookmarks where video_bookmarks."videoId" = ${videos.id})`;
  const viewerReacted = viewerId
    ? sql<boolean>`exists (select 1 from video_reactions where video_reactions."videoId" = ${videos.id} and video_reactions."userId" = ${viewerId})`
    : sql<boolean>`false`;
  const viewerReaction = viewerId
    ? sql<string | null>`(select video_reactions."reaction" from video_reactions where video_reactions."videoId" = ${videos.id} and video_reactions."userId" = ${viewerId} limit 1)`
    : sql<string | null>`null`;
  const viewerShared = viewerId
    ? sql<boolean>`exists (select 1 from video_shares where video_shares."videoId" = ${videos.id} and video_shares."userId" = ${viewerId})`
    : sql<boolean>`false`;
  const viewerBookmarked = viewerId
    ? sql<boolean>`exists (select 1 from video_bookmarks where video_bookmarks."videoId" = ${videos.id} and video_bookmarks."userId" = ${viewerId})`
    : sql<boolean>`false`;
  const rows = await db
    .select({
      video: videos,
      user: users,
      profile: profiles,
      reactionCount,
      shareCount,
      commentCount,
      bookmarkCount,
      viewerReacted,
      viewerReaction,
      viewerShared,
      viewerBookmarked,
    })
    .from(videos)
    .innerJoin(users, eq(videos.userId, users.id))
    .leftJoin(profiles, eq(videos.userId, profiles.userId))
    .where(
      and(
        // Only deliver playable media. PENDING/PROCESSING rows may still point
        // at unfinished HLS artifacts; filtering here keeps every public
        // listing (home feed, search, profiles, bookmarks) READY-only.
        eq(videos.processingStatus, "READY"),
        ...conditions
      )
    )
    .orderBy(
      ...(orderBy === "trendy"
        ? [desc(reactionCount), desc(shareCount), desc(videos.createdAt)]
        : [desc(videos.createdAt)])
    )
    .limit(60);
  const shaped = rows.map(shapeVideoRow);
  const sources = await loadVideoSources(shaped.map(video => video.id));
  return withSourceMap(shaped, sources);
}

export type SpotlightHighlight = {
  id: string;
  sourceType: "video" | "post";
  postId: number;
  createdAt: Date;
  title: string;
  caption: string;
  mediaType: "VIDEO" | "IMAGE" | "TEXT";
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  score: number;
  likes: number;
  comments: number;
  shares: number;
  author: {
    id: number;
    name: string | null;
    username: string | null;
    photoUrl: string | null;
  };
};

export async function listSpotlightHighlights(): Promise<SpotlightHighlight[]> {
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const likesCount = sql<number>`(select count(*) from video_reactions where video_reactions."videoId" = ${videos.id})`;
  const commentsCount = sql<number>`(select count(*) from video_comments where video_comments."videoId" = ${videos.id})`;
  const sharesCount = sql<number>`(select count(*) from video_shares where video_shares."videoId" = ${videos.id})`;
  const videoScore = sql<number>`${likesCount} + ${commentsCount} * 2 + ${sharesCount} * 3`;

  const postLikes = sql<number>`(select count(*) from community_reactions where community_reactions."announcementId" = ${communityAnnouncements.id})`;
  const postComments = sql<number>`(select count(*) from community_comments where community_comments."announcementId" = ${communityAnnouncements.id})`;
  const postScore = sql<number>`${postLikes} + ${postComments} * 2`;

  const [videoRows, postRows] = await Promise.all([
    db
      .select({
        video: videos,
        user: users,
        profile: profiles,
        likes: likesCount,
        comments: commentsCount,
        shares: sharesCount,
        score: videoScore,
      })
      .from(videos)
      .innerJoin(users, eq(videos.userId, users.id))
      .leftJoin(profiles, eq(videos.userId, profiles.userId))
      .where(and(eq(videos.processingStatus, "READY"), gt(videos.createdAt, since)))
      .orderBy(desc(videoScore), desc(videos.createdAt))
      .limit(50),
    db
      .select({
        post: communityAnnouncements,
        user: users,
        profile: profiles,
        likes: postLikes,
        comments: postComments,
        score: postScore,
        attachmentType: sql<"IMAGE" | "VIDEO" | null>`(select "mediaType" from community_announcement_attachments where "announcementId" = ${communityAnnouncements.id} order by "sortOrder" asc limit 1)`,
        attachmentUrl: sql<string | null>`(select "mediaUrl" from community_announcement_attachments where "announcementId" = ${communityAnnouncements.id} order by "sortOrder" asc limit 1)`,
      })
      .from(communityAnnouncements)
      .innerJoin(users, eq(communityAnnouncements.userId, users.id))
      .leftJoin(profiles, eq(communityAnnouncements.userId, profiles.userId))
      .where(gt(communityAnnouncements.createdAt, since))
      .orderBy(desc(postScore), desc(communityAnnouncements.createdAt))
      .limit(50),
  ]);
  const videoHighlights: SpotlightHighlight[] = videoRows.map(row => {
    const likes = Number(row.likes ?? 0);
    const comments = Number(row.comments ?? 0);
    const shares = Number(row.shares ?? 0);
    return {
      id: `video-${row.video.id}`,
      sourceType: "video",
      postId: row.video.id,
      createdAt: row.video.createdAt,
      title: row.video.title,
      caption: row.video.description,
      mediaType: row.video.mediaType,
      mediaUrl: publicMediaUrl(row.video.videoUrl),
      thumbnailUrl: publicMediaUrl(row.video.thumbnailUrl),
      score: likes + comments * 2 + shares * 3,
      likes,
      comments,
      shares,
      author: {
        id: row.user.id,
        name: row.user.name,
        username: row.profile?.username ?? null,
        photoUrl: row.profile?.photoUrl ?? null,
      },
    };
  });
  const postHighlights: SpotlightHighlight[] = postRows.map(row => {
    const likes = Number(row.likes ?? 0);
    const comments = Number(row.comments ?? 0);
    return {
      id: `post-${row.post.id}`,
      sourceType: "post",
      postId: row.post.id,
      createdAt: row.post.createdAt,
      title: "Community post",
      caption: row.post.body,
      mediaType: row.attachmentType ?? "TEXT",
      mediaUrl: publicMediaUrl(row.attachmentUrl),
      thumbnailUrl: null,
      score: likes + comments * 2,
      likes,
      comments,
      shares: 0,
      author: {
        id: row.user.id,
        name: row.user.name,
        username: row.profile?.username ?? null,
        photoUrl: row.profile?.photoUrl ?? null,
      },
    };
  });
  return [...videoHighlights, ...postHighlights]
    .sort((a, b) => b.score - a.score || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5);
}

export async function listVideos(kind: VideoKind, viewerId?: number) {
  const conditions = [eq(videos.kind, kind)];
  if (kind === "LONG" || kind === "SHORT" || kind === "WHEEL")
    conditions.push(eq(videos.mediaType, "VIDEO"));
  return selectVideos(conditions, viewerId, "recent");
}

export async function listProfileVideos(userId: number) {
  return selectVideos([eq(videos.userId, userId)], userId, "recent");
}

export async function listPublicProfileVideos(userId: number) {
  return selectVideos([eq(videos.userId, userId)], undefined, "recent");
}

export async function searchVideos(term: string, viewerId?: number) {
  const db = await getDb();
  const query = term.trim();
  if (!db || !query) return [];
  const pattern = `%${query}%`;
  return selectVideos(
    [
      or(
        ilike(videos.title, pattern),
        ilike(videos.description, pattern),
        ilike(users.name, pattern)
      ),
    ],
    viewerId,
    "recent"
  );
}

export type SearchUserResult = {
  id: number;
  name: string | null;
  username: string | null;
  photoUrl: string | null;
  isVerified: boolean;
  followersCount: number;
};

export type SearchAllResult = {
  users: SearchUserResult[];
  videos: Awaited<ReturnType<typeof searchVideos>>;
};

export async function searchAll(
  term: string,
  viewerId?: number
): Promise<SearchAllResult> {
  const db = await getDb();
  const query = term.trim();
  if (!db || !query) return { users: [], videos: [] };
  const pattern = `%${query}%`;

  const [userRows, videos] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        username: profiles.username,
        photoUrl: profiles.photoUrl,
        isVerified: profiles.isVerified,
        followersCount: sql<number>`(select count(*) from follows where follows."followedId" = ${users.id})`,
      })
      .from(users)
      .innerJoin(profiles, eq(users.id, profiles.userId))
      .where(or(ilike(users.name, pattern), ilike(profiles.username, pattern)))
      .orderBy(desc(sql<number>`(select count(*) from follows where follows."followedId" = ${users.id})`))
      .limit(20),
    searchVideos(term, viewerId),
  ]);

  return {
    users: userRows.map(row => ({
      ...row,
      followersCount: Number(row.followersCount),
    })),
    videos,
  };
}

// ---------------------------------------------------------------------------
// JHILIK Phase 2B — Hashtag Queries
// ---------------------------------------------------------------------------

export type HashtagContentResult = {
  type: "video" | "announcement" | "hype_room" | "hype_room_message" | "drop";
  id: number;
  title: string | null;
  body: string | null;
  createdAt: Date | string;
  authorId: number | null;
  authorName: string | null;
};

/**
 * Get a hashtag by its normalized tag.
 */
export async function getHashtagByTag(tag: string): Promise<{ id: number; tag: string; displayTag: string; createdAt: Date } | null> {
  const db = await getDb();
  if (!db) return null;
  const normalized = tag.toLowerCase();
  const [row] = await db
    .select({ id: hashtags.id, tag: hashtags.tag, displayTag: hashtags.displayTag, createdAt: hashtags.createdAt })
    .from(hashtags)
    .where(eq(hashtags.tag, normalized))
    .limit(1);
  return row ?? null;
}

/**
 * Get content associated with a hashtag, filtered by viewer permissions.
 * Returns a unified list of public content across all surfaces.
 * Respects blocks table and Hype Room authorization rules.
 */
export async function getHashtagContent(
  tag: string,
  viewerId?: number | null,
  limit = 50
): Promise<HashtagContentResult[]> {
  const db = await getDb();
  if (!db) return [];
  const normalized = tag.toLowerCase();

  const [hashtagRow] = await db
    .select({ id: hashtags.id })
    .from(hashtags)
    .where(eq(hashtags.tag, normalized))
    .limit(1);
  if (!hashtagRow) return [];

  const hashtagId = hashtagRow.id;

  // Fetch blocked user IDs for the viewer (if authenticated)
  let blockedUserIds = new Set<number>();
  let blockedByUserIds = new Set<number>();
  if (viewerId != null) {
    const [blockedRows, blockedByRows] = await Promise.all([
      // Users the viewer has blocked
      db
        .select({ blockedId: blocks.blockedId })
        .from(blocks)
        .where(eq(blocks.blockerId, viewerId)),
      // Users who have blocked the viewer
      db
        .select({ blockerId: blocks.blockerId })
        .from(blocks)
        .where(eq(blocks.blockedId, viewerId)),
    ]);
    blockedUserIds = new Set(blockedRows.map(r => r.blockedId));
    blockedByUserIds = new Set(blockedByRows.map(r => r.blockerId));
  }

  // Fetch viewer's active Hype Room memberships for link-only room access
  let memberRoomIds = new Set<number>();
  if (viewerId != null) {
    memberRoomIds = await listViewerMemberRoomIds(db, viewerId);
  }

  // Build a filter function for blocked users
  const isAuthorBlocked = (authorId: number | null) => {
    if (authorId == null) return false;
    return blockedUserIds.has(authorId) || blockedByUserIds.has(authorId);
  };

  // Build a filter function for Hype Room visibility
  const isHypeRoomDiscoverable = (room: { id: number; visibility: "public" | "link_only"; hostId: number }) => {
    return canDiscoverRoom(room, viewerId ?? null, memberRoomIds);
  };

  // Fetch content from each surface with proper visibility filtering
  const [
    videoRows,
    announcementRows,
    hypeRoomRows,
    hypeRoomMessageRows,
    dropRows,
  ] = await Promise.all([
    // Videos: public, READY only, author not blocked
    db
      .select({
        type: sql<"video">`'video'`,
        id: videos.id,
        title: videos.title,
        body: videos.description,
        createdAt: videos.createdAt,
        authorId: videos.userId,
        authorName: users.name,
      })
      .from(videoHashtags)
      .innerJoin(videos, eq(videoHashtags.videoId, videos.id))
      .innerJoin(users, eq(videos.userId, users.id))
      .where(
        and(
          eq(videoHashtags.hashtagId, hashtagId),
          eq(videos.processingStatus, "READY")
        )
      )
      .orderBy(desc(videos.createdAt))
      .limit(limit),

    // Community Announcements: public, verified authors only, author not blocked
    db
      .select({
        type: sql<"announcement">`'announcement'`,
        id: communityAnnouncements.id,
        title: sql<string | null>`null`,
        body: communityAnnouncements.body,
        createdAt: communityAnnouncements.createdAt,
        authorId: communityAnnouncements.userId,
        authorName: users.name,
      })
      .from(announcementHashtags)
      .innerJoin(communityAnnouncements, eq(announcementHashtags.announcementId, communityAnnouncements.id))
      .innerJoin(users, eq(communityAnnouncements.userId, users.id))
      .innerJoin(profiles, eq(communityAnnouncements.userId, profiles.userId))
      .where(
        and(
          eq(announcementHashtags.hashtagId, hashtagId),
          eq(profiles.isVerified, true),
          inArray(profiles.accountType, ["creator", "company"])
        )
      )
      .orderBy(desc(communityAnnouncements.createdAt))
      .limit(limit),

    // Hype Rooms: use canDiscoverRoom for proper authorization
    db
      .select({
        type: sql<"hype_room">`'hype_room'`,
        id: hypeRooms.id,
        title: hypeRooms.title,
        body: hypeRooms.description,
        createdAt: hypeRooms.createdAt,
        authorId: hypeRooms.hostId,
        authorName: users.name,
        visibility: hypeRooms.visibility,
        hostId: hypeRooms.hostId,
      })
      .from(hypeRoomHashtags)
      .innerJoin(hypeRooms, eq(hypeRoomHashtags.roomId, hypeRooms.id))
      .innerJoin(users, eq(hypeRooms.hostId, users.id))
      .where(
        and(
          eq(hypeRoomHashtags.hashtagId, hashtagId),
          inArray(hypeRooms.status, ["scheduled", "live"])
        )
      )
      .orderBy(desc(hypeRooms.createdAt))
      .limit(limit),

    // Hype Room Messages: inherit room's exact authorization
    db
      .select({
        type: sql<"hype_room_message">`'hype_room_message'`,
        id: hypeRoomMessages.id,
        title: sql<string | null>`null`,
        body: hypeRoomMessages.body,
        createdAt: hypeRoomMessages.createdAt,
        authorId: hypeRoomMessages.userId,
        authorName: users.name,
        roomId: hypeRooms.id,
        roomVisibility: hypeRooms.visibility,
        roomHostId: hypeRooms.hostId,
      })
      .from(hypeRoomMessageHashtags)
      .innerJoin(hypeRoomMessages, eq(hypeRoomMessageHashtags.messageId, hypeRoomMessages.id))
      .innerJoin(hypeRooms, eq(hypeRoomMessages.roomId, hypeRooms.id))
      .innerJoin(users, eq(hypeRoomMessages.userId, users.id))
      .where(
        and(
          eq(hypeRoomMessageHashtags.hashtagId, hashtagId),
          inArray(hypeRooms.status, ["scheduled", "live"])
        )
      )
      .orderBy(desc(hypeRoomMessages.createdAt))
      .limit(limit),

    // Drops: live/scheduled with remaining quantity, author not blocked
    db
      .select({
        type: sql<"drop">`'drop'`,
        id: drops.id,
        title: drops.title,
        body: drops.description,
        createdAt: drops.createdAt,
        authorId: drops.sellerId,
        authorName: users.name,
      })
      .from(dropHashtags)
      .innerJoin(drops, eq(dropHashtags.dropId, drops.id))
      .innerJoin(users, eq(drops.sellerId, users.id))
      .where(
        and(
          eq(dropHashtags.hashtagId, hashtagId),
          inArray(drops.status, ["live", "scheduled"]),
          gt(drops.remainingQuantity, 0)
        )
      )
      .orderBy(desc(drops.createdAt))
      .limit(limit),
  ]);

  // Apply blocked-user filtering to all surfaces
  const filteredVideos = videoRows.filter(r => !isAuthorBlocked(r.authorId));
  const filteredAnnouncements = announcementRows.filter(r => !isAuthorBlocked(r.authorId));
  const filteredHypeRooms = hypeRoomRows.filter(r => !isAuthorBlocked(r.authorId) && isHypeRoomDiscoverable({ id: r.id, visibility: r.visibility, hostId: r.hostId }));
  const filteredHypeRoomMessages = hypeRoomMessageRows.filter(r => !isAuthorBlocked(r.authorId) && isHypeRoomDiscoverable({ id: r.roomId, visibility: r.roomVisibility, hostId: r.roomHostId }));
  const filteredDrops = dropRows.filter(r => !isAuthorBlocked(r.authorId));

  // Merge and sort by createdAt descending
  const all = [
    ...filteredVideos,
    ...filteredAnnouncements,
    ...filteredHypeRooms,
    ...filteredHypeRoomMessages,
    ...filteredDrops,
  ];

  all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return all.slice(0, limit);
}

/**
 * Suggest hashtags by prefix (for autocomplete).
 */
export async function suggestHashtags(prefix: string, limit = 10): Promise<{ tag: string; displayTag: string }[]> {
  const db = await getDb();
  if (!db) return [];
  const normalized = prefix.toLowerCase();
  if (!normalized) return [];

  const rows = await db
    .select({ tag: hashtags.tag, displayTag: hashtags.displayTag })
    .from(hashtags)
    .where(sql`${hashtags.tag} LIKE ${normalized + '%'}`)
    .orderBy(hashtags.createdAt)
    .limit(limit);
  return rows;
}

export async function listHomeFeed(tab: HomeFeedTab, viewerId?: number) {
  if (tab === "all") return listUnifiedHomeFeed(viewerId);
  if (tab === "shorts")
    return selectVideos(
      [eq(videos.kind, "SHORT"), eq(videos.mediaType, "VIDEO")],
      viewerId,
      "recent"
    );
  if (tab === "wheels") {
    // WHEELS is a global public discovery surface, not a followed-users view.
    return selectVideos(
      [
        or(
          eq(videos.kind, "LONG"),
          eq(videos.kind, "SHORT")
        ),
      ],
      viewerId,
      "recent"
    );
  }
  if (tab === "following" && !viewerId) return [];
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (tab === "videos")
    conditions.push(or(eq(videos.kind, "LONG"), eq(videos.kind, "SHORT")));
  if (tab === "trendy" || tab === "following")
    conditions.push(eq(videos.kind, "LONG"), eq(videos.mediaType, "VIDEO"));
  if (tab === "following")
    conditions.push(
      inArray(
        videos.userId,
        db
          .select({ followedId: follows.followedId })
          .from(follows)
          .where(eq(follows.followerId, viewerId as number))
      )
    );
  if (tab === "icons") {
    conditions.push(eq(profiles.isVerified, true));
    conditions.push(inArray(profiles.accountType, ["creator", "company"]));
  }
  const filtered = await selectVideos(
    conditions,
    viewerId,
    tab === "trendy" ? "trendy" : "recent"
  );
  if (tab === "following" && filtered.length === 0) {
    return selectVideos(
      [eq(videos.kind, "LONG"), eq(videos.mediaType, "VIDEO")],
      viewerId,
      "recent"
    );
  }
  return filtered;
}

/** Resolve real persisted media and text posts into one chronological feed. */
async function listUnifiedHomeFeed(viewerId?: number) {
  const [mediaAndShorts, textPosts] = await Promise.all([
    // Fetch both production video kinds together so All Feed cannot drop one
    // branch while assembling the unified response.
    selectVideos(
      [or(eq(videos.kind, "LONG"), eq(videos.kind, "SHORT"))],
      viewerId,
      "recent"
    ),
    listCommunityAnnouncements(undefined, viewerId ?? null).catch(error => {
      console.error("[Feed] Community posts unavailable:", error);
      return [];
    }),
  ]);
  const chronological = [
    ...mediaAndShorts.flatMap(video =>
      video.kind === "SHORT" && video.mediaType === "VIDEO"
        ? [{
            feedType: "shorts" as const,
            id: "shorts-" + video.id,
            video,
            createdAt: video.createdAt,
          }]
        : [{ ...video, feedType: "media" as const }]
    ),
    ...textPosts.map(post => ({
      ...post,
      text: post.body,
      feedType: "text" as const,
    })),
  ].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
  return chronological;
}

export async function listNotifications(userId: number) {
  const db = await getDb();
  if (!db) return [];
  // Follows are deliberately absent: they are durable notifications now
  // (server/notifications.ts notifyNewFollower) and would otherwise render twice.
  const [reactions, shares, comments] = await Promise.all([
    db
      .select({
        id: videoReactions.id,
        createdAt: videoReactions.createdAt,
        actorName: users.name,
        videoTitle: videos.title,
      })
      .from(videoReactions)
      .innerJoin(videos, eq(videoReactions.videoId, videos.id))
      .innerJoin(users, eq(videoReactions.userId, users.id))
      .where(eq(videos.userId, userId))
      .orderBy(desc(videoReactions.createdAt))
      .limit(30),
    db
      .select({
        id: videoShares.id,
        createdAt: videoShares.createdAt,
        actorName: users.name,
        videoTitle: videos.title,
      })
      .from(videoShares)
      .innerJoin(videos, eq(videoShares.videoId, videos.id))
      .innerJoin(users, eq(videoShares.userId, users.id))
      .where(eq(videos.userId, userId))
      .orderBy(desc(videoShares.createdAt))
      .limit(30),
    db
      .select({
        id: videoComments.id,
        createdAt: videoComments.createdAt,
        actorName: users.name,
        videoTitle: videos.title,
      })
      .from(videoComments)
      .innerJoin(videos, eq(videoComments.videoId, videos.id))
      .innerJoin(users, eq(videoComments.userId, users.id))
      .where(eq(videos.userId, userId))
      .orderBy(desc(videoComments.createdAt))
      .limit(30),
  ]);
  return [
    ...reactions.map(item => ({ ...item, kind: "reaction" as const })),
    ...shares.map(item => ({ ...item, kind: "share" as const })),
    ...comments.map(item => ({ ...item, kind: "comment" as const })),
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 50);
}

export async function getVideoThumbnailSource(videoId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const [video] = await db
    .select({ id: videos.id, videoUrl: videos.videoUrl, thumbnailUrl: videos.thumbnailUrl, mediaType: videos.mediaType })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);
  return video;
}

export async function setVideoThumbnail(videoId: number, thumbnailUrl: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [updated] = await db
    .update(videos)
    .set({ thumbnailUrl: optionalText(thumbnailUrl), updatedAt: new Date() })
    .where(eq(videos.id, videoId))
    .returning({ id: videos.id, thumbnailUrl: videos.thumbnailUrl });
  return updated;
}

export async function createVideo(
  userId: number,
  input: {
    title: string;
    description: string;
    videoUrl: string;
    thumbnailUrl?: string | null;
    kind: VideoKind;
    durationSeconds: number;
    width: number;
    height: number;
    sources: VideoSourceInput[];
  }
) {
  if (!Number.isInteger(userId) || userId < 1)
    throw new Error("Authenticated application user ID is invalid.");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const title = requiredText(input.title, "Untitled video");
  const description = optionalText(input.description) ?? "";

  const [created] = await db.transaction(async (tx) => {
    const [video] = await tx
      .insert(videos)
      .values({
        userId,
        title,
        description,
        videoUrl: requiredText(input.videoUrl, "about:blank"),
        thumbnailUrl: optionalText(input.thumbnailUrl),
        mediaType: "VIDEO",
        kind: input.kind === "SHORT" ? "SHORT" : "LONG",
        durationSeconds: input.durationSeconds,
        width: input.width,
        height: input.height,
        processingStatus: "READY",
      })
      .returning();

    // Sync hashtags from title + description
    const videoTags = extractVideoHashtags(title, description);
    await syncVideoHashtags(tx, video.id, videoTags);

    return [video];
  });

  if (input.sources.length) {
    try {
      await db
        .insert(videoSources)
        .values(
          input.sources.map(source => ({ videoId: created.id, ...source }))
        );
    } catch (error) {
      // Direct original playback only needs videos.videoUrl. Keep an enum or
      // legacy video_sources mismatch from rolling back the published row.
      console.error("[MediaPublish] Optional video source insert failed:", error);
    }
  }
  return created;
}

export async function createPhotoPost(
  userId: number,
  input: {
    title: string;
    description: string;
    imageUrl: string;
    width: number;
    height: number;
  }
) {
  if (!Number.isInteger(userId) || userId < 1)
    throw new Error("Authenticated application user ID is invalid.");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const title = requiredText(input.title, "Untitled photo");
  const description = optionalText(input.description) ?? "";

  const [created] = await db.transaction(async (tx) => {
    const [photo] = await tx
      .insert(videos)
      .values({
        userId,
        title,
        description,
        videoUrl: requiredText(input.imageUrl, "about:blank"),
        thumbnailUrl: optionalText(input.imageUrl),
        mediaType: "IMAGE",
        kind: "LONG",
        durationSeconds: 1,
        width: input.width,
        height: input.height,
        processingStatus: "READY",
      })
      .returning();

    // Sync hashtags from title + description
    const photoTags = extractVideoHashtags(title, description);
    await syncVideoHashtags(tx, photo.id, photoTags);

    return [photo];
  });

  return created;
}

export async function createTextPost(
  userId: number,
  input: { text: string }
) {
  if (!Number.isInteger(userId) || userId < 1)
    throw new Error("Authenticated application user ID is invalid.");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const text = input.text.trim();
  if (!text) throw new Error("Text post cannot be empty.");

  const title = text.length > 80 ? text.slice(0, 80) + "…" : text;
  const description = text;

  const [created] = await db.transaction(async (tx) => {
    const [post] = await tx
      .insert(videos)
      .values({
        userId,
        title,
        description,
        videoUrl: "",
        thumbnailUrl: null,
        mediaType: "TEXT",
        kind: "LONG",
        durationSeconds: 0,
        width: 0,
        height: 0,
        processingStatus: "READY",
      })
      .returning();

    // Sync hashtags from title + description (both come from text)
    const textTags = extractVideoHashtags(title, description);
    await syncVideoHashtags(tx, post.id, textTags);

    return [post];
  });

  return created;
}

export async function updateVideoDescription(videoId: number, userId: number, description: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const trimmedDescription = description.trim();

  const [updated] = await db.transaction(async (tx) => {
    const [video] = await tx
      .update(videos)
      .set({ description: trimmedDescription, updatedAt: new Date() })
      .where(and(eq(videos.id, videoId), eq(videos.userId, userId)))
      .returning({ id: videos.id, title: videos.title, description: videos.description, updatedAt: videos.updatedAt });
    if (!video) throw new Error("Post not found or you are not the author.");

    // Sync hashtags from title + new description
    const videoTags = extractVideoHashtags(video.title, video.description);
    await syncVideoHashtags(tx, video.id, videoTags);

    return [video];
  });

  return updated;
}

export async function deleteVideo(videoId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [video] = await db.select().from(videos).where(and(eq(videos.id, videoId), eq(videos.userId, userId))).limit(1);
  if (!video) throw new Error("Post not found or you are not the author.");
  const sources = await db.select({ videoUrl: videoSources.videoUrl }).from(videoSources).where(eq(videoSources.videoId, videoId));
  const mediaUrls = [video.videoUrl, video.thumbnailUrl, video.hlsMasterUrl, ...sources.map(source => source.videoUrl)].filter((url): url is string => Boolean(url));
  await db.delete(videos).where(and(eq(videos.id, videoId), eq(videos.userId, userId)));
  await Promise.all(mediaUrls.map(url => storageDelete(url).catch(error => {
    console.warn(`[Storage] Failed to clean up deleted post media: ${url}`, error);
  })));
  return { deleted: true, videoId };
}

export async function updateVideoProcessing(
  videoId: number,
  input: {
    status: "PENDING" | "PROCESSING" | "READY" | "FAILED";
    hlsMasterUrl?: string | null;
    videoUrl?: string;
    processingError?: string | null;
  }
) {
  if (!Number.isInteger(videoId) || videoId < 1)
    throw new Error("Video ID is invalid.");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const processingStatus =
    input.status === "PROCESSING"
      ? "PROCESSING"
      : input.status === "READY"
        ? "READY"
        : input.status === "FAILED"
          ? "FAILED"
          : "PENDING";
  const [updated] = await db
    .update(videos)
    .set({
      processingStatus,
      videoUrl:
        input.videoUrl === undefined ? undefined : requiredText(input.videoUrl, "about:blank"),
      hlsMasterUrl:
        input.hlsMasterUrl === undefined ? undefined : optionalText(input.hlsMasterUrl),
      processingError:
        input.processingError === undefined ? undefined : optionalText(input.processingError),
      updatedAt: new Date(),
    })
    .where(eq(videos.id, videoId))
    .returning();
  return updated;
}
export async function listVideosAwaitingTranscode() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ id: videos.id, videoUrl: videos.videoUrl })
    .from(videos)
    .where(inArray(videos.processingStatus, ["PENDING", "PROCESSING"]));
}
export async function replaceVideoSources(
  videoId: number,
  sources: VideoSourceInput[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.transaction(async tx => {
    await tx.delete(videoSources).where(eq(videoSources.videoId, videoId));
    if (sources.length)
      await tx
        .insert(videoSources)
        .values(sources.map(source => ({ videoId, ...source })));
  });
}

async function getVideoEngagement(videoId: number, viewerId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [counts] = await db
    .select({
      reactionCount: sql<number>`(select count(*) from video_reactions where video_reactions."videoId" = ${videoId})`,
      shareCount: sql<number>`(select count(*) from video_shares where video_shares."videoId" = ${videoId})`,
      commentCount: sql<number>`(select count(*) from video_comments where video_comments."videoId" = ${videoId})`,
      bookmarkCount: sql<number>`(select count(*) from video_bookmarks where video_bookmarks."videoId" = ${videoId})`,
      viewerReacted: sql<boolean>`exists (select 1 from video_reactions where video_reactions."videoId" = ${videoId} and video_reactions."userId" = ${viewerId})`,
      viewerShared: sql<boolean>`exists (select 1 from video_shares where video_shares."videoId" = ${videoId} and video_shares."userId" = ${viewerId})`,
      viewerBookmarked: sql<boolean>`exists (select 1 from video_bookmarks where video_bookmarks."videoId" = ${videoId} and video_bookmarks."userId" = ${viewerId})`,
    })
    .from(videos)
    .where(eq(videos.id, videoId));
  return {
    reactionCount: Number(counts?.reactionCount ?? 0),
    shareCount: Number(counts?.shareCount ?? 0),
    commentCount: Number(counts?.commentCount ?? 0),
    bookmarkCount: Number(counts?.bookmarkCount ?? 0),
    viewerReacted: Boolean(counts?.viewerReacted),
    viewerShared: Boolean(counts?.viewerShared),
    viewerBookmarked: Boolean(counts?.viewerBookmarked),
  };
}

export async function recordVideoView(videoId: number, viewerIp?: string) {
  if (viewerIp) {
    const { wasRecentlyViewed } = await import("./viewDedup");
    if (wasRecentlyViewed(viewerIp, videoId)) {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const [row] = await db
        .select({ viewCount: videos.viewCount })
        .from(videos)
        .where(eq(videos.id, videoId))
        .limit(1);
      return { viewCount: Number(row?.viewCount ?? 0), deduped: true };
    }
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [updated] = await db
    .update(videos)
    .set({ viewCount: sql`${videos.viewCount} + 1` })
    .where(eq(videos.id, videoId))
    .returning({ viewCount: videos.viewCount });
  return { viewCount: Number(updated?.viewCount ?? 0), deduped: false };
}

export type RawPulseOption = {
  id: number;
  label: string;
  votes: number;
  selected: boolean;
};

export type RawPulse = {
  id: number;
  videoId: number;
  question: string;
  expiresAt: Date | null;
  isClosed: boolean;
  totalVotes: number;
  selectedOptionId: number | null;
  options: RawPulseOption[];
};

export async function getRawPulse(videoId: number, voterKey?: string, userId?: number) {
  const db = await getDb();
  if (!db) return null;
  const [poll] = await db
    .select()
    .from(rawPulsePolls)
    .where(eq(rawPulsePolls.videoId, videoId))
    .limit(1);
  if (!poll) return null;
  const [options, counts, selected] = await Promise.all([
    db.select().from(rawPulseOptions).where(eq(rawPulseOptions.pollId, poll.id)).orderBy(rawPulseOptions.sortOrder, rawPulseOptions.id),
    db.select({ optionId: rawPulseVotes.optionId, count: sql<number>`count(*)` }).from(rawPulseVotes).where(eq(rawPulseVotes.pollId, poll.id)).groupBy(rawPulseVotes.optionId),
    voterKey || userId
      ? db.select({ optionId: rawPulseVotes.optionId }).from(rawPulseVotes).where(and(eq(rawPulseVotes.pollId, poll.id), voterKey ? eq(rawPulseVotes.voterKey, voterKey) : eq(rawPulseVotes.userId, userId as number))).limit(1)
      : Promise.resolve([] as { optionId: number }[]),
  ]);
  const countByOption = new Map(counts.map(row => [row.optionId, Number(row.count)]));
  const selectedOptionId = selected[0]?.optionId ?? null;
  const totalVotes = counts.reduce((sum, row) => sum + Number(row.count), 0);
  const isClosed = Boolean(poll.expiresAt && poll.expiresAt.getTime() <= Date.now());
  return {
    id: poll.id,
    videoId: poll.videoId,
    question: poll.question,
    expiresAt: poll.expiresAt,
    isClosed,
    totalVotes,
    selectedOptionId,
    options: options.map(option => ({ id: option.id, label: option.label, votes: countByOption.get(option.id) ?? 0, selected: option.id === selectedOptionId })),
  } satisfies RawPulse;
}

export async function createRawPulse(videoId: number, userId: number, question: string, optionLabels: string[], expiresAt: Date | null) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [video] = await db.select({ id: videos.id, userId: videos.userId }).from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!video || video.userId !== userId) throw new Error("Only the post owner can create a Raw Pulse.");
  return db.transaction(async tx => {
    const [poll] = await tx.insert(rawPulsePolls).values({ videoId, question: question.trim(), expiresAt }).returning();
    const options = await tx.insert(rawPulseOptions).values(optionLabels.map((label, index) => ({ pollId: poll.id, label: label.trim(), sortOrder: index }))).returning();
    return { ...poll, options };
  });
}

export async function voteRawPulse(pollId: number, optionId: number, voterKey: string, userId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [poll] = await db.select().from(rawPulsePolls).where(eq(rawPulsePolls.id, pollId)).limit(1);
  if (!poll) throw new Error("Raw Pulse not found.");
  if (poll.expiresAt && poll.expiresAt.getTime() <= Date.now()) throw new Error("This Raw Pulse is closed.");
  const [option] = await db.select({ id: rawPulseOptions.id }).from(rawPulseOptions).where(and(eq(rawPulseOptions.id, optionId), eq(rawPulseOptions.pollId, pollId))).limit(1);
  if (!option) throw new Error("That Raw Pulse option is invalid.");
  await db.insert(rawPulseVotes).values({ pollId, optionId, voterKey, userId: userId ?? null }).onConflictDoUpdate({ target: [rawPulseVotes.pollId, rawPulseVotes.voterKey], set: { optionId, userId: userId ?? null } });
  return getRawPulse(poll.videoId, voterKey, userId);
}

export async function deleteComment(commentId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [videoMatch] = await db
    .select({ comment: videoComments, postUserId: videos.userId })
    .from(videoComments)
    .innerJoin(videos, eq(videoComments.videoId, videos.id))
    .where(eq(videoComments.id, commentId))
    .limit(1);
  if (videoMatch && (videoMatch.comment.userId === userId || videoMatch.postUserId === userId)) {
    await db.delete(videoComments).where(eq(videoComments.id, commentId));
    if (videoMatch.comment.audioUrl) await storageDelete(videoMatch.comment.audioUrl).catch(error => console.warn("[Storage] Failed to clean up deleted comment audio", error));
    return { deleted: true, commentId, type: "video" as const };
  }
  const [communityMatch] = await db
    .select({ comment: communityComments, postUserId: communityAnnouncements.userId })
    .from(communityComments)
    .innerJoin(communityAnnouncements, eq(communityComments.announcementId, communityAnnouncements.id))
    .where(eq(communityComments.id, commentId))
    .limit(1);
  if (communityMatch && (communityMatch.comment.userId === userId || communityMatch.postUserId === userId)) {
    await db.delete(communityComments).where(eq(communityComments.id, commentId));
    if (communityMatch.comment.audioUrl) await storageDelete(communityMatch.comment.audioUrl).catch(error => console.warn("[Storage] Failed to clean up deleted comment audio", error));
    return { deleted: true, commentId, type: "community" as const };
  }
  throw new Error("Comment not found or you are not authorized to delete it.");
}

export const COMMENT_ROOT_LIMIT = 100;
export const COMMENT_REPLY_BATCH_DEFAULT = 5;
export const COMMENT_REPLY_BATCH_MAX = 50;

export type VideoCommentListOptions = {
  /** When set, only direct replies of this comment are returned (batched). */
  parentId?: number | null;
  /** Reply batch size — ignored for the root listing. */
  limit?: number;
  /** Replies already loaded for this parent (batched paging). */
  offset?: number;
};

/**
 * Comment listing with threaded reply batching.
 *
 * - No `parentId`: top-level comments only (each carries `replyCount`).
 * - `parentId`: one batch of direct replies for that comment, newest first,
 *   paged with `limit`/`offset`. The parent must belong to `videoId`,
 *   otherwise the batch is empty (reply loading authorization).
 *
 * Ordering matches the legacy flat listing (createdAt desc) in both modes,
 * and legacy `comment_likes` + merged multi-reaction behaviour are unchanged.
 */
export async function listVideoComments(
  videoId: number,
  viewerId?: number,
  options?: VideoCommentListOptions
) {
  const db = await getDb();
  if (!db) return [];
  // Legacy fields keep their exact comment_likes semantics (read-only compat).
  const likeCount = sql<number>`(
    select count(*) from comment_likes
    where comment_likes."commentId" = ${videoComments.id}
  )`;
  const viewerLiked = viewerId
    ? sql<boolean>`exists (
        select 1 from comment_likes
        where comment_likes."commentId" = ${videoComments.id}
          and comment_likes."userId" = ${viewerId}
      )`
    : sql<boolean>`false`;
  // Real reply totals (used by the UI to show the expand affordance and the
  // "view more replies" action) — one correlated count, no extra round trip.
  // The inner table is aliased (`rc`): without it `video_comments` inside the
  // subquery shadows the outer table of the same name and the predicate
  // collapses to `parentId = id`, reporting 0 replies for every comment.
  const replyCount = sql<number>`(
    select count(*) from video_comments rc
    where rc."parentId" = ${videoComments.id}
  )`;
  const parentId = options?.parentId ?? null;

  if (parentId != null) {
    const [parent] = await db
      .select({ id: videoComments.id })
      .from(videoComments)
      .where(
        and(
          eq(videoComments.id, parentId),
          eq(videoComments.videoId, videoId)
        )
      )
      .limit(1);
    // Parent missing or belongs to another video → empty batch.
    if (!parent) return [];
  }

  const selectCommentRows = () =>
    db
      .select({
        comment: videoComments,
        user: users,
        profile: profiles,
        likeCount,
        viewerLiked,
        replyCount,
      })
      .from(videoComments)
      .innerJoin(users, eq(videoComments.userId, users.id))
      .leftJoin(profiles, eq(videoComments.userId, profiles.userId));

  const rows =
    parentId != null
      ? await selectCommentRows()
          .where(
            and(
              eq(videoComments.videoId, videoId),
              eq(videoComments.parentId, parentId)
            )
          )
          .orderBy(desc(videoComments.createdAt))
          .limit(
            Math.min(
              Math.max(
                Math.trunc(options?.limit ?? COMMENT_REPLY_BATCH_DEFAULT),
                1
              ),
              COMMENT_REPLY_BATCH_MAX
            )
          )
          .offset(Math.max(Math.trunc(options?.offset ?? 0), 0))
      : await selectCommentRows()
          .where(
            and(
              eq(videoComments.videoId, videoId),
              isNull(videoComments.parentId)
            )
          )
          .orderBy(desc(videoComments.createdAt))
          .limit(COMMENT_ROOT_LIMIT);

  // Merged multi-reaction view: comment_reactions ∪ legacy comment_likes for "like".
  // Read-only — no legacy rows are rewritten here.
  const commentIds = rows.map(row => row.comment.id);
  const [reactionRows, legacyLikeRows] = commentIds.length
    ? await Promise.all([
        db
          .select({
            commentId: commentReactions.commentId,
            userId: commentReactions.userId,
            reaction: commentReactions.reaction,
          })
          .from(commentReactions)
          .where(inArray(commentReactions.commentId, commentIds)),
        db
          .select({
            commentId: commentLikes.commentId,
            userId: commentLikes.userId,
          })
          .from(commentLikes)
          .where(inArray(commentLikes.commentId, commentIds)),
      ])
    : [[], []] as const;

  const typedByComment = new Map<number, Map<string, Set<number>>>();
  for (const row of reactionRows) {
    let byType = typedByComment.get(row.commentId);
    if (!byType) {
      byType = new Map();
      typedByComment.set(row.commentId, byType);
    }
    let userIds = byType.get(row.reaction);
    if (!userIds) {
      userIds = new Set();
      byType.set(row.reaction, userIds);
    }
    userIds.add(row.userId);
  }
  const legacyLikersByComment = new Map<number, Set<number>>();
  for (const row of legacyLikeRows) {
    let userIds = legacyLikersByComment.get(row.commentId);
    if (!userIds) {
      userIds = new Set();
      legacyLikersByComment.set(row.commentId, userIds);
    }
    userIds.add(row.userId);
  }

  return rows.map(row => {
    const typed = typedByComment.get(row.comment.id);
    const legacyLikers = legacyLikersByComment.get(row.comment.id);
    const reactions: Array<{
      reaction: ReactionType;
      count: number;
      reactedByMe: boolean;
    }> = [];
    for (const type of REACTION_TYPES) {
      const userIds = new Set(typed?.get(type));
      if (type === "like" && legacyLikers) {
        for (const id of legacyLikers) userIds.add(id);
      }
      if (userIds.size === 0) continue;
      reactions.push({
        reaction: type,
        count: userIds.size,
        reactedByMe: viewerId != null && userIds.has(viewerId),
      });
    }
    return {
      ...row.comment,
      body: typeof row.comment.body === "string" ? row.comment.body : "",
      audioUrl: typeof row.comment.audioUrl === "string" && row.comment.audioUrl.trim()
        ? row.comment.audioUrl
        : null,
      audioDuration: Number.isFinite(Number(row.comment.audioDuration))
        ? Math.max(1, Math.min(60, Math.round(Number(row.comment.audioDuration))))
        : null,
      likeCount: Number(row.likeCount ?? 0),
      viewerLiked: Boolean(row.viewerLiked),
      replyCount: Number(row.replyCount ?? 0),
      reactions,
      author: {
        id: row.user.id,
        name: row.user.name,
        username: row.profile?.username ?? null,
      },
    };
  });
}

export async function createVideoComment(
  videoId: number,
  userId: number,
  body: string,
  audio?: {
    audioUrl?: string | null;
    audioDuration?: number | null;
    parentId?: number | null;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if (audio?.parentId != null) {
    const [parent] = await db
      .select({ id: videoComments.id })
      .from(videoComments)
      .where(
        and(eq(videoComments.id, audio.parentId), eq(videoComments.videoId, videoId))
      )
      .limit(1);
    if (!parent) throw new Error("The comment you are replying to was not found.");
  }

  const trimmedBody = body.trim() || null;

  const [comment] = await db.transaction(async (tx) => {
    const [newComment] = await tx
      .insert(videoComments)
      .values({
        videoId,
        userId,
        body: trimmedBody,
        audioUrl: audio?.audioUrl ?? null,
        audioDuration: audio?.audioDuration ?? null,
        parentId: audio?.parentId ?? null,
      })
      .returning();

    // Sync hashtags from comment body
    const commentTags = extractTextHashtags(trimmedBody);
    await syncVideoCommentHashtags(tx, newComment.id, commentTags);

    return [newComment];
  });

  return comment;
}

/**
 * Toggle the legacy like on a video comment (comment_likes only).
 *
 * Same toggle semantics, return shape and errors as before — but the mutation
 * now runs inside a transaction that locks the comment row FOR UPDATE. The
 * legacy like shares comment_likes with the typed reaction path, so without
 * that lock a concurrent `toggleCommentReaction` could clear the like and have
 * a racing legacy toggle re-insert it, leaving a user with two reaction types.
 * Lock order matches `toggleCommentReaction`: comment → comment_likes.
 */
export async function toggleCommentLike(commentId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [comment] = await tx
      .select({ id: videoComments.id })
      .from(videoComments)
      .where(eq(videoComments.id, commentId))
      .for("update")
      .limit(1);
    if (!comment) throw new Error("Comment not found.");

    const [existing] = await tx
      .select({ id: commentLikes.id })
      .from(commentLikes)
      .where(
        and(
          eq(commentLikes.commentId, commentId),
          eq(commentLikes.userId, userId)
        )
      )
      .limit(1);
    if (existing)
      await tx.delete(commentLikes).where(eq(commentLikes.id, existing.id));
    else await tx.insert(commentLikes).values({ commentId, userId });

    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(commentLikes)
      .where(eq(commentLikes.commentId, commentId));

    return {
      commentId,
      likeCount: Number(count ?? 0),
      viewerLiked: !existing,
    };
  });
}

export type CommentReactionToggleResult = {
  commentId: number;
  reaction: ReactionType;
  active: boolean;
};

/**
 * Toggle a multi-reaction on a video comment (replies included).
 *
 * One reaction per (comment, user): activating X first clears every source the
 * user holds on that comment (all comment_reactions rows + the legacy
 * comment_likes row), then inserts X — so a user can never hold two types at
 * once, including rows written before this invariant existed. Deactivating
 * removes only the tapped type (typed row, plus the legacy like when the type
 * is "like"). Legacy comment_likes keeps its exact read semantics: it counts
 * as an active "like", feeds `likeCount`/`viewerLiked`, and is never migrated
 * or duplicated.
 *
 * Concurrency: the comment row is locked FOR UPDATE inside the transaction.
 * All reaction writes for a comment funnel through that row, so the
 * read-modify-write below is serialized — the unique index alone cannot stop
 * two different types racing (it only guards (commentId, userId, reaction)).
 * Lock order is always comment → reaction rows, matching the rest of the file.
 */
export async function toggleCommentReaction(
  commentId: number,
  userId: number,
  reaction: string
): Promise<CommentReactionToggleResult> {
  if (!isValidReaction(reaction)) {
    throw new Error("Invalid reaction type.");
  }
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [comment] = await tx
      .select({ id: videoComments.id })
      .from(videoComments)
      .where(eq(videoComments.id, commentId))
      .for("update")
      .limit(1);
    if (!comment) throw new Error("Comment not found.");

    // Every typed reaction this user holds on this comment (all types).
    const existingRows = await tx
      .select({ id: commentReactions.id, reaction: commentReactions.reaction })
      .from(commentReactions)
      .where(
        and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.userId, userId)
        )
      );

    // Legacy like counts as an active "like" — read only when the tapped
    // type is "like", so other types keep their historical query shape.
    let legacyLike: { id: number } | undefined;
    if (reaction === "like") {
      [legacyLike] = await tx
        .select({ id: commentLikes.id })
        .from(commentLikes)
        .where(
          and(
            eq(commentLikes.commentId, commentId),
            eq(commentLikes.userId, userId)
          )
        )
        .limit(1);
    }

    const matchingTyped = existingRows.filter(row => row.reaction === reaction);
    const active = matchingTyped.length > 0 || Boolean(legacyLike);

    if (active) {
      if (matchingTyped.length > 0) {
        await tx
          .delete(commentReactions)
          .where(
            and(
              eq(commentReactions.commentId, commentId),
              eq(commentReactions.userId, userId),
              eq(commentReactions.reaction, reaction)
            )
          );
      }
      if (legacyLike) {
        await tx.delete(commentLikes).where(eq(commentLikes.id, legacyLike.id));
      }
      return { commentId, reaction: reaction as ReactionType, active: false };
    }

    // Activating: clear every source first so exactly one type survives.
    if (existingRows.length > 0) {
      await tx
        .delete(commentReactions)
        .where(
          and(
            eq(commentReactions.commentId, commentId),
            eq(commentReactions.userId, userId)
          )
        );
    }
    if (reaction !== "like") {
      // A legacy like must not survive a switch to another type. Not selected
      // above (reaction !== "like"), so clear it by predicate — a no-op when
      // the user has no legacy row.
      await tx
        .delete(commentLikes)
        .where(
          and(
            eq(commentLikes.commentId, commentId),
            eq(commentLikes.userId, userId)
          )
        );
    }

    const [inserted] = await tx
      .insert(commentReactions)
      .values({ commentId, userId, reaction })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      return { commentId, reaction: reaction as ReactionType, active: true };
    }

    // Concurrent identical activation won the unique race — reaction is active.
    const [confirmed] = await tx
      .select({ id: commentReactions.id })
      .from(commentReactions)
      .where(
        and(
          eq(commentReactions.commentId, commentId),
          eq(commentReactions.userId, userId),
          eq(commentReactions.reaction, reaction)
        )
      )
      .limit(1);
    if (confirmed) {
      return { commentId, reaction: reaction as ReactionType, active: true };
    }
    throw new Error("Failed to toggle reaction.");
  });
}

/**
 * Toggle the viewer's reaction on a video.
 *
 * One reaction per (video, user), enforced by video_reactions_pair_unique.
 * Omitting `reaction` preserves the historical binary behavior: every
 * pre-existing row resolves to "like" (column default), so an omitted call
 * removes an active reaction and otherwise inserts one. Passing a type equal
 * to the stored one removes it; passing a different type replaces the row in
 * place (id/createdAt preserved). Unknown types are rejected.
 *
 * Concurrency: the video row is locked FOR UPDATE inside the transaction, so
 * the read-modify-write below is serialized — the pair-unique index alone
 * cannot arbitrate two racing replaces on the same (video, user) pair.
 * Lock order is always video → reaction rows, matching the rest of the file.
 */
export async function toggleVideoReaction(
  videoId: number,
  userId: number,
  reaction: ReactionType = "like"
) {
  if (!isValidReaction(reaction)) throw new Error("Invalid reaction type.");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  await db.transaction(async tx => {
    const [video] = await tx
      .select({ id: videos.id })
      .from(videos)
      .where(eq(videos.id, videoId))
      .for("update")
      .limit(1);
    if (!video) throw new Error("Video not found.");

    const [existing] = await tx
      .select({ id: videoReactions.id, reaction: videoReactions.reaction })
      .from(videoReactions)
      .where(
        and(
          eq(videoReactions.videoId, videoId),
          eq(videoReactions.userId, userId)
        )
      )
      .limit(1);

    if (!existing) {
      await tx.insert(videoReactions).values({ videoId, userId, reaction });
      return;
    }
    if (existing.reaction === reaction) {
      await tx.delete(videoReactions).where(eq(videoReactions.id, existing.id));
      return;
    }
    await tx
      .update(videoReactions)
      .set({ reaction })
      .where(eq(videoReactions.id, existing.id));
  });

  return getVideoEngagement(videoId, userId);
}

export async function recordVideoShare(videoId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(videoShares)
    .values({ videoId, userId })
    .onConflictDoNothing({ target: [videoShares.videoId, videoShares.userId] });
  return getVideoEngagement(videoId, userId);
}

export async function toggleVideoBookmark(videoId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = await db
    .select({ id: videoBookmarks.id })
    .from(videoBookmarks)
    .where(
      and(
        eq(videoBookmarks.videoId, videoId),
        eq(videoBookmarks.userId, userId)
      )
    )
    .limit(1);
  if (existing[0]) {
    await db.delete(videoBookmarks).where(eq(videoBookmarks.id, existing[0].id));
  } else {
    await db.insert(videoBookmarks).values({ videoId, userId });
  }
  return getVideoEngagement(videoId, userId);
}

export async function listBookmarkedVideos(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const ids = await db
    .select({ videoId: videoBookmarks.videoId })
    .from(videoBookmarks)
    .where(eq(videoBookmarks.userId, userId))
    .orderBy(desc(videoBookmarks.createdAt));
  if (!ids.length) return [];
  return selectVideos(
    [inArray(videos.id, ids.map(item => item.videoId))],
    userId,
    "recent"
  );
}

export async function toggleFollow(followerId: number, followedId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if (followerId === followedId) throw new Error("You cannot follow yourself.");
  const existing = await db
    .select({ id: follows.id })
    .from(follows)
    .where(
      and(eq(follows.followerId, followerId), eq(follows.followedId, followedId))
    )
    .limit(1);
  if (existing[0]) {
    await db.delete(follows).where(eq(follows.id, existing[0].id));
  } else {
    await db.insert(follows).values({ followerId, followedId });
  }
  const [state] = await db
    .select({ following: sql<boolean>`exists (select 1 from follows where "followerId" = ${followerId} and "followedId" = ${followedId})` })
    .from(users)
    .where(eq(users.id, followedId));
  return { following: Boolean(state?.following) };
}

export async function getFollowState(followerId: number, followedId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [state] = await db
    .select({ following: sql<boolean>`exists (select 1 from follows where "followerId" = ${followerId} and "followedId" = ${followedId})` })
    .from(users)
    .where(eq(users.id, followedId));
  return { following: Boolean(state?.following) };
}

/** One row of a profile's follower / following list. */
export type FollowListEntry = {
  userId: number;
  name: string | null;
  username: string | null;
  photoUrl: string | null;
  /** Viewer already follows this account. */
  isFollowing: boolean;
  /** This account follows the viewer (drives "follow back"). */
  isFollowedBy: boolean;
};

/** Hard cap per request; callers page with offset in 50-row batches. */
const FOLLOW_LIST_LIMIT = 200;
/** Backend default batch when the caller does not ask for one. */
export const FOLLOW_LIST_PAGE_SIZE = 50;

export type FollowListPageOptions = {
  /** Rows to return (clamped to 1..FOLLOW_LIST_LIMIT, default 50). */
  limit?: number;
  /** Rows to skip — real backend paging, never a client-side slice. */
  offset?: number;
};

async function listFollowEdges(
  direction: "followers" | "following",
  profileUserId: number,
  viewerId?: number,
  options?: FollowListPageOptions
): Promise<FollowListEntry[]> {
  const db = await getDb();
  if (!db) return [];
  if (!Number.isInteger(profileUserId) || profileUserId < 1) return [];
  const edge =
    direction === "followers" ? follows.followedId : follows.followerId;
  const counterparty =
    direction === "followers" ? follows.followerId : follows.followedId;
  const hasViewer =
    typeof viewerId === "number" && Number.isInteger(viewerId) && viewerId > 0;
  const viewerFollowing = hasViewer
    ? sql<boolean>`exists (select 1 from follows where follows."followerId" = ${viewerId} and follows."followedId" = users.id)`
    : sql<boolean>`false`;
  const followedByViewer = hasViewer
    ? sql<boolean>`exists (select 1 from follows where follows."followerId" = users.id and follows."followedId" = ${viewerId})`
    : sql<boolean>`false`;

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      username: profiles.username,
      photoUrl: profiles.photoUrl,
      isFollowing: viewerFollowing,
      isFollowedBy: followedByViewer,
      createdAt: follows.createdAt,
    })
    .from(follows)
    .innerJoin(users, eq(counterparty, users.id))
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(edge, profileUserId))
    .orderBy(desc(follows.createdAt), desc(follows.id))
    .limit(
      Math.min(
        Math.max(Math.trunc(options?.limit ?? FOLLOW_LIST_PAGE_SIZE), 1),
        FOLLOW_LIST_LIMIT
      )
    )
    .offset(Math.max(Math.trunc(options?.offset ?? 0), 0));

  return rows.map(row => ({
    userId: row.userId,
    name: row.name,
    username: row.username,
    photoUrl: row.photoUrl,
    isFollowing: Boolean(row.isFollowing),
    isFollowedBy: Boolean(row.isFollowedBy),
  }));
}

/** Accounts following this profile, newest first (viewer-aware, paged). */
export async function listFollowers(
  profileUserId: number,
  viewerId?: number,
  options?: FollowListPageOptions
) {
  return listFollowEdges("followers", profileUserId, viewerId, options);
}

/** Accounts this profile follows, newest first (viewer-aware, paged). */
export async function listFollowing(
  profileUserId: number,
  viewerId?: number,
  options?: FollowListPageOptions
) {
  return listFollowEdges("following", profileUserId, viewerId, options);
}

/** M3 — reactor identity pages shared by all four reaction surfaces. */

export const REACTOR_PAGE_DEFAULT_LIMIT = 50;
export const REACTOR_PAGE_MAX_LIMIT = 50;

type ProfileAccountType = (typeof profileAccountType.enumValues)[number];

export type ReactorListOptions = {
  /** Rows to return (clamped to 1..REACTOR_PAGE_MAX_LIMIT, default 50). */
  limit?: number;
  /** Rows to skip — backend paging, never a client-side slice. */
  offset?: number;
  /** Authenticated viewer for viewerReactions (anonymous when absent/null). */
  viewerId?: number | null;
};

/**
 * Safe public projection of one reactor — never the raw users row
 * (no email, openId, role, or other auth columns).
 */
export type ReactorEntry = {
  userId: number;
  name: string | null;
  username: string | null;
  photoUrl: string | null;
  accountType: ProfileAccountType;
  isVerified: boolean;
  /** Distinct active types for this user, in REACTION_TYPES order. */
  reactions: ReactionType[];
};

export type ReactorListPage = {
  reactors: ReactorEntry[];
  hasMore: boolean;
  offset: number;
  limit: number;
  /** The viewer's own types on this target ([] when anonymous). */
  viewerReactions: ReactionType[];
};

/** Vocabulary-ordered distinct types; unknown stored values are ignored. */
function toReactionTypes(values: readonly string[]): ReactionType[] {
  const present = new Set(values);
  return REACTION_TYPES.filter(type => present.has(type));
}

/**
 * One grouped page of reactor identities for a single target.
 *
 * `makeSource` must return a target-scoped subquery aliased exactly
 * `reactor_source` with columns ("userId", "reaction", "createdAt").
 * Two queries run per call (none when there is nothing to load): the
 * grouped page — users inner-joined and profile left-joined onto the
 * source, ordered by MAX(createdAt) DESC then userId DESC (deterministic,
 * and MAX not MIN so a user's latest reaction row sets their position) —
 * plus one batched type lookup covering the page's users and the viewer.
 * Cost is constant regardless of reactor count: no N+1.
 */
async function loadReactorPage(
  makeSource: () => SQL,
  options?: ReactorListOptions
): Promise<ReactorListPage> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const limit = Math.min(
    Math.max(Math.trunc(options?.limit ?? REACTOR_PAGE_DEFAULT_LIMIT), 1),
    REACTOR_PAGE_MAX_LIMIT
  );
  const offset = Math.max(Math.trunc(options?.offset ?? 0), 0);
  const viewerId =
    typeof options?.viewerId === "number" &&
    Number.isInteger(options.viewerId) &&
    options.viewerId > 0
      ? options.viewerId
      : null;

  const pageRows = await db
    .select({
      userId: users.id,
      name: users.name,
      username: profiles.username,
      photoUrl: profiles.photoUrl,
      accountType: profiles.accountType,
      isVerified: profiles.isVerified,
    })
    .from(makeSource())
    .innerJoin(users, sql`reactor_source."userId" = ${users.id}`)
    .leftJoin(profiles, sql`${profiles.userId} = ${users.id}`)
    .groupBy(users.id, profiles.id)
    .orderBy(desc(sql`max(reactor_source."createdAt")`), desc(users.id))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = pageRows.length > limit;
  const page = hasMore ? pageRows.slice(0, limit) : pageRows;

  const typeUserIds = page.map(row => row.userId);
  if (viewerId !== null && !typeUserIds.includes(viewerId)) {
    typeUserIds.push(viewerId);
  }

  const reactionsByUser = new Map<number, string[]>();
  if (typeUserIds.length > 0) {
    const typeRows = await db
      .select({
        userId: sql<number>`reactor_source."userId"`,
        reaction: sql<string>`reactor_source."reaction"`,
      })
      .from(makeSource())
      .where(inArray(sql`reactor_source."userId"`, typeUserIds));
    for (const row of typeRows) {
      const list = reactionsByUser.get(row.userId);
      if (list) list.push(row.reaction);
      else reactionsByUser.set(row.userId, [row.reaction]);
    }
  }

  const reactors: ReactorEntry[] = page.map(row => ({
    userId: row.userId,
    name: row.name ?? null,
    username: row.username ?? null,
    photoUrl: row.photoUrl ?? null,
    accountType: row.accountType ?? "member",
    isVerified: Boolean(row.isVerified),
    reactions: toReactionTypes(reactionsByUser.get(row.userId) ?? []),
  }));

  return {
    reactors,
    hasMore,
    offset,
    limit,
    viewerReactions:
      viewerId !== null
        ? toReactionTypes(reactionsByUser.get(viewerId) ?? [])
        : [],
  };
}

/** Reactors on a video (public read; missing target → "Video not found."). */
export async function listVideoReactors(
  videoId: number,
  options?: ReactorListOptions
): Promise<ReactorListPage> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [video] = await db
    .select({ id: videos.id })
    .from(videos)
    .where(eq(videos.id, videoId))
    .limit(1);
  if (!video) throw new Error("Video not found.");
  return loadReactorPage(
    () =>
      sql`(select "userId", "reaction", "createdAt" from "video_reactions" where "videoId" = ${videoId}) as "reactor_source"`,
    options
  );
}

/**
 * Reactors on a video comment (public read; missing target →
 * "Comment not found."). Legacy `comment_likes` rows are unioned in as
 * type "like" so the list matches the count semantics of
 * listVideoComments — read-only, legacy data is never modified.
 */
export async function listCommentReactors(
  commentId: number,
  options?: ReactorListOptions
): Promise<ReactorListPage> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [comment] = await db
    .select({ id: videoComments.id })
    .from(videoComments)
    .where(eq(videoComments.id, commentId))
    .limit(1);
  if (!comment) throw new Error("Comment not found.");
  return loadReactorPage(
    () =>
      sql`(select "userId", "reaction", "createdAt" from "comment_reactions" where "commentId" = ${commentId} union all select "userId", 'like' as "reaction", "createdAt" from "comment_likes" where "commentId" = ${commentId}) as "reactor_source"`,
    options
  );
}

/**
 * Reactors on a community announcement (public read; missing target →
 * "Community announcement not found.").
 */
export async function listCommunityReactors(
  announcementId: number,
  options?: ReactorListOptions
): Promise<ReactorListPage> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [announcement] = await db
    .select({ id: communityAnnouncements.id })
    .from(communityAnnouncements)
    .where(eq(communityAnnouncements.id, announcementId))
    .limit(1);
  if (!announcement) throw new Error("Community announcement not found.");
  return loadReactorPage(
    () =>
      sql`(select "userId", "reaction", "createdAt" from "community_reactions" where "announcementId" = ${announcementId}) as "reactor_source"`,
    options
  );
}

/**
 * Reactors on a Hype Room message (public read semantics of
 * listRoomMessages: room existence only, no membership gate). Hidden or
 * missing messages and cross-room bindings reuse the exact write-path
 * errors so moderated content never leaks reaction data.
 */
export async function listHypeRoomMessageReactors(
  roomId: number,
  messageId: number,
  options?: ReactorListOptions
): Promise<ReactorListPage> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select({
      roomExists: hypeRooms.id,
      messageId: hypeRoomMessages.id,
      messageRoomId: hypeRoomMessages.roomId,
      messageHiddenAt: hypeRoomMessages.hiddenAt,
    })
    .from(hypeRooms)
    .leftJoin(hypeRoomMessages, eq(hypeRoomMessages.id, messageId))
    .where(eq(hypeRooms.id, roomId))
    .limit(1);
  if (!row) throw new Error("Room not found.");
  if (row.messageId == null || row.messageHiddenAt != null) {
    throw new Error("Message not found.");
  }
  if (row.messageRoomId !== roomId) {
    throw new Error("Message does not belong to this room.");
  }
  return loadReactorPage(
    () =>
      sql`(select "userId", "reaction", "createdAt" from "hype_room_message_reactions" where "messageId" = ${messageId}) as "reactor_source"`,
    options
  );
}

export async function listSponsorBidsSessions() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const now = new Date();
    const active = await tx
      .select()
      .from(sponsorBidsSessions)
      .where(inArray(sponsorBidsSessions.status, ["scheduled", "live"]))
      .orderBy(
        asc(sponsorBidsSessions.startsAt),
        desc(sponsorBidsSessions.createdAt)
      );
    if (active.length) return active;

    const [showcase] = await tx
      .select()
      .from(sponsorBidsSessions)
      .where(eq(sponsorBidsSessions.status, "completed"))
      .orderBy(
        desc(sponsorBidsSessions.endsAt),
        desc(sponsorBidsSessions.createdAt)
      )
      .limit(1);
    if (showcase?.endsAt && showcase.endsAt > now) return [showcase];

    if (!showcase || !showcase.endsAt || showcase.endsAt <= now) {
      const startsAt = new Date(now.getTime() + SPONSORBIDS_ENTRY_WINDOW_MS);
      const [nextSession] = await tx
        .insert(sponsorBidsSessions)
        .values({
          title: "TimeWheels",
          status: "scheduled",
          startsAt,
          endsAt: new Date(startsAt.getTime() + SPONSORBIDS_SHOWCASE_MS),
        })
        .returning();
      return nextSession ? [nextSession] : [];
    }
    return [];
  });
}

export async function getSponsorBidsSession(sessionId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [session] = await db
    .select()
    .from(sponsorBidsSessions)
    .where(eq(sponsorBidsSessions.id, sessionId))
    .limit(1);
  return session;
}

export const SPONSORBIDS_ENTRY_FEE_TAKA = "100.00";
export const SPONSORBIDS_ENTRY_WINDOW_MS = 60 * 60 * 1000;

export async function joinSponsorBidsSession(
  sessionId: number,
  userId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(sponsorBidsSessions)
      .where(eq(sponsorBidsSessions.id, sessionId))
      .limit(1);
    if (!session) throw new Error("SponsorBids session not found.");
    if (session.status !== "scheduled")
      throw new Error(
        "This SponsorBids session is no longer accepting entries."
      );
    if (!session.startsAt)
      throw new Error("This SponsorBids session has no scheduled start time.");
    const now = Date.now();
    const spinAt = session.startsAt.getTime();
    const entryOpensAt = spinAt - SPONSORBIDS_ENTRY_WINDOW_MS;
    if (now < entryOpensAt)
      throw new Error("The SponsorBids entry window has not opened yet.");
    if (now >= spinAt)
      throw new Error("The SponsorBids entry window has closed.");

    const [existingCharge] = await tx
      .select({ participantId: walletTransactions.participantId })
      .from(walletTransactions)
      .where(
        and(
          eq(walletTransactions.userId, userId),
          eq(walletTransactions.sessionId, sessionId),
          eq(walletTransactions.type, "sponsor_bids_entry")
        )
      )
      .limit(1);
    if (existingCharge?.participantId) {
      const [existingParticipant] = await tx
        .select()
        .from(participants)
        .where(eq(participants.id, existingCharge.participantId))
        .limit(1);
      return existingParticipant;
    }

    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.userId, userId))
      .for("update")
      .limit(1);
    if (!wallet) throw new Error("Wallet not found.");
    if (Number(wallet.balance) < Number(SPONSORBIDS_ENTRY_FEE_TAKA))
      throw new Error(
        "Insufficient wallet balance. You need 100 Taka to join."
      );

    const [participant] = await tx
      .insert(participants)
      .values({ sessionId, userId })
      .onConflictDoNothing({
        target: [participants.sessionId, participants.userId],
      })
      .returning();
    const enrolledParticipant =
      participant ??
      (
        await tx
          .select()
          .from(participants)
          .where(
            and(
              eq(participants.sessionId, sessionId),
              eq(participants.userId, userId)
            )
          )
          .limit(1)
      )[0];
    if (!enrolledParticipant)
      throw new Error("Could not enroll in the session.");

    const [updatedWallet] = await tx
      .update(wallets)
      .set({
        balance: sql`${wallets.balance} - ${SPONSORBIDS_ENTRY_FEE_TAKA}`,
        updatedAt: new Date(),
      })
      .where(eq(wallets.id, wallet.id))
      .returning({ balance: wallets.balance });
    await tx.insert(walletTransactions).values({
      walletId: wallet.id,
      userId,
      sessionId,
      participantId: enrolledParticipant.id,
      type: "sponsor_bids_entry",
      referenceKey: `sponsor-bids-entry:${sessionId}:${userId}`,
      amount: `-${SPONSORBIDS_ENTRY_FEE_TAKA}`,
    });
    return {
      participant: enrolledParticipant,
      walletBalance: updatedWallet.balance,
    };
  });
}

export async function getWalletBalance(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [wallet] = await db
    .select({ balance: wallets.balance })
    .from(wallets)
    .where(eq(wallets.userId, userId))
    .limit(1);
  return wallet?.balance ?? "0.00";
}

export const SPONSORBIDS_SPONSOR_DISPLAY_MS = 10 * 60 * 1000;

export async function createLiveSponsor(input: {
  sessionId: number;
  userId: number;
  logoUrl: string;
  externalLink: string;
  sponsoredAmount: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(sponsorBidsSessions)
      .where(eq(sponsorBidsSessions.id, input.sessionId))
      .limit(1);
    if (!session) throw new Error("SponsorBids session not found.");
    if (!["scheduled", "live"].includes(session.status))
      throw new Error("This wheel is not accepting sponsorships.");
    if (session.startsAt && Date.now() >= session.startsAt.getTime())
      throw new Error("Sponsorships close when the wheel starts spinning.");
    if (Number(input.sponsoredAmount) <= 0)
      throw new Error("Sponsorship amount must be greater than zero.");

    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.userId, input.userId))
      .for("update")
      .limit(1);
    if (!wallet) throw new Error("Wallet not found.");
    if (Number(wallet.balance) < Number(input.sponsoredAmount))
      throw new Error("Insufficient wallet balance for this sponsorship.");

    const [sponsor] = await tx
      .insert(liveSponsors)
      .values({
        sessionId: input.sessionId,
        userId: input.userId,
        logoUrl: input.logoUrl,
        externalLink: input.externalLink,
        sponsoredAmount: input.sponsoredAmount,
        status: "pending",
        expiresAt: new Date(Date.now() + SPONSORBIDS_SPONSOR_DISPLAY_MS),
      })
      .returning();
    const [updatedWallet] = await tx
      .update(wallets)
      .set({
        balance: sql`${wallets.balance} - ${input.sponsoredAmount}`,
        updatedAt: new Date(),
      })
      .where(eq(wallets.id, wallet.id))
      .returning({ balance: wallets.balance });
    await tx.insert(walletTransactions).values({
      walletId: wallet.id,
      userId: input.userId,
      sessionId: input.sessionId,
      participantId: null,
      type: "sponsor_payment",
      referenceKey: `sponsor-payment:${input.sessionId}:${input.userId}:${sponsor.id}`,
      amount: `-${input.sponsoredAmount}`,
    });
    return { sponsor, walletBalance: updatedWallet.balance };
  });
}

export async function listLiveSponsors(sessionId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select()
    .from(liveSponsors)
    .where(
      and(
        eq(liveSponsors.sessionId, sessionId),
        eq(liveSponsors.status, "approved"),
        gt(liveSponsors.expiresAt, new Date())
      )
    )
    .orderBy(desc(liveSponsors.sponsoredAt));
}

export const SPONSORBIDS_PRIZES = {
  1: "7000.00",
  2: "5000.00",
  3: "2000.00",
} as const;
export const SPONSORBIDS_SPIN_OFFSETS_MS = {
  3: 0,
  2: 2 * 60 * 1000,
  1: 4 * 60 * 1000,
} as const;
export const SPONSORBIDS_SPIN_DURATION_MS = 20 * 1000;
export const SPONSORBIDS_SHOWCASE_MS = 24 * 60 * 60 * 1000;

async function advanceSponsorBidsSession(sessionId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const [session] = await tx
      .select()
      .from(sponsorBidsSessions)
      .where(eq(sponsorBidsSessions.id, sessionId))
      .for("update")
      .limit(1);
    if (!session?.startsAt) return session;
    const elapsed = Date.now() - session.startsAt.getTime();
    if (elapsed < 0) return session;

    for (const rank of [3, 2, 1] as const) {
      const spinStartsAt = SPONSORBIDS_SPIN_OFFSETS_MS[rank];
      if (elapsed < spinStartsAt) continue;
      const [alreadyAwarded] = await tx
        .select({ id: sessionWinners.id })
        .from(sessionWinners)
        .where(
          and(
            eq(sessionWinners.sessionId, sessionId),
            eq(sessionWinners.rank, rank)
          )
        )
        .limit(1);
      if (alreadyAwarded) continue;

      const [existingDraw] = await tx
        .select()
        .from(sponsorBidsDraws)
        .where(
          and(
            eq(sponsorBidsDraws.sessionId, sessionId),
            eq(sponsorBidsDraws.rank, rank)
          )
        )
        .limit(1);
      let draw = existingDraw;
      if (!draw) {
        const awardedParticipants = await tx
          .select({ participantId: sessionWinners.participantId })
          .from(sessionWinners)
          .where(eq(sessionWinners.sessionId, sessionId));
        const awardedIds = new Set(
          awardedParticipants.map(row => row.participantId)
        );
        const eligible = await tx
          .select()
          .from(participants)
          .where(eq(participants.sessionId, sessionId));
        const nominees = selectNomineeIds(
          sessionId,
          rank,
          eligible,
          awardedIds
        );
        [draw] = await tx
          .insert(sponsorBidsDraws)
          .values({ sessionId, rank, nomineeParticipantIds: nominees })
          .onConflictDoNothing({
            target: [sponsorBidsDraws.sessionId, sponsorBidsDraws.rank],
          })
          .returning();
        if (!draw) {
          [draw] = await tx
            .select()
            .from(sponsorBidsDraws)
            .where(
              and(
                eq(sponsorBidsDraws.sessionId, sessionId),
                eq(sponsorBidsDraws.rank, rank)
              )
            )
            .limit(1);
        }
      }
      if (
        !draw ||
        elapsed < spinStartsAt + SPONSORBIDS_SPIN_DURATION_MS ||
        draw.selectedParticipantId ||
        !draw.nomineeParticipantIds.length
      )
        continue;

      const nomineeIds = draw.nomineeParticipantIds;
      const selectedParticipantId = selectSecondaryWinnerId(
        sessionId,
        rank,
        nomineeIds
      );
      if (selectedParticipantId === undefined) continue;
      const [selected] = await tx
        .select()
        .from(participants)
        .where(
          and(
            eq(participants.id, selectedParticipantId),
            eq(participants.sessionId, sessionId)
          )
        )
        .limit(1);
      if (!selected) continue;
      const [updatedDraw] = await tx
        .update(sponsorBidsDraws)
        .set({ selectedParticipantId: selected.id, selectedAt: new Date() })
        .where(
          and(
            eq(sponsorBidsDraws.id, draw.id),
            sql`${sponsorBidsDraws.selectedParticipantId} IS NULL`
          )
        )
        .returning();
      if (!updatedDraw) continue;

      await tx
        .insert(sessionWinners)
        .values({
          sessionId,
          participantId: selected.id,
          rank,
          prizeAmount: SPONSORBIDS_PRIZES[rank],
        });
      const [wallet] = await tx
        .insert(wallets)
        .values({ userId: selected.userId, balance: "0.00" })
        .onConflictDoNothing({ target: wallets.userId })
        .returning();
      const [winnerWallet] = wallet
        ? [wallet]
        : await tx
            .select()
            .from(wallets)
            .where(eq(wallets.userId, selected.userId))
            .for("update")
            .limit(1);
      if (!winnerWallet) throw new Error("Winner wallet could not be created.");
      await tx
        .update(wallets)
        .set({
          balance: sql`${wallets.balance} + ${SPONSORBIDS_PRIZES[rank]}`,
          updatedAt: new Date(),
        })
        .where(eq(wallets.id, winnerWallet.id));
      await tx
        .insert(walletTransactions)
        .values({
          walletId: winnerWallet.id,
          userId: selected.userId,
          sessionId,
          participantId: selected.id,
          type: "sponsor_bids_prize",
          referenceKey: `sponsor-bids-prize:${sessionId}:${rank}`,
          amount: SPONSORBIDS_PRIZES[rank],
        });
    }

    if (
      elapsed >=
        SPONSORBIDS_SPIN_OFFSETS_MS[1] + SPONSORBIDS_SPIN_DURATION_MS &&
      session.status !== "completed"
    ) {
      await tx
        .update(sponsorBidsSessions)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(sponsorBidsSessions.id, sessionId));
    } else if (session.status !== "live") {
      await tx
        .update(sponsorBidsSessions)
        .set({ status: "live", updatedAt: new Date() })
        .where(eq(sponsorBidsSessions.id, sessionId));
    }
    const [updated] = await tx
      .select()
      .from(sponsorBidsSessions)
      .where(eq(sponsorBidsSessions.id, sessionId))
      .limit(1);
    return updated;
  });
}

export async function getSponsorBidsState(sessionId: number) {
  await advanceSponsorBidsSession(sessionId);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [session] = await db
    .select()
    .from(sponsorBidsSessions)
    .where(eq(sponsorBidsSessions.id, sessionId))
    .limit(1);
  if (!session) return undefined;
  const draws = await db
    .select()
    .from(sponsorBidsDraws)
    .where(eq(sponsorBidsDraws.sessionId, sessionId))
    .orderBy(sponsorBidsDraws.rank);
  const winners = await db
    .select({
      winner: sessionWinners,
      participant: participants,
      user: users,
      profile: profiles,
    })
    .from(sessionWinners)
    .innerJoin(participants, eq(sessionWinners.participantId, participants.id))
    .innerJoin(users, eq(participants.userId, users.id))
    .leftJoin(profiles, eq(users.id, profiles.userId))
    .where(eq(sessionWinners.sessionId, sessionId))
    .orderBy(sessionWinners.rank);
  const sponsors = await listLiveSponsors(sessionId);
  const serverNow = Date.now();
  const elapsed = session.startsAt
    ? serverNow - session.startsAt.getTime()
    : -1;
  const phase =
    elapsed < 0
      ? "entry"
      : elapsed < SPONSORBIDS_SPIN_OFFSETS_MS[2] + SPONSORBIDS_SPIN_DURATION_MS
        ? "spin-3rd"
        : elapsed < SPONSORBIDS_SPIN_OFFSETS_MS[1]
          ? "pause-after-3rd"
          : elapsed <
              SPONSORBIDS_SPIN_OFFSETS_MS[1] + SPONSORBIDS_SPIN_DURATION_MS
            ? "spin-2nd"
            : elapsed < SPONSORBIDS_SPIN_OFFSETS_MS[1] + 2 * 60 * 1000
              ? "pause-after-2nd"
              : elapsed <
                  SPONSORBIDS_SPIN_OFFSETS_MS[1] +
                    2 * 60 * 1000 +
                    SPONSORBIDS_SPIN_DURATION_MS
                ? "spin-1st"
                : elapsed < SPONSORBIDS_SHOWCASE_MS
                  ? "showcase"
                  : "showcase";
  return {
    session,
    serverNow,
    entryOpensAt: session.startsAt
      ? new Date(session.startsAt.getTime() - SPONSORBIDS_ENTRY_WINDOW_MS)
      : null,
    phase,
    draws,
    winners,
    sponsors,
  };
}

export async function listSessionWinners(sessionId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select()
    .from(sessionWinners)
    .where(eq(sessionWinners.sessionId, sessionId))
    .orderBy(desc(sessionWinners.awardedAt));
}

export async function adminListDashboard() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [sessions, walletsWithUsers, ledger, sponsors] = await Promise.all([
    db
      .select()
      .from(sponsorBidsSessions)
      .orderBy(desc(sponsorBidsSessions.createdAt)),
    db
      .select({ wallet: wallets, user: users })
      .from(wallets)
      .innerJoin(users, eq(wallets.userId, users.id))
      .orderBy(desc(wallets.updatedAt)),
    db
      .select({ transaction: walletTransactions, user: users })
      .from(walletTransactions)
      .innerJoin(users, eq(walletTransactions.userId, users.id))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(100),
    db
      .select({
        sponsor: liveSponsors,
        session: sponsorBidsSessions,
        user: users,
      })
      .from(liveSponsors)
      .innerJoin(
        sponsorBidsSessions,
        eq(liveSponsors.sessionId, sponsorBidsSessions.id)
      )
      .innerJoin(users, eq(liveSponsors.userId, users.id))
      .orderBy(desc(liveSponsors.sponsoredAt))
      .limit(100),
  ]);
  return { sessions, wallets: walletsWithUsers, ledger, sponsors };
}

export async function adminCreateSponsorBidsSession(input: {
  title: string;
  startsAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const startsAt =
    input.startsAt ?? new Date(Date.now() + SPONSORBIDS_ENTRY_WINDOW_MS);
  if (startsAt.getTime() <= Date.now())
    throw new Error("Session start must be in the future.");
  const [session] = await db
    .insert(sponsorBidsSessions)
    .values({
      title: input.title,
      status: "scheduled",
      startsAt,
      endsAt: new Date(startsAt.getTime() + SPONSORBIDS_SHOWCASE_MS),
    })
    .returning();
  return session;
}

export async function adminStartSponsorBidsSession(sessionId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [session] = await db
    .select()
    .from(sponsorBidsSessions)
    .where(eq(sponsorBidsSessions.id, sessionId))
    .limit(1);
  if (!session) throw new Error("SponsorBids session not found.");
  if (session.status === "completed" || session.status === "cancelled")
    throw new Error("This session cannot be started.");
  const startsAt = new Date(Date.now() + SPONSORBIDS_ENTRY_WINDOW_MS);
  const [updated] = await db
    .update(sponsorBidsSessions)
    .set({
      status: "scheduled",
      startsAt,
      endsAt: new Date(startsAt.getTime() + SPONSORBIDS_SHOWCASE_MS),
      updatedAt: new Date(),
    })
    .where(eq(sponsorBidsSessions.id, sessionId))
    .returning();
  return updated;
}

export async function adminSetSponsorStatus(
  sponsorId: number,
  status: "approved" | "rejected"
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [updated] = await db
    .update(liveSponsors)
    .set({ status })
    .where(eq(liveSponsors.id, sponsorId))
    .returning();
  if (!updated) throw new Error("Sponsor request not found.");
  return updated;
}

export async function listCommunityAnnouncements(
  ownerId?: number,
  viewerId?: number | null
) {
  const db = await getDb();
  if (!db) return [];
  const commentCount = sql<number>`(
    select count(*) from community_comments
    where community_comments."announcementId" = ${communityAnnouncements.id}
  )`;
  const reactionCount = sql<number>`(
    select count(*) from community_reactions
    where community_reactions."announcementId" = ${communityAnnouncements.id}
  )`;
  const viewerReacted = viewerId
    ? sql<boolean>`exists (
        select 1 from community_reactions
        where community_reactions."announcementId" = ${communityAnnouncements.id}
          and community_reactions."userId" = ${viewerId}
      )`
    : sql<boolean>`false`;
  const viewerReaction = viewerId
    ? sql<string | null>`(
        select community_reactions."reaction" from community_reactions
        where community_reactions."announcementId" = ${communityAnnouncements.id}
          and community_reactions."userId" = ${viewerId}
        limit 1
      )`
    : sql<string | null>`null`;
  const rows = await db
    .select({
      announcement: communityAnnouncements,
      user: users,
      profile: profiles,
      commentCount,
      reactionCount,
      viewerReacted,
      viewerReaction,
    })
    .from(communityAnnouncements)
    .innerJoin(users, eq(communityAnnouncements.userId, users.id))
    .leftJoin(profiles, eq(communityAnnouncements.userId, profiles.userId))
    .where(ownerId ? eq(communityAnnouncements.userId, ownerId) : undefined)
    .orderBy(desc(communityAnnouncements.createdAt))
    .limit(60);
  if (!rows.length) return [];
  const announcementIds = rows.map(row => row.announcement.id);
  const attachments = await db
    .select()
    .from(communityAnnouncementAttachments)
    .where(
      inArray(communityAnnouncementAttachments.announcementId, announcementIds)
    )
    .orderBy(communityAnnouncementAttachments.sortOrder);
  const attachmentsByAnnouncement = new Map<number, typeof attachments>();
  attachments.forEach(attachment => {
    const current =
      attachmentsByAnnouncement.get(attachment.announcementId) ?? [];
    current.push(attachment);
    attachmentsByAnnouncement.set(attachment.announcementId, current);
  });
  return rows.map(row => ({
    ...row.announcement,
    commentCount: Number(row.commentCount ?? 0),
    reactionCount: Number(row.reactionCount ?? 0),
    viewerReacted: Boolean(row.viewerReacted),
    viewerReaction: narrowReaction(row.viewerReaction),
    viewerBookmarked: false,
    author: {
      id: row.user.id,
      name: row.user.name,
      photoUrl: row.profile?.photoUrl ?? null,
      accountType: row.profile?.accountType ?? "member",
      isVerified: Boolean(row.profile?.isVerified),
    },
    attachments: attachmentsByAnnouncement.get(row.announcement.id) ?? [],
  }));
}

/**
 * Toggle the viewer's reaction on a community announcement.
 *
 * One reaction per (announcement, user), enforced by
 * community_reactions_pair_unique. Omitting `reaction` preserves the
 * historical binary behavior: every pre-existing row resolves to "like"
 * (column default), so an omitted call removes an active reaction and
 * otherwise inserts one. Passing a type equal to the stored one removes it;
 * passing a different type replaces the row in place (id/createdAt
 * preserved). Unknown types are rejected.
 *
 * Concurrency: the announcement row is locked FOR UPDATE inside the
 * transaction, so the read-modify-write below is serialized — the
 * pair-unique index alone cannot arbitrate two racing replaces on the same
 * (announcement, user) pair. Lock order is always announcement → reaction
 * rows, matching the rest of the file.
 */
export async function toggleCommunityReaction(
  announcementId: number,
  userId: number,
  reaction: ReactionType = "like"
): Promise<{ viewerReacted: boolean }> {
  if (!isValidReaction(reaction)) throw new Error("Invalid reaction type.");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  return db.transaction(async tx => {
    const [announcement] = await tx
      .select({ id: communityAnnouncements.id })
      .from(communityAnnouncements)
      .where(eq(communityAnnouncements.id, announcementId))
      .for("update")
      .limit(1);
    if (!announcement) throw new Error("Community announcement not found.");

    const [existing] = await tx
      .select({
        id: communityReactions.id,
        reaction: communityReactions.reaction,
      })
      .from(communityReactions)
      .where(
        and(
          eq(communityReactions.announcementId, announcementId),
          eq(communityReactions.userId, userId)
        )
      )
      .limit(1);

    if (!existing) {
      await tx
        .insert(communityReactions)
        .values({ announcementId, userId, reaction });
      return { viewerReacted: true };
    }
    if (existing.reaction === reaction) {
      await tx
        .delete(communityReactions)
        .where(eq(communityReactions.id, existing.id));
      return { viewerReacted: false };
    }
    await tx
      .update(communityReactions)
      .set({ reaction })
      .where(eq(communityReactions.id, existing.id));
    return { viewerReacted: true };
  });
}

export async function toggleCommunityBookmark(
  announcementId: number,
  userId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [existing] = await db
    .select({ id: communityBookmarks.id })
    .from(communityBookmarks)
    .where(
      and(
        eq(communityBookmarks.announcementId, announcementId),
        eq(communityBookmarks.userId, userId)
      )
    )
    .limit(1);
  if (existing) {
    await db
      .delete(communityBookmarks)
      .where(eq(communityBookmarks.id, existing.id));
    return { viewerBookmarked: false };
  }
  await db.insert(communityBookmarks).values({ announcementId, userId });
  return { viewerBookmarked: true };
}

export async function listAnnouncementComments(announcementId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ comment: communityComments, user: users, profile: profiles })
    .from(communityComments)
    .innerJoin(users, eq(communityComments.userId, users.id))
    .leftJoin(profiles, eq(communityComments.userId, profiles.userId))
    .where(eq(communityComments.announcementId, announcementId))
    .orderBy(desc(communityComments.createdAt))
    .limit(50);
    return rows.map(row => ({
    ...row.comment,
    body: typeof row.comment.body === "string" ? row.comment.body : "",
    audioUrl: typeof row.comment.audioUrl === "string" && row.comment.audioUrl.trim()
      ? row.comment.audioUrl
      : null,
    audioDuration: Number.isFinite(Number(row.comment.audioDuration))
      ? Math.max(1, Math.min(60, Math.round(Number(row.comment.audioDuration))))
      : null,
    author: {
      id: row.user.id,
      name: row.user.name,
      username: row.profile?.username ?? null,
    },
  }));
}
export async function createAnnouncementComment(
  announcementId: number,
  userId: number,
  body: string,
  audio?: { audioUrl?: string | null; audioDuration?: number | null }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const trimmedBody = body.trim();

  const [comment] = await db.transaction(async (tx) => {
    const [newComment] = await tx
      .insert(communityComments)
      .values({ announcementId, userId, body: trimmedBody, audioUrl: audio?.audioUrl ?? null, audioDuration: audio?.audioDuration ?? null })
      .returning();

    // Sync hashtags from comment body
    const commentTags = extractTextHashtags(trimmedBody);
    await syncCommunityCommentHashtags(tx, newComment.id, commentTags);

    return [newComment];
  });

  return comment;
}

export async function createCommunityAnnouncement(
  userId: number,
  input: { body: string; attachments: VideoAttachmentInput[] }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [profile] = await db
    .select({
      accountType: profiles.accountType,
      isVerified: profiles.isVerified,
    })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  if (
    !profile?.isVerified ||
    !["creator", "company"].includes(profile.accountType)
  ) {
    console.warn(
      `[Announcement denied] userId=${userId} profile.isVerified=${profile?.isVerified} profile.accountType=${profile?.accountType} profileExists=${!!profile}`
    );
    throw new Error(
      "Only verified creators and companies can publish announcements."
    );
  }
  if (!input.body.trim() && !input.attachments.length)
    throw new Error("An announcement needs text or an attachment.");

  const trimmedBody = input.body.trim();

  return db.transaction(async tx => {
    const [announcement] = await tx
      .insert(communityAnnouncements)
      .values({ userId, body: trimmedBody })
      .returning();

    // Sync hashtags from announcement body
    const announcementTags = extractTextHashtags(trimmedBody);
    await syncAnnouncementHashtags(tx, announcement.id, announcementTags);

    if (input.attachments.length)
      await tx.insert(communityAnnouncementAttachments).values(
        input.attachments.map(attachment => ({
          announcementId: announcement.id,
          ...attachment,
        }))
      );
    return announcement;
  });
}

export async function updateCommunityAnnouncement(
  announcementId: number,
  userId: number,
  body: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [owned] = await db
    .select({ id: communityAnnouncements.id })
    .from(communityAnnouncements)
    .where(
      and(
        eq(communityAnnouncements.id, announcementId),
        eq(communityAnnouncements.userId, userId)
      )
    )
    .limit(1);
  if (!owned) throw new Error("Post not found or you are not the author.");
  const nextBody = body.trim();
  if (!nextBody) {
    const [attachment] = await db
      .select({ id: communityAnnouncementAttachments.id })
      .from(communityAnnouncementAttachments)
      .where(eq(communityAnnouncementAttachments.announcementId, announcementId))
      .limit(1);
    if (!attachment)
      throw new Error("An announcement needs text or an attachment.");
  }

  const [updated] = await db.transaction(async (tx) => {
    const [announcement] = await tx
      .update(communityAnnouncements)
      .set({ body: nextBody, updatedAt: new Date() })
      .where(
        and(
          eq(communityAnnouncements.id, announcementId),
          eq(communityAnnouncements.userId, userId)
        )
      )
      .returning();
    if (!announcement) throw new Error("Post not found or you are not the author.");

    // Sync hashtags from updated body
    const announcementTags = extractTextHashtags(nextBody);
    await syncAnnouncementHashtags(tx, announcement.id, announcementTags);

    return [announcement];
  });

  return updated;
}

export async function deleteCommunityAnnouncement(
  announcementId: number,
  userId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [owned] = await db
    .select({ id: communityAnnouncements.id })
    .from(communityAnnouncements)
    .where(
      and(
        eq(communityAnnouncements.id, announcementId),
        eq(communityAnnouncements.userId, userId)
      )
    )
    .limit(1);
  if (!owned) throw new Error("Post not found or you are not the author.");
  const attachments = await db
    .select({ mediaUrl: communityAnnouncementAttachments.mediaUrl })
    .from(communityAnnouncementAttachments)
    .where(
      eq(communityAnnouncementAttachments.announcementId, announcementId)
    );
  await db
    .delete(communityAnnouncements)
    .where(
      and(
        eq(communityAnnouncements.id, announcementId),
        eq(communityAnnouncements.userId, userId)
      )
    );
  await Promise.all(
    attachments.map(({ mediaUrl }) =>
      storageDelete(mediaUrl).catch(error => {
        console.warn(
          `[Storage] Failed to clean up deleted announcement media: ${mediaUrl}`,
          error
        );
      })
    )
  );
  return { deleted: true, announcementId };
}
