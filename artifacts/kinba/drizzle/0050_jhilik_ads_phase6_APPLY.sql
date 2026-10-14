-- JHILIK Brand Advertising — Phase 6 (additive, idempotent)
--
-- 1) Campaign run-mode retrofit (Phases 1–5 campaigns): FB-style flexible
--    run. `campaigns.runMode` = 'continuous' (default, no end date — runs
--    until budget exhausted or manually paused/ended) | 'scheduled'
--    (fixed start/end dates, legacy behavior).
-- 2) Video pre-roll ads: preroll_ads / preroll_plays / preroll_settings.
-- 3) campaign_earnings: campaignId becomes nullable (pre-roll earnings are
--    not tied to a campaign) + prerollPlayId link.
--
-- Idempotency: DO-guarded enum creation, ADD COLUMN IF NOT EXISTS,
-- CREATE TABLE IF NOT EXISTS — safe to re-run. NO RLS (standing
-- convention: backend uses a direct DB connection; auth is enforced at the
-- tRPC layer).
-- APPLY ORDER (user): Phases 1–5 SQL+patches first → THIS file → Phase 6 patch → push.

BEGIN;

-- 1) Run-mode enum + column -------------------------------------------
DO $$ BEGIN
  CREATE TYPE "campaign_run_mode" AS ENUM ('continuous', 'scheduled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "runMode" "campaign_run_mode"
  DEFAULT 'continuous' NOT NULL;

-- 2) Pre-roll enum ------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE "preroll_ad_status" AS ENUM ('draft', 'active', 'paused', 'ended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 3) Pre-roll tables ----------------------------------------------------
CREATE TABLE IF NOT EXISTS "preroll_ads" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(120) NOT NULL,
  "videoUrl" varchar(1024) NOT NULL,
  "thumbnailUrl" varchar(1024),
  "dropId" integer REFERENCES "drops"("id") ON DELETE SET NULL,
  "status" "preroll_ad_status" DEFAULT 'draft' NOT NULL,
  "budgetCents" integer NOT NULL,
  "spentCents" integer DEFAULT 0 NOT NULL,
  "currency" char(3) DEFAULT 'USD' NOT NULL,
  "startsAt" timestamptz,
  "createdAt" timestamptz DEFAULT NOW() NOT NULL,
  "updatedAt" timestamptz DEFAULT NOW() NOT NULL,
  CONSTRAINT "preroll_ads_currency_check" CHECK ("currency" IN ('USD', 'BDT')),
  CONSTRAINT "preroll_ads_budget_check" CHECK ("budgetCents" > 0),
  CONSTRAINT "preroll_ads_spent_check" CHECK ("spentCents" >= 0)
);
CREATE INDEX IF NOT EXISTS "preroll_ads_user_idx" ON "preroll_ads" ("userId");
CREATE INDEX IF NOT EXISTS "preroll_ads_status_idx" ON "preroll_ads" ("status");

CREATE TABLE IF NOT EXISTS "preroll_plays" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "adId" integer NOT NULL REFERENCES "preroll_ads"("id") ON DELETE CASCADE,
  "videoId" integer REFERENCES "videos"("id") ON DELETE SET NULL,
  "creatorId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "viewerHash" char(64) NOT NULL,
  "watchedSecs" integer DEFAULT 0 NOT NULL,
  "skipped" boolean DEFAULT false NOT NULL,
  "completed" boolean DEFAULT false NOT NULL,
  "revenueCents" integer NOT NULL,
  "creatorShareCents" integer NOT NULL,
  "createdAt" timestamptz DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS "preroll_plays_ad_idx" ON "preroll_plays" ("adId");
CREATE INDEX IF NOT EXISTS "preroll_plays_creator_idx" ON "preroll_plays" ("creatorId");
CREATE INDEX IF NOT EXISTS "preroll_plays_viewer_day_idx" ON "preroll_plays" ("viewerHash", "createdAt");

CREATE TABLE IF NOT EXISTS "preroll_settings" (
  "id" integer PRIMARY KEY,
  "minFollowers" integer DEFAULT 1000 NOT NULL,
  "minViews" integer DEFAULT 10000 NOT NULL,
  "costPerPlayCents" integer DEFAULT 2 NOT NULL,
  "maxPlaysPerViewerPerDay" integer DEFAULT 20 NOT NULL,
  "updatedAt" timestamptz DEFAULT NOW() NOT NULL,
  CONSTRAINT "preroll_settings_single_row" CHECK ("id" = 1),
  CONSTRAINT "preroll_settings_cost_check" CHECK ("costPerPlayCents" > 0)
);

-- Seed the single settings row (defaults; admin can change in UI).
INSERT INTO "preroll_settings"
  ("id", "minFollowers", "minViews", "costPerPlayCents", "maxPlaysPerViewerPerDay")
VALUES (1, 1000, 10000, 2, 20)
ON CONFLICT ("id") DO NOTHING;

-- 4) campaign_earnings: allow pre-roll rows --------------------------------
-- campaignId NULL = pre-roll ad earning (not tied to a campaign).
ALTER TABLE "campaign_earnings"
  ALTER COLUMN "campaignId" DROP NOT NULL;

ALTER TABLE "campaign_earnings"
  ADD COLUMN IF NOT EXISTS "prerollPlayId" integer
  REFERENCES "preroll_plays"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "campaign_earnings_preroll_play_idx"
  ON "campaign_earnings" ("prerollPlayId");

COMMIT;
