-- KINBA growth features: trending follows, streaks/badges, close friends, audience privacy.
-- Additive and idempotent. Review and apply manually to production Supabase.
BEGIN;

ALTER TABLE "profiles" ADD COLUMN IF NOT EXISTS "timezone" varchar(64) NOT NULL DEFAULT 'UTC';
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "audience" varchar(32) NOT NULL DEFAULT 'everyone';

CREATE TABLE IF NOT EXISTS "close_friends" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "owner_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "friend_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "close_friends_pair_unique" ON "close_friends" ("owner_id", "friend_id");
CREATE INDEX IF NOT EXISTS "close_friends_owner_idx" ON "close_friends" ("owner_id");

CREATE TABLE IF NOT EXISTS "user_follows_hashtag" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "hashtag_id" integer NOT NULL REFERENCES "hashtags"("id") ON DELETE CASCADE,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_follows_hashtag_unique" ON "user_follows_hashtag" ("user_id", "hashtag_id");
CREATE INDEX IF NOT EXISTS "user_follows_hashtag_user_idx" ON "user_follows_hashtag" ("user_id");
CREATE INDEX IF NOT EXISTS "user_follows_hashtag_tag_idx" ON "user_follows_hashtag" ("hashtag_id");

CREATE TABLE IF NOT EXISTS "daily_activities" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "activity_date" varchar(10) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "daily_activities_user_date_unique" ON "daily_activities" ("user_id", "activity_date");
CREATE INDEX IF NOT EXISTS "daily_activities_user_date_idx" ON "daily_activities" ("user_id", "activity_date");

CREATE TABLE IF NOT EXISTS "user_streaks" (
  "user_id" integer PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "current_streak" integer NOT NULL DEFAULT 0,
  "longest_streak" integer NOT NULL DEFAULT 0,
  "last_activity_date" varchar(10),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "badges" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "key" varchar(64) NOT NULL UNIQUE,
  "title" varchar(120) NOT NULL,
  "description" text NOT NULL,
  "requirement" integer NOT NULL
);
CREATE TABLE IF NOT EXISTS "user_badges" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "badge_id" integer NOT NULL REFERENCES "badges"("id") ON DELETE CASCADE,
  "awardedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_badges_unique" ON "user_badges" ("user_id", "badge_id");

INSERT INTO "badges" ("key", "title", "description", "requirement") VALUES
  ('first_post', 'First post', 'Published your first post on KINBA.', 1),
  ('ten_pookies', '10 Pookies', 'Received 10 Pookies on your posts.', 10),
  ('seven_day_streak', '7 day streak', 'Stayed active for seven consecutive days.', 7)
ON CONFLICT ("key") DO NOTHING;

COMMIT;
