-- JHILIK Identity Completion v1 — additive only.
-- Adds display_name and birthday columns for identity completion.
--   display_name — nullable public display name, editable by user (profiles only).
--   birthday     — nullable private birthday, optional for user.
-- No DROP/TRUNCATE/RENAME. Existing rows keep NULL values (unchanged on client).
-- Do not make username NOT NULL in this phase; safe backfill first.
-- REVIEW BEFORE RUNNING IN PRODUCTION — do not execute from automated deploy
-- without the same manual APPLY gate used for 0024/0030/0031/0032/0033/0034/0037.
--
-- Idempotency / rerun safety:
-- - ADD COLUMN uses IF NOT EXISTS; re-running the full file is a no-op once they exist.
-- - No constraints added in this phase; username stays nullable.
-- - The DDL block is all-or-nothing inside BEGIN/COMMIT.
-- - Rollback path (if identity completion is abandoned):
--   ALTER TABLE "profiles" DROP COLUMN IF EXISTS "display_name";
--   ALTER TABLE "profiles" DROP COLUMN IF EXISTS "birthday";
BEGIN;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "display_name" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "birthday" date;
COMMIT;