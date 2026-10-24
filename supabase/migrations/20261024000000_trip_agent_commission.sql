-- ============================================================================
-- Agent commission on trips (internal reference only)
-- ============================================================================
-- Mirrors the driver commission columns. agent_name is who brought the
-- booking; agent_commission_type drives how agent_commission_amount is derived:
--   'percentage' -> amount = customer_total * agent_commission_value / 100
--   'flat'       -> amount = agent_commission_value (entered directly)
-- Never shown to the customer; deducted from net profit on the owner's view.
-- ============================================================================

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS agent_name TEXT,
  ADD COLUMN IF NOT EXISTS agent_commission_type TEXT NOT NULL DEFAULT 'percentage',
  ADD COLUMN IF NOT EXISTS agent_commission_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS agent_commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
