import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
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
export const mediaType = pgEnum("media_type", ["VIDEO", "IMAGE", "TEXT"]);
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

// JHILIK Phase 1 enums (new names only; existing enums untouched).
export const featureFlagKey = pgEnum("feature_flag_key", [
  "discover_v2",
  "jhilik_now",
  "time_limited_communities",
  "jhilik_drops",
  "jhilik_rewards",
  "video_rewards",
  "milestone_rewards",
  "free_verification",
  "moderation_v1",
]);
export const hypeRoomStatus = pgEnum("hype_room_status", [
  "scheduled",
  "live",
  "expired",
  "archived",
]);
export const hypeRoomVisibility = pgEnum("hype_room_visibility", [
  "public",
  "link_only",
]);
export const hypeRoomMemberRole = pgEnum("hype_room_member_role", [
  "member",
  "host",
]);
export const dropStatus = pgEnum("drop_status", [
  "draft",
  "scheduled",
  "live",
  "sold_out",
  "ended",
  "archived",
]);
export const dropClaimStatus = pgEnum("drop_claim_status", [
  "claimed",
  "released",
  "fulfilled",
  "cancelled",
]);
export const rewardAction = pgEnum("reward_action", [
  "video_watch",
  "daily_bonus",
  "milestone",
  "admin_credit",
  "admin_debit",
  "reversal",
  "spend_placeholder",
]);
export const rewardEntryStatus = pgEnum("reward_entry_status", [
  "pending",
  "approved",
  "credited",
  "rejected",
  "reversed",
]);
export const rewardReviewStatus = pgEnum("reward_review_status", [
  "none",
  "flagged",
  "cleared",
]);
export const verificationStatus = pgEnum("verification_status", [
  "none",
  "eligible",
  "pending",
  "verified",
  "business_verified",
  "official",
]);
export const verificationApplicationStatus = pgEnum(
  "verification_application_status",
  ["pending", "approved", "rejected", "withdrawn"]
);
export const verificationClass = pgEnum("verification_class", [
  "verified",
  "business_verified",
  "official",
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
    // Free-verification multi-state (additive). Legacy isVerified remains the
    // badge flag for existing UI; paid path keeps writing both fields.
    verificationStatus: verificationStatus("verificationStatus")
      .default("none")
      .notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex("profiles_userId_unique").on(table.userId),
    uniqueIndex("profiles_username_unique").on(table.username),
    index("profiles_verification_status_idx").on(table.verificationStatus),
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
    parentId: integer("parentId"),
    createdAt: createdAt(),
  },
  table => [
    index("video_comments_video_idx").on(table.videoId, table.createdAt),
    index("video_comments_user_idx").on(table.userId),
    index("video_comments_parent_idx").on(table.parentId),
    foreignKey({
      name: "video_comments_parentId_video_comments_id_fk",
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete("cascade"),
  ]
);
export const commentLikes = pgTable(
  "comment_likes",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    commentId: integer("commentId")
      .notNull()
      .references(() => videoComments.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  table => [
    uniqueIndex("comment_likes_comment_user_unique").on(
      table.commentId,
      table.userId
    ),
    index("comment_likes_comment_idx").on(table.commentId),
    index("comment_likes_user_idx").on(table.userId),
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

// ---------------------------------------------------------------------------
// JHILIK Phase 1 — additive schema foundation (no destructive changes).
// product comments match docs/JHILIK_MASTER_PRODUCT_SPEC.md §20.
// ---------------------------------------------------------------------------

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    flagKey: featureFlagKey("flagKey").notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    description: text("description"),
    updatedAt: updatedAt(),
    updatedBy: integer("updatedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  table => [uniqueIndex("feature_flags_key_unique").on(table.flagKey)]
);

export const drops = pgTable(
  "drops",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    sellerId: integer("sellerId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 180 }).notNull(),
    description: text("description").notNull(),
    terms: text("terms").notNull(),
    mediaUrl: varchar("mediaUrl", { length: 1024 }).notNull(),
    mediaWidth: integer("mediaWidth"),
    mediaHeight: integer("mediaHeight"),
    currency: varchar("currency", { length: 8 }).default("BDT").notNull(),
    originalPrice: numeric("originalPrice", { precision: 12, scale: 2 }).notNull(),
    discountedPrice: numeric("discountedPrice", { precision: 12, scale: 2 }).notNull(),
    quantity: integer("quantity").notNull(),
    remainingQuantity: integer("remainingQuantity").notNull(),
    status: dropStatus("status").default("draft").notNull(),
    startsAt: timestamp("startsAt", { withTimezone: true }),
    endsAt: timestamp("endsAt", { withTimezone: true }),
    featured: boolean("featured").default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    featuredAt: timestamp("featuredAt", { withTimezone: true }),
    endedAt: timestamp("endedAt", { withTimezone: true }),
    archivedAt: timestamp("archivedAt", { withTimezone: true }),
  },
  table => [
    index("drops_status_ends_idx").on(table.status, table.endsAt),
    index("drops_seller_created_idx").on(table.sellerId, table.createdAt),
    index("drops_featured_idx").on(table.featured),
    index("drops_status_idx").on(table.status),
    check("drops_quantity_check", sql`"quantity" > 0`),
    check("drops_remaining_check", sql`"remainingQuantity" >= 0`),
    check(
      "drops_remaining_le_quantity_check",
      sql`"remainingQuantity" <= "quantity"`
    ),
    check("drops_original_price_check", sql`"originalPrice" > 0`),
    check("drops_discounted_price_check", sql`"discountedPrice" > 0`),
    check(
      "drops_discount_lt_original_check",
      sql`"discountedPrice" < "originalPrice"`
    ),
  ]
);

export const dropClaims = pgTable(
  "drop_claims",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    dropId: integer("dropId")
      .notNull()
      .references(() => drops.id, { onDelete: "restrict" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: dropClaimStatus("status").default("claimed").notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 160 }).notNull(),
    claimedAt: createdAt(),
    updatedAt: updatedAt(),
    fulfilledAt: timestamp("fulfilledAt", { withTimezone: true }),
    cancelledAt: timestamp("cancelledAt", { withTimezone: true }),
    notes: text("notes"),
  },
  table => [
    uniqueIndex("drop_claims_idempotency_unique").on(table.idempotencyKey),
    uniqueIndex("drop_claims_drop_user_unique").on(table.dropId, table.userId),
    index("drop_claims_user_claimed_idx").on(table.userId, table.claimedAt),
    index("drop_claims_drop_status_idx").on(table.dropId, table.status),
  ]
);

export const hypeRooms = pgTable(
  "hype_rooms",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    // RESTRICT: preserve room history if a host account is deleted; handle
    // host cleanup explicitly (archive / anonymize) instead of cascading away
    // historical rooms and transcripts.
    hostId: integer("hostId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 180 }).notNull(),
    topic: varchar("topic", { length: 120 }),
    description: text("description"),
    coverUrl: varchar("coverUrl", { length: 1024 }),
    status: hypeRoomStatus("status").default("scheduled").notNull(),
    durationHours: integer("durationHours").notNull(),
    startsAt: timestamp("startsAt", { withTimezone: true }).notNull(),
    endsAt: timestamp("endsAt", { withTimezone: true }).notNull(),
    visibility: hypeRoomVisibility("visibility").default("public").notNull(),
    dropId: integer("dropId"),
    pinnedMessageId: integer("pinnedMessageId"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    expiredAt: timestamp("expiredAt", { withTimezone: true }),
    archivedAt: timestamp("archivedAt", { withTimezone: true }),
    cancelReason: text("cancelReason"),
  },
  table => [
    index("hype_rooms_status_ends_idx").on(table.status, table.endsAt),
    index("hype_rooms_status_starts_idx").on(table.status, table.startsAt),
    index("hype_rooms_host_created_idx").on(table.hostId, table.createdAt),
    index("hype_rooms_drop_idx").on(table.dropId),
    check(
      "hype_rooms_duration_hours_check",
      sql`"durationHours" IN (4, 6, 12, 24)`
    ),
    // Nullable FK to drops (defined above) — avoids circular required FKs.
    foreignKey({
      name: "hype_rooms_drop_fk",
      columns: [table.dropId],
      foreignColumns: [drops.id],
    }).onDelete("set null"),
  ]
);

export const hypeRoomMembers = pgTable(
  "hype_room_members",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    roomId: integer("roomId")
      .notNull()
      .references(() => hypeRooms.id, { onDelete: "cascade" }),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: hypeRoomMemberRole("role").default("member").notNull(),
    joinedAt: timestamp("joinedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    leftAt: timestamp("leftAt", { withTimezone: true }),
    bannedAt: timestamp("bannedAt", { withTimezone: true }),
    removedBy: integer("removedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  table => [
    uniqueIndex("hype_room_members_room_user_unique").on(
      table.roomId,
      table.userId
    ),
    index("hype_room_members_user_joined_idx").on(table.userId, table.joinedAt),
    index("hype_room_members_active_idx").on(table.roomId, table.leftAt),
  ]
);

export const hypeRoomMessages = pgTable(
  "hype_room_messages",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    // RESTRICT: never hard-delete a room that has transcript rows; archive instead.
    roomId: integer("roomId")
      .notNull()
      .references(() => hypeRooms.id, { onDelete: "restrict" }),
    // SET NULL: keep historical messages if the author account is removed.
    userId: integer("userId").references(() => users.id, { onDelete: "set null" }),
    body: text("body"),
    audioUrl: text("audioUrl"),
    audioDuration: integer("audioDuration"),
    pinned: boolean("pinned").default(false).notNull(),
    createdAt: createdAt(),
    moderatedAt: timestamp("moderatedAt", { withTimezone: true }),
    moderatedBy: integer("moderatedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    hiddenAt: timestamp("hiddenAt", { withTimezone: true }),
  },
  table => [
    index("hype_room_messages_room_created_idx").on(table.roomId, table.createdAt),
    index("hype_room_messages_user_idx").on(table.userId),
  ]
);

export const rewardRules = pgTable(
  "reward_rules",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    code: varchar("code", { length: 80 }).notNull(),
    action: rewardAction("action").notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    coinsAmount: integer("coinsAmount").notNull(),
    dailyLimitPerUser: integer("dailyLimitPerUser"),
    minWatchSeconds: integer("minWatchSeconds"),
    watchPercentThreshold: integer("watchPercentThreshold"),
    minVideoDurationSeconds: integer("minVideoDurationSeconds"),
    config: jsonb("config").default({}).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: integer("updatedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  table => [
    uniqueIndex("reward_rules_code_unique").on(table.code),
    index("reward_rules_action_enabled_idx").on(table.action, table.enabled),
    check("reward_rules_coins_nonneg_check", sql`"coinsAmount" >= 0`),
    check(
      "reward_rules_watch_percent_check",
      sql`"watchPercentThreshold" IS NULL OR ("watchPercentThreshold" BETWEEN 0 AND 100)`
    ),
  ]
);

export const rewardLedgerEntries = pgTable(
  "reward_ledger_entries",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotencyKey", { length: 200 }).notNull(),
    sourceType: varchar("sourceType", { length: 64 }).notNull(),
    sourceId: varchar("sourceId", { length: 120 }),
    action: rewardAction("action").notNull(),
    amount: integer("amount").notNull(),
    status: rewardEntryStatus("status").default("pending").notNull(),
    reviewStatus: rewardReviewStatus("reviewStatus").default("none").notNull(),
    createdAt: createdAt(),
    approvedAt: timestamp("approvedAt", { withTimezone: true }),
    creditedAt: timestamp("creditedAt", { withTimezone: true }),
    metadata: jsonb("metadata").default({}).notNull(),
    ruleId: integer("ruleId").references(() => rewardRules.id, {
      onDelete: "set null",
    }),
    adminId: integer("adminId").references(() => users.id, { onDelete: "set null" }),
    reversesEntryId: integer("reversesEntryId"),
    reversedByEntryId: integer("reversedByEntryId"),
  },
  table => [
    uniqueIndex("reward_ledger_idempotency_unique").on(table.idempotencyKey),
    index("reward_ledger_user_created_idx").on(table.userId, table.createdAt),
    index("reward_ledger_status_review_idx").on(table.status, table.reviewStatus),
    index("reward_ledger_source_idx").on(table.sourceType, table.sourceId),
    index("reward_ledger_action_created_idx").on(table.action, table.createdAt),
    foreignKey({
      name: "reward_ledger_reverses_fk",
      columns: [table.reversesEntryId],
      foreignColumns: [table.id],
    }).onDelete("set null"),
    foreignKey({
      name: "reward_ledger_reversed_by_fk",
      columns: [table.reversedByEntryId],
      foreignColumns: [table.id],
    }).onDelete("set null"),
    check("reward_ledger_amount_nonzero_check", sql`"amount" <> 0`),
  ]
);

export const coinAccounts = pgTable(
  "coin_accounts",
  {
    userId: integer("userId")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    balance: integer("balance").default(0).notNull(),
    lifetimeEarned: integer("lifetimeEarned").default(0).notNull(),
    lifetimeReversed: integer("lifetimeReversed").default(0).notNull(),
    updatedAt: updatedAt(),
  },
  table => [check("coin_accounts_balance_nonneg_check", sql`"balance" >= 0`)]
);

export const rewardDailyUsage = pgTable(
  "reward_daily_usage",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dayKey: date("dayKey").notNull(),
    action: rewardAction("action").notNull(),
    count: integer("count").default(0).notNull(),
    coinsToday: integer("coinsToday").default(0).notNull(),
    updatedAt: updatedAt(),
  },
  table => [
    uniqueIndex("reward_daily_usage_unique").on(
      table.userId,
      table.dayKey,
      table.action
    ),
    index("reward_daily_usage_user_day_idx").on(table.userId, table.dayKey),
  ]
);

export const verificationRules = pgTable(
  "verification_rules",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    key: varchar("key", { length: 64 }).notNull(),
    minFollowers: integer("minFollowers").default(1000).notNull(),
    minAccountAgeDays: integer("minAccountAgeDays").default(30).notNull(),
    minProfileCompleteness: integer("minProfileCompleteness").default(0).notNull(),
    maxOpenSeriousReports: integer("maxOpenSeriousReports").default(0).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    ruleVersion: integer("ruleVersion").default(1).notNull(),
    payload: jsonb("payload").default({}).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: integer("updatedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  table => [uniqueIndex("verification_rules_key_unique").on(table.key)]
);

export const verificationApplications = pgTable(
  "verification_applications",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: verificationApplicationStatus("status").default("pending").notNull(),
    requestedClass: verificationClass("requestedClass").default("verified").notNull(),
    metricsSnapshot: jsonb("metricsSnapshot").default({}).notNull(),
    evidenceUrls: jsonb("evidenceUrls").default([]).notNull(),
    ruleVersion: integer("ruleVersion").default(1).notNull(),
    reviewerId: integer("reviewerId").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewNote: text("reviewNote"),
    createdAt: createdAt(),
    decidedAt: timestamp("decidedAt", { withTimezone: true }),
  },
  table => [
    uniqueIndex("verification_applications_pending_unique")
      .on(table.userId)
      .where(sql`${table.status} = 'pending'`),
    index("verification_applications_status_created_idx").on(
      table.status,
      table.createdAt
    ),
    index("verification_applications_user_idx").on(table.userId, table.createdAt),
  ]
);

export const milestoneRules = pgTable(
  "milestone_rules",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    code: varchar("code", { length: 80 }).notNull(),
    metric: varchar("metric", { length: 64 }).notNull(),
    threshold: integer("threshold").notNull(),
    coinsReward: integer("coinsReward").default(0).notNull(),
    badgeKey: varchar("badgeKey", { length: 80 }),
    enabled: boolean("enabled").default(false).notNull(),
    sortOrder: integer("sortOrder").default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: integer("updatedBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  table => [
    uniqueIndex("milestone_rules_code_unique").on(table.code),
    index("milestone_rules_enabled_sort_idx").on(table.enabled, table.sortOrder),
    check("milestone_rules_threshold_check", sql`"threshold" >= 0`),
    check("milestone_rules_coins_check", sql`"coinsReward" >= 0`),
  ]
);

export const milestoneAwards = pgTable(
  "milestone_awards",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ruleId: integer("ruleId")
      .notNull()
      .references(() => milestoneRules.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotencyKey", { length: 200 }).notNull(),
    metricValueAtAward: integer("metricValueAtAward").notNull(),
    ledgerEntryId: integer("ledgerEntryId").references(
      () => rewardLedgerEntries.id,
      { onDelete: "set null" }
    ),
    awardedAt: createdAt(),
  },
  table => [
    uniqueIndex("milestone_awards_idempotency_unique").on(table.idempotencyKey),
    uniqueIndex("milestone_awards_user_rule_unique").on(table.userId, table.ruleId),
    index("milestone_awards_rule_idx").on(table.ruleId),
  ]
);

export const notifications = pgTable(
  "notifications",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 64 }).notNull(),
    title: text("title").notNull(),
    body: text("body"),
    entityType: varchar("entityType", { length: 48 }),
    entityId: integer("entityId"),
    link: varchar("link", { length: 512 }),
    readAt: timestamp("readAt", { withTimezone: true }),
    createdAt: createdAt(),
  },
  table => [
    index("notifications_user_read_created_idx").on(
      table.userId,
      table.readAt,
      table.createdAt
    ),
    index("notifications_user_created_idx").on(table.userId, table.createdAt),
  ]
);

// ---------------------------------------------------------------------------
// JHILIK Phase 2 M9 — moderation (additive only; legacy `reports` untouched).
// Spec §20.2 moderation_actions + §25 multi-target user reports.
// ---------------------------------------------------------------------------

export const moderationReports = pgTable(
  "moderation_reports",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    reporterId: integer("reporterId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: varchar("targetType", { length: 32 }).notNull(),
    targetId: integer("targetId").notNull(),
    reason: varchar("reason", { length: 120 }).notNull(),
    details: text("details"),
    status: varchar("status", { length: 16 }).default("open").notNull(),
    resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
    resolvedBy: integer("resolvedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  table => [
    index("moderation_reports_target_idx").on(table.targetType, table.targetId),
    index("moderation_reports_status_created_idx").on(
      table.status,
      table.createdAt
    ),
    index("moderation_reports_reporter_target_idx").on(
      table.reporterId,
      table.targetType,
      table.targetId
    ),
  ]
);

export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: integer("id").generatedAlwaysAsIdentity().primaryKey(),
    adminId: integer("adminId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    action: varchar("action", { length: 64 }).notNull(),
    targetType: varchar("targetType", { length: 32 }).notNull(),
    targetId: integer("targetId").notNull(),
    reason: text("reason").notNull(),
    metadata: jsonb("metadata"),
    createdAt: createdAt(),
  },
  table => [
    index("moderation_actions_target_idx").on(table.targetType, table.targetId),
    index("moderation_actions_admin_created_idx").on(
      table.adminId,
      table.createdAt
    ),
  ]
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type FeatureFlagRow = typeof featureFlags.$inferSelect;
export type RewardLedgerEntry = typeof rewardLedgerEntries.$inferSelect;
export type HypeRoomRow = typeof hypeRooms.$inferSelect;
export type DropRow = typeof drops.$inferSelect;
export type ModerationReportRow = typeof moderationReports.$inferSelect;
export type ModerationActionRow = typeof moderationActions.$inferSelect;
