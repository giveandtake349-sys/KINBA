-- JHILIK unified binary reactions (M2) — additive only.
-- No DROP/TRUNCATE/RENAME. Existing rows on both tables are untouched except
-- that the new column's DEFAULT 'like' becomes their value (deterministic
-- backfill; every existing row resolves to reaction='like').
-- No index or constraint changes: *_pair_unique (target,userId) stays as-is
-- and remains the one-user-per-target invariant.
-- Legacy comment_likes / comment_reactions / hype_room_message_reactions are
-- not altered here; historical duplicates are out of scope for this step.
-- REVIEW BEFORE RUNNING IN PRODUCTION — do not execute from automated deploy
-- without the same manual APPLY gate used for 0024/0030/0031/0032/0033.
--
-- Idempotency / rerun safety:
-- - ADD COLUMN uses IF NOT EXISTS; re-running the full file is a no-op once
--   the columns exist (PostgreSQL has no DEFAULT IF NOT EXISTS, but the guarded
--   ADD COLUMN short-circuits before any default is applied again).
-- - The DDL block is all-or-nothing inside BEGIN/COMMIT.
-- - No backfill statement is required: the column default covers existing rows.
-- - Rollback path (only after verifying all values are 'like'):
--   ALTER TABLE ... DROP COLUMN IF EXISTS "reaction";
BEGIN;
ALTER TABLE "video_reactions" ADD COLUMN IF NOT EXISTS "reaction" varchar(32) DEFAULT 'like' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_reactions" ADD COLUMN IF NOT EXISTS "reaction" varchar(32) DEFAULT 'like' NOT NULL;
COMMIT;
