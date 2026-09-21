-- ============================================================================
-- "Anyone available" now means the NEAREST one — security escorts + paired drivers
-- ============================================================================
-- The Book a Ride screen offers "Anyone available — nearest" for a security
-- escort (both the "Add a security escort" add-on and the standalone "Just send
-- security" flow). Ride/delivery rider matching (mbg_find_available_riders /
-- mbg_find_available_vehicles) already sorts nearest-first, but the two
-- functions below picked the BEST-RATED escort / paired driver anywhere,
-- ignoring where the customer actually is. That made "any available" mean
-- "highest rating, possibly across the city".
--
-- Distance is the same rule the rider search uses: live GPS position when the
-- rider has one, else their registered home location. A rider with neither
-- sorts last (NULLS LAST) rather than being excluded — better a far escort
-- than none. Rating is only the tie-break now.
--
-- Everything else is unchanged from the versions this replaces:
--   * mbg_request_ride_escort(UUID, UUID)  <- FIX_ESCORT_HOURLY_RATE_FALLBACK.sql
--   * mbg_request_security(...)            <- FIX_REQUEST_SECURITY_HONOR_CHOSEN_COMPANY.sql
-- A specific company still means ONLY that company's escorts (nearest of them).
-- Safe to re-run. Run in the shared Supabase SQL editor.
-- ============================================================================

-- Distance from a rider to a point, in km (NULL when the rider has no location).
CREATE OR REPLACE FUNCTION public.mbg_rider_distance_km(
  p_rider_id UUID,
  p_lat NUMERIC,
  p_lng NUMERIC
) RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    public.mbg_haversine_km(r.current_lat, r.current_lng, p_lat, p_lng),
    (SELECT public.mbg_haversine_km(h.latitude, h.longitude, p_lat, p_lng)
       FROM public.mbg_rider_locations h
      WHERE h.rider_user_id = r.user_id AND h.is_home = true
      LIMIT 1)
  )::NUMERIC
  FROM public.mbg_riders r
  WHERE r.id = p_rider_id;
$$;
REVOKE ALL ON FUNCTION public.mbg_rider_distance_km(UUID, NUMERIC, NUMERIC) FROM PUBLIC, anon, authenticated;


-- Security escort add-on for a ride: nearest available escort to the ride's pickup.
CREATE OR REPLACE FUNCTION public.mbg_request_ride_escort(
  p_ride_id UUID,
  p_business_profile_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_escort public.mbg_riders%ROWTYPE;
  v_fee NUMERIC;
  v_request_id UUID;
BEGIN
  SELECT r.* INTO v_ride FROM public.mbg_rides r
    JOIN public.mbg_customers c ON c.id = r.customer_id
    WHERE r.id = p_ride_id AND c.user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ride not found');
  END IF;
  IF EXISTS (SELECT 1 FROM public.mbg_ride_escort_requests WHERE ride_id = p_ride_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'An escort has already been requested for this ride');
  END IF;

  -- Every escort belongs to a security company; the fee is always that
  -- company's own price (flat fee, else hourly rate as a flat per-booking
  -- charge), so only escorts whose company has set one are candidates.
  IF p_business_profile_id IS NOT NULL THEN
    -- Customer picked a specific company — stay with that company's own
    -- escorts (the nearest of them), never substitute a different company.
    SELECT r.* INTO v_escort FROM public.mbg_riders r
    JOIN public.mbg_business_pricing_settings ps ON ps.business_profile_id = r.business_profile_id
    WHERE r.operator_type = 'escort' AND r.status = 'active' AND r.is_available = true
      AND r.business_profile_id = p_business_profile_id
      AND COALESCE(ps.escort_flat_fee, ps.escort_hourly_rate) IS NOT NULL
    ORDER BY public.mbg_rider_distance_km(r.id, v_ride.pickup_lat, v_ride.pickup_lng) ASC NULLS LAST,
             r.rating DESC NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'This security company has no available escort right now, or hasn''t set its escort pricing yet');
    END IF;
  ELSE
    -- Anyone available: nearest escort to the pickup, same country first.
    SELECT r.* INTO v_escort FROM public.mbg_riders r
    JOIN public.mbg_business_pricing_settings ps ON ps.business_profile_id = r.business_profile_id
    WHERE r.operator_type = 'escort' AND r.status = 'active' AND r.is_available = true
      AND COALESCE(ps.escort_flat_fee, ps.escort_hourly_rate) IS NOT NULL
      AND r.operator_country = COALESCE(v_ride.country, 'Uganda')
    ORDER BY public.mbg_rider_distance_km(r.id, v_ride.pickup_lat, v_ride.pickup_lng) ASC NULLS LAST,
             r.rating DESC NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT r.* INTO v_escort FROM public.mbg_riders r
      JOIN public.mbg_business_pricing_settings ps ON ps.business_profile_id = r.business_profile_id
      WHERE r.operator_type = 'escort' AND r.status = 'active' AND r.is_available = true
        AND COALESCE(ps.escort_flat_fee, ps.escort_hourly_rate) IS NOT NULL
      ORDER BY public.mbg_rider_distance_km(r.id, v_ride.pickup_lat, v_ride.pickup_lng) ASC NULLS LAST,
               r.rating DESC NULLS LAST
      LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'No security escort with pricing set up is available right now');
    END IF;
  END IF;

  SELECT COALESCE(escort_flat_fee, escort_hourly_rate) INTO v_fee FROM public.mbg_business_pricing_settings
  WHERE business_profile_id = v_escort.business_profile_id;

  INSERT INTO public.mbg_ride_escort_requests (ride_id, escort_rider_id, business_profile_id, fee)
  VALUES (p_ride_id, v_escort.id, v_escort.business_profile_id, v_fee)
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'fee', v_fee);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride_escort(UUID, UUID) TO authenticated;


