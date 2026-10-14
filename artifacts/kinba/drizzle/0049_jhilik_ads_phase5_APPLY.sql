-- JHILIK Brand Advertising & Creator Campaign System — Phase 5 (additive, idempotent)
--
-- Content-type discriminator for measurement: the "videos" table is the
-- unified content table (media_type = VIDEO | IMAGE | TEXT), so tracking
-- covers photos, text posts, AND videos. These columns denormalize
-- videos.mediaType at record/rollup time for per-type dashboard breakdowns.
--
--   video_view_events.contentType — media_type, nullable
--   video_impressions.contentType — media_type, nullable
--   daily_content_stats.contentType — media_type, nullable
--
-- Idempotency: ADD COLUMN IF NOT EXISTS — safe to re-run. NO RLS (standing
-- convention: backend uses a direct DB connection; auth is enforced at the
-- tRPC layer).
-- APPLY ORDER (user): Phases 1–4 SQL+patches first → THIS file → Phase 5 patch → push.

BEGIN;

ALTER TABLE "video_view_events"
  ADD COLUMN IF NOT EXISTS "contentType" "media_type";

ALTER TABLE "video_impressions"
  ADD COLUMN IF NOT EXISTS "contentType" "media_type";

ALTER TABLE "daily_content_stats"
  ADD COLUMN IF NOT EXISTS "contentType" "media_type";

-- Backfill from the unified content table for rows recorded before Phase 5.
UPDATE "video_view_events" e
  SET "contentType" = v."mediaType"
  FROM "videos" v
  WHERE e."videoId" = v."id" AND e."contentType" IS NULL;

UPDATE "video_impressions" i
  SET "contentType" = v."mediaType"
  FROM "videos" v
  WHERE i."videoId" = v."id" AND i."contentType" IS NULL;

UPDATE "daily_content_stats" s
  SET "contentType" = v."mediaType"
  FROM "videos" v
  WHERE s."videoId" = v."id" AND s."contentType" IS NULL;

COMMIT;
