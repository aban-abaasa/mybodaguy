-- ============================================================================
-- Lets 'ship' be recorded as a preferred_vehicle_type, so the MANAGER'S
-- order-approval step (not just the supplier's earlier confirm step) can
-- also offer "Ship" as an explicit choice for cross-border orders, in
-- addition to Car/Van/Truck.
--
-- 'ship' is real, but means something different from 'car'/'van'/'truck':
-- those are literal vehicle types used to match a single-hop delivery.
-- 'ship' can only ever apply to the SEA LEG of a cross-bloc journey
-- (mbg_dispatch_cargo_leg already hardcodes leg_type='sea_leg' to search
-- for 'ship' vehicles regardless of preference — a road leg physically
-- cannot be driven by a ship). So recording preferred_vehicle_type='ship'
-- on a journey/PO must NOT be applied literally to road legs or to a
-- same-bloc single-hop delivery — both of those fall back to their normal
-- default vehicle types (truck/van) exactly as if no preference had been
-- set at all. In practice this makes 'ship' mean "yes, route this via sea"
-- rather than "use a ship for every leg" — which is already what happens
-- automatically for a cross-bloc route (mbg_route_needs_sea_leg) even with
-- no preference at all; this option exists so the manager can see and
-- confirm that choice explicitly in the UI, not because it changes routing.
--
-- No "plane" option: Duffel (already integrated) only books passenger
-- flights, not air cargo/freight — there's no credentialed air-freight API
-- in this project, so a cargo "Plane" choice would be fake. Not added here.
--
-- Run after ADD_SUPPLIER_VEHICLE_PREFERENCE.sql.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'purchase_orders' AND c.contype = 'c'
      AND conname = 'purchase_orders_preferred_vehicle_type_check'
  ) THEN
    ALTER TABLE public.purchase_orders DROP CONSTRAINT purchase_orders_preferred_vehicle_type_check;
  END IF;
  ALTER TABLE public.purchase_orders
    ADD CONSTRAINT purchase_orders_preferred_vehicle_type_check
    CHECK (preferred_vehicle_type IS NULL OR preferred_vehicle_type IN ('car', 'van', 'truck', 'ship'));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'mbg_journeys' AND c.contype = 'c'
      AND conname = 'mbg_journeys_preferred_vehicle_type_check'
  ) THEN
    ALTER TABLE public.mbg_journeys DROP CONSTRAINT mbg_journeys_preferred_vehicle_type_check;
  END IF;
  ALTER TABLE public.mbg_journeys
    ADD CONSTRAINT mbg_journeys_preferred_vehicle_type_check
    CHECK (preferred_vehicle_type IS NULL OR preferred_vehicle_type IN ('car', 'van', 'truck', 'ship'));
END $$;

