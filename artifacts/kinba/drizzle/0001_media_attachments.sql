ALTER TABLE "messages" ADD COLUMN "imageUrl" varchar(1024);--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "imageUrl" varchar(1024);

--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('post-media', 'post-media', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('chat-media', 'chat-media', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
--> statement-breakpoint
DROP POLICY IF EXISTS "NIVO members can upload their post media" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "NIVO members can upload their post media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'post-media'
  AND (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);
--> statement-breakpoint
DROP POLICY IF EXISTS "NIVO members can upload their chat media" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "NIVO members can upload their chat media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'chat-media'
  AND (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);
