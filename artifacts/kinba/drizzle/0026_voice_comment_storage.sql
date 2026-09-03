INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'comment-media',
  'comment-media',
  true,
  10485760,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'audio/webm', 'audio/webm;codecs=opus', 'audio/ogg',
    'audio/mp4', 'audio/mpeg', 'audio/wav'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
--> statement-breakpoint
DROP POLICY IF EXISTS "NIVO members can upload their comment media" ON storage.objects;
--> statement-breakpoint
DROP POLICY IF EXISTS "KINBA members can upload their comment media" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "KINBA members can upload their comment media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'comment-media'
  AND (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);
--> statement-breakpoint
DROP POLICY IF EXISTS "Public can read comment media" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "Public can read comment media"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'comment-media');

