import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const appRole = pgEnum("app_role", ["user", "admin"]);
export const signalType = pgEnum("signal_type", ["need", "can"]);
export const signalStatus = pgEnum("signal_status", ["active", "closed"]);
export const signalMediaType = pgEnum("signal_media_type", [
  "NONE",
  "AUDIO",
  "VIDEO",
]);
export const videoKind = pgEnum("video_kind", ["LONG", "SHORT"]);
export const profileAccountType = pgEnum("profile_account_type", [
  "member",
  "creator",
  "company",
]);
export const announcementAttachmentType = pgEnum(
  "announcement_attachment_type",
  ["IMAGE", "VIDEO"]
);
export const connectionStatus = pgEnum("connection_status", [
  "pending",
  "accepted",
  "declined",
  "cancelled",
]);

const createdAt = () =>
  timestamp("createdAt", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull();

export const users = pgTable("users", {
  id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: appRole("role").default("user").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const profiles = pgTable(
  "profiles",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    country: varchar("country", { length: 100 }),
    languages: text("languages"),
    about: text("about"),
    skills: text("skills"),
    interests: text("interests"),
    photoUrl: varchar("photoUrl", { length: 1024 }),
    phoneVerified: boolean("phoneVerified").default(false).notNull(),
    accountType: profileAccountType("accountType").default("member").notNull(),
    isVerified: boolean("isVerified").default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [uniqueIndex("profiles_userId_unique").on(table.userId)]
);

export const signals = pgTable(
  "signals",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: signalType("type").notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    description: text("description").notNull(),
    category: varchar("category", { length: 64 }).notNull(),
    language: varchar("language", { length: 64 }).notNull(),
    location: varchar("location", { length: 120 }),
    imageUrl: varchar("imageUrl", { length: 1024 }),
    mediaUrl: varchar("mediaUrl", { length: 1024 }),
    mediaType: signalMediaType("mediaType").default("NONE").notNull(),
    mediaDuration: integer("mediaDuration").default(0).notNull(),
    status: signalStatus("status").default("active").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index("signals_discovery_idx").on(table.type, table.category, table.status),
    index("signals_user_idx").on(table.userId),
  ]
);

export const videos = pgTable(
  "videos",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 180 }).notNull(),
    description: text("description").notNull(),
    videoUrl: varchar("videoUrl", { length: 1024 }).notNull(),
    thumbnailUrl: varchar("thumbnailUrl", { length: 1024 }),
    kind: videoKind("kind").notNull(),
    durationSeconds: integer("durationSeconds").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index("videos_user_idx").on(table.userId),
    index("videos_kind_created_idx").on(table.kind, table.createdAt),
  ]
);
export const videoReactions = pgTable(
  "video_reactions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    videoId: integer("videoId")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex("video_reactions_pair_unique").on(table.videoId, table.userId),
    index("video_reactions_video_idx").on(table.videoId),
    index("video_reactions_user_idx").on(table.userId),
  ]
);
export const videoShares = pgTable(
  "video_shares",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    videoId: integer("videoId")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex("video_shares_pair_unique").on(table.videoId, table.userId),
    index("video_shares_video_idx").on(table.videoId),
    index("video_shares_user_idx").on(table.userId),
  ]
);
export const communityAnnouncements = pgTable(
  "community_announcements",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index("community_announcements_user_idx").on(table.userId),
    index("community_announcements_created_idx").on(table.createdAt),
  ]
);
export const communityAnnouncementAttachments = pgTable(
  "community_announcement_attachments",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    announcementId: integer("announcementId")
      .notNull()
      .references(() => communityAnnouncements.id, { onDelete: "cascade" }),
    mediaType: announcementAttachmentType("mediaType").notNull(),
    mediaUrl: varchar("mediaUrl", { length: 1024 }).notNull(),
    sortOrder: integer("sortOrder").default(0).notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSeconds: integer("durationSeconds"),
    createdAt: createdAt(),
  },
  table => [
    index("community_announcement_attachments_announcement_idx").on(
      table.announcementId,
      table.sortOrder
    ),
  ]
);
export const connections = pgTable(
  "connections",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    requesterId: integer("requesterId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: integer("recipientId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    signalId: integer("signalId").references(() => signals.id, {
      onDelete: "set null",
    }),
    note: text("note").notNull(),
    status: connectionStatus("status").default("pending").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index("connections_requester_idx").on(table.requesterId),
    index("connections_recipient_idx").on(table.recipientId),
    index("connections_status_idx").on(table.status),
  ]
);

export const comments = pgTable(
  "comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    postId: integer("postId")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content"),
    imageUrl: varchar("imageUrl", { length: 1024 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index("comments_post_idx").on(table.postId, table.createdAt),
    index("comments_user_idx").on(table.userId),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    connectionId: integer("connectionId")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    senderId: integer("senderId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    imageUrl: varchar("imageUrl", { length: 1024 }),
    createdAt: createdAt(),
  },
  table => [
    index("messages_connection_idx").on(table.connectionId, table.createdAt),
  ]
);

export const blocks = pgTable(
  "blocks",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    blockerId: integer("blockerId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: integer("blockedId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex("blocks_pair_unique").on(table.blockerId, table.blockedId),
  ]
);

export const follows = pgTable(
  "follows",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    followerId: integer("followerId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followedId: integer("followedId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex("follows_pair_unique").on(table.followerId, table.followedId),
    index("follows_follower_idx").on(table.followerId),
    index("follows_followed_idx").on(table.followedId),
  ]
);
export const reactions = pgTable(
  "reactions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    signalId: integer("signalId")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex("reactions_signal_user_unique").on(
      table.signalId,
      table.userId
    ),
    index("reactions_signal_idx").on(table.signalId),
    index("reactions_user_idx").on(table.userId),
  ]
);
export const reports = pgTable(
  "reports",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    reporterId: integer("reporterId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportedUserId: integer("reportedUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: varchar("reason", { length: 120 }).notNull(),
    details: text("details"),
    createdAt: createdAt(),
  },
  table => [index("reports_reported_idx").on(table.reportedUserId)]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
