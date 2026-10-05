-- ═══════════════════════════════════════════════════════════════════════════
-- Live GPS "riders near me" for the customer Overview greeting + map.
-- Uses real rider GPS (mbg_riders.current_lat/lng, kept fresh by the rider
-- app) — only riders pinged in the last 10 minutes count as "online".
-- SECURITY DEFINER because customers cannot SELECT mbg_riders; returns
-- anonymous positions only (no ids/names/phones).
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.mbg_get_nearby_riders(
  p_lat NUMERIC, p_lng NUMERIC, p_radius_km NUMERIC DEFAULT 5
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_riders JSONB;
  v_count INT;
  v_nearest NUMERIC;
  v_stage RECORD;
BEGIN
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object('lat', t.lat, 'lng', t.lng, 'km', ROUND(t.km, 2)) ORDER BY t.km), '[]'::jsonb),
    COUNT(*), MIN(t.km)
  INTO v_riders, v_count, v_nearest
  FROM (
    SELECT r.current_lat::NUMERIC AS lat, r.current_lng::NUMERIC AS lng,
           public.mbg_haversine_km(r.current_lat, r.current_lng, p_lat, p_lng) AS km
    FROM public.mbg_riders r
    WHERE r.status = 'active' AND r.is_available = true
      AND r.current_lat IS NOT NULL AND r.current_lng IS NOT NULL
      AND r.location_updated_at > now() - interval '10 minutes'
  ) t
  WHERE t.km <= p_radius_km;

  SELECT s.name, s.location_lat::NUMERIC AS lat, s.location_lng::NUMERIC AS lng
  INTO v_stage
  FROM public.mbg_stages s
  WHERE s.is_active AND s.location_lat IS NOT NULL AND s.location_lng IS NOT NULL
  ORDER BY public.mbg_haversine_km(s.location_lat, s.location_lng, p_lat, p_lng)
  LIMIT 1;

  RETURN jsonb_build_object(
    'count', v_count,
    'nearest_km', v_nearest,
    'eta_min', CASE WHEN v_nearest IS NULL THEN NULL ELSE GREATEST(2, ROUND(v_nearest / 20 * 60)) END,
    'stage_name', v_stage.name, 'stage_lat', v_stage.lat, 'stage_lng', v_stage.lng,
    'riders', v_riders
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_get_nearby_riders(NUMERIC, NUMERIC, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';
