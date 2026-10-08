-- JHILIK Phase 2B — Hashtag Foundation (additive only).
-- Creates canonical hashtags table + 7 explicit many-to-many association tables.
-- No DROP/TRUNCATE/RENAME. No existing table, column, index or constraint is altered.
-- REVIEW BEFORE RUNNING IN PRODUCTION — do not execute from automated deploy
-- without the same manual APPLY gate used for 0024/0030/0031/0032/0033/0034/0037/0038.
--
-- Idempotency / rerun safety:
-- - CREATE TABLE / CREATE UNIQUE INDEX / CREATE INDEX use IF NOT EXISTS.
-- - ALTER TYPE ... ADD VALUE uses IF NOT EXISTS (must stay outside BEGIN/COMMIT).
-- - ADD CONSTRAINT uses DO + pg_constraint guards (PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS).
-- - The DDL block is all-or-nothing inside BEGIN/COMMIT.
-- - Rollback path (if hashtag feature is abandoned):
--   DROP TABLE IF EXISTS "video_hashtags";
--   DROP TABLE IF EXISTS "video_comment_hashtags";
--   DROP TABLE IF EXISTS "announcement_hashtags";
--   DROP TABLE IF EXISTS "community_comment_hashtags";
--   DROP TABLE IF EXISTS "hype_room_hashtags";
--   DROP TABLE IF EXISTS "hype_room_message_hashtags";
--   DROP TABLE IF EXISTS "drop_hashtags";
--   DROP TABLE IF EXISTS "hashtags";

BEGIN;
CREATE TABLE IF NOT EXISTS "hashtags" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hashtags_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
  "tag" text NOT NULL,
  "display_tag" text NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "hashtags_tag_unique" ON "hashtags" USING btree ("tag");
CREATE INDEX IF NOT EXISTS "hashtags_created_idx" ON "hashtags" USING btree ("createdAt");

CREATE TABLE IF NOT EXISTS "video_hashtags" (
  "video_id" integer NOT NULL,
  "hashtag_id" integer NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.video_hashtags'::regclass
      AND conname = 'video_hashtags_video_id_videos_id_fk'
  ) THEN
    ALTER TABLE "video_hashtags" ADD CONSTRAINT "video_hashtags_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.video_hashtags'::regclass
      AND conname = 'video_hashtags_hashtag_id_hashtags_id_fk'
  ) THEN
    ALTER TABLE "video_hashtags" ADD CONSTRAINT "video_hashtags_hashtag_id_hashtags_id_fk" FOREIGN KEY ("hashtag_id") REFERENCES "public"."hashtags"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "video_hashtags_pk" ON "video_hashtags" USING btree ("video_id","hashtag_id");
CREATE INDEX IF NOT EXISTS "video_hashtags_hashtag_idx" ON "video_hashtags" USING btree ("hashtag_id");

CREATE TABLE IF NOT EXISTS "video_comment_hashtags" (
  "comment_id" integer NOT NULL,
  "hashtag_id" integer NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.video_comment_hashtags'::regclass
      AND conname = 'video_comment_hashtags_comment_id_video_comments_id_fk'
  ) THEN
    ALTER TABLE "video_comment_hashtags" ADD CONSTRAINT "video_comment_hashtags_comment_id_video_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."video_comments"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.video_comment_hashtags'::regclass
      AND conname = 'video_comment_hashtags_hashtag_id_hashtags_id_fk'
  ) THEN
    ALTER TABLE "video_comment_hashtags" ADD CONSTRAINT "video_comment_hashtags_hashtag_id_hashtags_id_fk" FOREIGN KEY ("hashtag_id") REFERENCES "public"."hashtags"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "video_comment_hashtags_pk" ON "video_comment_hashtags" USING btree ("comment_id","hashtag_id");
CREATE INDEX IF NOT EXISTS "video_comment_hashtags_hashtag_idx" ON "video_comment_hashtags" USING btree ("hashtag_id");

CREATE TABLE IF NOT EXISTS "announcement_hashtags" (
  "announcement_id" integer NOT NULL,
  "hashtag_id" integer NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.announcement_hashtags'::regclass
      AND conname = 'announcement_hashtags_announcement_id_community_announcements_id_fk'
  ) THEN
    ALTER TABLE "announcement_hashtags" ADD CONSTRAINT "announcement_hashtags_announcement_id_community_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."community_announcements"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.announcement_hashtags'::regclass
      AND conname = 'announcement_hashtags_hashtag_id_hashtags_id_fk'
  ) THEN
    ALTER TABLE "announcement_hashtags" ADD CONSTRAINT "announcement_hashtags_hashtag_id_hashtags_id_fk" FOREIGN KEY ("hashtag_id") REFERENCES "public"."hashtags"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "announcement_hashtags_pk" ON "announcement_hashtags" USING btree ("announcement_id","hashtag_id");