-- Standalone "Just send security": nearest escort to the pickup, and — when the
-- escort has no vehicle — the nearest suitable driver paired with them.
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
    -- Customer picked a specific company — that company's nearest escort.
    SELECT * INTO v_escort FROM public.mbg_riders
    WHERE operator_type = 'escort' AND status = 'active' AND is_available = true
      AND business_profile_id = p_business_profile_id
    ORDER BY public.mbg_rider_distance_km(id, p_pickup_lat, p_pickup_lng) ASC NULLS LAST,
             rating DESC NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'This security company has no available escort right now');
    END IF;
  ELSE
    -- Anyone available — the nearest escort to the pickup, same country
    -- first, else any.
    SELECT * INTO v_escort FROM public.mbg_riders
    WHERE operator_type = 'escort' AND status = 'active' AND is_available = true
      AND operator_country = COALESCE(p_country, 'Uganda')
    ORDER BY public.mbg_rider_distance_km(id, p_pickup_lat, p_pickup_lng) ASC NULLS LAST,
             rating DESC NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT * INTO v_escort FROM public.mbg_riders
      WHERE operator_type = 'escort' AND status = 'active' AND is_available = true
      ORDER BY public.mbg_rider_distance_km(id, p_pickup_lat, p_pickup_lng) ASC NULLS LAST,
               rating DESC NULLS LAST
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
  -- an add-on — ride fare + escort fee.
  IF COALESCE(p_passenger_count, 1) <= 1 THEN
    v_preferred_vehicle := 'motorcycle'; v_preferred_operator := 'passenger';
  ELSIF p_passenger_count <= 4 THEN
    v_preferred_vehicle := 'car'; v_preferred_operator := 'passenger';
  ELSE
    v_preferred_vehicle := 'van'; v_preferred_operator := 'cargo';
  END IF;

  -- Right vehicle type first (a boda for one person), then the NEAREST one to
  -- the pickup; same country first, falling back to any other available
  -- passenger/cargo rider rather than failing outright.
  SELECT * INTO v_driver FROM public.mbg_riders
  WHERE operator_type IN ('passenger', 'cargo') AND status = 'active' AND is_available = true
    AND operator_country = COALESCE(p_country, 'Uganda')
  ORDER BY
    (vehicle_type::TEXT = v_preferred_vehicle) DESC,
    (operator_type = v_preferred_operator) DESC,
    public.mbg_rider_distance_km(id, p_pickup_lat, p_pickup_lng) ASC NULLS LAST,
    rating DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_driver FROM public.mbg_riders
    WHERE operator_type IN ('passenger', 'cargo') AND status = 'active' AND is_available = true
    ORDER BY
      (vehicle_type::TEXT = v_preferred_vehicle) DESC,
      (operator_type = v_preferred_operator) DESC,
      public.mbg_rider_distance_km(id, p_pickup_lat, p_pickup_lng) ASC NULLS LAST,
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
  -- Stay with the same escort's company that was already matched above.
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
  RAISE NOTICE '✅ Security escorts (add-on + "Just send security") and the driver paired with an escort are now the NEAREST available one to the pickup (rating breaks ties), instead of the best-rated one anywhere. A chosen company still restricts to that company''s escorts.';
END $$;
