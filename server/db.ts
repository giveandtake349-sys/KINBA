import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  communityAnnouncementAttachments,
  communityAnnouncements,
  follows,
  profiles,
  type InsertUser,
  users,
  videoComments,
  videoReactions,
  videoShares,
  videoSources,
  videos,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { resolvePostgresDatabaseUrl } from "./databaseConfig";

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
  values.role =
    user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  updateSet.role = values.role;
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

export type VideoKind = "LONG" | "SHORT";
export type VideoQuality = "ORIGINAL" | "1080P" | "720P" | "480P";
export type VideoSourceInput = { quality: VideoQuality; videoUrl: string };
export type VideoAttachmentInput = {
  mediaType: "IMAGE" | "VIDEO";
  mediaUrl: string;
  sortOrder: number;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
};
export type HomeFeedTab = "videos" | "trendy" | "following" | "icons";

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
    reactionCount: Number(row.reactionCount),
    shareCount: Number(row.shareCount),
    commentCount: Number(row.commentCount),
    viewCount: Number(row.video.viewCount ?? 0),
    viewerReacted: Boolean(row.viewerReacted),
    viewerShared: Boolean(row.viewerShared),
    owner: {
      id: row.user.id,
      name: row.user.name,
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
  const viewerReacted = viewerId
    ? sql<boolean>`exists (select 1 from video_reactions where video_reactions."videoId" = ${videos.id} and video_reactions."userId" = ${viewerId})`
    : sql<boolean>`false`;
  const viewerShared = viewerId
    ? sql<boolean>`exists (select 1 from video_shares where video_shares."videoId" = ${videos.id} and video_shares."userId" = ${viewerId})`
    : sql<boolean>`false`;
  const rows = await db
    .select({
      video: videos,
      user: users,
      profile: profiles,
      reactionCount,
      shareCount,
      commentCount,
      viewerReacted,
      viewerShared,
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
  return selectVideos([eq(videos.kind, kind)], viewerId, "recent");
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
  if (tab === "following" && !viewerId) return [];
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [];
  if (tab === "videos" || tab === "trendy" || tab === "following")
    conditions.push(eq(videos.kind, "LONG"));
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
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db.transaction(async tx => {
    const [created] = await tx
      .insert(videos)
      .values({
        userId,
        title: input.title,
        description: input.description,
        videoUrl: input.videoUrl,
        thumbnailUrl: input.thumbnailUrl ?? null,
        kind: input.kind,
        durationSeconds: input.durationSeconds,
        width: input.width,
        height: input.height,
      })
      .returning();
    await tx
      .insert(videoSources)
      .values(
        input.sources.map(source => ({ videoId: created.id, ...source }))
      );
    return created;
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
      viewerReacted: sql<boolean>`exists (select 1 from video_reactions where video_reactions."videoId" = ${videoId} and video_reactions."userId" = ${viewerId})`,
      viewerShared: sql<boolean>`exists (select 1 from video_shares where video_shares."videoId" = ${videoId} and video_shares."userId" = ${viewerId})`,
    })
    .from(videos)
    .where(eq(videos.id, videoId));
  return {
    reactionCount: Number(counts?.reactionCount ?? 0),
    shareCount: Number(counts?.shareCount ?? 0),
    commentCount: Number(counts?.commentCount ?? 0),
    viewerReacted: Boolean(counts?.viewerReacted),
    viewerShared: Boolean(counts?.viewerShared),
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
    .select({ comment: videoComments, user: users })
    .from(videoComments)
    .innerJoin(users, eq(videoComments.userId, users.id))
    .where(eq(videoComments.videoId, videoId))
    .orderBy(desc(videoComments.createdAt))
    .limit(50);
  return rows.map(row => ({
    ...row.comment,
    author: { id: row.user.id, name: row.user.name },
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

export async function listCommunityAnnouncements() {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      announcement: communityAnnouncements,
      user: users,
      profile: profiles,
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
