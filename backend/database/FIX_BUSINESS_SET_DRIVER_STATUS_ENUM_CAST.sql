-- ============================================================================
-- Fix: mbg_business_set_driver_status always failed at runtime.
-- ============================================================================
-- mbg_riders.status is the enum public.mbg_rider_status, but this function's
-- p_status parameter is TEXT. A raw string literal ('active') auto-casts to
-- an enum with no fuss, but a declared TEXT variable already has a concrete
-- type — COALESCE(p_status, status) then asks Postgres to unify TEXT and
-- mbg_rider_status, which it refuses to do implicitly:
--   "COALESCE types text and mbg_rider_status cannot be matched"
-- This bug shipped in the original CREATE_BODAGOERA_BUSINESS_DRIVER_ROSTER.sql
-- and was carried over unchanged by FIX_BUSINESS_DRIVER_STATUS_ACTIVE_VEHICLE_
-- INVARIANT.sql (that fix only added the single-active-vehicle invariant
-- below it). Net effect: a business admin toggling a driver's status/
-- availability from BusinessDriverRoster.tsx has always errored out, so
-- company drivers could never actually be brought online — which is also
-- why mbg_list_ride_companies (needs is_available = true) turns up empty.
--
-- Fix: cast p_status to the enum before the COALESCE. Keeps the function's
-- existing TEXT signature (the RPC call site still passes a plain string),
-- so plain CREATE OR REPLACE, no DROP needed.
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
    status = COALESCE(p_status::public.mbg_rider_status, status),
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
  RAISE NOTICE '✅ mbg_business_set_driver_status casts p_status to mbg_rider_status before COALESCE — status/availability toggles from BusinessDriverRoster.tsx no longer error out.';
END $$;
