-- ============================================================================
-- Fix: business admin bringing a driver online strands the request on a
-- vehicle the driver's own dashboard isn't looking at.
-- ============================================================================
-- Symptom: customer requests a ride, gets matched to a rider (e.g. "Aronny")
-- and sees "Waiting for Aronny..." — but Aronny's own Ride & Delivery
-- Requests screen says "No requests right now."
--
-- Root cause: RiderRideRequests.tsx / useRiderStats (RiderDashboard.tsx) only
-- ever show pending requests for whichever ONE mbg_riders row matches
-- mbg_users.active_vehicle_type. ADD_MULTI_VEHICLE_SUPPORT.sql's
-- mbg_switch_active_vehicle keeps that invariant true by construction: it
-- forces every OTHER vehicle row for that person to is_available = false
-- and updates active_vehicle_type whenever a rider switches which vehicle
-- is live.
--
-- mbg_business_set_driver_status (CREATE_BODAGOERA_BUSINESS_DRIVER_ROSTER.sql)
-- is a SECOND, independent way to flip is_available = true on a driver's
-- row — used by a business admin from BusinessDriverRoster.tsx — and it
-- skips both of those steps. So a driver who holds both a personal
-- registration (e.g. their own motorcycle) and a business-added one (e.g. a
-- car under a transport company) can end up with TWO rows is_available =
-- true at once, with active_vehicle_type still pointing at the personal one.
-- The matching engine (which just filters is_available = true per row, with
-- no notion of "the" active vehicle) can then dispatch a request to the
-- business row while the driver's dashboard keeps resolving to the personal
-- row — the request is real, but nothing on that driver's screen will ever
-- show it.
--
-- Fix: mirror mbg_switch_active_vehicle's invariant here too — bringing a
-- vehicle online through the business panel now also takes every other
-- vehicle for that same person offline and points active_vehicle_type at
-- it, so the driver's own dashboard is guaranteed to be looking at the
-- vehicle that's actually receiving requests.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_business_set_driver_status(
  p_rider_id UUID,
  p_status TEXT DEFAULT NULL,
  p_is_available BOOLEAN DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_profile_id UUID;
  v_user_id UUID;
  v_vehicle_type TEXT;
BEGIN
  SELECT business_profile_id, user_id, vehicle_type::TEXT
    INTO v_business_profile_id, v_user_id, v_vehicle_type
  FROM public.mbg_riders WHERE id = p_rider_id;
  IF v_business_profile_id IS NULL OR NOT public.ican_business_admin(v_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only this driver''s business admin can change their status');
  END IF;

  PERFORM set_config('mbg.trusted_write', 'true', true);

  UPDATE public.mbg_riders SET
    status = COALESCE(p_status, status),
    is_available = COALESCE(p_is_available, is_available),
    updated_at = now()
  WHERE id = p_rider_id;

  -- Bringing this vehicle online: same invariant mbg_switch_active_vehicle
  -- enforces for a self-service switch — at most one vehicle per person is
  -- ever is_available = true, and active_vehicle_type always points at it,
  -- so this driver's own dashboard actually shows requests sent to it.
  IF p_is_available = true THEN
    UPDATE public.mbg_riders
    SET is_available = false, updated_at = now()
    WHERE user_id = v_user_id AND id <> p_rider_id;

    UPDATE public.mbg_users
    SET active_vehicle_type = v_vehicle_type, updated_at = now()
    WHERE id = v_user_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_set_driver_status(UUID, TEXT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_business_set_driver_status now keeps active_vehicle_type / is_available in sync across a driver''s vehicles, so business-dispatched requests actually show up on the driver''s own dashboard.';
END $$;
