CREATE TABLE "follows" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "follows_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
  "followerId" integer NOT NULL,
  "followedId" integer NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "reactions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
  "signalId" integer NOT NULL,
  "userId" integer NOT NULL,
  "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followerId_users_id_fk" FOREIGN KEY ("followerId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followedId_users_id_fk" FOREIGN KEY ("followedId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_signalId_signals_id_fk" FOREIGN KEY ("signalId") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "follows_pair_unique" ON "follows" USING btree ("followerId", "followedId");
--> statement-breakpoint
CREATE INDEX "follows_follower_idx" ON "follows" USING btree ("followerId");
--> statement-breakpoint
CREATE INDEX "follows_followed_idx" ON "follows" USING btree ("followedId");
--> statement-breakpoint
CREATE UNIQUE INDEX "reactions_signal_user_unique" ON "reactions" USING btree ("signalId", "userId");
--> statement-breakpoint
CREATE INDEX "reactions_signal_idx" ON "reactions" USING btree ("signalId");
--> statement-breakpoint
CREATE INDEX "reactions_user_idx" ON "reactions" USING btree ("userId");
