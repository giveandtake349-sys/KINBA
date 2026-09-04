ALTER TABLE "video_comments"
  ADD COLUMN IF NOT EXISTS "audio_url" text,
  ADD COLUMN IF NOT EXISTS "audio_duration" integer;
--> statement-breakpoint
ALTER TABLE "video_comments"
  ALTER COLUMN "body" DROP NOT NULL;
