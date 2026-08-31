CREATE TYPE "public"."app_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('pending', 'accepted', 'declined', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."signal_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."signal_type" AS ENUM('need', 'can');--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "blocks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"blockerId" integer NOT NULL,
	"blockedId" integer NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "connections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"requesterId" integer NOT NULL,
	"recipientId" integer NOT NULL,
	"signalId" integer,
	"note" text NOT NULL,
	"status" "connection_status" DEFAULT 'pending' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "messages_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"connectionId" integer NOT NULL,
	"senderId" integer NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "profiles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"country" varchar(100),
	"languages" text,
	"about" text,
	"skills" text,
	"interests" text,
	"photoUrl" varchar(1024),
	"phoneVerified" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"reporterId" integer NOT NULL,
	"reportedUserId" integer NOT NULL,
	"reason" varchar(120) NOT NULL,
	"details" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "signals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"type" "signal_type" NOT NULL,
	"title" varchar(180) NOT NULL,
	"description" text NOT NULL,
	"category" varchar(64) NOT NULL,
	"language" varchar(64) NOT NULL,
	"location" varchar(120),
	"status" "signal_status" DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "app_role" DEFAULT 'user' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockerId_users_id_fk" FOREIGN KEY ("blockerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockedId_users_id_fk" FOREIGN KEY ("blockedId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_requesterId_users_id_fk" FOREIGN KEY ("requesterId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_recipientId_users_id_fk" FOREIGN KEY ("recipientId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_signalId_signals_id_fk" FOREIGN KEY ("signalId") REFERENCES "public"."signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_connectionId_connections_id_fk" FOREIGN KEY ("connectionId") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_users_id_fk" FOREIGN KEY ("senderId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_users_id_fk" FOREIGN KEY ("reporterId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reportedUserId_users_id_fk" FOREIGN KEY ("reportedUserId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blocks_pair_unique" ON "blocks" USING btree ("blockerId","blockedId");--> statement-breakpoint
CREATE INDEX "connections_requester_idx" ON "connections" USING btree ("requesterId");--> statement-breakpoint
CREATE INDEX "connections_recipient_idx" ON "connections" USING btree ("recipientId");--> statement-breakpoint
CREATE INDEX "connections_status_idx" ON "connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "messages_connection_idx" ON "messages" USING btree ("connectionId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_userId_unique" ON "profiles" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "reports_reported_idx" ON "reports" USING btree ("reportedUserId");--> statement-breakpoint
CREATE INDEX "signals_discovery_idx" ON "signals" USING btree ("type","category","status");--> statement-breakpoint
CREATE INDEX "signals_user_idx" ON "signals" USING btree ("userId");