-- ============================================================================
-- Let each side of an active ride read the OTHER side's contact info
-- (name/phone), so Call/Video/Chat (RideCommsBar) actually has someone to
-- reach instead of silently rendering nothing.
-- ============================================================================
-- RiderRideRequests.tsx (rider's active-ride card) fetches the customer's
-- contact via:
--   mbg_customers -> mbg_users(phone, email) -> mbg_user_profiles(full_name)
-- CustomerDashboard.tsx (Overview/Orders ride list) fetches the rider's
-- contact the mirror-image way:
--   mbg_riders -> mbg_users(phone, email) -> mbg_user_profiles(full_name)
--
-- mbg_riders already has a policy letting a customer read an active ride's
-- rider row (FIX_CUSTOMER_READ_RIDER_LOCATION_DURING_ACTIVE_RIDE.sql). But
-- every SELECT policy on mbg_users, mbg_user_profiles and mbg_customers is
-- still strictly "your own row" (see COMPLETE_MYBODAGUY_SETUP.sql) — there
-- is NO policy letting a rider read a customer's row, or a customer read a
-- rider's mbg_users/mbg_user_profiles row. So both fetches above silently
-- come back empty (RLS filters, it doesn't error) and RideCommsBar never
-- renders for either party — this is why the rider's accepted-ride card
-- shows no Call/Chat buttons at all, and the customer's ride-history rows
-- are just as blind.
--
-- Fix: symmetric SELECT policies scoped to "the other participant on an
-- active (accepted/in_progress) ride with me" — same shape, and same
-- SECURITY DEFINER technique, as the mbg_riders fix already applied. Each
-- helper function queries mbg_rides/mbg_riders/mbg_customers directly under
-- its own (bypassed-RLS) privileges, so calling it from a policy on
-- mbg_users/mbg_user_profiles/mbg_customers can never re-trigger those
-- tables' own policies — no circular-RLS risk like the one that took down
-- mbg_riders/mbg_rides earlier.
-- ============================================================================

-- ── mbg_customers: let the assigned rider read the customer row itself ────
CREATE OR REPLACE FUNCTION public.mbg_rider_has_active_ride_with_customer(p_customer_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mbg_rides r
    JOIN public.mbg_riders ri ON ri.id = r.rider_id
    WHERE r.customer_id = p_customer_id
      AND ri.user_id = auth.uid()
      AND r.status IN ('accepted', 'in_progress')
  );
$$;

DROP POLICY IF EXISTS mbg_customers_read_active_ride_rider ON public.mbg_customers;
CREATE POLICY mbg_customers_read_active_ride_rider ON public.mbg_customers
  FOR SELECT
  USING (public.mbg_rider_has_active_ride_with_customer(id));

-- ── mbg_users / mbg_user_profiles: let EITHER participant on an active ride
--    read the OTHER's row (covers both fetch directions above). ───────────
CREATE OR REPLACE FUNCTION public.mbg_has_active_ride_with_user(p_other_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mbg_rides r
    JOIN public.mbg_customers c ON c.id = r.customer_id
    JOIN public.mbg_riders ri ON ri.id = r.rider_id
    WHERE r.status IN ('accepted', 'in_progress')
      AND (
        (c.user_id = auth.uid() AND ri.user_id = p_other_user_id)
        OR (ri.user_id = auth.uid() AND c.user_id = p_other_user_id)
      )
  );
$$;

DROP POLICY IF EXISTS mbg_users_read_active_ride_peer ON public.mbg_users;
CREATE POLICY mbg_users_read_active_ride_peer ON public.mbg_users
  FOR SELECT
  USING (public.mbg_has_active_ride_with_user(id));

DROP POLICY IF EXISTS mbg_user_profiles_read_active_ride_peer ON public.mbg_user_profiles;
CREATE POLICY mbg_user_profiles_read_active_ride_peer ON public.mbg_user_profiles
  FOR SELECT
  USING (public.mbg_has_active_ride_with_user(user_id));

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Riders can now read their active ride''s customer contact info, and customers can read their active ride''s rider contact info — RideCommsBar (Call/Video/Chat/Send) now actually resolves a peer on both sides instead of silently rendering nothing.';
END $$;
