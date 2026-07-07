-- ============================================================================
-- rider_supermarket_applications: add denormalized rider contact info
-- ============================================================================
-- The supermarket admin (digital-city-era's AdminPortal) reads this table
-- from a different auth.uid() than the rider who created the row, and
-- mbg_users/mbg_user_profiles/mbg_riders are locked down to "read own row
-- only" (see COMPLETE_MYBODAGUY_SETUP_WITH_HIERARCHY.sql). A nested select
-- joining those tables would silently return nulls for the admin. So —
-- same reason supplier_applications stores contact_name/contact_phone
-- directly on the row instead of joining users — capture the rider's
-- contact info at application time.
-- ============================================================================

ALTER TABLE public.rider_supermarket_applications
  ADD COLUMN IF NOT EXISTS rider_name     TEXT,
  ADD COLUMN IF NOT EXISTS rider_email    TEXT,
  ADD COLUMN IF NOT EXISTS rider_phone    TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_type   TEXT,
  ADD COLUMN IF NOT EXISTS license_number TEXT;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ rider_supermarket_applications now carries rider contact info for the admin panel.';
END $$;
