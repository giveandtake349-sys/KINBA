import { and, desc, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  blocks,
  connections,
  type InsertUser,
  messages,
  profiles,
  reports,
  signals,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: values.lastSignedIn };
  (["name", "email", "loginMethod"] as const).forEach((field) => {
    if (user[field] !== undefined) {
      values[field] = user[field];
      updateSet[field] = user[field] ?? null;
    }
  });
  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  updateSet.role = values.role;
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return result[0];
}

export async function ensureProfile(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(profiles).values({ userId, languages: JSON.stringify([]), skills: JSON.stringify([]), interests: JSON.stringify([]) }).onDuplicateKeyUpdate({ set: { userId } });
}

export async function getOwnProfile(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.select({ user: users, profile: profiles }).from(users).leftJoin(profiles, eq(users.id, profiles.userId)).where(eq(users.id, userId)).limit(1);
  return result[0];
}

export async function updateProfile(userId: number, input: { country: string | null; languages: string[]; about: string | null; skills: string[]; interests: string[]; photoUrl: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await ensureProfile(userId);
  await db.update(profiles).set({
    country: input.country,
    languages: JSON.stringify(input.languages),
    about: input.about,
    skills: JSON.stringify(input.skills),
    interests: JSON.stringify(input.interests),
    photoUrl: input.photoUrl,
    updatedAt: new Date(),
  }).where(eq(profiles.userId, userId));
  return getOwnProfile(userId);
}

export async function getPublicProfile(userId: number, viewerId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if (viewerId && await areUsersBlocked(viewerId, userId)) return undefined;
  const person = await db.select({ user: users, profile: profiles }).from(users).leftJoin(profiles, eq(users.id, profiles.userId)).where(eq(users.id, userId)).limit(1);
  if (!person[0]) return undefined;
  const publicSignals = await db.select().from(signals).where(and(eq(signals.userId, userId), eq(signals.status, "active"))).orderBy(desc(signals.createdAt));
  const acceptedConnections = await db.select().from(connections).where(and(or(eq(connections.requesterId, userId), eq(connections.recipientId, userId)), eq(connections.status, "accepted")));
  return { ...person[0], signals: publicSignals, completedConnections: acceptedConnections.length };
}

export async function getBlockedIds(userId: number) {
  const db = await getDb();
  if (!db) return new Set<number>();
  const rows = await db.select().from(blocks).where(or(eq(blocks.blockerId, userId), eq(blocks.blockedId, userId)));
  return new Set(rows.map((row) => row.blockerId === userId ? row.blockedId : row.blockerId));
}

export async function areUsersBlocked(firstUserId: number, secondUserId: number) {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select().from(blocks).where(or(
    and(eq(blocks.blockerId, firstUserId), eq(blocks.blockedId, secondUserId)),
    and(eq(blocks.blockerId, secondUserId), eq(blocks.blockedId, firstUserId)),
  )).limit(1);
  return rows.length > 0;
}

export async function listSignals(input: { type?: "need" | "can"; category?: string; viewerId?: number }) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(signals.status, "active")];
  if (input.type) conditions.push(eq(signals.type, input.type));
  if (input.category) conditions.push(eq(signals.category, input.category));
  const blockedIds = input.viewerId ? await getBlockedIds(input.viewerId) : new Set<number>();
  const rows = await db.select({ signal: signals, user: users, profile: profiles }).from(signals)
    .innerJoin(users, eq(signals.userId, users.id))
    .leftJoin(profiles, eq(signals.userId, profiles.userId))
    .where(and(...conditions)).orderBy(desc(signals.createdAt)).limit(60);
  return rows.filter((row) => !blockedIds.has(row.signal.userId)).map((row) => ({
    ...row.signal,
    owner: { id: row.user.id, name: row.user.name, country: row.profile?.country ?? null, languages: row.profile?.languages ?? "[]", photoUrl: row.profile?.photoUrl ?? null, phoneVerified: Boolean(row.profile?.phoneVerified) },
  }));
}

export async function createSignal(userId: number, input: { type: "need" | "can"; title: string; description: string; category: string; language: string; location: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(signals).values({ userId, ...input });
  return { id: Number(result[0].insertId) };
}

export async function getSignalById(signalId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(signals).where(eq(signals.id, signalId)).limit(1);
  return result[0];
}

export async function listOwnSignals(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(signals).where(eq(signals.userId, userId)).orderBy(desc(signals.createdAt));
}

export async function createConnection(userId: number, input: { recipientId: number; signalId: number | null; note: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = await db.select().from(connections).where(and(eq(connections.requesterId, userId), eq(connections.recipientId, input.recipientId), eq(connections.status, "pending"))).limit(1);
  if (existing.length) throw new Error("A connection request is already pending for this person.");
  const result = await db.insert(connections).values({ requesterId: userId, recipientId: input.recipientId, signalId: input.signalId, note: input.note });
  return { id: Number(result[0].insertId) };
}

export async function getConnectionForParticipant(connectionId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(connections).where(and(eq(connections.id, connectionId), or(eq(connections.requesterId, userId), eq(connections.recipientId, userId)))).limit(1);
  return result[0];
}

export async function listConnections(userId: number) {
  const db = await getDb();
  if (!db) return [];
  const raw = await db.select().from(connections).where(or(eq(connections.requesterId, userId), eq(connections.recipientId, userId))).orderBy(desc(connections.updatedAt));
  const counterpartIds = Array.from(new Set(raw.map((row) => row.requesterId === userId ? row.recipientId : row.requesterId)));
  if (!counterpartIds.length) return [];
  const people = await db.select({ user: users, profile: profiles }).from(users).leftJoin(profiles, eq(users.id, profiles.userId)).where(inArray(users.id, counterpartIds));
  const peopleById = new Map(people.map((row) => [row.user.id, row]));
  const blockedIds = await getBlockedIds(userId);
  return raw.filter((row) => !blockedIds.has(row.requesterId === userId ? row.recipientId : row.requesterId)).map((row) => {
    const counterpartId = row.requesterId === userId ? row.recipientId : row.requesterId;
    const counterpart = peopleById.get(counterpartId);
    return { ...row, counterpart: counterpart ? { id: counterpart.user.id, name: counterpart.user.name, country: counterpart.profile?.country ?? null, photoUrl: counterpart.profile?.photoUrl ?? null, phoneVerified: Boolean(counterpart.profile?.phoneVerified) } : null };
  });
}

export async function setConnectionStatus(connectionId: number, status: "accepted" | "declined" | "cancelled") {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(connections).set({ status, updatedAt: new Date() }).where(eq(connections.id, connectionId));
}

export async function listMessages(connectionId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(messages).where(eq(messages.connectionId, connectionId)).orderBy(messages.createdAt);
}

export async function createMessage(connectionId: number, senderId: number, body: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const result = await db.insert(messages).values({ connectionId, senderId, body });
  await db.update(connections).set({ updatedAt: new Date() }).where(eq(connections.id, connectionId));
  return { id: Number(result[0].insertId) };
}

export async function blockUser(blockerId: number, blockedId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(blocks).values({ blockerId, blockedId }).onDuplicateKeyUpdate({ set: { blockerId } });
}

export async function createReport(reporterId: number, input: { reportedUserId: number; reason: string; details: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(reports).values({ reporterId, ...input });
}
