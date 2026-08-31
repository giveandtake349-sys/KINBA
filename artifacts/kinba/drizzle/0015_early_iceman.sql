ALTER TYPE "public"."wallet_transaction_type" ADD VALUE IF NOT EXISTS 'sponsor_bids_prize';
--> statement-breakpoint
DROP INDEX "wallet_transactions_user_session_type_unique";
--> statement-breakpoint
ALTER TABLE "session_winners" ADD COLUMN "rank" integer;
--> statement-breakpoint
ALTER TABLE "session_winners" ADD COLUMN "prizeAmount" numeric(12, 2);
--> statement-breakpoint
WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "sessionId" ORDER BY "createdAt", "id") AS position
  FROM "session_winners"
)
UPDATE "session_winners" AS winners
SET
  "rank" = LEAST(ranked.position, 3),
  "prizeAmount" = CASE LEAST(ranked.position, 3)
    WHEN 1 THEN 7000.00
    WHEN 2 THEN 5000.00
    ELSE 2000.00
  END
FROM ranked
WHERE winners."id" = ranked."id";
--> statement-breakpoint
ALTER TABLE "session_winners" ALTER COLUMN "rank" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "session_winners" ALTER COLUMN "prizeAmount" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD COLUMN "referenceKey" varchar(160);
--> statement-breakpoint
UPDATE "wallet_transactions"
SET "referenceKey" = CONCAT('legacy-wallet-transaction:', "id")
WHERE "referenceKey" IS NULL;
--> statement-breakpoint
ALTER TABLE "wallet_transactions" ALTER COLUMN "referenceKey" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "session_winners_session_rank_unique" ON "session_winners" USING btree ("sessionId","rank");
--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_transactions_user_session_reference_unique" ON "wallet_transactions" USING btree ("userId","sessionId","referenceKey");
