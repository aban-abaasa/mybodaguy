-- ============================================================================
-- Fix: "Ride cannot be started (not found, not yours, or not accepted yet)"
--
-- mbg_start_ride looked up the rider with
--   SELECT id FROM mbg_riders WHERE user_id = auth.uid()
-- A person can now hold one mbg_riders row per vehicle (ADD_MULTI_VEHICLE_SUPPORT),
-- so that picked an arbitrary row and the ride's rider_id could fail to match.
-- It also raised for a ride that was already in progress (a double tap or a
-- stale screen), and gave the same vague message for every cause.
--
-- Now: the ride only has to belong to ANY of the caller's rider rows, starting a
-- ride that is already in progress just succeeds, and each failure says why.
--
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_start_ride(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
BEGIN
  SELECT r.* INTO v_ride
  FROM public.mbg_rides r
  JOIN public.mbg_riders rd ON rd.id = r.rider_id
  WHERE r.id = p_ride_id AND rd.user_id = auth.uid()
  FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This ride is not assigned to you (it may have been declined or reassigned)';
  END IF;

  IF v_ride.status = 'in_progress' THEN
    RETURN jsonb_build_object('success', true, 'already_started', true);
  END IF;

  IF v_ride.status <> 'accepted' THEN
    RAISE EXCEPTION 'This ride cannot be started because its status is "%"', v_ride.status;
  END IF;

  UPDATE public.mbg_rides
  SET status = 'in_progress', started_at = now(), updated_at = now()
  WHERE id = p_ride_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_start_ride(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_start_ride fixed — works for multi-vehicle riders, safe to tap twice, and errors now say why.';
END $$;
