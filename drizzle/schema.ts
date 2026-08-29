import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const appRole = pgEnum("app_role", ["user", "admin"]);
export const videoKind = pgEnum("video_kind", ["LONG", "SHORT"]);
export const videoProcessingStatus = pgEnum("video_processing_status", [
  "PENDING",
  "PROCESSING",
  "READY",
  "FAILED",
]);
export const paymentMethod = pgEnum("payment_method", ["bkash", "nagad"]);
export const transactionStatus = pgEnum("transaction_status", [
  "pending",
  "approved",
  "rejected",
]);
export const videoSourceQuality = pgEnum("video_source_quality", [
  "ORIGINAL",
  "1080P",
  "720P",
  "480P",
  "240P",
]);
export const profileAccountType = pgEnum("profile_account_type", [
  "member",
  "creator",
  "company",
]);
export const announcementAttachmentType = pgEnum(
  "announcement_attachment_type",
  ["IMAGE", "VIDEO"]
);

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
    username: varchar("username", { length: 64 }),
    phoneVerified: boolean("phoneVerified").default(false).notNull(),
    accountType: profileAccountType("accountType").default("member").notNull(),
    isVerified: boolean("isVerified").default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex("profiles_userId_unique").on(table.userId),
    uniqueIndex("profiles_username_unique").on(table.username),
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
    viewCount: integer("viewCount").default(0).notNull(),
    hlsMasterUrl: varchar("hlsMasterUrl", { length: 1024 }),
    processingStatus: videoProcessingStatus("processingStatus")
      .default("PENDING")
      .notNull(),
    processingError: text("processingError"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index("videos_user_idx").on(table.userId),
    index("videos_kind_created_idx").on(table.kind, table.createdAt),
  ]
);

export const videoSources = pgTable(
  "video_sources",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    videoId: integer("videoId")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    quality: videoSourceQuality("quality").notNull(),
    videoUrl: varchar("videoUrl", { length: 1024 }).notNull(),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex("video_sources_quality_unique").on(
      table.videoId,
      table.quality
    ),
    index("video_sources_video_idx").on(table.videoId),
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

export const videoComments = pgTable(
  "video_comments",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    videoId: integer("videoId")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  table => [
    index("video_comments_video_idx").on(table.videoId, table.createdAt),
    index("video_comments_user_idx").on(table.userId),
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

export const transactions = pgTable(
  "transactions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    paymentMethod: paymentMethod("paymentMethod").notNull(),
    senderNumber: varchar("senderNumber", { length: 32 }).notNull(),
    transactionId: varchar("transactionId", { length: 128 }).notNull(),
    status: transactionStatus("status").default("pending").notNull(),
    approvedBy: integer("approvedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approvedAt", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex("transactions_transaction_id_unique").on(table.transactionId),
    uniqueIndex("transactions_user_pending_unique")
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    index("transactions_user_idx").on(table.userId, table.createdAt),
    index("transactions_status_idx").on(table.status, table.createdAt),
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
