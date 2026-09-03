CREATE TABLE IF NOT EXISTS "raw_pulse_polls" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "video_id" integer NOT NULL REFERENCES "videos"("id") ON DELETE CASCADE,
  "question" text NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "raw_pulse_polls_video_unique" ON "raw_pulse_polls" ("video_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_pulse_polls_expires_idx" ON "raw_pulse_polls" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_pulse_options" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "poll_id" integer NOT NULL REFERENCES "raw_pulse_polls"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_pulse_options_poll_idx" ON "raw_pulse_options" ("poll_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "raw_pulse_votes" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "poll_id" integer NOT NULL REFERENCES "raw_pulse_polls"("id") ON DELETE CASCADE,
  "option_id" integer NOT NULL REFERENCES "raw_pulse_options"("id") ON DELETE CASCADE,
  "voter_key" text NOT NULL,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "raw_pulse_votes_poll_voter_unique" ON "raw_pulse_votes" ("poll_id", "voter_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "raw_pulse_votes_option_idx" ON "raw_pulse_votes" ("option_id");