CREATE INDEX IF NOT EXISTS "announcement_hashtags_hashtag_idx" ON "announcement_hashtags" USING btree ("hashtag_id");

CREATE TABLE IF NOT EXISTS "community_comment_hashtags" (
  "comment_id" integer NOT NULL,
  "hashtag_id" integer NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.community_comment_hashtags'::regclass
      AND conname = 'community_comment_hashtags_comment_id_community_comments_id_fk'
  ) THEN
    ALTER TABLE "community_comment_hashtags" ADD CONSTRAINT "community_comment_hashtags_comment_id_community_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."community_comments"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.community_comment_hashtags'::regclass
      AND conname = 'community_comment_hashtags_hashtag_id_hashtags_id_fk'
  ) THEN
    ALTER TABLE "community_comment_hashtags" ADD CONSTRAINT "community_comment_hashtags_hashtag_id_hashtags_id_fk" FOREIGN KEY ("hashtag_id") REFERENCES "public"."hashtags"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "community_comment_hashtags_pk" ON "community_comment_hashtags" USING btree ("comment_id","hashtag_id");
CREATE INDEX IF NOT EXISTS "community_comment_hashtags_hashtag_idx" ON "community_comment_hashtags" USING btree ("hashtag_id");

CREATE TABLE IF NOT EXISTS "hype_room_hashtags" (
  "room_id" integer NOT NULL,
  "hashtag_id" integer NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_hashtags'::regclass
      AND conname = 'hype_room_hashtags_room_id_hype_rooms_id_fk'
  ) THEN
    ALTER TABLE "hype_room_hashtags" ADD CONSTRAINT "hype_room_hashtags_room_id_hype_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."hype_rooms"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_hashtags'::regclass
      AND conname = 'hype_room_hashtags_hashtag_id_hashtags_id_fk'
  ) THEN
    ALTER TABLE "hype_room_hashtags" ADD CONSTRAINT "hype_room_hashtags_hashtag_id_hashtags_id_fk" FOREIGN KEY ("hashtag_id") REFERENCES "public"."hashtags"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "hype_room_hashtags_pk" ON "hype_room_hashtags" USING btree ("room_id","hashtag_id");
CREATE INDEX IF NOT EXISTS "hype_room_hashtags_hashtag_idx" ON "hype_room_hashtags" USING btree ("hashtag_id");

CREATE TABLE IF NOT EXISTS "hype_room_message_hashtags" (
  "message_id" integer NOT NULL,
  "hashtag_id" integer NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_message_hashtags'::regclass
      AND conname = 'hype_room_message_hashtags_message_id_hype_room_messages_id_fk'
  ) THEN
    ALTER TABLE "hype_room_message_hashtags" ADD CONSTRAINT "hype_room_message_hashtags_message_id_hype_room_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."hype_room_messages"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_message_hashtags'::regclass
      AND conname = 'hype_room_message_hashtags_hashtag_id_hashtags_id_fk'
  ) THEN
    ALTER TABLE "hype_room_message_hashtags" ADD CONSTRAINT "hype_room_message_hashtags_hashtag_id_hashtags_id_fk" FOREIGN KEY ("hashtag_id") REFERENCES "public"."hashtags"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "hype_room_message_hashtags_pk" ON "hype_room_message_hashtags" USING btree ("message_id","hashtag_id");
CREATE INDEX IF NOT EXISTS "hype_room_message_hashtags_hashtag_idx" ON "hype_room_message_hashtags" USING btree ("hashtag_id");

CREATE TABLE IF NOT EXISTS "drop_hashtags" (
  "drop_id" integer NOT NULL,
  "hashtag_id" integer NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.drop_hashtags'::regclass
      AND conname = 'drop_hashtags_drop_id_drops_id_fk'
  ) THEN
    ALTER TABLE "drop_hashtags" ADD CONSTRAINT "drop_hashtags_drop_id_drops_id_fk" FOREIGN KEY ("drop_id") REFERENCES "public"."drops"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.drop_hashtags'::regclass
      AND conname = 'drop_hashtags_hashtag_id_hashtags_id_fk'
  ) THEN
    ALTER TABLE "drop_hashtags" ADD CONSTRAINT "drop_hashtags_hashtag_id_hashtags_id_fk" FOREIGN KEY ("hashtag_id") REFERENCES "public"."hashtags"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "drop_hashtags_pk" ON "drop_hashtags" USING btree ("drop_id","hashtag_id");
CREATE INDEX IF NOT EXISTS "drop_hashtags_hashtag_idx" ON "drop_hashtags" USING btree ("hashtag_id");
COMMIT;