-- JHILIK unified binary reactions (M2) — additive only.
-- No DROP/TRUNCATE/RENAME. Existing rows on both tables are untouched except
-- that the new column's DEFAULT 'like' becomes their value (deterministic
-- backfill; every existing row resolves to reaction='like').
-- No index or constraint changes: *_pair_unique (target,userId) stays as-is
-- and remains the one-user-per-target invariant.
-- Legacy comment_likes / comment_reactions / hype_room_message_reactions are
-- not altered here; historical duplicates are out of scope for this step.
-- Do not execute against production from CI;
-- production uses the companion *_APPLY.sql under separate review.
--
-- Idempotency / rerun safety:
-- - ADD COLUMN uses IF NOT EXISTS (PostgreSQL has no DEFAULT IF NOT EXISTS,
--   but re-running the guarded ADD COLUMN is a no-op once the column exists).
-- - This canonical file has no BEGIN/COMMIT (drizzle-kit migration runner wraps the file);
--   the *_APPLY.sql companion wraps the same statements in BEGIN/COMMIT.
-- - No backfill statement is required: the column default covers existing rows.
ALTER TABLE "video_reactions" ADD COLUMN IF NOT EXISTS "reaction" varchar(32) DEFAULT 'like' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_reactions" ADD COLUMN IF NOT EXISTS "reaction" varchar(32) DEFAULT 'like' NOT NULL;
