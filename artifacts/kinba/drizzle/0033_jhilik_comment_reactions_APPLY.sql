-- JHILIK comment multi-reactions — additive only.
-- No DROP/TRUNCATE/RENAME. Legacy comment_likes is not altered.
-- CREATE TABLE / FK / INDEX only. No backfill.
-- REVIEW BEFORE RUNNING IN PRODUCTION — do not execute from automated deploy
-- without the same manual APPLY gate used for 0024/0030/0031/0032.
--
-- Idempotency / rerun safety:
-- - CREATE TABLE / CREATE INDEX use IF NOT EXISTS.
-- - ADD CONSTRAINT uses DO + pg_constraint guards (PostgreSQL has no
--   ADD CONSTRAINT IF NOT EXISTS).
-- - The DDL block is all-or-nothing inside BEGIN/COMMIT.
-- - Re-running the full file is safe for every guarded statement below.
BEGIN;
CREATE TABLE IF NOT EXISTS "comment_reactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "comment_reactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"commentId" integer NOT NULL,
	"userId" integer NOT NULL,
	"reaction" varchar(32) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.comment_reactions'::regclass
      AND conname = 'comment_reactions_commentId_video_comments_id_fk'
  ) THEN
    ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_commentId_video_comments_id_fk" FOREIGN KEY ("commentId") REFERENCES "public"."video_comments"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.comment_reactions'::regclass
      AND conname = 'comment_reactions_userId_users_id_fk'
  ) THEN
    ALTER TABLE "comment_reactions" ADD CONSTRAINT "comment_reactions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comment_reactions_unique" ON "comment_reactions" USING btree ("commentId","userId","reaction");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_reactions_comment_idx" ON "comment_reactions" USING btree ("commentId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_reactions_user_idx" ON "comment_reactions" USING btree ("userId");
COMMIT;
