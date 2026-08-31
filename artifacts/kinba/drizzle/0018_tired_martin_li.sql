CREATE TABLE "community_comments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "community_comments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"announcementId" integer NOT NULL,
	"userId" integer NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_announcementId_community_announcements_id_fk" FOREIGN KEY ("announcementId") REFERENCES "public"."community_announcements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_comments_announcement_idx" ON "community_comments" USING btree ("announcementId","createdAt");--> statement-breakpoint
CREATE INDEX "community_comments_user_idx" ON "community_comments" USING btree ("userId");