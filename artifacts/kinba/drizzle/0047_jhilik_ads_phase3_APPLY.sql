-- JHILIK Brand Advertising & Creator Campaign System — Phase 3 (additive, idempotent)
--
-- Two nullable columns Phase 3 needs:
--   campaigns.rules              — campaign rules shown to invited creators
--   campaign_invitations.message — personal note from the admin on the invite
--
-- Idempotency: ADD COLUMN IF NOT EXISTS — safe to re-run.
-- APPLY ORDER (user): Phase 1 SQL → Phase 1 patch → Phase 2 SQL → Phase 2 patch
--   → THIS file → Phase 3 patch → push.

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "rules" text;

ALTER TABLE "campaign_invitations"
  ADD COLUMN IF NOT EXISTS "message" text;
