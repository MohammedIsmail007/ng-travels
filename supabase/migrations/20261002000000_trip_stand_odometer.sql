-- ============================================================================
-- Stand (garage) odometer readings on trips
-- ============================================================================
-- Tracks the vehicle's empty running at both ends of a trip, separately from
-- the billed pickup -> drop distance (starting_km / ending_km):
--   stand_start_km   odometer when the vehicle leaves the stand (owner enters
--                    it at booking/dispatch)
--   stand_return_km  odometer when the vehicle is back at the stand after the
--                    drop (driver or owner enters it after completion)
-- Derived (not stored): stand->pickup = starting_km - stand_start_km,
-- drop->stand = stand_return_km - ending_km. Tracking only — billing is
-- unchanged and still uses pickup -> drop.
-- ============================================================================

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS stand_start_km NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS stand_start_photo TEXT,
  ADD COLUMN IF NOT EXISTS stand_return_km NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS stand_return_photo TEXT,
  ADD COLUMN IF NOT EXISTS stand_return_time TIMESTAMPTZ;
