CREATE TYPE "public"."media_type" AS ENUM('VIDEO', 'IMAGE');--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "mediaType" "media_type" DEFAULT 'VIDEO' NOT NULL;--> statement-breakpoint
CREATE INDEX "videos_media_type_created_idx" ON "videos" USING btree ("mediaType", "createdAt");
