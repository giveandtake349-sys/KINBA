-- JHILIK DM Message Actions v1 — additive only.
-- Adds the three nullable dm_messages columns declared in drizzle/schema.ts:
--   editedAt    — null = never edited (Edit allowed <= 30 minutes after createdAt)
--   deletedAt   — null = live; soft delete keeps the row so replies and
--                 dm_conversation_reads.lastReadMessageId keep resolving
--   replyToId   — one-level reply parent inside the same conversation
-- No DROP/TRUNCATE/RENAME. Existing dm_messages rows are untouched; all three
-- columns are nullable so every existing message keeps editedAt = NULL,
-- deletedAt = NULL, replyToId = NULL (renders unchanged on the client).
-- dm_message_requests is deliberately untouched.
-- REVIEW BEFORE RUNNING IN PRODUCTION — do not execute from automated deploy
-- without the same manual APPLY gate used for 0024/0030/0031/0032/0033/0034.
--
-- Idempotency / rerun safety:
-- - ADD COLUMN and CREATE INDEX use IF NOT EXISTS; re-running the full file is
--   a no-op once they exist; the FK guard skips an existing constraint.
-- - The DDL block is all-or-nothing inside BEGIN/COMMIT.
BEGIN;
ALTER TABLE "dm_messages" ADD COLUMN IF NOT EXISTS "editedAt" timestamp with time zone;
ALTER TABLE "dm_messages" ADD COLUMN IF NOT EXISTS "deletedAt" timestamp with time zone;
ALTER TABLE "dm_messages" ADD COLUMN IF NOT EXISTS "replyToId" integer;
CREATE INDEX IF NOT EXISTS "dm_messages_reply_idx" ON "dm_messages" USING btree ("replyToId");
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
COMMIT;
