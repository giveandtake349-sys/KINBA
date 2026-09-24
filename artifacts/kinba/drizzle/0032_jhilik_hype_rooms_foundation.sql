-- JHILIK Hype Room Professional Foundation — M-A1 + M-A2 (additive only).
-- No DROP/TRUNCATE/RENAME. Existing hype room tables are only extended with
-- nullable columns / FKs / indexes. New tables are hype_room_* scoped.
-- Do not execute against production from CI;
-- production uses the companion *_APPLY.sql under separate review.
--
-- ALTER TYPE ... ADD VALUE is intentionally OUTSIDE BEGIN/COMMIT (same rule as 0031).
--
-- Idempotency / rerun safety (M-A2.2):
-- - ALTER TYPE ... ADD VALUE uses IF NOT EXISTS (must stay outside any BEGIN/COMMIT).
-- - CREATE TYPE uses a DO + duplicate_object guard (PostgreSQL has no CREATE TYPE IF NOT EXISTS).
-- - ADD CONSTRAINT uses DO + pg_constraint guards (PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS).
-- - CREATE TABLE / CREATE INDEX / ADD COLUMN already use IF NOT EXISTS.
-- - This canonical file has no BEGIN/COMMIT (drizzle-kit migration runner wraps the file);
--   standalone statement-by-statement re-run is safe for every guarded statement below.
-- - Remaining limitation: adding a FK will fail if existing rows violate it (e.g. orphan
--   hype_room_messages.parentId). Fix data before re-run; this migration never drops/rewrites rows.
ALTER TYPE "public"."hype_room_member_role" ADD VALUE IF NOT EXISTS 'speaker';--> statement-breakpoint
ALTER TYPE "public"."hype_room_member_role" ADD VALUE IF NOT EXISTS 'audience';--> statement-breakpoint
ALTER TABLE "hype_room_messages" ADD COLUMN IF NOT EXISTS "parentId" integer;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_messages'::regclass
      AND conname = 'hype_room_messages_parentId_hype_room_messages_id_fk'
  ) THEN
    ALTER TABLE "hype_room_messages" ADD CONSTRAINT "hype_room_messages_parentId_hype_room_messages_id_fk" FOREIGN KEY ("parentId") REFERENCES "public"."hype_room_messages"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_room_messages_parent_idx" ON "hype_room_messages" USING btree ("parentId");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hype_room_message_reactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hype_room_message_reactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"roomId" integer NOT NULL,
	"messageId" integer NOT NULL,
	"userId" integer NOT NULL,
	"reaction" varchar(32) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_message_reactions'::regclass
      AND conname = 'hype_room_message_reactions_roomId_hype_rooms_id_fk'
  ) THEN
    ALTER TABLE "hype_room_message_reactions" ADD CONSTRAINT "hype_room_message_reactions_roomId_hype_rooms_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."hype_rooms"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_message_reactions'::regclass
      AND conname = 'hype_room_message_reactions_messageId_hype_room_messages_id_fk'
  ) THEN
    ALTER TABLE "hype_room_message_reactions" ADD CONSTRAINT "hype_room_message_reactions_messageId_hype_room_messages_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."hype_room_messages"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_message_reactions'::regclass
      AND conname = 'hype_room_message_reactions_userId_users_id_fk'
  ) THEN
    ALTER TABLE "hype_room_message_reactions" ADD CONSTRAINT "hype_room_message_reactions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hype_room_message_reactions_unique" ON "hype_room_message_reactions" USING btree ("messageId","userId","reaction");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_room_message_reactions_message_idx" ON "hype_room_message_reactions" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_room_message_reactions_room_idx" ON "hype_room_message_reactions" USING btree ("roomId");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hype_room_message_mentions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hype_room_message_mentions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"roomId" integer NOT NULL,
	"messageId" integer NOT NULL,
	"mentionedUserId" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_message_mentions'::regclass
      AND conname = 'hype_room_message_mentions_roomId_hype_rooms_id_fk'
  ) THEN
    ALTER TABLE "hype_room_message_mentions" ADD CONSTRAINT "hype_room_message_mentions_roomId_hype_rooms_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."hype_rooms"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_message_mentions'::regclass
      AND conname = 'hype_room_message_mentions_messageId_hype_room_messages_id_fk'
  ) THEN
    ALTER TABLE "hype_room_message_mentions" ADD CONSTRAINT "hype_room_message_mentions_messageId_hype_room_messages_id_fk" FOREIGN KEY ("messageId") REFERENCES "public"."hype_room_messages"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_message_mentions'::regclass
      AND conname = 'hype_room_message_mentions_mentionedUserId_users_id_fk'
  ) THEN
    ALTER TABLE "hype_room_message_mentions" ADD CONSTRAINT "hype_room_message_mentions_mentionedUserId_users_id_fk" FOREIGN KEY ("mentionedUserId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hype_room_message_mentions_unique" ON "hype_room_message_mentions" USING btree ("messageId","mentionedUserId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_room_message_mentions_message_idx" ON "hype_room_message_mentions" USING btree ("messageId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_room_message_mentions_user_idx" ON "hype_room_message_mentions" USING btree ("mentionedUserId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_room_message_mentions_room_idx" ON "hype_room_message_mentions" USING btree ("roomId");--> statement-breakpoint
DO $$
BEGIN
  CREATE TYPE "public"."hype_room_invite_status" AS ENUM('pending', 'accepted', 'revoked', 'declined');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hype_room_invites" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "hype_room_invites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"roomId" integer NOT NULL,
	"invitedUserId" integer NOT NULL,
	"createdBy" integer NOT NULL,
	"status" "public"."hype_room_invite_status" DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"consumedAt" timestamp with time zone
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_invites'::regclass
      AND conname = 'hype_room_invites_roomId_hype_rooms_id_fk'
  ) THEN
    ALTER TABLE "hype_room_invites" ADD CONSTRAINT "hype_room_invites_roomId_hype_rooms_id_fk" FOREIGN KEY ("roomId") REFERENCES "public"."hype_rooms"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_invites'::regclass
      AND conname = 'hype_room_invites_invitedUserId_users_id_fk'
  ) THEN
    ALTER TABLE "hype_room_invites" ADD CONSTRAINT "hype_room_invites_invitedUserId_users_id_fk" FOREIGN KEY ("invitedUserId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.hype_room_invites'::regclass
      AND conname = 'hype_room_invites_createdBy_users_id_fk'
  ) THEN
    ALTER TABLE "hype_room_invites" ADD CONSTRAINT "hype_room_invites_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "hype_room_invites_room_user_unique" ON "hype_room_invites" USING btree ("roomId","invitedUserId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_room_invites_room_status_idx" ON "hype_room_invites" USING btree ("roomId","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hype_room_invites_user_idx" ON "hype_room_invites" USING btree ("invitedUserId");
