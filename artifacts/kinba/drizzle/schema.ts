import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const appRole = pgEnum("app_role", ["user", "admin"]);
export const videoKind = pgEnum("video_kind", ["LONG", "SHORT", "WHEEL"]);
export const mediaType = pgEnum("media_type", ["VIDEO", "IMAGE"]);
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

export const sponsorBidsSessionStatus = pgEnum("sponsor_bids_session_status", [
  "scheduled",
  "live",
  "completed",
  "cancelled",
]);

export const sponsorBidsSessions = pgTable(
  "sponsor_bids_sessions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    title: varchar("title", { length: 180 }).notNull(),
    status: sponsorBidsSessionStatus("status").default("scheduled").notNull(),
    startsAt: timestamp("startsAt", { withTimezone: true }),
    endsAt: timestamp("endsAt", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    index("sponsor_bids_sessions_status_idx").on(table.status),
    index("sponsor_bids_sessions_starts_idx").on(table.startsAt),
  ]
);

export const participants = pgTable(
  "participants",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: integer("sessionId")
      .notNull()
      .references(() => sponsorBidsSessions.id, { onDelete: "cascade" }),
    joinedAt: createdAt(),
  },
  table => [
    uniqueIndex("participants_session_user_unique").on(
      table.sessionId,
      table.userId
    ),
    index("participants_user_idx").on(table.userId),
    index("participants_session_idx").on(table.sessionId, table.joinedAt),
  ]
);

