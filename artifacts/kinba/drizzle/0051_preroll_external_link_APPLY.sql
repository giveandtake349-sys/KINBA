-- JHILIK Ads: optional external destination for video pre-roll ads
-- Additive and idempotent. Existing Drop links remain unchanged.
BEGIN;

ALTER TABLE "public"."preroll_ads"
  ADD COLUMN IF NOT EXISTS "linkUrl" varchar(2048);

COMMIT;
