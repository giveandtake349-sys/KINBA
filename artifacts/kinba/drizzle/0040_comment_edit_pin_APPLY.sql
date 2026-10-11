-- JHILIK Comment upgrades — edit + creator pin (additive only).
-- Adds nullable video_comments.editedAt / video_comments.pinnedAt plus an
-- index on (videoId, pinnedAt). Existing comments keep editedAt = NULL and
-- pinnedAt = NULL, so they render exactly as before.
-- REVIEW BEFORE RUNNING IN PRODUCTION — do not execute from automated deploy
-- without the same manual APPLY gate used for the earlier *_APPLY.sql files.
--
-- Idempotency / rerun safety: every statement uses IF NOT EXISTS; the block is
-- all-or-nothing inside BEGIN/COMMIT.
BEGIN;
ALTER TABLE "video_comments" ADD COLUMN IF NOT EXISTS "editedAt" timestamp with time zone;
ALTER TABLE "video_comments" ADD COLUMN IF NOT EXISTS "pinnedAt" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "video_comments_pinned_idx" ON "video_comments" USING btree ("videoId", "pinnedAt");
COMMIT;
