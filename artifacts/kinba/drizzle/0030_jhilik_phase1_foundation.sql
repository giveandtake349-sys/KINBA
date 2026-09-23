-- JHILIK Phase 1 — additive foundation only.
-- No DROP/RENAME/TRUNCATE. Existing tables and enums are untouched except
-- additive profiles."verificationStatus" with backfill from isVerified.
-- Forward: apply in order. Rollback: see docs/JHILIK_PHASE1_IMPLEMENTATION.md.

CREATE TYPE "public"."feature_flag_key" AS ENUM('discover_v2', 'jhilik_now', 'time_limited_communities', 'jhilik_drops', 'jhilik_rewards', 'video_rewards', 'milestone_rewards', 'free_verification');--> statement-breakpoint
CREATE TYPE "public"."hype_room_status" AS ENUM('scheduled', 'live', 'expired', 'archived');--> statement-breakpoint
CREATE TYPE "public"."hype_room_visibility" AS ENUM('public', 'link_only');--> statement-breakpoint
CREATE TYPE "public"."hype_room_member_role" AS ENUM('member', 'host');--> statement-breakpoint
CREATE TYPE "public"."drop_status" AS ENUM('draft', 'scheduled', 'live', 'sold_out', 'ended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."drop_claim_status" AS ENUM('claimed', 'released', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reward_action" AS ENUM('video_watch', 'daily_bonus', 'milestone', 'admin_credit', 'admin_debit', 'reversal', 'spend_placeholder');--> statement-breakpoint
CREATE TYPE "public"."reward_entry_status" AS ENUM('pending', 'approved', 'credited', 'rejected', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."reward_review_status" AS ENUM('none', 'flagged', 'cleared');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('none', 'eligible', 'pending', 'verified', 'business_verified', 'official');--> statement-breakpoint
CREATE TYPE "public"."verification_application_status" AS ENUM('pending', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."verification_class" AS ENUM('verified', 'business_verified', 'official');--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "feature_flags" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "feature_flags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"flagKey" "feature_flag_key" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"description" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedBy" integer
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "feature_flags_key_unique" ON "feature_flags" USING btree ("flagKey");--> statement-breakpoint
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_updatedBy_users_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drops" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drops_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sellerId" integer NOT NULL,
	"title" varchar(180) NOT NULL,
	"description" text NOT NULL,
	"terms" text NOT NULL,
	"mediaUrl" varchar(1024) NOT NULL,
	"mediaWidth" integer,
	"mediaHeight" integer,
	"currency" varchar(8) DEFAULT 'BDT' NOT NULL,
	"originalPrice" numeric(12, 2) NOT NULL,
	"discountedPrice" numeric(12, 2) NOT NULL,
	"quantity" integer NOT NULL,
	"remainingQuantity" integer NOT NULL,
	"status" "drop_status" DEFAULT 'draft' NOT NULL,
	"startsAt" timestamp with time zone,
	"endsAt" timestamp with time zone,
	"featured" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"featuredAt" timestamp with time zone,
	"endedAt" timestamp with time zone,
	"archivedAt" timestamp with time zone,
	CONSTRAINT "drops_quantity_check" CHECK ("quantity" > 0),
	CONSTRAINT "drops_remaining_check" CHECK ("remainingQuantity" >= 0),
	CONSTRAINT "drops_remaining_le_quantity_check" CHECK ("remainingQuantity" <= "quantity"),
	CONSTRAINT "drops_original_price_check" CHECK ("originalPrice" > 0),
	CONSTRAINT "drops_discounted_price_check" CHECK ("discountedPrice" > 0),
	CONSTRAINT "drops_discount_lt_original_check" CHECK ("discountedPrice" < "originalPrice")
);--> statement-breakpoint
ALTER TABLE "drops" ADD CONSTRAINT "drops_sellerId_users_id_fk" FOREIGN KEY ("sellerId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drops_status_ends_idx" ON "drops" USING btree ("status","endsAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drops_seller_created_idx" ON "drops" USING btree ("sellerId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drops_featured_idx" ON "drops" USING btree ("featured");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drops_status_idx" ON "drops" USING btree ("status");--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "drop_claims" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drop_claims_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"dropId" integer NOT NULL,
	"userId" integer NOT NULL,
	"status" "drop_claim_status" DEFAULT 'claimed' NOT NULL,
	"idempotencyKey" varchar(160) NOT NULL,
	"claimedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"fulfilledAt" timestamp with time zone,
	"cancelledAt" timestamp with time zone,
	"notes" text
);--> statement-breakpoint
ALTER TABLE "drop_claims" ADD CONSTRAINT "drop_claims_dropId_drops_id_fk" FOREIGN KEY ("dropId") REFERENCES "public"."drops"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drop_claims" ADD CONSTRAINT "drop_claims_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "drop_claims_idempotency_unique" ON "drop_claims" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "drop_claims_drop_user_unique" ON "drop_claims" USING btree ("dropId","userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drop_claims_user_claimed_idx" ON "drop_claims" USING btree ("userId","claimedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "drop_claims_drop_status_idx" ON "drop_claims" USING btree ("dropId","status");--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hype_rooms" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hype_rooms_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"hostId" integer NOT NULL,
	"title" varchar(180) NOT NULL,
	"topic" varchar(120),
	"description" text,
	"coverUrl" varchar(1024),
	"status" "hype_room_status" DEFAULT 'scheduled' NOT NULL,
	"durationHours" integer NOT NULL,
	"startsAt" timestamp with time zone NOT NULL,
	"endsAt" timestamp with time zone NOT NULL,
	"visibility" "hype_room_visibility" DEFAULT 'public' NOT NULL,
	"dropId" integer,
	"pinnedMessageId" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"expiredAt" timestamp with time zone,
	"archivedAt" timestamp with time zone,
	"cancelReason" text,
	CONSTRAINT "hype_rooms_duration_hours_check" CHECK ("durationHours" IN (4, 6, 12, 24))
);--> statement-breakpoint
ALTER TABLE "hype_rooms" ADD CONSTRAINT "hype_rooms_hostId_users_id_fk" FOREIGN KEY ("hostId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hype_rooms" ADD CONSTRAINT "hype_rooms_drop_fk" FOREIGN KEY ("dropId") REFERENCES "public"."drops"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_rooms_status_ends_idx" ON "hype_rooms" USING btree ("status","endsAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_rooms_status_starts_idx" ON "hype_rooms" USING btree ("status","startsAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_rooms_host_created_idx" ON "hype_rooms" USING btree ("hostId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_rooms_drop_idx" ON "hype_rooms" USING btree ("dropId");--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hype_room_members" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hype_room_members_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"roomId" integer NOT NULL,
	"userId" integer NOT NULL,
	"role" "hype_room_member_role" DEFAULT 'member' NOT NULL,
	"joinedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"leftAt" timestamp with time zone,
	"bannedAt" timestamp with time zone,
	"removedBy" integer
);--> statement-breakpoint
ALTER TABLE "hype_room_members" ADD CONSTRAINT "hype_room_members_roomId_hype_rooms_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."hype_rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hype_room_members" ADD CONSTRAINT "hype_room_members_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hype_room_members" ADD CONSTRAINT "hype_room_members_removedBy_users_id_fk" FOREIGN KEY ("removedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hype_room_members_room_user_unique" ON "hype_room_members" USING btree ("roomId","userId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_room_members_user_joined_idx" ON "hype_room_members" USING btree ("userId","joinedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_room_members_active_idx" ON "hype_room_members" USING btree ("roomId","leftAt");--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hype_room_messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hype_room_messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"roomId" integer NOT NULL,
	"userId" integer,
	"body" text,
	"audioUrl" text,
	"audioDuration" integer,
	"pinned" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"moderatedAt" timestamp with time zone,
	"moderatedBy" integer,
	"hiddenAt" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "hype_room_messages" ADD CONSTRAINT "hype_room_messages_roomId_hype_rooms_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."hype_rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hype_room_messages" ADD CONSTRAINT "hype_room_messages_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hype_room_messages" ADD CONSTRAINT "hype_room_messages_moderatedBy_users_id_fk" FOREIGN KEY ("moderatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_room_messages_room_created_idx" ON "hype_room_messages" USING btree ("roomId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_room_messages_user_idx" ON "hype_room_messages" USING btree ("userId");--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reward_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reward_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" varchar(80) NOT NULL,
	"action" "reward_action" NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"coinsAmount" integer NOT NULL,
	"dailyLimitPerUser" integer,
	"minWatchSeconds" integer,
	"watchPercentThreshold" integer,
	"minVideoDurationSeconds" integer,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedBy" integer,
	CONSTRAINT "reward_rules_coins_nonneg_check" CHECK ("coinsAmount" >= 0),
	CONSTRAINT "reward_rules_watch_percent_check" CHECK ("watchPercentThreshold" IS NULL OR ("watchPercentThreshold" BETWEEN 0 AND 100))
);--> statement-breakpoint
ALTER TABLE "reward_rules" ADD CONSTRAINT "reward_rules_updatedBy_users_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reward_rules_code_unique" ON "reward_rules" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_rules_action_enabled_idx" ON "reward_rules" USING btree ("action","enabled");--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reward_ledger_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reward_ledger_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"idempotencyKey" varchar(200) NOT NULL,
	"sourceType" varchar(64) NOT NULL,
	"sourceId" varchar(120),
	"action" "reward_action" NOT NULL,
	"amount" integer NOT NULL,
	"status" "reward_entry_status" DEFAULT 'pending' NOT NULL,
	"reviewStatus" "reward_review_status" DEFAULT 'none' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"approvedAt" timestamp with time zone,
	"creditedAt" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ruleId" integer,
	"adminId" integer,
	"reversesEntryId" integer,
	"reversedByEntryId" integer,
	CONSTRAINT "reward_ledger_amount_nonzero_check" CHECK ("amount" <> 0)
);--> statement-breakpoint
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_ruleId_reward_rules_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."reward_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_entries_adminId_users_id_fk" FOREIGN KEY ("adminId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_reverses_fk" FOREIGN KEY ("reversesEntryId") REFERENCES "public"."reward_ledger_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_ledger_entries" ADD CONSTRAINT "reward_ledger_reversed_by_fk" FOREIGN KEY ("reversedByEntryId") REFERENCES "public"."reward_ledger_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reward_ledger_idempotency_unique" ON "reward_ledger_entries" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_ledger_user_created_idx" ON "reward_ledger_entries" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_ledger_status_review_idx" ON "reward_ledger_entries" USING btree ("status","reviewStatus");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_ledger_source_idx" ON "reward_ledger_entries" USING btree ("sourceType","sourceId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_ledger_action_created_idx" ON "reward_ledger_entries" USING btree ("action","createdAt");--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "coin_accounts" (
	"userId" integer PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"lifetimeEarned" integer DEFAULT 0 NOT NULL,
	"lifetimeReversed" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coin_accounts_balance_nonneg_check" CHECK ("balance" >= 0)
);--> statement-breakpoint
ALTER TABLE "coin_accounts" ADD CONSTRAINT "coin_accounts_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reward_daily_usage" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reward_daily_usage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"dayKey" date NOT NULL,
	"action" "reward_action" NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"coinsToday" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "reward_daily_usage" ADD CONSTRAINT "reward_daily_usage_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reward_daily_usage_unique" ON "reward_daily_usage" USING btree ("userId","dayKey","action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reward_daily_usage_user_day_idx" ON "reward_daily_usage" USING btree ("userId","dayKey");--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "verification_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"key" varchar(64) NOT NULL,
	"minFollowers" integer DEFAULT 1000 NOT NULL,
	"minAccountAgeDays" integer DEFAULT 30 NOT NULL,
	"minProfileCompleteness" integer DEFAULT 0 NOT NULL,
	"maxOpenSeriousReports" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"ruleVersion" integer DEFAULT 1 NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedBy" integer
);--> statement-breakpoint
ALTER TABLE "verification_rules" ADD CONSTRAINT "verification_rules_updatedBy_users_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verification_rules_key_unique" ON "verification_rules" USING btree ("key");--> statement-breakpoint
--> statement-breakpoint
INSERT INTO "verification_rules" ("key", "minFollowers", "minAccountAgeDays", "minProfileCompleteness", "maxOpenSeriousReports", "enabled", "ruleVersion", "payload")
VALUES ('default', 1000, 30, 0, 0, true, 1, '{}'::jsonb)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "verification_applications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "verification_applications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"status" "verification_application_status" DEFAULT 'pending' NOT NULL,
	"requestedClass" "verification_class" DEFAULT 'verified' NOT NULL,
	"metricsSnapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidenceUrls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ruleVersion" integer DEFAULT 1 NOT NULL,
	"reviewerId" integer,
	"reviewNote" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"decidedAt" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "verification_applications" ADD CONSTRAINT "verification_applications_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_applications" ADD CONSTRAINT "verification_applications_reviewerId_users_id_fk" FOREIGN KEY ("reviewerId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "verification_applications_pending_unique" ON "verification_applications" USING btree ("userId") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_applications_status_created_idx" ON "verification_applications" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "verification_applications_user_idx" ON "verification_applications" USING btree ("userId","createdAt");--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "milestone_rules" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "milestone_rules_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" varchar(80) NOT NULL,
	"metric" varchar(64) NOT NULL,
	"threshold" integer NOT NULL,
	"coinsReward" integer DEFAULT 0 NOT NULL,
	"badgeKey" varchar(80),
	"enabled" boolean DEFAULT false NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedBy" integer,
	CONSTRAINT "milestone_rules_threshold_check" CHECK ("threshold" >= 0),
	CONSTRAINT "milestone_rules_coins_check" CHECK ("coinsReward" >= 0)
);--> statement-breakpoint
ALTER TABLE "milestone_rules" ADD CONSTRAINT "milestone_rules_updatedBy_users_id_fk" FOREIGN KEY ("updatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "milestone_rules_code_unique" ON "milestone_rules" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "milestone_rules_enabled_sort_idx" ON "milestone_rules" USING btree ("enabled","sortOrder");--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "milestone_awards" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "milestone_awards_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"ruleId" integer NOT NULL,
	"idempotencyKey" varchar(200) NOT NULL,
	"metricValueAtAward" integer NOT NULL,
	"ledgerEntryId" integer,
	"awardedAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "milestone_awards" ADD CONSTRAINT "milestone_awards_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_awards" ADD CONSTRAINT "milestone_awards_ruleId_milestone_rules_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."milestone_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_awards" ADD CONSTRAINT "milestone_awards_ledgerEntryId_reward_ledger_entries_id_fk" FOREIGN KEY ("ledgerEntryId") REFERENCES "public"."reward_ledger_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "milestone_awards_idempotency_unique" ON "milestone_awards" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "milestone_awards_user_rule_unique" ON "milestone_awards" USING btree ("userId","ruleId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "milestone_awards_rule_idx" ON "milestone_awards" USING btree ("ruleId");--> statement-breakpoint
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notifications" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"type" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"entityType" varchar(48),
	"entityId" integer,
	"link" varchar(512),
	"readAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_read_created_idx" ON "notifications" USING btree ("userId","readAt","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx" ON "notifications" USING btree ("userId","createdAt");--> statement-breakpoint
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "verificationStatus" "verification_status" DEFAULT 'none' NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profiles_verification_status_idx" ON "profiles" USING btree ("verificationStatus");--> statement-breakpoint
UPDATE "profiles" SET "verificationStatus" = 'verified' WHERE "isVerified" = true AND "verificationStatus" = 'none';
