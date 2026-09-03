ALTER TABLE "video_comments"
  ADD COLUMN IF NOT EXISTS "audio_url" text,
  ADD COLUMN IF NOT EXISTS "audio_duration" integer;

ALTER TABLE "community_comments"
  ADD COLUMN IF NOT EXISTS "audio_url" text,
  ADD COLUMN IF NOT EXISTS "audio_duration" integer;