export const liveSponsorStatus = pgEnum("live_sponsor_status", [
  "pending",
  "approved",
  "rejected",
]);
export const liveSponsors = pgTable(
  "live_sponsors",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    sessionId: integer("sessionId")
      .notNull()
      .references(() => sponsorBidsSessions.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    logoUrl: varchar("logoUrl", { length: 1024 }).notNull(),
    externalLink: varchar("externalLink", { length: 2048 }).notNull(),
    sponsoredAmount: numeric("sponsoredAmount", {
      precision: 12,
      scale: 2,
    }).notNull(),
    status: liveSponsorStatus("status").default("pending").notNull(),
    sponsoredAt: createdAt(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  },
  table => [
    index("live_sponsors_session_idx").on(table.sessionId, table.sponsoredAt),
    index("live_sponsors_expiry_idx").on(table.expiresAt),
  ]
);

export const sponsorBidsDraws = pgTable(
  "sponsor_bids_draws",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    sessionId: integer("sessionId")
      .notNull()
      .references(() => sponsorBidsSessions.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    nomineeParticipantIds: jsonb("nomineeParticipantIds")
      .$type<number[]>()
      .notNull(),
    selectedParticipantId: integer("selectedParticipantId").references(
      () => participants.id,
      { onDelete: "set null" }
    ),
    preliminaryAt: timestamp("preliminaryAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    selectedAt: timestamp("selectedAt", { withTimezone: true }),
  },
  table => [
    uniqueIndex("sponsor_bids_draws_session_rank_unique").on(
      table.sessionId,
      table.rank
    ),
    index("sponsor_bids_draws_session_idx").on(table.sessionId, table.rank),
  ]
);

export const sessionWinners = pgTable(
  "session_winners",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    sessionId: integer("sessionId")
      .notNull()
      .references(() => sponsorBidsSessions.id, { onDelete: "cascade" }),
    participantId: integer("participantId")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    rank: integer("rank").notNull(),
    prizeAmount: numeric("prizeAmount", { precision: 12, scale: 2 }).notNull(),
    awardedAt: createdAt(),
  },
  table => [
    uniqueIndex("session_winners_session_participant_unique").on(
      table.sessionId,
      table.participantId
    ),
    uniqueIndex("session_winners_session_rank_unique").on(
      table.sessionId,
      table.rank
    ),
    index("session_winners_session_idx").on(table.sessionId, table.awardedAt),
  ]
);

export const walletTransactionType = pgEnum("wallet_transaction_type", [
  "sponsor_bids_entry",
  "sponsor_payment",
  "sponsor_bids_prize",
]);

export const wallets = pgTable(
  "wallets",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    balance: numeric("balance", { precision: 12, scale: 2 })
      .default("0.00")
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [uniqueIndex("wallets_user_unique").on(table.userId)]
);

export const walletTransactions = pgTable(
  "wallet_transactions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    walletId: integer("walletId")
      .notNull()
      .references(() => wallets.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: integer("sessionId")
      .notNull()
      .references(() => sponsorBidsSessions.id, { onDelete: "cascade" }),
    participantId: integer("participantId").references(() => participants.id, {
      onDelete: "cascade",
    }),
    type: walletTransactionType("type").notNull(),
    referenceKey: varchar("referenceKey", { length: 160 }).notNull(),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex("wallet_transactions_user_session_reference_unique").on(
      table.userId,
      table.sessionId,
      table.referenceKey
    ),
    index("wallet_transactions_wallet_idx").on(table.walletId, table.createdAt),
    index("wallet_transactions_session_idx").on(
      table.sessionId,
      table.createdAt
    ),
  ]
);

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
    mediaType: mediaType("mediaType").default("VIDEO").notNull(),
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

export const rawPulsePolls = pgTable(
  "raw_pulse_polls",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    videoId: integer("video_id")
      .notNull()
      .references(() => videos.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex("raw_pulse_polls_video_unique").on(table.videoId),
    index("raw_pulse_polls_expires_idx").on(table.expiresAt),
  ]
);

export const rawPulseOptions = pgTable(
  "raw_pulse_options",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    pollId: integer("poll_id")
      .notNull()
      .references(() => rawPulsePolls.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  table => [index("raw_pulse_options_poll_idx").on(table.pollId)]
);

export const rawPulseVotes = pgTable(
  "raw_pulse_votes",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    pollId: integer("poll_id")
      .notNull()
      .references(() => rawPulsePolls.id, { onDelete: "cascade" }),
    optionId: integer("option_id")
      .notNull()
      .references(() => rawPulseOptions.id, { onDelete: "cascade" }),
    voterKey: text("voter_key").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex("raw_pulse_votes_poll_voter_unique").on(table.pollId, table.voterKey),
    index("raw_pulse_votes_option_idx").on(table.optionId),
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

export const videoBookmarks = pgTable(
  "video_bookmarks",
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
    uniqueIndex("video_bookmarks_pair_unique").on(table.videoId, table.userId),
    index("video_bookmarks_video_idx").on(table.videoId),
    index("video_bookmarks_user_idx").on(table.userId),
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
    body: text("body"),
    audioUrl: text("audio_url"),
    audioDuration: integer("audio_duration"),
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

export const communityComments = pgTable(
  "community_comments",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    announcementId: integer("announcementId")
      .notNull()
      .references(() => communityAnnouncements.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    audioUrl: text("audio_url"),
    audioDuration: integer("audio_duration"),
    createdAt: createdAt(),
  },
  table => [
    index("community_comments_announcement_idx").on(
      table.announcementId,
      table.createdAt
    ),
    index("community_comments_user_idx").on(table.userId),
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

export const communityReactions = pgTable(
  "community_reactions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    announcementId: integer("announcementId")
      .notNull()
      .references(() => communityAnnouncements.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex("community_reactions_pair_unique").on(
      table.announcementId,
      table.userId
    ),
    index("community_reactions_announcement_idx").on(table.announcementId),
    index("community_reactions_user_idx").on(table.userId),
  ]
);

export const communityBookmarks = pgTable(
  "community_bookmarks",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    announcementId: integer("announcementId")
      .notNull()
      .references(() => communityAnnouncements.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex("community_bookmarks_pair_unique").on(
      table.announcementId,
      table.userId
    ),
    index("community_bookmarks_announcement_idx").on(table.announcementId),
    index("community_bookmarks_user_idx").on(table.userId),
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
