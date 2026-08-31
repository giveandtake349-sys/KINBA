CREATE TYPE "public"."video_source_quality" AS ENUM('ORIGINAL', '1080P', '720P', '480P');--> statement-breakpoint
CREATE TABLE "video_sources" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "video_sources_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"videoId" integer NOT NULL,
	"quality" "video_source_quality" NOT NULL,
	"videoUrl" varchar(1024) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "comments" CASCADE;--> statement-breakpoint
DROP TABLE "connections" CASCADE;--> statement-breakpoint
DROP TABLE "messages" CASCADE;--> statement-breakpoint
DROP TABLE "reactions" CASCADE;--> statement-breakpoint
DROP TABLE "signals" CASCADE;--> statement-breakpoint
ALTER TABLE "video_sources" ADD CONSTRAINT "video_sources_videoId_videos_id_fk" FOREIGN KEY ("videoId") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_sources_quality_unique" ON "video_sources" USING btree ("videoId","quality");--> statement-breakpoint
CREATE INDEX "video_sources_video_idx" ON "video_sources" USING btree ("videoId");--> statement-breakpoint
DROP TYPE "public"."connection_status";--> statement-breakpoint
DROP TYPE "public"."signal_media_type";--> statement-breakpoint
DROP TYPE "public"."signal_status";--> statement-breakpoint
DROP TYPE "public"."signal_type";