-- JHILIK DM Message Actions v1 — additive only.
-- Adds the three nullable dm_messages columns declared in drizzle/schema.ts:
--   editedAt    — null = never edited (Edit allowed <= 30 minutes after createdAt)
--   deletedAt   — null = live; soft delete keeps the row so replies and
--                 dm_conversation_reads.lastReadMessageId keep resolving
--   replyToId   — one-level reply parent inside the same conversation
-- No DROP/TRUNCATE/RENAME. No pre-existing table, column, index or constraint
-- is altered or dropped here; no rows are backfilled or rewritten.
-- dm_message_requests is deliberately untouched (it has no conversationId and
-- must never gain one).
-- Do not execute against production from CI;
-- production uses the companion *_APPLY.sql under separate review.
--
-- Idempotency / rerun safety:
-- - ADD COLUMN uses IF NOT EXISTS (re-runnable).
-- - CREATE INDEX uses IF NOT EXISTS.
-- - ADD CONSTRAINT uses a DO + pg_constraint guard (PostgreSQL has no
--   ADD CONSTRAINT IF NOT EXISTS).
-- - This canonical file has no BEGIN/COMMIT (drizzle-kit migration runner
--   wraps the file); the *_APPLY.sql companion wraps the same statements in
--   BEGIN/COMMIT.
-- - Rollback path (only if message actions are abandoned and no edited/
--   deleted/reply data must be kept):
--   ALTER TABLE "dm_messages" DROP CONSTRAINT IF EXISTS
--     "dm_messages_replyToId_dm_messages_id_fk";
--   DROP INDEX IF EXISTS "dm_messages_reply_idx";
--   ALTER TABLE "dm_messages" DROP COLUMN IF EXISTS "replyToId";
--   ALTER TABLE "dm_messages" DROP COLUMN IF EXISTS "deletedAt";
--   ALTER TABLE "dm_messages" DROP COLUMN IF EXISTS "editedAt";
ALTER TABLE "dm_messages" ADD COLUMN IF NOT EXISTS "editedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dm_messages" ADD COLUMN IF NOT EXISTS "deletedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dm_messages" ADD COLUMN IF NOT EXISTS "replyToId" integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dm_messages_reply_idx" ON "dm_messages" USING btree ("replyToId");--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.dm_messages'::regclass
      AND conname = 'dm_messages_replyToId_dm_messages_id_fk'
  ) THEN
    ALTER TABLE "dm_messages" ADD CONSTRAINT "dm_messages_replyToId_dm_messages_id_fk" FOREIGN KEY ("replyToId") REFERENCES "public"."dm_messages"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
