-- ============================================================================
-- CROSS-BORDER CUSTOMER DELIVERY — extends the customer-facing "Book a
-- Ride > Delivery > Normal Delivery" flow to match cargo couriers
-- (van/truck, operator_type='cargo') when pickup and dropoff resolve to
-- different countries, instead of mbg_find_available_riders/mbg_request_ride
-- (which are country-blind and hard-require a Uganda mbg_stages row).
--
-- Same-country delivery/ride requests are completely untouched — this is a
-- new, additive branch the frontend only calls when pickup/dropoff countries
-- differ (see EnhancedRideRequest.tsx).
--
-- Run after CREATE_JOURNEY_BOOKING_ENGINE.sql (needs mbg_find_available_vehicles).
-- ============================================================================

-- 1. mbg_find_available_vehicles gains fare/distance_km output columns so the
--    customer-facing search step can show a price without a second RPC call
--    — same formula mbg_dispatch_delivery_for_purchase_order already uses.
--    Adding RETURNS TABLE columns changes the function's return type, which
--    Postgres will NOT let CREATE OR REPLACE do silently ("cannot change
--    return type of existing function") — the old version must be dropped
--    first. Input parameter list is unchanged, so this remains the single,
--    unambiguous overload of this name.
DROP FUNCTION IF EXISTS public.mbg_find_available_vehicles(
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT[], TEXT, NUMERIC, UUID[], INT
);

CREATE FUNCTION public.mbg_find_available_vehicles(
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_country TEXT DEFAULT 'Uganda',
  p_vehicle_types TEXT[] DEFAULT ARRAY['motorcycle'],
  p_operator_type TEXT DEFAULT 'passenger',
  p_min_cargo_capacity_kg NUMERIC DEFAULT NULL,
  p_exclude_rider_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 10
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
  ORDER BY dist.km ASC NULLS LAST, r.rating DESC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_find_available_vehicles TO service_role, authenticated;

-- ============================================================================
-- 2. Customer-facing request/confirm step for a cross-border delivery.
--    Modeled on mbg_request_ride, but: no mbg_stages lookup (cross-border
--    cargo never goes through Uganda's chairperson-commission hierarchy —
--    same precedent already established for mbg_riders.stage_id on
--    cross-border operators), and fares use the cargo.* settings instead of
--    ride.*. stage_id = NULL here satisfies mbg_complete_ride's commission
--    step, which is gated by FOUND on a stage lookup — a NULL stage_id
--    simply matches no row and the whole commission loop is skipped, no
--    exception (verified by reading mbg_complete_ride directly).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_request_cross_border_delivery(
  p_rider_id UUID,
  p_pickup_location TEXT, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_pickup_country TEXT,
  p_dropoff_location TEXT, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC, p_dropoff_country TEXT,
  p_order_notes TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id UUID;
  v_rider public.mbg_riders%ROWTYPE;
  v_distance_km NUMERIC;
  v_fare NUMERIC;
  v_ride_id UUID;
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('cargo.base_fare', 5000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('cargo.per_km_rate', 2000);
  v_platform_pct NUMERIC := public.mbg_get_setting_numeric('commission.platform_fee_percentage', 5);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();
  IF v_customer_id IS NULL THEN
    INSERT INTO public.mbg_customers (user_id) VALUES (auth.uid()) RETURNING id INTO v_customer_id;
  END IF;

  SELECT * INTO v_rider FROM public.mbg_riders
  WHERE id = p_rider_id AND status = 'active' AND is_available = true AND operator_type = 'cargo';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Selected courier is no longer available');
  END IF;

  v_distance_km := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  IF v_distance_km IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid pickup/dropoff coordinates');
  END IF;
  v_fare := ROUND((v_base_fare + v_distance_km * v_per_km) / 100) * 100;

  INSERT INTO public.mbg_rides (
    customer_id, rider_id, stage_id,
    pickup_location, pickup_lat, pickup_lng,
    dropoff_location, dropoff_lat, dropoff_lng,
    status, distance_km, duration_minutes, fare,
    service_type, delivery_mode, supermarket_id, country, order_notes
  ) VALUES (
    v_customer_id, p_rider_id, NULL,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(5, ROUND(v_distance_km / 40 * 60)), v_fare,
    'delivery', 'normal', NULL, p_pickup_country, p_order_notes
  ) RETURNING id INTO v_ride_id;

  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx)
  VALUES (v_ride_id, ROUND(v_fare * v_platform_pct / 100));

  RETURN jsonb_build_object('success', true, 'ride_id', v_ride_id, 'fare', v_fare, 'distance_km', v_distance_km);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_cross_border_delivery TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Cross-border customer delivery ready: mbg_find_available_vehicles now returns fare/distance_km, mbg_request_cross_border_delivery lets a customer request a cargo courier directly (no Uganda stage hierarchy required).';
END $$;
