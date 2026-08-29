import { and, desc, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import {
  blocks,
  comments,
  connections,
  follows,
  type InsertUser,
  messages,
  profiles,
  reactions,
  reports,
  signals,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { resolvePostgresDatabaseUrl } from "./databaseConfig";
import { scoreSignalPair } from "./nivoMatching";

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

export async function getOwnProfile(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db
    .select({
      user: users,
      profile: profiles,
      reactionsReceived: sql<number>`(select count(*) from reactions inner join signals on reactions."signalId" = signals.id where signals."userId" = ${userId})`,
      iconsCount: sql<number>`(select count(*) from signals where signals."userId" = ${userId} and signals.status = 'active')`,
      followingCount: sql<number>`(select count(*) from follows where follows."followerId" = ${userId})`,
      followersCount: sql<number>`(select count(*) from follows where follows."followedId" = ${userId})`,
    })
    .from(users)
    .leftJoin(profiles, eq(users.id, profiles.userId))
    .where(eq(users.id, userId))
    .limit(1);
  const profile = result[0];
  if (!profile) return undefined;
  return {
    user: profile.user,
    profile: profile.profile,
    stats: {
      reactionsReceived: Number(profile.reactionsReceived),
      iconsCount: Number(profile.iconsCount),
      followingCount: Number(profile.followingCount),
      followersCount: Number(profile.followersCount),
    },
  };
}

export async function updateProfile(
  userId: number,
  input: {
    country: string | null;
    languages: string[];
    about: string | null;
    skills: string[];
    interests: string[];
    photoUrl: string | null;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await ensureProfile(userId);
  await db
    .update(profiles)
    .set({
      country: input.country,
      languages: JSON.stringify(input.languages),
      about: input.about,
      skills: JSON.stringify(input.skills),
      interests: JSON.stringify(input.interests),
      photoUrl: input.photoUrl,
      updatedAt: new Date(),
    })
    .where(eq(profiles.userId, userId));
  return getOwnProfile(userId);
}

export async function getPublicProfile(userId: number, viewerId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if (viewerId && (await areUsersBlocked(viewerId, userId))) return undefined;
  const person = await db
    .select({ user: users, profile: profiles })
    .from(users)
    .leftJoin(profiles, eq(users.id, profiles.userId))
    .where(eq(users.id, userId))
    .limit(1);
  if (!person[0]) return undefined;
  const publicSignals = await db
    .select({
      signal: signals,
      commentCount: sql<number>`(select count(*) from comments where comments."postId" = ${signals.id})`,
    })
    .from(signals)
    .where(and(eq(signals.userId, userId), eq(signals.status, "active")))
    .orderBy(desc(signals.createdAt));
  const acceptedConnections = await db
    .select()
    .from(connections)
    .where(
      and(
        or(
          eq(connections.requesterId, userId),
          eq(connections.recipientId, userId)
        ),
        eq(connections.status, "accepted")
      )
    );
  return {
    ...person[0],
    signals: publicSignals.map(({ signal, commentCount }) => ({
      ...signal,
      commentCount: Number(commentCount),
    })),
    completedConnections: acceptedConnections.length,
  };
}

export async function getBlockedIds(userId: number) {
  const db = await getDb();
  if (!db) return new Set<number>();
  const rows = await db
    .select()
    .from(blocks)
    .where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
  return new Set(
    rows.map(row => (row.blockerId === userId ? row.blockedId : row.blockerId))
  );
}

export async function areUsersBlocked(
  firstUserId: number,
  secondUserId: number
) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db
    .select()
    .from(blocks)
    .where(
      or(
        and(
          eq(blocks.blockerId, firstUserId),
          eq(blocks.blockedId, secondUserId)
        ),
        and(
          eq(blocks.blockerId, secondUserId),
          eq(blocks.blockedId, firstUserId)
        )
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function listSignals(input: {
  type?: "need" | "can";
  category?: string;
  search?: string;
  viewerId?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(signals.status, "active")];
  if (input.type) conditions.push(eq(signals.type, input.type));
  if (input.category) conditions.push(eq(signals.category, input.category));
  const blockedIds = input.viewerId
    ? await getBlockedIds(input.viewerId)
    : new Set<number>();
  const rows = await db
    .select({
      signal: signals,
      user: users,
      profile: profiles,
      commentCount: sql<number>`(select count(*) from comments where comments."postId" = ${signals.id})`,
    })
    .from(signals)
    .innerJoin(users, eq(signals.userId, users.id))
    .leftJoin(profiles, eq(signals.userId, profiles.userId))
    .where(and(...conditions))
    .orderBy(
      sql`case when ${signals.mediaType} <> 'NONE' then 0 else 1 end`,
      desc(signals.createdAt)
    )
    .limit(60);
  const normalizedSearch = input.search?.trim().toLocaleLowerCase();
  return rows
    .filter(row => {
      if (blockedIds.has(row.signal.userId)) return false;
      if (!normalizedSearch) return true;
      return `${row.signal.title} ${row.signal.description} ${row.signal.category} ${row.signal.language} ${row.signal.location ?? ""}`
        .toLocaleLowerCase()
        .includes(normalizedSearch);
    })
    .map(row => ({
      ...row.signal,
      commentCount: Number(row.commentCount),
      owner: {
        id: row.user.id,
        name: row.user.name,
        country: row.profile?.country ?? null,
        languages: row.profile?.languages ?? "[]",
        photoUrl: row.profile?.photoUrl ?? null,
        phoneVerified: Boolean(row.profile?.phoneVerified),
      },
    }));
}

export async function createSignal(
  userId: number,
  input: {
    type: "need" | "can";
    title: string;
    description: string;
    category: string;
    language: string;
    location: string | null;
    imageUrl: string | null;
    mediaUrl: string | null;
    mediaType: "NONE" | "AUDIO" | "VIDEO";
    mediaDuration: number;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [created] = await db
    .insert(signals)
    .values({ userId, ...input })
    .returning({ id: signals.id });
  return created;
}

export async function getSignalById(signalId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(signals)
    .where(eq(signals.id, signalId))
    .limit(1);
  return result[0];
}

export async function listOwnSignals(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      signal: signals,
      commentCount: sql<number>`(select count(*) from comments where comments."postId" = ${signals.id})`,
    })
    .from(signals)
    .where(eq(signals.userId, userId))
    .orderBy(desc(signals.createdAt))
    .then(rows =>
      rows.map(({ signal, commentCount }) => ({
        ...signal,
        commentCount: Number(commentCount),
      }))
    );
}

export type ProfileContentTab = "videos" | "trendy" | "following" | "icons";
export async function listProfileContent(
  userId: number,
  tab: ProfileContentTab
) {
  const db = await getDb();
  if (!db) return [];
  const reactionCount = sql<number>`(select count(*) from reactions where reactions."signalId" = ${signals.id})`;
  const commentCount = sql<number>`(select count(*) from comments where comments."postId" = ${signals.id})`;
  const conditions = [eq(signals.status, "active")];
  if (tab === "following") {
    conditions.push(
      inArray(
        signals.userId,
        db
          .select({ followedId: follows.followedId })
          .from(follows)
          .where(eq(follows.followerId, userId))
      )
    );
  } else {
    conditions.push(eq(signals.userId, userId));
    if (tab === "videos") conditions.push(eq(signals.mediaType, "VIDEO"));
  }
  const rows = await db
    .select({
      signal: signals,
      user: users,
      profile: profiles,
      reactionCount,
      commentCount,
    })
    .from(signals)
    .innerJoin(users, eq(signals.userId, users.id))
    .leftJoin(profiles, eq(signals.userId, profiles.userId))
    .where(and(...conditions))
    .orderBy(
      ...(tab === "trendy"
        ? [desc(reactionCount), desc(commentCount), desc(signals.createdAt)]
        : [desc(signals.createdAt)])
    )
    .limit(60);
  const blockedIds = await getBlockedIds(userId);
  return rows
    .filter(row => !blockedIds.has(row.signal.userId))
    .map(row => ({
      ...row.signal,
      reactionCount: Number(row.reactionCount),
      commentCount: Number(row.commentCount),
      owner: {
        id: row.user.id,
        name: row.user.name,
        country: row.profile?.country ?? null,
        photoUrl: row.profile?.photoUrl ?? null,
      },
    }));
}
export async function listMatches(userId: number, search?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [ownSignals, blockedIds, candidates] = await Promise.all([
    db
      .select()
      .from(signals)
      .where(and(eq(signals.userId, userId), eq(signals.status, "active")))
      .orderBy(desc(signals.createdAt)),
    getBlockedIds(userId),
    db
      .select({ signal: signals, user: users, profile: profiles })
      .from(signals)
      .innerJoin(users, eq(signals.userId, users.id))
      .leftJoin(profiles, eq(signals.userId, profiles.userId))
      .where(eq(signals.status, "active"))
      .orderBy(desc(signals.createdAt))
      .limit(240),
  ]);
  if (!ownSignals.length) return [];

  const normalizedSearch = search?.trim().toLocaleLowerCase();
  const bestBySignalId = new Map<
    number,
    {
      id: number;
      type: "need" | "can";
      title: string;
      description: string;
      category: string;
      language: string;
      location: string | null;
      imageUrl: string | null;
      mediaUrl: string | null;
      mediaType: "NONE" | "AUDIO" | "VIDEO";
      mediaDuration: number;
      matchScore: number;
      matchedWith: "need" | "can";
      owner: {
        id: number;
        name: string | null;
        country: string | null;
        photoUrl: string | null;
        phoneVerified: boolean;
      };
    }
  >();

  for (
    let candidateIndex = 0;
    candidateIndex < candidates.length;
    candidateIndex += 1
  ) {
    const candidate = candidates[candidateIndex];
    if (
      candidate.signal.userId === userId ||
      blockedIds.has(candidate.signal.userId)
    )
      continue;
    if (
      normalizedSearch &&
      !`${candidate.signal.title} ${candidate.signal.description} ${candidate.signal.category}`
        .toLocaleLowerCase()
        .includes(normalizedSearch)
    )
      continue;
    for (let ownIndex = 0; ownIndex < ownSignals.length; ownIndex += 1) {
      const ownSignal = ownSignals[ownIndex];
      const score = scoreSignalPair(ownSignal, candidate.signal);
      if (score < 55) continue;
      const existing = bestBySignalId.get(candidate.signal.id);
      if (existing && existing.matchScore >= score) continue;
      bestBySignalId.set(candidate.signal.id, {
        id: candidate.signal.id,
        type: candidate.signal.type,
        title: candidate.signal.title,
        description: candidate.signal.description,
        category: candidate.signal.category,
        language: candidate.signal.language,
        location: candidate.signal.location,
        imageUrl: candidate.signal.imageUrl,
        mediaUrl: candidate.signal.mediaUrl,
        mediaType: candidate.signal.mediaType,
        mediaDuration: candidate.signal.mediaDuration,
        matchScore: score,
        matchedWith: ownSignal.type,
        owner: {
          id: candidate.user.id,
          name: candidate.user.name,
          country: candidate.profile?.country ?? null,
          photoUrl: candidate.profile?.photoUrl ?? null,
          phoneVerified: Boolean(candidate.profile?.phoneVerified),
        },
      });
    }
  }
  return Array.from(bestBySignalId.values())
    .sort((first, second) => second.matchScore - first.matchScore)
    .slice(0, 24);
}

export async function createConnection(
  userId: number,
  input: { recipientId: number; signalId: number | null; note: string }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.requesterId, userId),
        eq(connections.recipientId, input.recipientId),
        eq(connections.status, "pending")
      )
    )
    .limit(1);
  if (existing.length)
    throw new Error("A connection request is already pending for this person.");
  const [created] = await db
    .insert(connections)
    .values({
      requesterId: userId,
      recipientId: input.recipientId,
      signalId: input.signalId,
      note: input.note,
    })
    .returning({ id: connections.id });
  return created;
}

export async function getConnectionForParticipant(
  connectionId: number,
  userId: number
) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(connections)
    .where(
      and(
        eq(connections.id, connectionId),
        or(
          eq(connections.requesterId, userId),
          eq(connections.recipientId, userId)
        )
      )
    )
    .limit(1);
  return result[0];
}

