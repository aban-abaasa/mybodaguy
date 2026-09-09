-- ============================================================================
-- mbg_request_security (the standalone "Just send security" flow,
-- CREATE_SECURITY_ONLY_ESCORT_BOOKING.sql) drops the customer's chosen
-- security company on the floor when the escort has no vehicle of their own.
-- ============================================================================
-- mbg_request_security already matches v_escort scoped to p_business_profile_id
-- when the customer picked a specific company (or auto-picks in-country
-- otherwise). That's correct for the "escort has their own transport" path,
-- where v_escort IS the ride.
--
-- But when the escort has NO vehicle (escort_has_own_transport = false), it
-- auto-orders a driver for the trip and then attaches the escort with:
--     v_escort_result := public.mbg_request_ride_escort(v_ride_id);
-- — the plain 1-arg call, with no company scope at all. That function does
-- its OWN independent best-rated-in-country match, completely ignoring
-- v_escort (the one actually matched above, possibly from the exact company
-- the customer picked). Result: a customer who chose "Company X" can end up
-- billed and escorted by an entirely different company's escort, silently.
--
-- Fix: pass the already-resolved company through, so the escort actually
-- attached is guaranteed to come from the same company (or "any", if that's
-- what the customer chose) — mirrors ADD_COMPANY_CHOICE_TO_RIDE_AND_ESCORT_
-- REQUESTS.sql's own "stay with that company, don't silently substitute
-- another one" rule, applied consistently end-to-end. Requires that
-- migration's 2-arg mbg_request_ride_escort(UUID, UUID) to already exist.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_request_security(
  p_pickup_location TEXT, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_location TEXT, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_country TEXT DEFAULT 'Uganda',
  p_business_profile_id UUID DEFAULT NULL,
  p_passenger_count INT DEFAULT 1
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_escort public.mbg_riders%ROWTYPE;
  v_driver public.mbg_riders%ROWTYPE;
  v_ride_result JSONB;
  v_ride_id UUID;
  v_escort_result JSONB;
  v_preferred_vehicle TEXT;
  v_preferred_operator TEXT;
BEGIN
  IF p_business_profile_id IS NOT NULL THEN
    -- Customer picked a specific company — stay with that company's own
    -- escorts, don't silently substitute a different company's escort.
    SELECT * INTO v_escort FROM public.mbg_riders
    WHERE operator_type = 'escort' AND status = 'active' AND is_available = true
      AND business_profile_id = p_business_profile_id
    ORDER BY rating DESC NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'This security company has no available escort right now');
    END IF;
  ELSE
    -- No company picked — best available escort anywhere, same country
    -- first, else any (mirrors mbg_request_ride_escort's own matching).
    SELECT * INTO v_escort FROM public.mbg_riders
    WHERE operator_type = 'escort' AND status = 'active' AND is_available = true
      AND operator_country = COALESCE(p_country, 'Uganda')
    ORDER BY rating DESC NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT * INTO v_escort FROM public.mbg_riders
      WHERE operator_type = 'escort' AND status = 'active' AND is_available = true
      ORDER BY rating DESC NULLS LAST
      LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'No security escort is available right now');
    END IF;
  END IF;

  IF v_escort.escort_has_own_transport THEN
    -- The escort brings their own vehicle: they ARE the ride. One fare,
    -- no separate escort_flat_fee stacked on top.
    v_ride_result := public.mbg_request_ride(
      'ride', NULL, NULL, v_escort.id,
      p_pickup_location, p_pickup_lat, p_pickup_lng,
      p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
      NULL, false, 'Security escort (self-transport)', 'wallet'
    );
    IF NOT COALESCE((v_ride_result->>'success')::boolean, false) THEN
      RETURN v_ride_result;
    END IF;
    RETURN v_ride_result || jsonb_build_object('mode', 'escort_self_transport', 'escort_rider_id', v_escort.id);
  END IF;

  -- This escort has no vehicle of their own: auto-order a vehicle sized to
  -- the party (1 -> boda, 2-4 -> car, 5+ -> van), then attach the escort as
  -- an add-on — two real resources, so ride fare + escort fee (today's
  -- mbg_request_ride_escort behaviour) is the correct charge here, just
  -- dispatched as one customer order.
  IF COALESCE(p_passenger_count, 1) <= 1 THEN
    v_preferred_vehicle := 'motorcycle'; v_preferred_operator := 'passenger';
  ELSIF p_passenger_count <= 4 THEN
    v_preferred_vehicle := 'car'; v_preferred_operator := 'passenger';
  ELSE
    v_preferred_vehicle := 'van'; v_preferred_operator := 'cargo';
  END IF;

  -- Exact vehicle-type match first, same country first; falls back to any
  -- other available passenger/cargo rider rather than failing outright —
  -- better to send a different vehicle than send nobody.
  SELECT * INTO v_driver FROM public.mbg_riders
  WHERE operator_type IN ('passenger', 'cargo') AND status = 'active' AND is_available = true
    AND operator_country = COALESCE(p_country, 'Uganda')
  ORDER BY
    (vehicle_type::TEXT = v_preferred_vehicle) DESC,
    (operator_type = v_preferred_operator) DESC,
    rating DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_driver FROM public.mbg_riders
    WHERE operator_type IN ('passenger', 'cargo') AND status = 'active' AND is_available = true
    ORDER BY
      (vehicle_type::TEXT = v_preferred_vehicle) DESC,
      (operator_type = v_preferred_operator) DESC,
      rating DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'This escort has no vehicle of their own and no driver is available to pair with them right now');
  END IF;

  v_ride_result := public.mbg_request_ride(
    'ride', NULL, NULL, v_driver.id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    NULL, false, 'Security escort requested', 'wallet'
  );

  IF NOT COALESCE((v_ride_result->>'success')::boolean, false) THEN
    RETURN v_ride_result;
  END IF;

  v_ride_id := (v_ride_result->>'ride_id')::UUID;
  -- Stay with the same escort's company that was already matched above —
  -- was the bare 1-arg call, which threw v_escort's company away and let
  -- mbg_request_ride_escort re-match independently.
  v_escort_result := public.mbg_request_ride_escort(v_ride_id, v_escort.business_profile_id);

  RETURN v_ride_result || jsonb_build_object(
    'mode', 'escort_plus_driver',
    'escort', v_escort_result
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_security(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, UUID, INT) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_request_security now keeps the customer''s chosen security company (or lack of one) all the way through to the escort actually attached to the ride, instead of letting mbg_request_ride_escort re-match independently.';
END $$;
