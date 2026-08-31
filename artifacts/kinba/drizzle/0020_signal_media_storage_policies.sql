DROP POLICY IF EXISTS "Public can read signal media" ON storage.objects;--> statement-breakpoint
CREATE POLICY "Public can read signal media"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'signal-media');--> statement-breakpoint
DROP POLICY IF EXISTS "Authenticated users can upload signal media" ON storage.objects;--> statement-breakpoint
CREATE POLICY "Authenticated users can upload signal media"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'signal-media'
  AND (storage.foldername(name))[1] = (select auth.jwt()->>'sub')
);
