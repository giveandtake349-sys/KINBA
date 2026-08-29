DO $$ BEGIN
  CREATE TYPE "signal_media_type" AS ENUM ('NONE', 'AUDIO', 'VIDEO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "mediaUrl" varchar(1024);
--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "mediaType" "signal_media_type" DEFAULT 'NONE' NOT NULL;
--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "mediaDuration" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('signal-media', 'signal-media', true, 26214400, ARRAY['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'video/webm', 'video/mp4', 'video/quicktime', 'video/ogg'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
--> statement-breakpoint
DROP POLICY IF EXISTS "NIVO members can upload their signal media" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "NIVO members can upload their signal media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'signal-media' AND (storage.foldername(name))[1] = (select auth.jwt()->>'sub'));
