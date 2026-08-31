CREATE TYPE "public"."wallet_transaction_type" AS ENUM('sponsor_bids_entry');--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wallet_transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"walletId" integer NOT NULL,
	"userId" integer NOT NULL,
	"sessionId" integer NOT NULL,
	"participantId" integer NOT NULL,
	"type" "wallet_transaction_type" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "wallets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"balance" numeric(12, 2) DEFAULT '0.00' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_walletId_wallets_id_fk" FOREIGN KEY ("walletId") REFERENCES "public"."wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_sessionId_sponsor_bids_sessions_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."sponsor_bids_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_participantId_participants_id_fk" FOREIGN KEY ("participantId") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_sponsor_entry_unique" ON "wallet_transactions" USING btree ("userId","sessionId");--> statement-breakpoint
CREATE INDEX "wallet_transactions_wallet_idx" ON "wallet_transactions" USING btree ("walletId","createdAt");--> statement-breakpoint
CREATE INDEX "wallet_transactions_session_idx" ON "wallet_transactions" USING btree ("sessionId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_user_unique" ON "wallets" USING btree ("userId");