-- ============================================================================
-- RIDER DEMAND INSIGHTS
-- ============================================================================
-- Powers two things on the rider homepage (RiderSmartAssist.tsx):
--   - "Customers keep asking for <place> — add it to My areas": busy places
--     the rider doesn't cover yet, and
--   - the smart Work Mode suggestion / auto-switch: how busy this hour is
--     against the area's usual day, how many requests are waiting and how
--     many riders are online nearby.
--
-- A rider can only read their own rides (RLS), so the area-wide picture comes
-- from this SECURITY DEFINER function. It never returns a customer, a ride or
-- an exact point: only ~1 km cells, and only cells that at least two different
-- customers rode to/from or saved as an area. Riders only.
--
-- Depends on CREATE_REAL_RIDE_MATCHING_ENGINE.sql (mbg_haversine_km,
-- mbg_customer_areas). The app falls back to the rider's own history if this
-- hasn't been run yet, so it is safe to deploy in any order.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_rider_demand_snapshot(
  p_lat       NUMERIC DEFAULT NULL,
  p_lng       NUMERIC DEFAULT NULL,
  p_radius_km NUMERIC DEFAULT 15,
  p_days      INTEGER DEFAULT 14,
  p_tz        TEXT    DEFAULT 'Africa/Kampala'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days    INTEGER := LEAST(GREATEST(COALESCE(p_days, 14), 1), 60);
  v_radius  NUMERIC := LEAST(GREATEST(COALESCE(p_radius_km, 15), 1), 50);
  v_since   TIMESTAMPTZ := now() - make_interval(days => v_days);
  v_tz      TEXT := COALESCE(NULLIF(p_tz, ''), 'Africa/Kampala');
  v_cells   JSONB;
  v_hourly  JSONB;
  v_pending INTEGER;
  v_online  INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mbg_riders WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only riders can read demand insights';
  END IF;

  -- An unknown time zone name would abort the whole call; fall back instead.
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'Africa/Kampala';
  END IF;

  -- Busy ~1 km cells: ride pickups AND drop-offs (customers "want" a place
  -- whether they leave from it or go to it) plus areas customers saved.
  WITH pts AS (
    SELECT c.user_id AS who, r.pickup_lat::NUMERIC AS lat, r.pickup_lng::NUMERIC AS lng,
           r.pickup_location AS label, r.requested_at AS at, true AS is_ride
    FROM public.mbg_rides r JOIN public.mbg_customers c ON c.id = r.customer_id
    WHERE r.requested_at >= v_since
    UNION ALL
    SELECT c.user_id, r.dropoff_lat::NUMERIC, r.dropoff_lng::NUMERIC, r.dropoff_location, r.requested_at, true
    FROM public.mbg_rides r JOIN public.mbg_customers c ON c.id = r.customer_id
    WHERE r.requested_at >= v_since
    UNION ALL
    SELECT a.customer_user_id, a.latitude::NUMERIC, a.longitude::NUMERIC, COALESCE(NULLIF(a.name, ''), a.address), a.created_at, false
    FROM public.mbg_customer_areas a
    WHERE a.latitude IS NOT NULL AND a.longitude IS NOT NULL
  ),
  scoped AS (
    SELECT * FROM pts
    WHERE lat IS NOT NULL AND lng IS NOT NULL
      AND (p_lat IS NULL OR p_lng IS NULL OR public.mbg_haversine_km(p_lat, p_lng, lat, lng) <= v_radius)
  ),
  cells AS (
    SELECT ROUND(lat, 2) AS clat, ROUND(lng, 2) AS clng,
           AVG(lat) AS lat, AVG(lng) AS lng,
           mode() WITHIN GROUP (ORDER BY label) AS label,
           COUNT(*) FILTER (WHERE is_ride) AS requests,
           COUNT(DISTINCT who) AS customers,
           COUNT(*) FILTER (WHERE is_ride AND at >= now() - interval '48 hours') AS recent,
           MAX(at) FILTER (WHERE is_ride) AS last_at
    FROM scoped
    GROUP BY 1, 2
    HAVING COUNT(DISTINCT who) >= 2
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'lat', ROUND(lat, 5), 'lng', ROUND(lng, 5), 'label', label,
           'requests', requests, 'customers', customers, 'recent', recent, 'last_at', last_at
         ) ORDER BY (requests + customers * 2 + recent * 2) DESC), '[]'::jsonb)
  INTO v_cells
  FROM (SELECT * FROM cells ORDER BY (requests + customers * 2 + recent * 2) DESC LIMIT 40) top_cells;

  -- Hour-of-day histogram of requests in the rider's surroundings (local time).
  SELECT COALESCE(jsonb_agg(COALESCE(h.n, 0) ORDER BY g.hr), '[]'::jsonb)
  INTO v_hourly
  FROM generate_series(0, 23) AS g(hr)
  LEFT JOIN (
    SELECT EXTRACT(HOUR FROM (r.requested_at AT TIME ZONE v_tz))::INTEGER AS hr, COUNT(*) AS n
    FROM public.mbg_rides r
    WHERE r.requested_at >= v_since
      AND (p_lat IS NULL OR p_lng IS NULL OR public.mbg_haversine_km(p_lat, p_lng, r.pickup_lat, r.pickup_lng) <= v_radius)
    GROUP BY 1
  ) h ON h.hr = g.hr;

  -- Requests waiting for a rider right now, nearby.
  SELECT COUNT(*) INTO v_pending
  FROM public.mbg_rides r
  WHERE r.status::TEXT = 'pending'
    AND r.requested_at >= now() - interval '20 minutes'
    AND (p_lat IS NULL OR p_lng IS NULL OR public.mbg_haversine_km(p_lat, p_lng, r.pickup_lat, r.pickup_lng) <= v_radius);

  -- Riders online nearby (fresh location only).
  SELECT COUNT(*) INTO v_online
  FROM public.mbg_riders r
  WHERE r.status = 'active' AND r.is_available = true
    AND (
      p_lat IS NULL OR p_lng IS NULL
      OR (r.current_lat IS NOT NULL AND r.location_updated_at >= now() - interval '30 minutes'
          AND public.mbg_haversine_km(p_lat, p_lng, r.current_lat, r.current_lng) <= v_radius)
    );

  RETURN jsonb_build_object(
    'cells', v_cells,
    'hourly', v_hourly,
    'pending_nearby', v_pending,
    'riders_online', v_online,
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mbg_rider_demand_snapshot(NUMERIC, NUMERIC, NUMERIC, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_rider_demand_snapshot(NUMERIC, NUMERIC, NUMERIC, INTEGER, TEXT) TO authenticated;
