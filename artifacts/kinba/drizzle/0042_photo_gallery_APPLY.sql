-- KINBA photo carousel support.
-- Safe and additive: existing photo rows keep using videos.videoUrl when gallery is NULL.
-- Review and apply manually in Supabase SQL Editor before publishing this feature.
BEGIN;
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "gallery" jsonb;
COMMIT;
