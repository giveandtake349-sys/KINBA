CREATE TABLE "comments" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "postId" integer NOT NULL,
  "userId" integer NOT NULL,
  "content" text,
  "imageUrl" varchar(1024),
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
  "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_postId_signals_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "comments_post_idx" ON "comments" USING btree ("postId","createdAt");
--> statement-breakpoint
CREATE INDEX "comments_user_idx" ON "comments" USING btree ("userId");
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('comment-media', 'comment-media', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;
--> statement-breakpoint
DROP POLICY IF EXISTS "NIVO members can upload their comment media" ON storage.objects;
--> statement-breakpoint
CREATE POLICY "NIVO members can upload their comment media"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'comment-media' AND (storage.foldername(name))[1] = (select auth.jwt()->>'sub'));
