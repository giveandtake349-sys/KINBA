-- JHILIK Hype Room upgrade — optional product/website link (additive only).
-- No DROP/TRUNCATE/RENAME. Existing hype_rooms rows are untouched; the new
-- column is nullable so every existing room keeps linkUrl = NULL (renders
-- nothing on the client).
-- REVIEW BEFORE RUNNING IN PRODUCTION — do not execute from automated deploy
-- without the same manual APPLY gate used for 0024/0030/0031/0032/0033/0034.
--
-- Idempotency / rerun safety:
-- - ADD COLUMN uses IF NOT EXISTS; re-running the full file is a no-op once
--   the column exists.
-- - The DDL block is all-or-nothing inside BEGIN/COMMIT.
-- - Rollback path (only after confirming no room links are in use):
--   ALTER TABLE "hype_rooms" DROP COLUMN IF EXISTS "linkUrl";
BEGIN;
ALTER TABLE "hype_rooms" ADD COLUMN IF NOT EXISTS "linkUrl" varchar(2048);
COMMIT;
