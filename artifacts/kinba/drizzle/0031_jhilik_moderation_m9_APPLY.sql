-- JHILIK Phase 2 M9 — additive moderation only.
-- No DROP/TRUNCATE/RENAME. Legacy "reports" is not altered.
-- CREATE TABLE / FK / INDEX + one additive enum value.
-- REVIEW BEFORE RUNNING IN PRODUCTION — do not execute from automated deploy
-- without the same manual APPLY gate used for 0024/0030.
--
-- ALTER TYPE ... ADD VALUE is intentionally OUTSIDE BEGIN/COMMIT:
-- PostgreSQL does not allow ALTER TYPE ... ADD VALUE inside an open
-- transaction block (restriction applies on PG < 12 always; on PG 12+
-- still unsafe if combined with other DDL in the same transaction in some
-- managed environments). Keep this statement as a standalone statement
-- first, then run the transactional DDL block.
ALTER TYPE "public"."feature_flag_key" ADD VALUE IF NOT EXISTS 'moderation_v1';
BEGIN;
CREATE TABLE IF NOT EXISTS "moderation_reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "moderation_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"reporterId" integer NOT NULL,
	"targetType" varchar(32) NOT NULL,
	"targetId" integer NOT NULL,
	"reason" varchar(120) NOT NULL,
	"details" text,
	"status" varchar(16) DEFAULT 'open' NOT NULL,
	"resolvedAt" timestamp with time zone,
	"resolvedBy" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_reporterId_users_id_fk" FOREIGN KEY ("reporterId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_reports" ADD CONSTRAINT "moderation_reports_resolvedBy_users_id_fk" FOREIGN KEY ("resolvedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "moderation_reports_target_idx" ON "moderation_reports" USING btree ("targetType","targetId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "moderation_reports_status_created_idx" ON "moderation_reports" USING btree ("status","createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "moderation_reports_reporter_target_idx" ON "moderation_reports" USING btree ("reporterId","targetType","targetId");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "moderation_actions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "moderation_actions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"adminId" integer NOT NULL,
	"action" varchar(64) NOT NULL,
	"targetType" varchar(32) NOT NULL,
	"targetId" integer NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_adminId_users_id_fk" FOREIGN KEY ("adminId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "moderation_actions_target_idx" ON "moderation_actions" USING btree ("targetType","targetId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "moderation_actions_admin_created_idx" ON "moderation_actions" USING btree ("adminId","createdAt");
COMMIT;
