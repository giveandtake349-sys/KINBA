ALTER TABLE "profiles" ADD COLUMN "username" varchar(64);--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "viewCount" integer DEFAULT 0 NOT NULL;