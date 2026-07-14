-- ============================================================================
-- FIX: mbg_request_ship_cargo_journey (ADD_SHIP_CARGO_JOURNEY.sql) created a
-- real 3-leg shipment but never actually charged the customer anything —
-- a real gap, not a stub left on purpose. This adds a real upfront ICAN
-- debit, tithe-free (mbg_debit_journey_fare — modeled on sell_ican_coins,
-- see ICAN/backend/CREATE_JOURNEY_ESCROW_FUNCTION.sql and
-- feedback_tithe_is_personal: journey/shipping payments are a paid service,
-- not a peer transfer/earning, so no 10% tithe applies).
--
-- Fare model: one combined estimate across all 3 legs (pickup->port,
-- port->port, port->dropoff), using the same cargo.base_fare/per_km_rate
-- settings every other cargo leg already prices from — a single base fare
-- for the whole shipment, not three, since this is the customer's upfront
-- quote, not the sum of what each leg's driver is separately paid.
-- ICAN_TO_UGX (5000) matches the same floor-price constant already
-- hardcoded in mybodaguy/frontend/api/journeys/quote.js — keep both in
-- sync if that ever changes (see ICAN_CROSS_APP_WALLET_MIGRATION.sql).
--
-- Payment happens BEFORE any journey/leg rows are created — fails fast on
-- insufficient balance instead of creating a shipment the customer can't
-- pay for.
--
-- Run after ADD_SHIP_CARGO_JOURNEY.sql. Needs mbg_debit_journey_fare
-- (ICAN/backend/CREATE_JOURNEY_ESCROW_FUNCTION.sql) already applied.
-- ============================================================================

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
  v_total_km NUMERIC;
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('cargo.base_fare', 5000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('cargo.per_km_rate', 2000);
  v_fare_ugx NUMERIC;
  v_fare_ican NUMERIC;
  v_debit JSONB;
  ICAN_TO_UGX CONSTANT NUMERIC := 5000;
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

  -- One combined fare estimate for the whole shipment (pickup->port,
  -- port->port, port->dropoff) — a single base fare, not three.
  v_total_km := COALESCE(public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, v_origin_port.latitude, v_origin_port.longitude), 0)
              + COALESCE(public.mbg_haversine_km(v_origin_port.latitude, v_origin_port.longitude, v_dest_port.latitude, v_dest_port.longitude), 0)
              + COALESCE(public.mbg_haversine_km(v_dest_port.latitude, v_dest_port.longitude, p_dropoff_lat, p_dropoff_lng), 0);
  v_fare_ugx := ROUND((v_base_fare + v_total_km * v_per_km) / 100) * 100;
  v_fare_ican := ROUND(v_fare_ugx / ICAN_TO_UGX, 8);

  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();
  IF v_customer_id IS NULL THEN
    INSERT INTO public.mbg_customers (user_id) VALUES (auth.uid()) RETURNING id INTO v_customer_id;
  END IF;

  -- Charge first — fail fast rather than create a shipment nobody paid for.
  v_debit := public.mbg_debit_journey_fare(auth.uid(), v_fare_ican, 'mybodaguy', NULL);
  IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_debit ->> 'error', 'Payment failed'));
  END IF;

  INSERT INTO public.mbg_journeys (
    customer_id, journey_kind, status, origin_country, destination_country,
    destination_address, destination_lat, destination_lng, cargo_description, cargo_weight_kg,
    total_fare_ugx, total_fare_ican, ican_journey_tx_id
  ) VALUES (
    v_customer_id, 'cargo', 'confirmed', p_pickup_country, p_dropoff_country,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng, p_cargo_description, p_cargo_weight_kg,
    v_fare_ugx, v_fare_ican, (v_debit ->> 'tx_id')::UUID
  ) RETURNING id INTO v_journey_id;

  -- reference_id on the ledger row now that the journey exists (couldn't
  -- know its id at debit time — same two-step order the flight journey's
  -- confirm.js follows).
  UPDATE ican_coin_transactions SET reference_id = v_journey_id::TEXT WHERE id = (v_debit ->> 'tx_id')::UUID;

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

  RETURN jsonb_build_object(
    'success', true, 'journey_id', v_journey_id, 'via_sea', true,
    'fare_ugx', v_fare_ugx, 'fare_ican', v_fare_ican
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ship_cargo_journey TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Ship cargo journeys now actually charge the customer — tithe-free ICAN debit before dispatch, same pattern as flight journeys.';
END $$;
