-- KINBA community image/text post comment upgrade.
-- Run this file manually in the Supabase SQL Editor.
-- Safe to re-run.
BEGIN;

ALTER TABLE "community_comments"
  ALTER COLUMN "body" DROP NOT NULL;
ALTER TABLE "community_comments"
  ADD COLUMN IF NOT EXISTS "parentId" integer;
ALTER TABLE "community_comments"
  ADD COLUMN IF NOT EXISTS "editedAt" timestamp with time zone;
ALTER TABLE "community_comments"
  ADD COLUMN IF NOT EXISTS "pinnedAt" timestamp with time zone;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'community_comments_parentId_community_comments_id_fk'
  ) THEN
    ALTER TABLE "community_comments"
      ADD CONSTRAINT "community_comments_parentId_community_comments_id_fk"
      FOREIGN KEY ("parentId") REFERENCES "community_comments"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "community_comments_parent_idx" ON "community_comments" ("parentId");
CREATE INDEX IF NOT EXISTS "community_comments_pinned_idx" ON "community_comments" ("announcementId", "pinnedAt");

CREATE TABLE IF NOT EXISTS "community_comment_likes" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "commentId" integer NOT NULL REFERENCES "community_comments"("id") ON DELETE CASCADE,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "community_comment_likes_comment_user_unique" UNIQUE ("commentId", "userId")
);
CREATE INDEX IF NOT EXISTS "community_comment_likes_comment_idx" ON "community_comment_likes" ("commentId");

CREATE TABLE IF NOT EXISTS "community_comment_reactions" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "commentId" integer NOT NULL REFERENCES "community_comments"("id") ON DELETE CASCADE,
  "userId" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reaction" varchar(32) NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "community_comment_reactions_unique" UNIQUE ("commentId", "userId", "reaction")
);
CREATE INDEX IF NOT EXISTS "community_comment_reactions_comment_idx" ON "community_comment_reactions" ("commentId");

COMMIT;
