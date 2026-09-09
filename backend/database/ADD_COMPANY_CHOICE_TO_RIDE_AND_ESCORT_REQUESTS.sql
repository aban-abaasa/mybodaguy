-- ============================================================================
-- Let a customer choose "any available rider/driver" OR "only from this
-- specific transport company" when booking a ride/delivery — and the same
-- any-vs-company choice for the security escort add-on, which today always
-- auto-picks silently.
-- ============================================================================
-- mbg_list_security_companies / mbg_request_security already let a customer
-- pick a specific 'security_escort' business for the STANDALONE "Just send
-- security" flow (CREATE_SECURITY_ONLY_ESCORT_BOOKING.sql). Two gaps this
-- closes:
--
-- 1. The ordinary ride/delivery matching path (mbg_find_available_riders,
--    mbg_find_available_vehicles) has no equivalent — a customer can filter
--    by vehicle type but never by which 'transport_company' business a
--    driver belongs to, even though CREATE_BODAGOERA_BUSINESS_DRIVER_ROSTER.sql
--    already lets companies build a driver roster. mbg_list_ride_companies
--    is the transport_company mirror of mbg_list_security_companies, and
--    both matching functions gain an optional trailing p_business_profile_id
--    filter (dropping every existing overload first — adding a parameter
--    creates a second overload otherwise, per this project's own established
--    convention, see ADD_VEHICLE_TYPE_FILTER_TO_RIDE_MATCHING.sql).
--
-- 2. mbg_request_ride_escort (the "Add a security escort" add-on toggle on
--    an ordinary ride, CREATE_RIDE_SECURITY_ESCORT.sql) always auto-picks
--    the best-rated available escort in-country — unlike mbg_request_security,
--    it never accepts a company choice at all, even though the frontend
--    already collects one (selectedSecurityCompanyId) for the OTHER,
--    standalone escort flow. Gains the same optional p_business_profile_id
--    param, with the same "stay with that company, don't silently
--    substitute another one" behavior mbg_request_security already has.
--
-- Also, while touching escort pricing: mbg_request_ride_escort billed
-- COALESCE(that escort's own company escort_flat_fee, mbg_estimate_escort_fee)
-- — a platform-wide fixed fallback fee (pricing.escort_default_fee_ugx,
-- 15000) could end up charged even though no company the customer was
-- actually matched to set that number. Escorts only ever belong to a
-- security company (there's no personal-escort path), so the fee should
-- always be that company's own price. Both mbg_request_ride_escort and the
-- preview mbg_estimate_escort_fee now only ever match/quote a company that
-- has actually configured escort_flat_fee — never a generic guess.
-- ============================================================================

-- ── 1. mbg_find_available_riders: + optional company filter ───────────────
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mbg_find_available_riders'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.mbg_find_available_riders(%s)', fn.args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.mbg_find_available_riders(
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_dropoff_area TEXT DEFAULT NULL,
  p_power_type TEXT DEFAULT NULL,
  p_require_umbrella BOOLEAN DEFAULT false,
  p_exclude_rider_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 10,
  p_vehicle_types TEXT[] DEFAULT NULL,
  p_business_profile_id UUID DEFAULT NULL
)
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
  mode TEXT,
  distance_to_pickup_km NUMERIC,
  estimated_arrival_min INTEGER,
  knows_destination BOOLEAN,
  fare NUMERIC,
  distance_km NUMERIC,
  time_multiplier NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_distance_km NUMERIC := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  v_multiplier NUMERIC := public.mbg_current_time_multiplier();
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('ride.base_fare', 1000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('ride.per_km_rate', 1000);
  v_min_fare  NUMERIC := public.mbg_get_setting_numeric('ride.minimum_fare', 2000);
  v_raw_fare NUMERIC;
BEGIN
  IF v_distance_km IS NULL THEN
    RAISE EXCEPTION 'Invalid pickup/dropoff coordinates';
  END IF;
  v_raw_fare := GREATEST(v_min_fare, v_base_fare + v_distance_km * v_per_km) * v_multiplier;

  RETURN QUERY
  SELECT
    r.id,
    COALESCE(up.full_name, 'Rider'),
    COALESCE(NULLIF(up.phone, ''), NULLIF(u.phone, '')),
    r.rating,
    r.total_rides,
    r.vehicle_type::TEXT,
    r.power_type,
    r.has_umbrella,
    r.plate_number,
    r.vehicle_color,
    r.mode,
    dist.km,
    GREATEST(2, ROUND(COALESCE(dist.km, 5) / 20 * 60))::INTEGER,
    EXISTS (
      SELECT 1 FROM public.mbg_rider_locations kl
      WHERE kl.rider_user_id = r.user_id
        AND (
          (p_dropoff_area IS NOT NULL AND kl.name ILIKE '%' || p_dropoff_area || '%')
          OR public.mbg_haversine_km(kl.latitude, kl.longitude, p_dropoff_lat, p_dropoff_lng) <= 3
        )
    ),
    ROUND((CASE
      WHEN r.mode = 'vip' THEN v_raw_fare * (1 + r.vip_surcharge_pct / 100)
      WHEN r.mode = 'discount' THEN v_raw_fare * (1 - r.discount_pct / 100)
      WHEN r.mode = 'return' THEN v_raw_fare * (1 - r.return_discount_pct / 100)
      ELSE v_raw_fare
    END) / 100) * 100,
    v_distance_km,
    v_multiplier
  FROM public.mbg_riders r
  JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  LEFT JOIN public.mbg_rider_locations home ON home.rider_user_id = r.user_id AND home.is_home = true
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      public.mbg_haversine_km(r.current_lat, r.current_lng, p_pickup_lat, p_pickup_lng),
      public.mbg_haversine_km(home.latitude, home.longitude, p_pickup_lat, p_pickup_lng)
    ) AS km
  ) dist
  WHERE r.status = 'active'
    AND r.is_available = true
    AND NOT (r.id = ANY(p_exclude_rider_ids))
    AND (p_power_type IS NULL OR r.power_type = p_power_type)
    AND (NOT p_require_umbrella OR r.has_umbrella = true)
    AND (p_vehicle_types IS NULL OR r.vehicle_type::TEXT = ANY(p_vehicle_types))
    AND (p_business_profile_id IS NULL OR r.business_profile_id = p_business_profile_id)
  -- Nearest rider first (real GPS/home distance), "knows this destination"
  -- only breaks ties among comparably-close riders, then rating.
  ORDER BY dist.km ASC NULLS LAST, 13 DESC, r.rating DESC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_find_available_riders(
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN, UUID[], INT, TEXT[], UUID
) TO authenticated;

-- ── 2. mbg_find_available_vehicles: + optional company filter ─────────────
DO $$
DECLARE
  fn RECORD;
BEGIN
  FOR fn IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mbg_find_available_vehicles'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.mbg_find_available_vehicles(%s)', fn.args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.mbg_find_available_vehicles(
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_country TEXT DEFAULT 'Uganda',
  p_vehicle_types TEXT[] DEFAULT ARRAY['motorcycle'],
  p_operator_type TEXT DEFAULT 'passenger',
  p_min_cargo_capacity_kg NUMERIC DEFAULT NULL,
  p_exclude_rider_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 10,
  p_business_profile_id UUID DEFAULT NULL
)
RETURNS TABLE (
  rider_id UUID,
  full_name TEXT,
  phone TEXT,
  rating NUMERIC,
  vehicle_type TEXT,
  operator_type TEXT,
  cargo_capacity_kg NUMERIC,
  plate_number TEXT,
  distance_to_pickup_km NUMERIC,
  fare NUMERIC,
  distance_km NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- fare/distance_km (ADD_CROSS_BORDER_CUSTOMER_DELIVERY.sql) — lets the
  -- customer-facing cross-border search show a price without a second RPC
  -- call. Must be preserved here: dropping every overload above and
  -- recreating from the plain CREATE_JOURNEY_BOOKING_ENGINE.sql shape would
  -- silently regress that (EnhancedRideRequest.tsx reads v.fare/v.distance_km
  -- straight off this function's rows).
  v_distance_km NUMERIC := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('cargo.base_fare', 5000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('cargo.per_km_rate', 2000);
  v_fare NUMERIC := ROUND((v_base_fare + COALESCE(v_distance_km, 0) * v_per_km) / 100) * 100;
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    COALESCE(up.full_name, 'Driver'),
    COALESCE(NULLIF(up.phone, ''), NULLIF(u.phone, '')),
    r.rating,
    r.vehicle_type::TEXT,
    r.operator_type,
    r.cargo_capacity_kg,
    r.plate_number,
    dist.km,
    v_fare,
    v_distance_km
  FROM public.mbg_riders r
  JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  LEFT JOIN public.mbg_rider_locations home ON home.rider_user_id = r.user_id AND home.is_home = true
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      public.mbg_haversine_km(r.current_lat, r.current_lng, p_pickup_lat, p_pickup_lng),
      public.mbg_haversine_km(home.latitude, home.longitude, p_pickup_lat, p_pickup_lng)
    ) AS km
  ) dist
  WHERE r.status = 'active'
    AND r.is_available = true
    AND r.operator_type = p_operator_type
    AND r.vehicle_type::TEXT = ANY(p_vehicle_types)
    AND p_country = ANY(r.service_countries)
    AND NOT (r.id = ANY(p_exclude_rider_ids))
    AND (p_min_cargo_capacity_kg IS NULL OR r.cargo_capacity_kg >= p_min_cargo_capacity_kg)
    AND (p_business_profile_id IS NULL OR r.business_profile_id = p_business_profile_id)
  ORDER BY dist.km ASC NULLS LAST, r.rating DESC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_find_available_vehicles(
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT[], TEXT, NUMERIC, UUID[], INT, UUID
) TO service_role, authenticated;

-- ── 3. mbg_list_ride_companies — transport_company mirror of
--    mbg_list_security_companies, for the ordinary ride/delivery flow. ─────
CREATE OR REPLACE FUNCTION public.mbg_list_ride_companies(
  p_country TEXT DEFAULT NULL,
  p_vehicle_type TEXT DEFAULT NULL
)
RETURNS TABLE (
  business_profile_id UUID,
  business_name TEXT,
  avatar_url TEXT,
  home_city TEXT,
  home_country TEXT,
  available_vehicles INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    bp.id, bp.business_name, bp.avatar_url,
    bp.metadata->>'home_city', bp.metadata->>'home_country',
    COUNT(r.id)::INTEGER
  FROM public.business_profiles bp
  JOIN public.mbg_riders r ON r.business_profile_id = bp.id
    AND r.operator_type IN ('passenger', 'cargo') AND r.status = 'active' AND r.is_available = true
    AND (p_country IS NULL OR r.operator_country = p_country)
    AND (p_vehicle_type IS NULL OR r.vehicle_type::TEXT = p_vehicle_type)
  WHERE bp.metadata->>'category_key' = 'transport_company'
    AND bp.metadata->>'source' = 'bodagoera'
  GROUP BY bp.id, bp.business_name, bp.avatar_url, bp.metadata
  ORDER BY COUNT(r.id) DESC, bp.business_name ASC;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_list_ride_companies(TEXT, TEXT) TO authenticated;

-- ── 4. mbg_estimate_escort_fee: + optional company choice, drop the
--    platform-wide fixed-fee fallback ────────────────────────────────────
-- Was: COALESCE(avg of every in-country company's own escort_flat_fee,
-- pricing.escort_default_fee_ugx flat 15000). That flat number could show up
-- as "the price" even though no company the customer could actually be
-- matched to charges it. Now: with a company picked, this is exactly that
-- company's own escort_flat_fee (or NULL — "this company hasn't set its
-- price yet" — never a made-up number); with no company picked ("Any"),
-- still an in-country average across companies that HAVE set a price, since
-- which company answers isn't known yet, but no more platform-default floor
-- under it. Adding a parameter changes the function's identity, so the old
-- 1-arg signature is dropped first (this project's own convention, see
-- ADD_VEHICLE_TYPE_FILTER_TO_RIDE_MATCHING.sql).
DROP FUNCTION IF EXISTS public.mbg_estimate_escort_fee(TEXT);

CREATE OR REPLACE FUNCTION public.mbg_estimate_escort_fee(
  p_country TEXT DEFAULT 'Uganda',
  p_business_profile_id UUID DEFAULT NULL
)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_business_profile_id IS NOT NULL THEN
      (SELECT escort_flat_fee FROM public.mbg_business_pricing_settings WHERE business_profile_id = p_business_profile_id)
    ELSE (
      SELECT AVG(ps.escort_flat_fee)
      FROM public.mbg_business_pricing_settings ps
      JOIN public.mbg_riders r ON r.business_profile_id = ps.business_profile_id
      WHERE r.operator_type = 'escort' AND r.status = 'active' AND r.is_available = true
        AND r.operator_country = COALESCE(p_country, 'Uganda')
        AND ps.escort_flat_fee IS NOT NULL
    )
  END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_estimate_escort_fee(TEXT, UUID) TO authenticated;

-- ── 5. mbg_request_ride_escort: + optional company choice ──────────────────
DROP FUNCTION IF EXISTS public.mbg_request_ride_escort(UUID);

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

  -- Every escort belongs to a security company (there's no "personal"
  -- escort path — see CREATE_SECURITY_ONLY_ESCORT_BOOKING.sql). The fee is
  -- always that company's own escort_flat_fee, never a generic platform
  -- guess, so only escorts whose company has actually configured a price
  -- are candidates at all.
  IF p_business_profile_id IS NOT NULL THEN
    -- Customer picked a specific company — stay with that company's own
    -- escorts rather than silently substituting a different one (same rule
    -- mbg_request_security already applies to the standalone escort flow).
    SELECT r.* INTO v_escort FROM public.mbg_riders r
    JOIN public.mbg_business_pricing_settings ps ON ps.business_profile_id = r.business_profile_id
    WHERE r.operator_type = 'escort' AND r.status = 'active' AND r.is_available = true
      AND r.business_profile_id = p_business_profile_id
      AND ps.escort_flat_fee IS NOT NULL
    ORDER BY r.rating DESC NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'This security company has no available escort right now, or hasn''t set its escort pricing yet');
    END IF;
  ELSE
    SELECT r.* INTO v_escort FROM public.mbg_riders r
    JOIN public.mbg_business_pricing_settings ps ON ps.business_profile_id = r.business_profile_id
    WHERE r.operator_type = 'escort' AND r.status = 'active' AND r.is_available = true
      AND ps.escort_flat_fee IS NOT NULL
      AND r.operator_country = COALESCE(v_ride.country, 'Uganda')
    ORDER BY r.rating DESC NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT r.* INTO v_escort FROM public.mbg_riders r
      JOIN public.mbg_business_pricing_settings ps ON ps.business_profile_id = r.business_profile_id
      WHERE r.operator_type = 'escort' AND r.status = 'active' AND r.is_available = true
        AND ps.escort_flat_fee IS NOT NULL
      ORDER BY r.rating DESC NULLS LAST
      LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'No security escort with pricing set up is available right now');
    END IF;
  END IF;

  -- Guaranteed NOT NULL by the ps.escort_flat_fee IS NOT NULL filter above —
  -- always this escort's own company price, never a fallback estimate.
  SELECT escort_flat_fee INTO v_fee FROM public.mbg_business_pricing_settings
  WHERE business_profile_id = v_escort.business_profile_id;

  INSERT INTO public.mbg_ride_escort_requests (ride_id, escort_rider_id, business_profile_id, fee)
  VALUES (p_ride_id, v_escort.id, v_escort.business_profile_id, v_fee)
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'fee', v_fee);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride_escort(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Ride/delivery matching and the escort add-on both accept an optional company choice now (mbg_list_ride_companies + p_business_profile_id on mbg_find_available_riders/mbg_find_available_vehicles/mbg_request_ride_escort), and escort pricing always comes from that escort''s own company (mbg_estimate_escort_fee / mbg_request_ride_escort no longer fall back to a platform-wide fixed fee).';
END $$;
