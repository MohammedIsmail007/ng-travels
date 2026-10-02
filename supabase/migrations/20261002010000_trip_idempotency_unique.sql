-- ============================================================================
-- One trip per booking submission
-- ============================================================================
-- The trip wizard sends an idempotency_key per booking attempt. POST /trips
-- returns the existing trip when the key repeats (double-click, network
-- retry); this index makes that hold even for two requests racing each
-- other, so a booking can never create a duplicate trip + advance payment.
-- Existing trips have no key (NULL) and are unaffected.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS trips_idempotency_key_unique
  ON public.trips (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
