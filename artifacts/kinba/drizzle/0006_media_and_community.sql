CREATE TYPE "public"."announcement_attachment_type" AS ENUM('IMAGE', 'VIDEO');--> statement-breakpoint
CREATE TYPE "public"."profile_account_type" AS ENUM('member', 'creator', 'company');--> statement-breakpoint
CREATE TYPE "public"."video_kind" AS ENUM('LONG', 'SHORT');--> statement-breakpoint
CREATE TABLE "community_announcement_attachments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "community_announcement_attachments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"announcementId" integer NOT NULL,
	"mediaType" "announcement_attachment_type" NOT NULL,
	"mediaUrl" varchar(1024) NOT NULL,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"durationSeconds" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_announcements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "community_announcements_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_reactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "video_reactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"videoId" integer NOT NULL,
	"userId" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_shares" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "video_shares_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"videoId" integer NOT NULL,
	"userId" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "videos_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"title" varchar(180) NOT NULL,
	"description" text NOT NULL,
	"videoUrl" varchar(1024) NOT NULL,
	"thumbnailUrl" varchar(1024),
	"kind" "video_kind" NOT NULL,
	"durationSeconds" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "accountType" "profile_account_type" DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "isVerified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "community_announcement_attachments" ADD CONSTRAINT "community_announcement_attachments_announcementId_community_announcements_id_fk" FOREIGN KEY ("announcementId") REFERENCES "public"."community_announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_announcements" ADD CONSTRAINT "community_announcements_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_reactions" ADD CONSTRAINT "video_reactions_videoId_videos_id_fk" FOREIGN KEY ("videoId") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_reactions" ADD CONSTRAINT "video_reactions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_shares" ADD CONSTRAINT "video_shares_videoId_videos_id_fk" FOREIGN KEY ("videoId") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_shares" ADD CONSTRAINT "video_shares_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_announcement_attachments_announcement_idx" ON "community_announcement_attachments" USING btree ("announcementId","sortOrder");--> statement-breakpoint
CREATE INDEX "community_announcements_user_idx" ON "community_announcements" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "community_announcements_created_idx" ON "community_announcements" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "video_reactions_pair_unique" ON "video_reactions" USING btree ("videoId","userId");--> statement-breakpoint
CREATE INDEX "video_reactions_video_idx" ON "video_reactions" USING btree ("videoId");--> statement-breakpoint
CREATE INDEX "video_reactions_user_idx" ON "video_reactions" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "video_shares_pair_unique" ON "video_shares" USING btree ("videoId","userId");--> statement-breakpoint
CREATE INDEX "video_shares_video_idx" ON "video_shares" USING btree ("videoId");--> statement-breakpoint
CREATE INDEX "video_shares_user_idx" ON "video_shares" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "videos_user_idx" ON "videos" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "videos_kind_created_idx" ON "videos" USING btree ("kind","createdAt");