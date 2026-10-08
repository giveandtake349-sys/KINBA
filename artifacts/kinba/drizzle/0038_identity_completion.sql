-- JHILIK Identity Completion v1 — additive only.
-- Adds display_name and birthday columns for identity completion.
--   display_name — nullable public display name, editable by user (profiles only).
--   birthday     — nullable private birthday, optional for user.
-- No DROP/TRUNCATE/RENAME. Existing rows keep NULL values (unchanged on client).
-- Do not make username NOT NULL in this phase; safe backfill first.
-- REVIEW BEFORE RUNNING IN PRODUCTION — manual APPLY gate required.
--
-- Idempotency / rerun safety:
-- - ADD COLUMN uses IF NOT EXISTS (re-runnable).
-- - No constraints added in this phase; username stays nullable.
-- - This canonical file has no BEGIN/COMMIT (drizzle-kit wraps);
--   the *_APPLY.sql companion wraps the same statements in BEGIN/COMMIT.
-- - Rollback path (if identity completion is abandoned):
--   ALTER TABLE "profiles" DROP COLUMN IF EXISTS "display_name";
--   ALTER TABLE "profiles" DROP COLUMN IF EXISTS "birthday";
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "display_name" text;
ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "birthday" date;