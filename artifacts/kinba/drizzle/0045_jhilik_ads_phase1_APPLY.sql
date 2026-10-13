-- JHILIK Brand Advertising & Creator Campaign System — Phase 1 (additive, idempotent)
--
-- New tables: brands, brand_applications, brand_links, campaigns,
-- campaign_invitations, campaign_submissions, campaign_links,
-- campaign_earnings (FIAT ledger — NOT the integer-coin reward ledger),
-- campaign_audit_log, video_view_events, video_impressions, link_clicks,
-- daily_content_stats, daily_campaign_stats, rate_limit_buckets.
-- Only delta on an existing table: videos."campaignId" (nullable).
--
-- Idempotency / rerun safety:
-- - CREATE TYPE uses DO + duplicate_object guard (no CREATE TYPE IF NOT EXISTS).
-- - CREATE TABLE / CREATE INDEX / ADD COLUMN all use IF NOT EXISTS.
-- - ADD CONSTRAINT uses DO + pg_constraint guard.
-- - Partial apply: pre-BEGIN type mutations persist if the DDL block fails;
--   the DDL block itself is all-or-nothing. Re-running the full file is safe.
--
-- APPLY ORDER (user): run this file FIRST, then apply the code patch, then push.

-- ---------- enums ----------
DO $$
BEGIN
  CREATE TYPE "public"."brand_application_status" AS ENUM('draft', 'submitted', 'pending', 'info_requested', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'active', 'paused', 'ended');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "public"."campaign_invitation_status" AS ENUM('pending', 'accepted', 'declined', 'expired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "public"."campaign_submission_status" AS ENUM('draft', 'in_review', 'approved', 'rejected', 'live');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  CREATE TYPE "public"."campaign_earnings_status" AS ENUM('estimated', 'approved', 'reversed', 'paid_recorded');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

BEGIN;

-- ---------- brands ----------
CREATE TABLE IF NOT EXISTS "public"."brands" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "userId" integer NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "name" varchar(160) NOT NULL,
  "category" varchar(80),
  "contactPerson" varchar(120),
  "email" varchar(320),
  "phone" varchar(32),
  "country" varchar(64),
  "website" varchar(2048),
  "socials" jsonb,
  "productDetails" text,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "brands_user_idx" ON "public"."brands" ("userId");

-- ---------- brand_applications ----------
CREATE TABLE IF NOT EXISTS "public"."brand_applications" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "userId" integer NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "brandName" varchar(160) NOT NULL,
  "category" varchar(80),
  "contactPerson" varchar(120),
  "email" varchar(320),
  "phone" varchar(32),
  "country" varchar(64),
  "targetMarket" varchar(64),
  "website" varchar(2048),
  "socials" jsonb,
  "productDetails" text,
  "objectives" text[],
  "formats" text[],
  "budgetAmount" numeric(12,2),
  "budgetCurrency" char(3),
  "serviceFee" numeric(12,2),
  "creatorPool" numeric(12,2),
  "startsAt" timestamp with time zone,
  "endsAt" timestamp with time zone,
  "audience" jsonb,
  "status" "public"."brand_application_status" DEFAULT 'draft' NOT NULL,
  "reviewedBy" integer REFERENCES "public"."users"("id") ON DELETE set null,
  "reviewedAt" timestamp with time zone,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "brand_applications_user_idx" ON "public"."brand_applications" ("userId");
CREATE INDEX IF NOT EXISTS "brand_applications_status_idx" ON "public"."brand_applications" ("status");

-- ---------- brand_links ----------
CREATE TABLE IF NOT EXISTS "public"."brand_links" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "applicationId" integer NOT NULL REFERENCES "public"."brand_applications"("id") ON DELETE cascade,
  "kind" varchar(32),
  "label" varchar(160),
  "url" varchar(2048) NOT NULL,
  "productName" varchar(200),
  "price" numeric(12,2),
  "imageUrl" varchar(1024),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "brand_links_application_idx" ON "public"."brand_links" ("applicationId");

-- ---------- campaigns ----------
CREATE TABLE IF NOT EXISTS "public"."campaigns" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "applicationId" integer REFERENCES "public"."brand_applications"("id") ON DELETE set null,
  "title" varchar(200) NOT NULL,
  "brief" text,
  "concepts" jsonb,
  "validationQuestions" jsonb,
  "startsAt" timestamp with time zone,
  "endsAt" timestamp with time zone,
  "status" "public"."campaign_status" DEFAULT 'draft' NOT NULL,
  "budgetTotal" numeric(12,2),
  "budgetCurrency" char(3),
  "serviceFee" numeric(12,2),
  "creatorPool" numeric(12,2),
  "dropId" integer REFERENCES "public"."drops"("id") ON DELETE set null,
  "createdBy" integer REFERENCES "public"."users"("id") ON DELETE set null,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "campaigns_application_idx" ON "public"."campaigns" ("applicationId");
CREATE INDEX IF NOT EXISTS "campaigns_status_idx" ON "public"."campaigns" ("status");
CREATE INDEX IF NOT EXISTS "campaigns_drop_idx" ON "public"."campaigns" ("dropId");

-- ---------- campaign_invitations ----------
CREATE TABLE IF NOT EXISTS "public"."campaign_invitations" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "campaignId" integer NOT NULL REFERENCES "public"."campaigns"("id") ON DELETE cascade,
  "userId" integer NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "status" "public"."campaign_invitation_status" DEFAULT 'pending' NOT NULL,
  "rewardAmount" numeric(12,2),
  "rewardCurrency" char(3),
  "invitedAt" timestamp with time zone DEFAULT now() NOT NULL,
  "respondedAt" timestamp with time zone,
  "expiresAt" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_invitations_unique" ON "public"."campaign_invitations" ("campaignId", "userId");
CREATE INDEX IF NOT EXISTS "campaign_invitations_campaign_idx" ON "public"."campaign_invitations" ("campaignId");
CREATE INDEX IF NOT EXISTS "campaign_invitations_user_idx" ON "public"."campaign_invitations" ("userId");

-- ---------- campaign_submissions ----------
CREATE TABLE IF NOT EXISTS "public"."campaign_submissions" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "campaignId" integer NOT NULL REFERENCES "public"."campaigns"("id") ON DELETE cascade,
  "creatorId" integer NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "videoId" integer REFERENCES "public"."videos"("id") ON DELETE set null,
  "answers" jsonb,
  "autoChecks" jsonb,
  "reviewStatus" "public"."campaign_submission_status" DEFAULT 'draft' NOT NULL,
  "rewardEligible" boolean DEFAULT false NOT NULL,
  "submittedAt" timestamp with time zone,
  "reviewedAt" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "campaign_submissions_campaign_idx" ON "public"."campaign_submissions" ("campaignId");
CREATE INDEX IF NOT EXISTS "campaign_submissions_creator_idx" ON "public"."campaign_submissions" ("creatorId");
CREATE INDEX IF NOT EXISTS "campaign_submissions_video_idx" ON "public"."campaign_submissions" ("videoId");

-- ---------- campaign_links ----------
CREATE TABLE IF NOT EXISTS "public"."campaign_links" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "campaignId" integer NOT NULL REFERENCES "public"."campaigns"("id") ON DELETE cascade,
  "kind" varchar(32),
  "label" varchar(160),
  "url" varchar(2048) NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "campaign_links_campaign_idx" ON "public"."campaign_links" ("campaignId");

-- ---------- campaign_earnings (FIAT ledger) ----------
CREATE TABLE IF NOT EXISTS "public"."campaign_earnings" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "campaignId" integer NOT NULL REFERENCES "public"."campaigns"("id") ON DELETE cascade,
  "submissionId" integer REFERENCES "public"."campaign_submissions"("id") ON DELETE set null,
  "creatorId" integer NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "amount" numeric(12,2) NOT NULL,
  "currency" char(3) NOT NULL,
  "status" "public"."campaign_earnings_status" DEFAULT 'estimated' NOT NULL,
  "idempotencyKey" varchar(200) NOT NULL UNIQUE,
  "adminId" integer REFERENCES "public"."users"("id") ON DELETE set null,
  "reason" text,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "decidedAt" timestamp with time zone
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_earnings_currency_check'
  ) THEN
    ALTER TABLE "public"."campaign_earnings"
      ADD CONSTRAINT "campaign_earnings_currency_check"
      CHECK ("currency" IN ('USD', 'BDT'));
  END IF;