export async function listConnections(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const raw = await db
    .select()
    .from(connections)
    .where(
      or(
        eq(connections.requesterId, userId),
        eq(connections.recipientId, userId)
      )
    )
    .orderBy(desc(connections.updatedAt));
  const counterpartIds = Array.from(
    new Set(
      raw.map(row =>
        row.requesterId === userId ? row.recipientId : row.requesterId
      )
    )
  );
  if (!counterpartIds.length) return [];
  const people = await db
    .select({ user: users, profile: profiles })
    .from(users)
    .leftJoin(profiles, eq(users.id, profiles.userId))
    .where(inArray(users.id, counterpartIds));
  const peopleById = new Map(people.map(row => [row.user.id, row]));
  const blockedIds = await getBlockedIds(userId);
  return raw
    .filter(
      row =>
        !blockedIds.has(
          row.requesterId === userId ? row.recipientId : row.requesterId
        )
    )
    .map(row => {
      const counterpartId =
        row.requesterId === userId ? row.recipientId : row.requesterId;
      const counterpart = peopleById.get(counterpartId);
      return {
        ...row,
        counterpart: counterpart
          ? {
              id: counterpart.user.id,
              name: counterpart.user.name,
              country: counterpart.profile?.country ?? null,
              photoUrl: counterpart.profile?.photoUrl ?? null,
              phoneVerified: Boolean(counterpart.profile?.phoneVerified),
            }
          : null,
      };
    });
}

