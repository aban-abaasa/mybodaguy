-- ============================================================================
-- Supermarkets need real coordinates for the "smart" delivery pickup flow:
-- when a customer picks delivery from a specific registered supermarket, the
-- pickup point should auto-fill from the supermarket's own location instead
-- of asking the customer to search for it manually.
-- ============================================================================

ALTER TABLE public.supermarkets
  ADD COLUMN IF NOT EXISTS latitude  DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8);

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ supermarkets.latitude/longitude added. Until an admin sets them for a given store, delivery pickup for that store falls back to manual entry.';
END $$;