END $$;
-- One live earning per submission (dup-proof at the DB level).
CREATE UNIQUE INDEX IF NOT EXISTS "campaign_earnings_submission_unique"
  ON "public"."campaign_earnings" ("campaignId", "submissionId")
  WHERE "status" IN ('estimated', 'approved', 'paid_recorded');
CREATE INDEX IF NOT EXISTS "campaign_earnings_campaign_idx" ON "public"."campaign_earnings" ("campaignId");
CREATE INDEX IF NOT EXISTS "campaign_earnings_creator_idx" ON "public"."campaign_earnings" ("creatorId");
CREATE INDEX IF NOT EXISTS "campaign_earnings_status_idx" ON "public"."campaign_earnings" ("status");

-- ---------- campaign_audit_log (append-only) ----------
CREATE TABLE IF NOT EXISTS "public"."campaign_audit_log" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "campaignId" integer REFERENCES "public"."campaigns"("id") ON DELETE set null,
  "applicationId" integer REFERENCES "public"."brand_applications"("id") ON DELETE set null,
  "actorId" integer NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "action" varchar(64) NOT NULL,
  "details" jsonb,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "campaign_audit_log_campaign_idx" ON "public"."campaign_audit_log" ("campaignId");
CREATE INDEX IF NOT EXISTS "campaign_audit_log_application_idx" ON "public"."campaign_audit_log" ("applicationId");
CREATE INDEX IF NOT EXISTS "campaign_audit_log_created_idx" ON "public"."campaign_audit_log" ("createdAt");

