-- ============================================================================
-- Lets a customer choose "Boda" vs "Car" (etc.) when booking a ride, so a
-- request actually reaches the right kind of driver instead of matching
-- against every vehicle_type indiscriminately. mbg_find_available_riders
-- had no vehicle_type filter at all — EnhancedRideRequest.tsx only ever
-- displayed each candidate's vehicle_type after the fact, never let the
-- customer filter by it up front.
--
-- p_vehicle_types is appended as a new trailing parameter with a default.
-- CORRECTION: an earlier version of this file claimed CREATE OR REPLACE
-- handles an added parameter safely in place — that's wrong. Postgres
-- identifies a function by name + ordered argument TYPE list; adding a
-- parameter changes that list, so CREATE OR REPLACE creates a SECOND,
-- distinct overload rather than replacing the original 9-arg one (same
-- underlying issue as the mbg_apply_as_operator incident in
-- FIX_OPERATOR_APPLICATION_UPGRADE_PATH.sql — there is no safe case for
-- changing a function's parameter list without dropping old overloads
-- first). Drop every existing overload by name before recreating, exactly
-- like that file does.
-- ============================================================================

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
  p_vehicle_types TEXT[] DEFAULT NULL
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
  -- Nearest rider first (real GPS/home distance), "knows this destination"
  -- only breaks ties among comparably-close riders, then rating.
  ORDER BY dist.km ASC NULLS LAST, 13 DESC, r.rating DESC
  LIMIT p_limit;
END;
$$;
-- Explicit argument list, not a bare function name — a bare GRANT has to
-- resolve the function by name alone, which throws the same "not unique"
-- error the instant more than one overload exists for any reason.
GRANT EXECUTE ON FUNCTION public.mbg_find_available_riders(
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN, UUID[], INT, TEXT[]
) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_find_available_riders now supports an optional p_vehicle_types filter — Boda vs Car selection in EnhancedRideRequest.tsx actually narrows matching now.';
END $$;
