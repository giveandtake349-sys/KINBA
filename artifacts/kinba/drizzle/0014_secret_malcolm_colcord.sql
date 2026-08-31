ALTER TYPE "public"."wallet_transaction_type" ADD VALUE 'sponsor_payment';--> statement-breakpoint
DROP INDEX "wallet_transactions_sponsor_entry_unique";--> statement-breakpoint
ALTER TABLE "wallet_transactions" ALTER COLUMN "participantId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "live_sponsors" ADD COLUMN "userId" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "live_sponsors" ADD COLUMN "expiresAt" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "live_sponsors" ADD CONSTRAINT "live_sponsors_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_sponsors_expiry_idx" ON "live_sponsors" USING btree ("expiresAt");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_user_session_type_unique" ON "wallet_transactions" USING btree ("userId","sessionId","type");