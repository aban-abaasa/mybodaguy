-- ============================================================================
-- "Just send security" booking — single order, no double charge.
-- ============================================================================
-- Until now a security escort could only be added on top of a ride the
-- customer had already booked with their own chosen driver
-- (mbg_request_ride_escort in CREATE_RIDE_SECURITY_ESCORT.sql), billed as
-- ride fare + escort_flat_fee. That's correct when the customer really does
-- use two separate resources (their own driver AND an escort).
--
-- But a customer who has no means of transport of their own and just wants
-- "security" needs the escort to physically get them there. Naively that
-- means the escort's own vehicle does the trip — and if the app then also
-- billed the standalone ride fare on top of the escort fee, the customer
-- would effectively be charged twice for one trip (the escort still has to
-- make their own way back to base afterwards either way, same as any other
-- driver — that's normal operating overhead, not a second leg to bill for).
--
-- This adds one entrypoint, mbg_request_security, that picks the flow for
-- the customer instead of asking them to know the difference:
--   - Best-available escort HAS their own vehicle (mbg_riders.
--     escort_has_own_transport) -> the escort IS the ride. One
--     mbg_request_ride call, one fare (still gets the business's own
--     base_fare/per_km_rate via the trg_mbg_apply_business_pricing trigger
--     if that escort's business has pricing set). No escort_flat_fee on top.
--   - Escort has no vehicle -> auto-match a normal driver for the trip and
--     attach the escort to it via the existing mbg_request_ride_escort add-on
--     path, exactly like today's "vehicle + security" flow. Two real
--     resources, so ride fare + escort fee is correct here.
-- Either way the customer makes one call and gets one order back.
-- ============================================================================

ALTER TABLE public.mbg_riders
  ADD COLUMN IF NOT EXISTS escort_has_own_transport BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.mbg_riders.escort_has_own_transport IS
  'operator_type = escort only: true if this escort brings their own vehicle and can be booked as the ride itself, not just an add-on to someone else''s ride.';

-- ============================================================================
-- Let a business admin declare whether an escort they add has their own
-- transport. Adding a trailing param changes the function''s identity in
-- Postgres, so the old 10-arg signature is dropped first (see
-- ADD_RIDE_ORDER_NOTES.sql for why).
-- ============================================================================
DROP FUNCTION IF EXISTS public.mbg_business_add_driver(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
);

CREATE OR REPLACE FUNCTION public.mbg_business_add_driver(
  p_business_profile_id UUID,
  p_driver_email TEXT,
  p_operator_type TEXT,
  p_vehicle_type TEXT DEFAULT 'motorcycle',
  p_plate_number TEXT DEFAULT NULL,
  p_license_number TEXT DEFAULT NULL,
  p_vehicle_model TEXT DEFAULT NULL,
  p_vehicle_color TEXT DEFAULT NULL,
  p_operator_country TEXT DEFAULT 'Uganda',
  p_operator_home_city TEXT DEFAULT NULL,
  p_escort_has_own_transport BOOLEAN DEFAULT false
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver_user_id UUID;
  v_rider_id UUID;
BEGIN
  IF NOT public.ican_business_admin(p_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a business admin can add drivers');
  END IF;
  IF p_operator_type NOT IN ('passenger', 'cargo', 'escort') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid role');
  END IF;

  SELECT id INTO v_driver_user_id FROM public.mbg_users WHERE lower(email) = lower(trim(p_driver_email));
  IF v_driver_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No BodaGoEra account found for that email — they need to sign up first');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mbg_riders
    WHERE user_id = v_driver_user_id AND vehicle_type = p_vehicle_type::public.mbg_vehicle_type
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This person already has a driver/rider registration for that vehicle type');
  END IF;

  INSERT INTO public.mbg_riders (
    user_id, vehicle_type, plate_number, license_number, vehicle_model, vehicle_color,
    status, is_available, operator_type, operator_country, operator_home_city, service_countries,
    business_profile_id, ownership_mode, approved_by, approved_at, escort_has_own_transport
  ) VALUES (
    v_driver_user_id, p_vehicle_type::public.mbg_vehicle_type, COALESCE(p_plate_number, 'PENDING'), COALESCE(p_license_number, 'PENDING'),
    p_vehicle_model, p_vehicle_color,
    'active', false, p_operator_type, COALESCE(p_operator_country, 'Uganda'), p_operator_home_city, ARRAY[COALESCE(p_operator_country, 'Uganda')],
    p_business_profile_id, 'company', auth.uid(), now(),
    p_operator_type = 'escort' AND COALESCE(p_escort_has_own_transport, false)
  ) RETURNING id INTO v_rider_id;

  UPDATE public.mbg_users SET role_type = 'rider', updated_at = now() WHERE id = v_driver_user_id AND role_type = 'customer';

  RETURN jsonb_build_object('success', true, 'rider_id', v_rider_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_add_driver(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) TO authenticated;

-- Surface the flag on the roster list so a business admin can see it (and so
-- the frontend roster table can offer to edit it later).
DROP FUNCTION IF EXISTS public.mbg_business_list_drivers(UUID);

CREATE OR REPLACE FUNCTION public.mbg_business_list_drivers(p_business_profile_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  full_name TEXT,
  email TEXT,
  vehicle_type TEXT,
  operator_type TEXT,
  plate_number TEXT,
  status TEXT,
  is_available BOOLEAN,
  rating NUMERIC,
  total_rides INTEGER,
  escort_has_own_transport BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, r.user_id,
    COALESCE(up.full_name, u.email) AS full_name,
    u.email,
    r.vehicle_type::TEXT, r.operator_type, r.plate_number, r.status, r.is_available,
    r.rating, r.total_rides, r.escort_has_own_transport, r.created_at
  FROM public.mbg_riders r
  JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  WHERE r.business_profile_id = p_business_profile_id
    AND public.ican_business_member(p_business_profile_id)
  ORDER BY r.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_list_drivers(UUID) TO authenticated;

-- Lets a business admin flip the flag for an escort already on the roster.
CREATE OR REPLACE FUNCTION public.mbg_business_set_escort_transport(
  p_rider_id UUID,
  p_has_own_transport BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_profile_id UUID;
  v_operator_type TEXT;
BEGIN
  SELECT business_profile_id, operator_type INTO v_business_profile_id, v_operator_type
  FROM public.mbg_riders WHERE id = p_rider_id;

  IF v_business_profile_id IS NULL OR NOT public.ican_business_admin(v_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only this escort''s business admin can change this');
  END IF;
  IF v_operator_type <> 'escort' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only escort roster entries have a transport flag');
  END IF;

  UPDATE public.mbg_riders SET escort_has_own_transport = p_has_own_transport, updated_at = now()
  WHERE id = p_rider_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_set_escort_transport(UUID, BOOLEAN) TO authenticated;

-- ============================================================================
-- Public list of security-escort companies a customer can pick from, scoped
-- to ones that actually have an available escort right now (no point
-- listing a company with nobody on shift). Separate from mbg_my_businesses,
-- which is member-only and lists a business admin's own companies.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_list_security_companies(p_country TEXT DEFAULT NULL)
RETURNS TABLE (
  business_profile_id UUID,
  business_name TEXT,
  avatar_url TEXT,
  home_city TEXT,
  home_country TEXT,
  available_escorts INTEGER,
  has_self_transport_escort BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    bp.id, bp.business_name, bp.avatar_url,
    bp.metadata->>'home_city', bp.metadata->>'home_country',
    COUNT(r.id)::INTEGER,
    BOOL_OR(r.escort_has_own_transport)
  FROM public.business_profiles bp
  JOIN public.mbg_riders r ON r.business_profile_id = bp.id
    AND r.operator_type = 'escort' AND r.status = 'active' AND r.is_available = true
    AND (p_country IS NULL OR r.operator_country = p_country)
  WHERE bp.metadata->>'category_key' = 'security_escort'
    AND bp.metadata->>'source' = 'bodagoera'
  GROUP BY bp.id, bp.business_name, bp.avatar_url, bp.metadata
  ORDER BY COUNT(r.id) DESC, bp.business_name ASC;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_list_security_companies(TEXT) TO authenticated;

-- ============================================================================
-- Single "I need security" entrypoint. Auto-decides self-transport vs
-- driver+escort so the customer never has to pick which flow applies, and
-- never gets billed for both a full ride and an escort covering the same
-- trip. Optionally scoped to one company (p_business_profile_id) the
-- customer picked from mbg_list_security_companies; when the vehicle has to
-- be auto-ordered, its size is picked from p_passenger_count instead of
-- defaulting to whatever's nearest, so a group doesn't get sent a boda.
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
  v_escort_result := public.mbg_request_ride_escort(v_ride_id);

  RETURN v_ride_result || jsonb_build_object(
    'mode', 'escort_plus_driver',
    'escort', v_escort_result
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_security(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, UUID, INT) TO authenticated;

-- ============================================================================
-- mbg_request_security assigns a rider (escort or driver) the customer never
-- picked from a list, unlike the normal direct-offer flow. This lets the
-- frontend fetch that rider's public details afterwards — same shape/source
-- columns as mbg_find_available_riders — so the existing "waiting for
-- acceptance" / comms UI can display and address them like any other ride.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_get_ride_rider_info(p_ride_id UUID)
RETURNS TABLE (
  rider_id UUID,
  full_name TEXT,
  phone TEXT,
  rating NUMERIC,
  total_rides INTEGER,
  vehicle_type TEXT,
  power_type TEXT,
  has_umbrella BOOLEAN,
  plate_number TEXT,
  vehicle_color TEXT,
  mode TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, COALESCE(up.full_name, 'Rider'),
    COALESCE(NULLIF(up.phone, ''), NULLIF(u.phone, '')),
    r.rating, r.total_rides, r.vehicle_type::TEXT, r.power_type, r.has_umbrella,
    r.plate_number, r.vehicle_color, r.mode
  FROM public.mbg_rides ride
  JOIN public.mbg_customers c ON c.id = ride.customer_id
  JOIN public.mbg_riders r ON r.id = ride.rider_id
  JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  WHERE ride.id = p_ride_id AND c.user_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.mbg_get_ride_rider_info(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Security-only booking ready — mbg_request_security auto-picks self-transport-escort vs driver+escort, never both fares for one trip.';
END $$;
