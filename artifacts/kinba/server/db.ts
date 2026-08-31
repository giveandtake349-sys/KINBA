import { and, asc, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  communityAnnouncementAttachments,
  communityAnnouncements,
  communityComments,
  liveSponsors,
  participants,
  sessionWinners,
  sponsorBidsDraws,
  sponsorBidsSessions,
  wallets,
  walletTransactions,
  follows,
  profiles,
  type InsertUser,
  users,
  videoBookmarks,
  videoComments,
  videoReactions,
  videoShares,
  videoSources,
  videos,
  transactions,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { resolvePostgresDatabaseUrl } from "./databaseConfig";
import { selectNomineeIds, selectSecondaryWinnerId } from "./sponsorBidsDraw";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: Pool | null = null;

export async function getDb() {
  if (!_db) {
    const connectionString = resolvePostgresDatabaseUrl();
    if (!connectionString) {
      console.error(
        "[Database] PostgreSQL is not configured. Set SUPABASE_DATABASE_URL or a PostgreSQL DATABASE_URL."
      );
      return null;
    }
    try {
      _pool = new Pool({
        connectionString,
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
      });
      _db = drizzle({ client: _pool });
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
      _pool = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db)
    throw new Error(
      "Kinba PostgreSQL database is unavailable. Configure SUPABASE_DATABASE_URL or a PostgreSQL DATABASE_URL."
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

export async function updateOwnProfile(
  userId: number,
  input: { username?: string | null; photoUrl?: string | null }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const hasUsername = Object.prototype.hasOwnProperty.call(input, "username");
  const hasPhotoUrl = Object.prototype.hasOwnProperty.call(input, "photoUrl");
  const username = hasUsername
    ? input.username?.trim().toLowerCase() || null
    : undefined;
  if (username) {
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
  const updateSet: Partial<typeof profiles.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (hasUsername) updateSet.username = username ?? null;
  if (hasPhotoUrl) updateSet.photoUrl = input.photoUrl ?? null;
  const insertValues: typeof profiles.$inferInsert = {
    userId,
    username: username ?? null,
    photoUrl: hasPhotoUrl ? (input.photoUrl ?? null) : null,
  };
  await db
    .insert(profiles)
    .values(insertValues)
    .onConflictDoUpdate({ target: profiles.userId, set: updateSet });
  return getOwnProfile(userId);
}

export async function getVerificationStatus(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [profile] = await db
    .select({ isVerified: profiles.isVerified })
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
  status: "approved" | "rejected"
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
    if (status === "approved")
      await tx
        .update(profiles)
        .set({ isVerified: true, phoneVerified: true, updatedAt: new Date() })
        .where(eq(profiles.userId, transaction.userId));
    return updated;
  });
}

export type VideoKind = "LONG" | "SHORT";
export type MediaType = "VIDEO" | "IMAGE";
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
export type HomeFeedTab = "all" | "videos" | "trendy" | "following" | "icons";

function requiredText(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized || fallback;
}

function optionalText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
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
      videoUrl: source.videoUrl,
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

function shapeVideoRow(row: any) {
  return {
    ...row.video,
    mediaType: row.video.mediaType === "IMAGE" ? "IMAGE" : "VIDEO",
    processingStatus: row.video.processingStatus ?? "READY",
    reactionCount: Number(row.reactionCount),
    shareCount: Number(row.shareCount),
    commentCount: Number(row.commentCount),
    bookmarkCount: Number(row.bookmarkCount),
    viewCount: Number(row.video.viewCount ?? 0),
    viewerReacted: Boolean(row.viewerReacted),
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
      viewerShared,
      viewerBookmarked,
    })
    .from(videos)
    .innerJoin(users, eq(videos.userId, users.id))
    .leftJoin(profiles, eq(videos.userId, profiles.userId))
    .where(and(...conditions))
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

export async function listVideos(kind: VideoKind, viewerId?: number) {
  const conditions = [eq(videos.kind, kind)];
  if (kind === "LONG") conditions.push(eq(videos.mediaType, "VIDEO"));
  return selectVideos(conditions, viewerId, "recent");
}

export async function listProfileVideos(userId: number) {
  return selectVideos([eq(videos.userId, userId)], userId, "recent");
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

export async function listHomeFeed(tab: HomeFeedTab, viewerId?: number) {
  if (tab === "all") return listUnifiedHomeFeed(viewerId);
  if (tab === "following" && !viewerId) return [];
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (tab === "videos" || tab === "trendy" || tab === "following")
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
  return selectVideos(
    conditions,
    viewerId,
    tab === "trendy" ? "trendy" : "recent"
  );
}

/** Resolve real persisted media and text posts into one chronological feed. */
async function listUnifiedHomeFeed(viewerId?: number) {
  const [media, shorts, textPosts] = await Promise.all([
    selectVideos([eq(videos.kind, "LONG")], viewerId, "recent"),
    selectVideos([eq(videos.kind, "SHORT")], viewerId, "recent"),
    listCommunityAnnouncements(),
  ]);
  const regular = [
    ...media.map(video => ({ ...video, feedType: "media" as const })),
    ...textPosts.map(post => ({
      ...post,
      text: post.body,
      feedType: "text" as const,
    })),
  ].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
  const items: any[] = [];
  let shortIndex = 0;
  regular.forEach((item, index) => {
    items.push(item);
    const nextShort = shorts[shortIndex];
    if ((index + 1) % 5 === 0 && nextShort) {
      items.push({
        feedType: "shorts" as const,
        id: "shorts-" + nextShort.id,
        video: nextShort,
      });
      shortIndex += 1;
    }
  });
  return items;
}

export async function listNotifications(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const [reactions, shares, comments, newFollowers] = await Promise.all([
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
    db
      .select({
        id: follows.id,
        createdAt: follows.createdAt,
        actorName: users.name,
      })
      .from(follows)
      .innerJoin(users, eq(follows.followerId, users.id))
      .where(eq(follows.followedId, userId))
      .orderBy(desc(follows.createdAt))
      .limit(30),
  ]);
  return [
    ...reactions.map(item => ({ ...item, kind: "reaction" as const })),
    ...shares.map(item => ({ ...item, kind: "share" as const })),
    ...comments.map(item => ({ ...item, kind: "comment" as const })),
    ...newFollowers.map(item => ({
      ...item,
      kind: "follow" as const,
      videoTitle: null,
    })),
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 50);
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
  const [created] = await db
    .insert(videos)
    .values({
      userId,
      title: requiredText(input.title, "Untitled video"),
      description: requiredText(input.description, "No description provided."),
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
  const [created] = await db
    .insert(videos)
    .values({
      userId,
      title: requiredText(input.title, "Untitled photo"),
      description: requiredText(input.description, "No description provided."),
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
  return created;
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

export async function recordVideoView(videoId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [updated] = await db
    .update(videos)
    .set({ viewCount: sql`${videos.viewCount} + 1` })
    .where(eq(videos.id, videoId))
    .returning({ viewCount: videos.viewCount });
  return { viewCount: Number(updated?.viewCount ?? 0) };
}

export async function listVideoComments(videoId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ comment: videoComments, user: users, profile: profiles })
    .from(videoComments)
    .innerJoin(users, eq(videoComments.userId, users.id))
    .leftJoin(profiles, eq(videoComments.userId, profiles.userId))
    .where(eq(videoComments.videoId, videoId))
    .orderBy(desc(videoComments.createdAt))
    .limit(50);
  return rows.map(row => ({
    ...row.comment,
    author: {
      id: row.user.id,
      name: row.user.name,
      username: row.profile?.username ?? null,
    },
  }));
}

export async function createVideoComment(
  videoId: number,
  userId: number,
  body: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [comment] = await db
    .insert(videoComments)
    .values({ videoId, userId, body })
    .returning();
  return comment;
}

export async function toggleVideoReaction(videoId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = await db
    .select({ id: videoReactions.id })
    .from(videoReactions)
    .where(
      and(
        eq(videoReactions.videoId, videoId),
        eq(videoReactions.userId, userId)
      )
    )
    .limit(1);
  if (existing[0])
    await db
      .delete(videoReactions)
      .where(eq(videoReactions.id, existing[0].id));
  else await db.insert(videoReactions).values({ videoId, userId });
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

export async function listCommunityAnnouncements() {
  const db = await getDb();
  if (!db) return [];
  const commentCount = sql<number>`(
    select count(*) from community_comments
    where community_comments."announcementId" = ${communityAnnouncements.id}
  )`;
  const rows = await db
    .select({
      announcement: communityAnnouncements,
      user: users,
      profile: profiles,
      commentCount,
    })
    .from(communityAnnouncements)
    .innerJoin(users, eq(communityAnnouncements.userId, users.id))
    .innerJoin(profiles, eq(communityAnnouncements.userId, profiles.userId))
    .where(
      and(
        eq(profiles.isVerified, true),
        inArray(profiles.accountType, ["creator", "company"])
      )
    )
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
    author: {
      id: row.user.id,
      name: row.user.name,
      photoUrl: row.profile.photoUrl ?? null,
      accountType: row.profile.accountType,
      isVerified: row.profile.isVerified,
    },
    attachments: attachmentsByAnnouncement.get(row.announcement.id) ?? [],
  }));
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
  body: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [comment] = await db
    .insert(communityComments)
    .values({ announcementId, userId, body: body.trim() })
    .returning();
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
  )
    throw new Error(
      "Only verified creators and companies can publish announcements."
    );
  if (!input.body.trim() && !input.attachments.length)
    throw new Error("An announcement needs text or an attachment.");
  return db.transaction(async tx => {
    const [announcement] = await tx
      .insert(communityAnnouncements)
      .values({ userId, body: input.body.trim() })
      .returning();
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
