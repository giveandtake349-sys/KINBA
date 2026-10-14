-- JHILIK ads Phase 2 — brand application verification documents.
-- Additive only: one nullable jsonb column, safe to re-run.
BEGIN;

ALTER TABLE brand_applications
  ADD COLUMN IF NOT EXISTS documents jsonb;

COMMIT;
