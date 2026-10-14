-- JHILIK Brand Advertising & Creator Campaign System — Phase 4 (additive, idempotent)
--
-- One new column Phase 4 needs:
--   link_clicks.day — UTC calendar day of the click, part of the dedup key
--   (linkId, ipHash, day) so one IP counts at most once per link per day.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS —
-- safe to re-run. NO RLS (standing convention: backend uses a direct DB
-- connection; auth is enforced at the tRPC layer).
-- APPLY ORDER (user): Phase 1 SQL → Phase 1 patch → Phase 2 SQL → Phase 2 patch
--   → Phase 3 SQL → Phase 3 patch → THIS file → Phase 4 patch → push.

BEGIN;

ALTER TABLE "link_clicks"
  ADD COLUMN IF NOT EXISTS "day" date;

-- Backfill for rows recorded before this column existed.
UPDATE "link_clicks"
  SET "day" = ("createdAt" AT TIME ZONE 'UTC')::date
  WHERE "day" IS NULL;

ALTER TABLE "link_clicks"
  ALTER COLUMN "day" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "link_clicks_dedup_unique"
  ON "link_clicks" ("linkId", "ipHash", "day");

COMMIT;
