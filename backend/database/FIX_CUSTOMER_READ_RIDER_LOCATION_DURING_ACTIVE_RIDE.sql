-- ============================================================================
-- Let a customer read their OWN active ride's rider row (for live location
-- tracking) even after that rider is no longer "available" for matching.
-- ============================================================================
-- New: LiveTrackingMap.tsx reads mbg_riders.current_lat/current_lng for the
-- customer's assigned rider during the 'accepted'/'in_progress' screens, to
-- show a live position on the map (that column is kept fresh by
-- useLiveLocationPing on the rider's own dashboard).
--
-- Both existing customer-facing SELECT policies on mbg_riders —
-- mbg_riders_read_matching and mbg_riders_read_customers — require
-- is_available = true (they exist so a customer can browse riders to pick
-- from during matching). But mbg_respond_to_ride flips is_available = false
-- the instant the rider accepts. So the very moment a customer's ride goes
-- 'accepted' — exactly when they'd want to start watching the rider's live
-- position — RLS silently drops their read access to that row (0 rows, no
-- error, since RLS just filters rather than raising).
--
-- Fix: one more SELECT policy scoped narrowly to "a customer who has an
-- active ride currently assigned to this exact rider" — independent of
-- is_available, and it stops applying the moment the ride leaves
-- accepted/in_progress (completed, cancelled, etc.), so it can't be used to
-- keep tracking a rider after the trip is over.
--
-- IMPORTANT: this can't be a plain EXISTS against mbg_rides. mbg_rides has
-- its own policy (mbg_rides_read_own_rider, in
-- CREATE_REAL_RIDE_MATCHING_ENGINE.sql) that does EXISTS against mbg_riders
-- to let a rider see their own rides. Query mbg_riders -> this policy reads
-- mbg_rides -> that policy reads mbg_riders -> this policy reads mbg_rides
-- -> ... circular RLS between the two tables, which blows Postgres's stack
-- (54001) and PostgREST reports it as a plain 500 with no useful body.
-- Worse, it doesn't just break this new policy: ANY select or write on
-- mbg_riders or mbg_rides that needs to re-check RETURNING rows now 500s
-- too, since the planner has to evaluate every applicable policy.
-- Same fix this codebase already used for mbg_users/mbg_committee_members
-- (see FIX_RLS_RECURSION_FINAL.sql): push the cross-table check into a
-- SECURITY DEFINER function. Inside a SECURITY DEFINER function, table
-- reads run as the function owner and bypass RLS entirely, so the mbg_rides
-- read here never re-triggers mbg_rides_read_own_rider — no cycle.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_customer_has_active_ride_with_rider(p_rider_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mbg_rides r
    JOIN public.mbg_customers c ON c.id = r.customer_id
    WHERE r.rider_id = p_rider_id
      AND c.user_id = auth.uid()
      AND r.status IN ('accepted', 'in_progress')
  );
$$;

DROP POLICY IF EXISTS mbg_riders_read_active_ride_customer ON public.mbg_riders;
CREATE POLICY mbg_riders_read_active_ride_customer ON public.mbg_riders
  FOR SELECT
  USING (public.mbg_customer_has_active_ride_with_rider(id));

-- Realtime pushes UPDATEs on a table only if it's in the supabase_realtime
-- publication. mbg_ride_messages was added explicitly elsewhere
-- (CREATE_MESSAGING_AND_PRODUCTS.sql); mbg_riders never was, so without
-- this the live map's postgres_changes subscription would just sit silent
-- — no error, it would only ever show the position from its one initial
-- fetch. ADD TABLE errors if it's already in the publication (e.g. if this
-- project's publication was set to ALL TABLES some other way), so guard it.
-- Same gap applies to RiderRideRequests.tsx's own postgres_changes
-- subscription on mbg_rides (added this same round of fixes, for instant
-- new-request push instead of a 4s poll) — cover both while here.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mbg_riders;
EXCEPTION WHEN duplicate_object OR OTHERS THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mbg_rides;
EXCEPTION WHEN duplicate_object OR OTHERS THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Customers can now read their assigned rider''s live position for the duration of an accepted/in_progress ride, even though that rider is no longer "available" for matching, and mbg_riders is in the realtime publication so position updates push instantly.';
END $$;
