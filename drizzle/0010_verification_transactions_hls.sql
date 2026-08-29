CREATE TYPE "public"."payment_method" AS ENUM('bkash', 'nagad');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."video_processing_status" AS ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "transactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"userId" integer NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"paymentMethod" "payment_method" NOT NULL,
	"senderNumber" varchar(32) NOT NULL,
	"transactionId" varchar(128) NOT NULL,
	"status" "transaction_status" DEFAULT 'pending' NOT NULL,
	"approvedBy" integer,
	"approvedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "hlsMasterUrl" varchar(1024);--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "processingStatus" "video_processing_status" DEFAULT 'PENDING' NOT NULL;--> statement-breakpoint
ALTER TABLE "videos" ADD COLUMN "processingError" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_approvedBy_users_id_fk" FOREIGN KEY ("approvedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_transaction_id_unique" ON "transactions" USING btree ("transactionId");--> statement-breakpoint
CREATE INDEX "transactions_user_idx" ON "transactions" USING btree ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_username_unique" ON "profiles" USING btree ("username");