export async function setConnectionStatus(
  connectionId: number,
  status: "accepted" | "declined" | "cancelled"
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .update(connections)
    .set({ status, updatedAt: new Date() })
    .where(eq(connections.id, connectionId));
}

export async function listMessages(connectionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(messages)
    .where(eq(messages.connectionId, connectionId))
    .orderBy(messages.createdAt);
}

export async function createMessage(
  connectionId: number,
  senderId: number,
  body: string,
  imageUrl: string | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [created] = await db
    .insert(messages)
    .values({ connectionId, senderId, body, imageUrl })
    .returning({ id: messages.id });
  await db
    .update(connections)
    .set({ updatedAt: new Date() })
    .where(eq(connections.id, connectionId));
  return created;
}

export async function listComments(postId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ comment: comments, user: users, profile: profiles })
    .from(comments)
    .innerJoin(users, eq(comments.userId, users.id))
    .leftJoin(profiles, eq(comments.userId, profiles.userId))
    .where(eq(comments.postId, postId))
    .orderBy(comments.createdAt);
  return rows.map(({ comment, user, profile }) => ({
    ...comment,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: profile?.photoUrl ?? null,
    },
  }));
}

export async function createComment(
  postId: number,
  userId: number,
  content: string | null,
  imageUrl: string | null
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [created] = await db
    .insert(comments)
    .values({ postId, userId, content, imageUrl })
    .returning();
  return created;
}

export async function deleteComment(commentId: string, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [target] = await db
    .select({ comment: comments, postOwnerId: signals.userId })
    .from(comments)
    .innerJoin(signals, eq(comments.postId, signals.id))
    .where(eq(comments.id, commentId))
    .limit(1);
  if (!target) return "not_found" as const;
  if (target.comment.userId !== userId && target.postOwnerId !== userId)
    return "forbidden" as const;
  await db.delete(comments).where(eq(comments.id, commentId));
  return "deleted" as const;
}

export async function blockUser(blockerId: number, blockedId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(blocks)
    .values({ blockerId, blockedId })
    .onConflictDoNothing({ target: [blocks.blockerId, blocks.blockedId] });
}

export async function createReport(
  reporterId: number,
  input: { reportedUserId: number; reason: string; details: string | null }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(reports).values({ reporterId, ...input });
}