-- ============================================================================
-- mbg_dispatch_delivery_for_purchase_order: same signature, no drop needed.
-- A 'ship' preference reaching this function means the route did NOT need
-- a sea leg (mbg_dispatch_cargo_for_purchase_order only forwards here for
-- same-bloc routes) — so there's no single-hop "ship" delivery to match
-- here. Treat 'ship' as if no preference were given at all.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_dispatch_delivery_for_purchase_order(
  p_purchase_order_id UUID,
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_pickup_location TEXT,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC, p_dropoff_location TEXT,
  p_country TEXT DEFAULT 'Uganda',
  p_cross_border BOOLEAN DEFAULT false,
  p_preferred_vehicle_type TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vehicle_types TEXT[];
  v_operator_type TEXT;
  v_candidate RECORD;
  v_distance_km NUMERIC;
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('cargo.base_fare', 5000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('cargo.per_km_rate', 2000);
  v_fare NUMERIC;
  v_ride_id UUID;
BEGIN
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' AND auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF EXISTS (SELECT 1 FROM public.mbg_rides WHERE purchase_order_id = p_purchase_order_id AND status NOT IN ('cancelled', 'failed')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'A delivery is already dispatched or in progress for this purchase order');
  END IF;

  -- A supplier's/manager's explicit car/van/truck choice wins outright;
  -- 'ship' has no single-hop meaning here (see header note) so it falls
  -- through to the automatic cross-border default, same as no preference.
  IF p_preferred_vehicle_type IS NOT NULL AND p_preferred_vehicle_type <> 'ship' THEN
    v_vehicle_types := ARRAY[p_preferred_vehicle_type];
    v_operator_type := CASE WHEN p_preferred_vehicle_type = 'car' THEN 'passenger' ELSE 'cargo' END;
  ELSE
    v_vehicle_types := CASE WHEN p_cross_border THEN ARRAY['truck', 'ship'] ELSE ARRAY['van', 'truck'] END;
    v_operator_type := 'cargo';
  END IF;

  SELECT * INTO v_candidate
  FROM public.mbg_find_available_vehicles(
    p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng,
    p_country, v_vehicle_types, v_operator_type, NULL, ARRAY[]::UUID[], 1
  );

  IF v_candidate.rider_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No available cargo vehicle right now');
  END IF;

  v_distance_km := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  v_fare := ROUND((v_base_fare + COALESCE(v_distance_km, 0) * v_per_km) / 100) * 100;

  INSERT INTO public.mbg_rides (
    customer_id, rider_id, stage_id,
    pickup_location, pickup_lat, pickup_lng,
    dropoff_location, dropoff_lat, dropoff_lng,
    status, distance_km, duration_minutes, fare,
    service_type, purchase_order_id, country
  ) VALUES (
    NULL, v_candidate.rider_id, NULL,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(5, ROUND(COALESCE(v_distance_km, 5) / 40 * 60)), v_fare,
    'cargo_delivery', p_purchase_order_id, p_country
  ) RETURNING id INTO v_ride_id;

  BEGIN
    UPDATE public.supplier_deliveries
    SET delivery_status = 'dispatched', mbg_ride_id = v_ride_id, updated_at = now()
    WHERE purchase_order_id = p_purchase_order_id;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true, 'ride_id', v_ride_id, 'rider_id', v_candidate.rider_id, 'fare', v_fare);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dispatch_delivery_for_purchase_order(
  UUID, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN, TEXT
) TO service_role, authenticated;

-- ============================================================================
-- mbg_dispatch_cargo_leg: same signature, no drop needed. A road leg must
-- never search for 'ship' vehicles (physically impossible) — only the sea
-- leg (already hardcoded above this branch) actually uses 'ship'. So a
-- 'ship' journey-level preference is treated as "no preference" for road
-- legs, same as the delivery function above.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_dispatch_cargo_leg(p_journey_leg_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leg public.mbg_journey_legs%ROWTYPE;
  v_journey public.mbg_journeys%ROWTYPE;
  v_candidate RECORD;
  v_vehicle_types TEXT[];
  v_operator_type TEXT;
  v_distance_km NUMERIC;
  v_fare NUMERIC;
  v_ride_id UUID;
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('cargo.base_fare', 5000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('cargo.per_km_rate', 2000);
BEGIN
  SELECT * INTO v_leg FROM public.mbg_journey_legs WHERE id = p_journey_leg_id FOR UPDATE;
  IF NOT FOUND OR v_leg.leg_type NOT IN ('road_leg', 'sea_leg') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a dispatchable cargo leg');
  END IF;
  IF v_leg.status NOT IN ('pending', 'ready_to_dispatch') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Leg is not awaiting dispatch');
  END IF;
  SELECT * INTO v_journey FROM public.mbg_journeys WHERE id = v_leg.journey_id;

  IF v_leg.leg_type = 'sea_leg' THEN
    v_vehicle_types := ARRAY['ship'];
    v_operator_type := 'cargo';
  ELSIF v_journey.preferred_vehicle_type IS NOT NULL AND v_journey.preferred_vehicle_type <> 'ship' THEN
    v_vehicle_types := ARRAY[v_journey.preferred_vehicle_type];
    v_operator_type := CASE WHEN v_journey.preferred_vehicle_type = 'car' THEN 'passenger' ELSE 'cargo' END;
  ELSE
    v_vehicle_types := ARRAY['truck', 'van'];
    v_operator_type := 'cargo';
  END IF;

  SELECT * INTO v_candidate FROM public.mbg_find_available_vehicles(
    v_leg.origin_lat, v_leg.origin_lng, v_leg.destination_lat, v_leg.destination_lng,
    COALESCE(v_leg.origin_country, v_journey.origin_country, 'Uganda'),
    v_vehicle_types, v_operator_type, v_journey.cargo_weight_kg, ARRAY[]::UUID[], 1
  );

  IF v_candidate.rider_id IS NULL THEN
    UPDATE public.mbg_journey_legs SET status = 'ready_to_dispatch', updated_at = now() WHERE id = p_journey_leg_id;
    RETURN jsonb_build_object('success', false, 'error', 'No available vehicle right now');
  END IF;

  v_distance_km := public.mbg_haversine_km(v_leg.origin_lat, v_leg.origin_lng, v_leg.destination_lat, v_leg.destination_lng);
  v_fare := ROUND((v_base_fare + COALESCE(v_distance_km, 0) * v_per_km) / 100) * 100;

  INSERT INTO public.mbg_rides (
    customer_id, rider_id, stage_id, pickup_location, pickup_lat, pickup_lng,
    dropoff_location, dropoff_lat, dropoff_lng, status, distance_km, duration_minutes, fare,
    service_type, purchase_order_id, country
  ) VALUES (
    v_journey.customer_id, v_candidate.rider_id, NULL,
    COALESCE(v_leg.origin_city, 'Origin'), v_leg.origin_lat, v_leg.origin_lng,
    COALESCE(v_leg.destination_city, 'Destination'), v_leg.destination_lat, v_leg.destination_lng,
    'pending', v_distance_km, GREATEST(5, ROUND(COALESCE(v_distance_km, 5) / 40 * 60)), v_fare,
    'cargo_delivery', v_journey.purchase_order_id, COALESCE(v_leg.origin_country, 'Uganda')
  ) RETURNING id INTO v_ride_id;

  UPDATE public.mbg_journey_legs
  SET ride_id = v_ride_id, status = 'dispatched', dispatched_at = now(), updated_at = now()
  WHERE id = p_journey_leg_id;

  RETURN jsonb_build_object('success', true, 'ride_id', v_ride_id, 'rider_id', v_candidate.rider_id, 'fare', v_fare);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dispatch_cargo_leg TO service_role;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ preferred_vehicle_type now also accepts ''ship'' (manager approval step) — road legs and same-bloc single-hop delivery correctly ignore it and fall back to truck/van, since a ship can only ever run the sea leg.';
END $$;