-- ---------- video_view_events ----------
CREATE TABLE IF NOT EXISTS "public"."video_view_events" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "videoId" integer NOT NULL REFERENCES "public"."videos"("id") ON DELETE cascade,
  "campaignId" integer REFERENCES "public"."campaigns"("id") ON DELETE set null,
  "viewerHash" char(64) NOT NULL,
  "userId" integer REFERENCES "public"."users"("id") ON DELETE set null,
  "userAgent" varchar(512),
  "source" varchar(32),
  "day" date NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "video_view_events_dedup"
  ON "public"."video_view_events" ("videoId", "viewerHash", "day");
CREATE INDEX IF NOT EXISTS "video_view_events_video_created_idx"
  ON "public"."video_view_events" ("videoId", "createdAt");
CREATE INDEX IF NOT EXISTS "video_view_events_campaign_created_idx"
  ON "public"."video_view_events" ("campaignId", "createdAt");

-- ---------- video_impressions ----------
CREATE TABLE IF NOT EXISTS "public"."video_impressions" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "videoId" integer NOT NULL REFERENCES "public"."videos"("id") ON DELETE cascade,
  "campaignId" integer REFERENCES "public"."campaigns"("id") ON DELETE set null,
  "viewerHash" char(64) NOT NULL,
  "userId" integer REFERENCES "public"."users"("id") ON DELETE set null,
  "day" date NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "video_impressions_dedup"
  ON "public"."video_impressions" ("videoId", "viewerHash", "day");
CREATE INDEX IF NOT EXISTS "video_impressions_video_created_idx"
  ON "public"."video_impressions" ("videoId", "createdAt");

-- ---------- link_clicks ----------
CREATE TABLE IF NOT EXISTS "public"."link_clicks" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "linkId" integer REFERENCES "public"."campaign_links"("id") ON DELETE set null,
  "videoId" integer REFERENCES "public"."videos"("id") ON DELETE set null,
  "campaignId" integer REFERENCES "public"."campaigns"("id") ON DELETE set null,
  "userId" integer REFERENCES "public"."users"("id") ON DELETE set null,
  "ipHash" char(64),
  "userAgent" varchar(512),
  "referrer" varchar(1024),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "link_clicks_link_created_idx"
  ON "public"."link_clicks" ("linkId", "createdAt");
CREATE INDEX IF NOT EXISTS "link_clicks_campaign_created_idx"
  ON "public"."link_clicks" ("campaignId", "createdAt");

-- ---------- daily_content_stats ----------
CREATE TABLE IF NOT EXISTS "public"."daily_content_stats" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "videoId" integer NOT NULL REFERENCES "public"."videos"("id") ON DELETE cascade,
  "day" date NOT NULL,
  "views" integer DEFAULT 0 NOT NULL,
  "impressions" integer DEFAULT 0 NOT NULL,
  "clicks" integer DEFAULT 0 NOT NULL,
  "uniqueViewers" integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "daily_content_stats_unique"
  ON "public"."daily_content_stats" ("videoId", "day");

-- ---------- daily_campaign_stats ----------
CREATE TABLE IF NOT EXISTS "public"."daily_campaign_stats" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "campaignId" integer NOT NULL REFERENCES "public"."campaigns"("id") ON DELETE cascade,
  "day" date NOT NULL,
  "views" integer DEFAULT 0 NOT NULL,
  "impressions" integer DEFAULT 0 NOT NULL,
  "clicks" integer DEFAULT 0 NOT NULL,
  "spend" numeric(12,2) DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "daily_campaign_stats_unique"
  ON "public"."daily_campaign_stats" ("campaignId", "day");

-- ---------- rate_limit_buckets ----------
CREATE TABLE IF NOT EXISTS "public"."rate_limit_buckets" (
  "key" varchar(200) NOT NULL,
  "windowStart" timestamp with time zone NOT NULL,
  "count" integer DEFAULT 0 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "rate_limit_buckets_unique"
  ON "public"."rate_limit_buckets" ("key", "windowStart");

-- ---------- videos.campaignId (only delta on an existing table) ----------
ALTER TABLE "public"."videos" ADD COLUMN IF NOT EXISTS "campaignId" integer;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'videos_campaignId_fkey'
  ) THEN
    ALTER TABLE "public"."videos"
      ADD CONSTRAINT "videos_campaignId_fkey"
      FOREIGN KEY ("campaignId") REFERENCES "public"."campaigns"("id") ON DELETE set null;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "videos_campaign_idx" ON "public"."videos" ("campaignId");

COMMIT;
