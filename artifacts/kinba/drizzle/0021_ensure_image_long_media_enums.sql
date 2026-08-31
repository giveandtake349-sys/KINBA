DO $$
BEGIN
  CREATE TYPE "public"."media_type" AS ENUM ('VIDEO', 'IMAGE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
ALTER TYPE "public"."media_type" ADD VALUE IF NOT EXISTS 'IMAGE';--> statement-breakpoint
ALTER TYPE "public"."video_kind" ADD VALUE IF NOT EXISTS 'LONG';--> statement-breakpoint
ALTER TABLE "videos"
  ADD COLUMN IF NOT EXISTS "mediaType" "public"."media_type" DEFAULT 'VIDEO' NOT NULL;
