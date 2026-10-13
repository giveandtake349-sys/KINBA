-- KINBA Close Friends post recipients (additive, idempotent)
-- Stores the exact users selected for each close-friends post.
BEGIN;
CREATE TABLE IF NOT EXISTS "video_audience_users" (
  "video_id" integer NOT NULL REFERENCES "public"."videos"("id") ON DELETE cascade,
  "user_id" integer NOT NULL REFERENCES "public"."users"("id") ON DELETE cascade,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "video_audience_users_unique" ON "video_audience_users" ("video_id", "user_id");
CREATE INDEX IF NOT EXISTS "video_audience_users_user_idx" ON "video_audience_users" ("user_id");
COMMIT;
