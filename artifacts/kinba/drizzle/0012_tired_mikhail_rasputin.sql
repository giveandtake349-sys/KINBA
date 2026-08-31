CREATE TYPE "public"."sponsor_bids_session_status" AS ENUM('scheduled', 'live', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "live_sponsors" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "live_sponsors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sessionId" integer NOT NULL,
	"logoUrl" varchar(1024) NOT NULL,
	"externalLink" varchar(2048) NOT NULL,
	"sponsoredAmount" numeric(12, 2) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "participants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"sessionId" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_winners" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "session_winners_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sessionId" integer NOT NULL,
	"participantId" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sponsor_bids_sessions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sponsor_bids_sessions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"title" varchar(180) NOT NULL,
	"status" "sponsor_bids_session_status" DEFAULT 'scheduled' NOT NULL,
	"startsAt" timestamp with time zone,
	"endsAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "live_sponsors" ADD CONSTRAINT "live_sponsors_sessionId_sponsor_bids_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."sponsor_bids_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_sessionId_sponsor_bids_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."sponsor_bids_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_winners" ADD CONSTRAINT "session_winners_sessionId_sponsor_bids_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."sponsor_bids_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_winners" ADD CONSTRAINT "session_winners_participantId_participants_id_fk" FOREIGN KEY ("participantId") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_sponsors_session_idx" ON "live_sponsors" USING btree ("sessionId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "participants_session_user_unique" ON "participants" USING btree ("sessionId","userId");--> statement-breakpoint
CREATE INDEX "participants_user_idx" ON "participants" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "participants_session_idx" ON "participants" USING btree ("sessionId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "session_winners_session_participant_unique" ON "session_winners" USING btree ("sessionId","participantId");--> statement-breakpoint
CREATE INDEX "session_winners_session_idx" ON "session_winners" USING btree ("sessionId","createdAt");--> statement-breakpoint
CREATE INDEX "sponsor_bids_sessions_status_idx" ON "sponsor_bids_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sponsor_bids_sessions_starts_idx" ON "sponsor_bids_sessions" USING btree ("startsAt");