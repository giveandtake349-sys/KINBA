CREATE TABLE "video_comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "video_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"videoId" integer NOT NULL,
	"userId" integer NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_comments" ADD CONSTRAINT "video_comments_videoId_videos_id_fk" FOREIGN KEY ("videoId") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_comments" ADD CONSTRAINT "video_comments_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_comments_video_idx" ON "video_comments" USING btree ("videoId","createdAt");--> statement-breakpoint
CREATE INDEX "video_comments_user_idx" ON "video_comments" USING btree ("userId");