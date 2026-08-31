CREATE TABLE "sponsor_bids_draws" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sponsor_bids_draws_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"sessionId" integer NOT NULL,
	"rank" integer NOT NULL,
	"nomineeParticipantIds" jsonb NOT NULL,
	"selectedParticipantId" integer,
	"preliminaryAt" timestamp with time zone DEFAULT now() NOT NULL,
	"selectedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sponsor_bids_draws" ADD CONSTRAINT "sponsor_bids_draws_sessionId_sponsor_bids_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."sponsor_bids_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_bids_draws" ADD CONSTRAINT "sponsor_bids_draws_selectedParticipantId_participants_id_fk" FOREIGN KEY ("selectedParticipantId") REFERENCES "public"."participants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_bids_draws_session_rank_unique" ON "sponsor_bids_draws" USING btree ("sessionId","rank");--> statement-breakpoint
CREATE INDEX "sponsor_bids_draws_session_idx" ON "sponsor_bids_draws" USING btree ("sessionId","rank");