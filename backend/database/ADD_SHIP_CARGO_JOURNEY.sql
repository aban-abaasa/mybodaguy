-- ============================================================================
-- CUSTOMER-INITIATED SHIP CARGO JOURNEYS — lets a customer book a full
-- end-to-end cargo shipment (pickup -> departure port -> sea crossing ->
-- arrival port -> final delivery) directly from "Book a Journey", reusing
-- every piece ADD_SHIP_DISPATCH.sql already built for supplier purchase
-- orders (mbg_ports, mbg_country_ports, mbg_route_needs_sea_leg,
-- mbg_journeys/mbg_journey_legs, mbg_dispatch_cargo_leg,
-- mbg_advance_cargo_journey_leg). Until now a cargo mbg_journeys row could
-- only be owned by a purchase_order_id — this widens ownership so a
-- customer_id can own one too, exactly like mbg_rides already allows for
-- 'cargo_delivery' rides via mbg_rides_customer_or_cargo_check.
--
-- Run after ADD_SHIP_DISPATCH.sql.
-- ============================================================================

-- 1. A cargo mbg_rides row may now be owned by a customer directly (ship
--    cargo the customer booked themselves) OR a purchase_order (supplier
--    flow, unchanged) — widening this CHECK only ADDS a permitted
--    combination, so every existing row/insert keeps validating exactly as
--    before.
DO $$
DECLARE con RECORD;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'mbg_rides' AND c.contype = 'c'
      AND c.conname = 'mbg_rides_customer_or_cargo_check'
  LOOP
    EXECUTE format('ALTER TABLE public.mbg_rides DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;
ALTER TABLE public.mbg_rides
  ADD CONSTRAINT mbg_rides_customer_or_cargo_check
  CHECK (
    (service_type IN ('ride', 'delivery') AND customer_id IS NOT NULL AND purchase_order_id IS NULL)
    OR (service_type = 'cargo_delivery' AND purchase_order_id IS NOT NULL AND customer_id IS NULL)
    OR (service_type = 'cargo_delivery' AND customer_id IS NOT NULL AND purchase_order_id IS NULL)
  );

-- Same widening for mbg_journeys (ADD_SHIP_DISPATCH.sql's version required
-- journey_kind='cargo' to always pair with purchase_order_id) — simplified
-- to "exactly one of customer_id/purchase_order_id", which already covers
-- passenger (customer_id) and both cargo ownership shapes without tying the
-- check to journey_kind at all.
ALTER TABLE public.mbg_journeys DROP CONSTRAINT IF EXISTS mbg_journeys_customer_or_cargo_check;
ALTER TABLE public.mbg_journeys
  ADD CONSTRAINT mbg_journeys_customer_or_cargo_check
  CHECK (
    (customer_id IS NOT NULL AND purchase_order_id IS NULL)
    OR (customer_id IS NULL AND purchase_order_id IS NOT NULL)
  );

-- 2. What's being shipped — used both for the customer-facing record and to
--    only match vehicles that can actually carry the load (real use of the
--    weight figure, not just a display field).
ALTER TABLE public.mbg_journeys
  ADD COLUMN IF NOT EXISTS cargo_description TEXT,
  ADD COLUMN IF NOT EXISTS cargo_weight_kg NUMERIC;

-- 3. mbg_dispatch_cargo_leg: use the journey's own customer_id (NULL for
--    PO-driven journeys, exactly as before) instead of hardcoding NULL, and
--    pass the journey's cargo_weight_kg through to mbg_find_available_vehicles'
--    existing p_min_cargo_capacity_kg filter so a shipment only ever matches
--    a vehicle that can actually carry it.
CREATE OR REPLACE FUNCTION public.mbg_dispatch_cargo_leg(p_journey_leg_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leg public.mbg_journey_legs%ROWTYPE;
  v_journey public.mbg_journeys%ROWTYPE;
  v_candidate RECORD;
  v_vehicle_types TEXT[];
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

  v_vehicle_types := CASE v_leg.leg_type WHEN 'sea_leg' THEN ARRAY['ship'] ELSE ARRAY['truck', 'van'] END;

  SELECT * INTO v_candidate FROM public.mbg_find_available_vehicles(
    v_leg.origin_lat, v_leg.origin_lng, v_leg.destination_lat, v_leg.destination_lng,
    COALESCE(v_leg.origin_country, v_journey.origin_country, 'Uganda'),
    v_vehicle_types, 'cargo', v_journey.cargo_weight_kg, ARRAY[]::UUID[], 1
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

-- 4. Customer-facing entry point — mirrors mbg_dispatch_cargo_for_purchase_order
--    but owned by customer_id instead of purchase_order_id. Same-bloc pairs
--    (a real road route exists) are turned away here on purpose — that case
--    is already served by mbg_request_cross_border_delivery's single-hop
--    match (ADD_CROSS_BORDER_CUSTOMER_DELIVERY.sql), which needs a specific
--    rider chosen from a search step this direct-book flow doesn't have.
CREATE OR REPLACE FUNCTION public.mbg_request_ship_cargo_journey(
  p_pickup_location TEXT, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_pickup_country TEXT,
  p_dropoff_location TEXT, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC, p_dropoff_country TEXT,
  p_cargo_description TEXT DEFAULT NULL,
  p_cargo_weight_kg NUMERIC DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id UUID;
  v_origin_port RECORD;
  v_dest_port RECORD;
  v_journey_id UUID;
  v_first_leg_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF NOT public.mbg_route_needs_sea_leg(p_pickup_country, p_dropoff_country) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This route does not need a ship — use normal cross-border delivery instead');
  END IF;

  SELECT p.* INTO v_origin_port FROM public.mbg_country_ports cp JOIN public.mbg_ports p ON p.id = cp.port_id WHERE cp.country = p_pickup_country;
  SELECT p.* INTO v_dest_port   FROM public.mbg_country_ports cp JOIN public.mbg_ports p ON p.id = cp.port_id WHERE cp.country = p_dropoff_country;
  IF v_origin_port IS NULL OR v_dest_port IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No seaport route configured yet for this country pair');
  END IF;

  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();
  IF v_customer_id IS NULL THEN
    INSERT INTO public.mbg_customers (user_id) VALUES (auth.uid()) RETURNING id INTO v_customer_id;
  END IF;

  INSERT INTO public.mbg_journeys (
    customer_id, journey_kind, status, origin_country, destination_country,
    destination_address, destination_lat, destination_lng, cargo_description, cargo_weight_kg
  ) VALUES (
    v_customer_id, 'cargo', 'confirmed', p_pickup_country, p_dropoff_country,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng, p_cargo_description, p_cargo_weight_kg
  ) RETURNING id INTO v_journey_id;

  INSERT INTO public.mbg_journey_legs (
    journey_id, leg_order, leg_type, status,
    origin_country, origin_city, origin_lat, origin_lng,
    destination_country, destination_city, destination_lat, destination_lng, dispatch_after
  ) VALUES
    (v_journey_id, 1, 'road_leg', 'ready_to_dispatch',
     p_pickup_country, p_pickup_location, p_pickup_lat, p_pickup_lng,
     v_origin_port.country, v_origin_port.city, v_origin_port.latitude, v_origin_port.longitude, now()),
    (v_journey_id, 2, 'sea_leg', 'pending',
     v_origin_port.country, v_origin_port.city, v_origin_port.latitude, v_origin_port.longitude,
     v_dest_port.country, v_dest_port.city, v_dest_port.latitude, v_dest_port.longitude, NULL),
    (v_journey_id, 3, 'road_leg', 'pending',
     v_dest_port.country, v_dest_port.city, v_dest_port.latitude, v_dest_port.longitude,
     p_dropoff_country, p_dropoff_location, p_dropoff_lat, p_dropoff_lng, NULL);

  SELECT id INTO v_first_leg_id FROM public.mbg_journey_legs WHERE journey_id = v_journey_id AND leg_order = 1;
  PERFORM public.mbg_dispatch_cargo_leg(v_first_leg_id);

  RETURN jsonb_build_object('success', true, 'journey_id', v_journey_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ship_cargo_journey TO authenticated;

-- 5. Customer can read their own cargo journeys/legs — the earlier
--    ADD_SHIP_DISPATCH.sql deliberately left cargo journeys covered only by
--    the service_role policy since only PO-driven journeys existed; now a
--    customer genuinely owns some of these rows and needs to see them.
DROP POLICY IF EXISTS mbg_journeys_read_own ON public.mbg_journeys;
CREATE POLICY mbg_journeys_read_own ON public.mbg_journeys FOR SELECT USING (
  customer_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.mbg_customers c WHERE c.id = mbg_journeys.customer_id AND c.user_id = auth.uid()
  )
);

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Customer ship-cargo journeys ready: mbg_request_ship_cargo_journey books a real end-to-end road->sea->road journey, cargo_weight_kg now actually filters matching by mbg_riders.cargo_capacity_kg.';
END $$;
