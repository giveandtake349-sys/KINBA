-- JHILIK Comment upgrades — edit + creator pin (additive only).
-- Adds two nullable video_comments columns declared in drizzle/schema.ts:
--   editedAt — null = never edited (author edit window is enforced in the API)
--   pinnedAt — non-null = pinned to the top of the video's comments by the
--              post owner (the API keeps at most one pinned root per video)
-- No DROP/TRUNCATE/RENAME. No existing table, column, index or constraint is
-- altered; no rows are backfilled or rewritten.
-- Do not execute against production from CI; production uses the companion
-- *_APPLY.sql under separate review.
--
-- Idempotency / rerun safety: ADD COLUMN and CREATE INDEX use IF NOT EXISTS.
-- Rollback path (only if the feature is abandoned and no edit/pin data must
-- be kept):
--   DROP INDEX IF EXISTS "video_comments_pinned_idx";
--   ALTER TABLE "video_comments" DROP COLUMN IF EXISTS "pinnedAt";
--   ALTER TABLE "video_comments" DROP COLUMN IF EXISTS "editedAt";
ALTER TABLE "video_comments" ADD COLUMN IF NOT EXISTS "editedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_comments" ADD COLUMN IF NOT EXISTS "pinnedAt" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "video_comments_pinned_idx" ON "video_comments" USING btree ("videoId", "pinnedAt");
