import { boolean, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const appRole = pgEnum("app_role", ["user", "admin"]);
export const signalType = pgEnum("signal_type", ["need", "can"]);
export const signalStatus = pgEnum("signal_status", ["active", "closed"]);
export const connectionStatus = pgEnum("connection_status", ["pending", "accepted", "declined", "cancelled"]);

const createdAt = () => timestamp("createdAt", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull();

export const users = pgTable("users", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: appRole("role").default("user").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(),
});

export const profiles = pgTable("profiles", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  country: varchar("country", { length: 100 }),
  languages: text("languages"),
  about: text("about"),
  skills: text("skills"),
  interests: text("interests"),
  photoUrl: varchar("photoUrl", { length: 1024 }),
  phoneVerified: boolean("phoneVerified").default(false).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("profiles_userId_unique").on(table.userId)]);

export const signals = pgTable("signals", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  userId: integer("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: signalType("type").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  description: text("description").notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  language: varchar("language", { length: 64 }).notNull(),
  location: varchar("location", { length: 120 }),
  status: signalStatus("status").default("active").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("signals_discovery_idx").on(table.type, table.category, table.status), index("signals_user_idx").on(table.userId)]);

export const connections = pgTable("connections", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  requesterId: integer("requesterId").notNull().references(() => users.id, { onDelete: "cascade" }),
  recipientId: integer("recipientId").notNull().references(() => users.id, { onDelete: "cascade" }),
  signalId: integer("signalId").references(() => signals.id, { onDelete: "set null" }),
  note: text("note").notNull(),
  status: connectionStatus("status").default("pending").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [index("connections_requester_idx").on(table.requesterId), index("connections_recipient_idx").on(table.recipientId), index("connections_status_idx").on(table.status)]);

export const messages = pgTable("messages", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  connectionId: integer("connectionId").notNull().references(() => connections.id, { onDelete: "cascade" }),
  senderId: integer("senderId").notNull().references(() => users.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  createdAt: createdAt(),
}, (table) => [index("messages_connection_idx").on(table.connectionId, table.createdAt)]);

export const blocks = pgTable("blocks", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  blockerId: integer("blockerId").notNull().references(() => users.id, { onDelete: "cascade" }),
  blockedId: integer("blockedId").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
}, (table) => [uniqueIndex("blocks_pair_unique").on(table.blockerId, table.blockedId)]);

export const reports = pgTable("reports", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  reporterId: integer("reporterId").notNull().references(() => users.id, { onDelete: "cascade" }),
  reportedUserId: integer("reportedUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  reason: varchar("reason", { length: 120 }).notNull(),
  details: text("details"),
  createdAt: createdAt(),
}, (table) => [index("reports_reported_idx").on(table.reportedUserId)]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
