-- ============================================================================
-- Fix: mbg_find_available_riders 400 (Bad Request) from the frontend.
-- ============================================================================
-- mbg_find_available_riders has been redefined across four migration files
-- as its signature grew (CREATE_REAL_RIDE_MATCHING_ENGINE.sql: 9 args ->
-- ADD_VEHICLE_TYPE_FILTER_TO_RIDE_MATCHING.sql: +p_vehicle_types ->
-- ADD_COMPANY_CHOICE_TO_RIDE_AND_ESCORT_REQUESTS.sql: +p_business_profile_id
-- -> ADD_ADMIN_VERIFIED_STORE_DRIVERS.sql: same 11 args, 2 more OUTPUT
-- columns). Postgres identifies a function by name + argument TYPE LIST, so
-- every one of those had to DROP every prior overload before recreating —
-- the first two migrations do that with a dynamic pg_proc loop (drops
-- whatever currently exists, no matter its shape). The last one instead
-- hardcodes DROP FUNCTION IF EXISTS ...(NUMERIC, NUMERIC, ..., TEXT[], UUID)
-- — if what was actually live at the time didn't exactly match that literal
-- 11-argument list (e.g. an earlier migration in this chain never got run
-- against this database), that DROP IF EXISTS silently no-ops and
-- CREATE OR REPLACE adds a SECOND overload instead of replacing the first.
-- With two overloads alive, PostgREST can no longer uniquely resolve a
-- named-parameter RPC call and returns exactly this kind of 400.
--
-- Fix: same dynamic drop-everything-then-recreate-one pattern the earlier
-- two migrations already established, applied here so this is self-healing
-- regardless of which overload(s) actually exist right now. Recreates the
-- single canonical (and most current) 11-arg version from
-- ADD_ADMIN_VERIFIED_STORE_DRIVERS.sql verbatim — no behavior change, just
-- guarantees there's exactly one function left afterward.
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
  time_multiplier NUMERIC,
  verified_business_name TEXT,
  is_admin_verified_store_driver BOOLEAN
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
    v_multiplier,
    CASE WHEN r.admin_verified_at IS NOT NULL THEN bp.business_name ELSE NULL END,
    r.admin_verified_at IS NOT NULL
  FROM public.mbg_riders r
  JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  LEFT JOIN public.mbg_rider_locations home ON home.rider_user_id = r.user_id AND home.is_home = true
  LEFT JOIN public.business_profiles bp ON bp.id = r.business_profile_id
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
  -- Nearest rider first (real GPS/home distance); "knows this destination"
  -- (column 14) and admin-verified store driver (column 19) only break ties
  -- among comparably-close riders, then rating.
  ORDER BY dist.km ASC NULLS LAST, 14 DESC, 19 DESC, r.rating DESC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_find_available_riders(
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN, UUID[], INT, TEXT[], UUID
) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mbg_find_available_riders';

  IF v_count = 1 THEN
    RAISE NOTICE '✅ mbg_find_available_riders: exactly one overload now exists — the duplicate-overload 400 should be gone.';
  ELSE
    RAISE WARNING '⚠️ mbg_find_available_riders: % overloads still exist after this fix — something else is redefining it. Check for other migration files calling CREATE FUNCTION on this name without dropping first.', v_count;
  END IF;
END $$;
