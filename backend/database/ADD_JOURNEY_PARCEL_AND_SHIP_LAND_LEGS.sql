-- ============================================================================
-- Two additions to "Book a full journey":
--
-- A. FLY -> "Send a parcel" (delivery mode).
--    The same door-to-door journey, but the ground legs move GOODS instead of
--    people: a courier collects the parcel and takes it to the airport, and a
--    courier takes it from the arrival airport to the recipient. The flight is
--    still a normal passenger ticket (the traveller carries the parcel as
--    checked baggage — there is no air-freight API), so it is priced exactly
--    as before, parcel weight above the free allowance included.
--      · mbg_journeys.service_mode = 'parcel' (default 'travel'), plus the
--        recipient's name/phone; the parcel description/weight reuse the
--        existing cargo_description / cargo_weight_kg columns.
--      · The two courier legs are still normal PREPAID 'ride' rows, so the
--        whole tested lifecycle (dispatch cascade, decline re-queue, leg and
--        journey status sync, no second debit) is unchanged. A trigger stamps
--        the parcel details onto each ride so the rider is told it is a parcel
--        (mbg_rides.is_parcel / parcel_description / recipient_*). No existing
--        dispatch function is redefined for this.
--
-- B. SHIP CARGO -> land transport is now optional and selectable.
--    Until now a shipment always had a truck/van road leg to the departure
--    port and another from the arrival port. Now the customer can:
--      · keep either road leg (door-to-door) or skip it (they bring the cargo
--        to the departure port / collect it from the arrival port themselves);
--      · pick the land vehicle: automatic (truck/van, matched on weight),
--        motorcycle (<= 30 kg), car (<= 200 kg), van or truck.
--    A skipped leg is not created and not charged; the legs that remain are
--    numbered consecutively so the existing "advance to the next leg" trigger
--    works unchanged. Every leg now carries its own fixed fare_ugx (prepaid).
--    The customer's price is worked out at the LIVE ICAN price
--    (ican_get_price_in_currency), not a hardcoded 5,000 UGX, and can be
--    previewed first with mbg_quote_ship_cargo_journey.
--
-- Run after ADD_JOURNEY_PREPAID_LEG_FARES.sql, ADD_JOURNEY_MULTI_PASSENGER.sql
-- and ADD_LONG_HAUL_DETECTION_AND_SEA_FLAT_FEE.sql. Safe to re-run.
-- Do NOT re-run ADD_JOURNEY_PREPAID_LEG_FARES.sql afterwards: it redefines
-- mbg_dispatch_cargo_leg with the older body (no per-leg vehicle choice).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema
-- ----------------------------------------------------------------------------
ALTER TABLE public.mbg_journeys
  ADD COLUMN IF NOT EXISTS cargo_description TEXT,
  ADD COLUMN IF NOT EXISTS cargo_weight_kg   NUMERIC,
  ADD COLUMN IF NOT EXISTS service_mode      TEXT NOT NULL DEFAULT 'travel',
  ADD COLUMN IF NOT EXISTS recipient_name    TEXT,
  ADD COLUMN IF NOT EXISTS recipient_phone   TEXT;

DO $$
BEGIN
  ALTER TABLE public.mbg_journeys
    ADD CONSTRAINT mbg_journeys_service_mode_check CHECK (service_mode IN ('travel', 'parcel'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

ALTER TABLE public.mbg_journey_legs
  ADD COLUMN IF NOT EXISTS fare_ugx NUMERIC,
  ADD COLUMN IF NOT EXISTS preferred_vehicle_type TEXT;

ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS is_journey_prepaid  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_parcel           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parcel_description  TEXT,
  ADD COLUMN IF NOT EXISTS parcel_weight_kg    NUMERIC,
  ADD COLUMN IF NOT EXISTS recipient_name      TEXT,
  ADD COLUMN IF NOT EXISTS recipient_phone     TEXT;

-- ----------------------------------------------------------------------------
-- 2. Parcel journeys: tell the rider the ride is a parcel. Runs when dispatch
--    attaches a ride to a ground leg, so it keeps working whatever the current
--    body of mbg_dispatch_journey_leg is.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_stamp_parcel_on_leg_ride()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_journey public.mbg_journeys%ROWTYPE;
BEGIN
  IF NEW.ride_id IS NULL OR NEW.leg_type NOT IN ('local_pickup', 'local_dropoff') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_journey FROM public.mbg_journeys WHERE id = NEW.journey_id;
  IF NOT FOUND OR v_journey.service_mode IS DISTINCT FROM 'parcel' THEN
    RETURN NEW;
  END IF;
  UPDATE public.mbg_rides
  SET is_parcel = true,
      parcel_description = v_journey.cargo_description,
      parcel_weight_kg = v_journey.cargo_weight_kg,
      recipient_name = v_journey.recipient_name,
      recipient_phone = v_journey.recipient_phone
  WHERE id = NEW.ride_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mbg_stamp_parcel_on_leg_ride_trg ON public.mbg_journey_legs;
CREATE TRIGGER mbg_stamp_parcel_on_leg_ride_trg
  AFTER INSERT OR UPDATE OF ride_id ON public.mbg_journey_legs
  FOR EACH ROW WHEN (NEW.ride_id IS NOT NULL)
  EXECUTE FUNCTION public.mbg_stamp_parcel_on_leg_ride();

-- ----------------------------------------------------------------------------
-- 3. Cargo leg dispatch: a road leg honours its OWN vehicle choice (falling back
--    to the journey's, then truck/van). Bikes and cars are passenger-operator
--    vehicles with no cargo capacity on file, so the weight filter applies only
--    to cargo vehicles — the weight limit for a bike/car is enforced when the
--    shipment is booked. Otherwise identical to the body in
--    ADD_JOURNEY_PREPAID_LEG_FARES.sql.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_dispatch_cargo_leg(p_journey_leg_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leg public.mbg_journey_legs%ROWTYPE;
  v_journey public.mbg_journeys%ROWTYPE;
  v_candidate RECORD;
  v_rider RECORD;
  v_split RECORD;
  v_road_type TEXT;
  v_vehicle_types TEXT[];
  v_operator_type TEXT;
  v_min_capacity NUMERIC;
  v_distance_km NUMERIC;
  v_fare NUMERIC;
  v_prepaid BOOLEAN;
  v_ride_id UUID;
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('cargo.base_fare', 5000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('cargo.per_km_rate', 2000);
  v_sea_flat_fee NUMERIC := public.mbg_get_setting_numeric('journey.sea_leg_flat_fee_ugx', 250000);
BEGIN
  SELECT * INTO v_leg FROM public.mbg_journey_legs WHERE id = p_journey_leg_id FOR UPDATE;
  IF NOT FOUND OR v_leg.leg_type NOT IN ('road_leg', 'sea_leg') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a dispatchable cargo leg');
  END IF;
  IF v_leg.status NOT IN ('pending', 'ready_to_dispatch') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Leg is not awaiting dispatch');
  END IF;
  SELECT * INTO v_journey FROM public.mbg_journeys WHERE id = v_leg.journey_id;
  v_prepaid := v_journey.customer_id IS NOT NULL;

  IF v_leg.leg_type = 'sea_leg' THEN
    v_vehicle_types := ARRAY['ship'];
    v_operator_type := 'cargo';
  ELSE
    v_road_type := COALESCE(NULLIF(v_leg.preferred_vehicle_type, ''), NULLIF(v_journey.preferred_vehicle_type, ''));
    IF v_road_type IS NOT NULL AND v_road_type <> 'ship' THEN
      v_vehicle_types := ARRAY[v_road_type];
      v_operator_type := CASE WHEN v_road_type IN ('motorcycle', 'car', 'tuktuk', 'bicycle') THEN 'passenger' ELSE 'cargo' END;
    ELSE
      v_vehicle_types := ARRAY['truck', 'van'];
      v_operator_type := 'cargo';
    END IF;
  END IF;
  v_min_capacity := CASE WHEN v_operator_type = 'cargo' THEN v_journey.cargo_weight_kg ELSE NULL END;

  SELECT * INTO v_candidate FROM public.mbg_find_available_vehicles(
    v_leg.origin_lat, v_leg.origin_lng, v_leg.destination_lat, v_leg.destination_lng,
    COALESCE(v_leg.origin_country, v_journey.origin_country, 'Uganda'),
    v_vehicle_types, v_operator_type, v_min_capacity, ARRAY[]::UUID[], 1
  );

  IF v_candidate.rider_id IS NULL THEN
    UPDATE public.mbg_journey_legs SET status = 'ready_to_dispatch', updated_at = now() WHERE id = p_journey_leg_id;
    RETURN jsonb_build_object('success', false, 'error', 'No available vehicle right now');
  END IF;

  v_distance_km := public.mbg_haversine_km(v_leg.origin_lat, v_leg.origin_lng, v_leg.destination_lat, v_leg.destination_lng);

  IF v_leg.leg_type = 'sea_leg' THEN
    v_fare := ROUND(COALESCE(v_leg.fare_ugx, v_sea_flat_fee) / 100) * 100;
  ELSIF v_prepaid THEN
    v_fare := ROUND(COALESCE(
      v_leg.fare_ugx,
      CASE WHEN v_leg.leg_order = 1 THEN v_base_fare ELSE 0 END + COALESCE(v_distance_km, 0) * v_per_km
    ) / 100) * 100;
  ELSE
    v_fare := ROUND((v_base_fare + COALESCE(v_distance_km, 0) * v_per_km) / 100) * 100;
  END IF;

  IF v_prepaid THEN
    SELECT vehicle_type::TEXT AS vehicle_type, business_profile_id IS NOT NULL AS is_company
      INTO v_rider FROM public.mbg_riders WHERE id = v_candidate.rider_id;
    SELECT * INTO v_split FROM public.mbg_compute_ride_split(
      v_fare, v_rider.vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk'), COALESCE(v_rider.is_company, false), 'wallet'
    );

    INSERT INTO public.mbg_rides (
      customer_id, rider_id, stage_id, pickup_location, pickup_lat, pickup_lng,
      dropoff_location, dropoff_lat, dropoff_lng, status, distance_km, duration_minutes, fare,
      service_type, purchase_order_id, country,
      rider_earning, chairperson_commission_total,
      payment_method, wallet_charged_at_acceptance, is_journey_prepaid
    ) VALUES (
      v_journey.customer_id, v_candidate.rider_id, NULL,
      COALESCE(v_leg.origin_city, 'Origin'), v_leg.origin_lat, v_leg.origin_lng,
      COALESCE(v_leg.destination_city, 'Destination'), v_leg.destination_lat, v_leg.destination_lng,
      'pending', v_distance_km, GREATEST(5, ROUND(COALESCE(v_distance_km, 5) / 40 * 60)), v_fare,
      'cargo_delivery', NULL, COALESCE(v_leg.origin_country, 'Uganda'),
      v_split.o_rider_earning, v_split.o_chair_total,
      'wallet', true, true
    ) RETURNING id INTO v_ride_id;
  ELSE
    INSERT INTO public.mbg_rides (
      customer_id, rider_id, stage_id, pickup_location, pickup_lat, pickup_lng,
      dropoff_location, dropoff_lat, dropoff_lng, status, distance_km, duration_minutes, fare,
      service_type, purchase_order_id, country
    ) VALUES (
      NULL, v_candidate.rider_id, NULL,
      COALESCE(v_leg.origin_city, 'Origin'), v_leg.origin_lat, v_leg.origin_lng,
      COALESCE(v_leg.destination_city, 'Destination'), v_leg.destination_lat, v_leg.destination_lng,
      'pending', v_distance_km, GREATEST(5, ROUND(COALESCE(v_distance_km, 5) / 40 * 60)), v_fare,
      'cargo_delivery', v_journey.purchase_order_id, COALESCE(v_leg.origin_country, 'Uganda')
    ) RETURNING id INTO v_ride_id;
  END IF;

  UPDATE public.mbg_journey_legs
  SET ride_id = v_ride_id, status = 'dispatched', dispatched_at = now(), updated_at = now()
  WHERE id = p_journey_leg_id;

  RETURN jsonb_build_object('success', true, 'ride_id', v_ride_id, 'rider_id', v_candidate.rider_id, 'fare', v_fare);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dispatch_cargo_leg TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Ship cargo pricing + validation, shared by the quote and the booking so the
--    price shown is the price charged. Internal: not granted to any client role.
--    Land legs: the base fare is charged once, on the first land leg that is
--    kept. The sea crossing is the flat fee. Skipping both land legs leaves only
--    the crossing.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_plan_ship_cargo_journey(
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_pickup_country TEXT,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC, p_dropoff_country TEXT,
  p_pickup_leg BOOLEAN, p_dropoff_leg BOOLEAN,
  p_land_vehicle_type TEXT, p_cargo_weight_kg NUMERIC
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_origin_port RECORD;
  v_dest_port RECORD;
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('cargo.base_fare', 5000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('cargo.per_km_rate', 2000);
  v_sea_flat_fee NUMERIC := public.mbg_get_setting_numeric('journey.sea_leg_flat_fee_ugx', 250000);
  -- Mirrored in JourneyBookingFlow.tsx (SHIP_LAND_VEHICLES).
  v_motorcycle_max_kg CONSTANT NUMERIC := 30;
  v_car_max_kg        CONSTANT NUMERIC := 200;
  v_pickup_fare NUMERIC := 0;
  v_dropoff_fare NUMERIC := 0;
  v_sea_fare NUMERIC;
  v_total_ugx NUMERIC;
  v_ugx_per_ican NUMERIC;
BEGIN
  IF p_land_vehicle_type IS NOT NULL AND p_land_vehicle_type NOT IN ('motorcycle', 'car', 'van', 'truck') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose a motorcycle, car, van or truck for the land legs');
  END IF;
  IF p_land_vehicle_type = 'motorcycle' AND (p_cargo_weight_kg IS NULL OR p_cargo_weight_kg <= 0 OR p_cargo_weight_kg > v_motorcycle_max_kg) THEN
    RETURN jsonb_build_object('success', false, 'error', format('A motorcycle carries up to %s kg — enter the weight, or choose a car, van or truck', v_motorcycle_max_kg));
  END IF;
  IF p_land_vehicle_type = 'car' AND (p_cargo_weight_kg IS NULL OR p_cargo_weight_kg <= 0 OR p_cargo_weight_kg > v_car_max_kg) THEN
    RETURN jsonb_build_object('success', false, 'error', format('A car carries up to %s kg — enter the weight, or choose a van or truck', v_car_max_kg));
  END IF;

  IF NOT public.mbg_route_needs_sea_leg(p_pickup_country, p_dropoff_country) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This route does not need a ship — use normal cross-border delivery instead');
  END IF;

  SELECT p.* INTO v_origin_port FROM public.mbg_country_ports cp JOIN public.mbg_ports p ON p.id = cp.port_id WHERE cp.country = p_pickup_country;
  SELECT p.* INTO v_dest_port   FROM public.mbg_country_ports cp JOIN public.mbg_ports p ON p.id = cp.port_id WHERE cp.country = p_dropoff_country;
  IF v_origin_port IS NULL OR v_dest_port IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No seaport route configured yet for this country pair');
  END IF;

  IF p_pickup_leg AND (p_pickup_lat IS NULL OR p_pickup_lng IS NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Set the pickup pin, or choose to bring the cargo to the port yourself');
  END IF;
  IF p_dropoff_leg AND (p_dropoff_lat IS NULL OR p_dropoff_lng IS NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Set the delivery pin, or choose to collect the cargo at the port yourself');
  END IF;

  IF p_pickup_leg THEN
    v_pickup_fare := ROUND((v_base_fare + COALESCE(public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, v_origin_port.latitude, v_origin_port.longitude), 0) * v_per_km) / 100) * 100;
  END IF;
  IF p_dropoff_leg THEN
    v_dropoff_fare := ROUND((
      CASE WHEN p_pickup_leg THEN 0 ELSE v_base_fare END
      + COALESCE(public.mbg_haversine_km(v_dest_port.latitude, v_dest_port.longitude, p_dropoff_lat, p_dropoff_lng), 0) * v_per_km
    ) / 100) * 100;
  END IF;
  v_sea_fare := ROUND(v_sea_flat_fee / 100) * 100;
  v_total_ugx := v_pickup_fare + v_sea_fare + v_dropoff_fare;

  -- Priced at the LIVE ICAN value, never a fixed rate. If the price engine can't
  -- answer, refuse rather than charge a guess.
  SELECT price_local INTO v_ugx_per_ican FROM public.ican_get_price_in_currency('UGX'::VARCHAR) LIMIT 1;
  IF v_ugx_per_ican IS NULL OR v_ugx_per_ican <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The live ICAN price is not available right now — please try again in a moment');
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'origin_port', jsonb_build_object('country', v_origin_port.country, 'city', v_origin_port.city, 'name', v_origin_port.port_name, 'lat', v_origin_port.latitude, 'lng', v_origin_port.longitude),
    'dest_port',   jsonb_build_object('country', v_dest_port.country,   'city', v_dest_port.city,   'name', v_dest_port.port_name,   'lat', v_dest_port.latitude,   'lng', v_dest_port.longitude),
    'pickup_fare_ugx', v_pickup_fare,
    'sea_fare_ugx', v_sea_fare,
    'dropoff_fare_ugx', v_dropoff_fare,
    'total_ugx', v_total_ugx,
    'total_ican', ROUND(v_total_ugx / v_ugx_per_ican, 8),
    'ican_price_ugx', v_ugx_per_ican
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_plan_ship_cargo_journey(NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, BOOLEAN, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Price preview for the customer, before anything is charged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_quote_ship_cargo_journey(
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_pickup_country TEXT,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC, p_dropoff_country TEXT,
  p_pickup_leg BOOLEAN DEFAULT true,
  p_dropoff_leg BOOLEAN DEFAULT true,
  p_land_vehicle_type TEXT DEFAULT NULL,
  p_cargo_weight_kg NUMERIC DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  v_plan := public.mbg_plan_ship_cargo_journey(
    p_pickup_lat, p_pickup_lng, p_pickup_country, p_dropoff_lat, p_dropoff_lng, p_dropoff_country,
    COALESCE(p_pickup_leg, true), COALESCE(p_dropoff_leg, true), p_land_vehicle_type, p_cargo_weight_kg
  );
  IF NOT COALESCE((v_plan ->> 'success')::BOOLEAN, false) THEN
    RETURN v_plan;
  END IF;
  RETURN jsonb_build_object(
    'success', true,
    'pickup_fare_ugx', v_plan -> 'pickup_fare_ugx',
    'sea_fare_ugx', v_plan -> 'sea_fare_ugx',
    'dropoff_fare_ugx', v_plan -> 'dropoff_fare_ugx',
    'total_ugx', v_plan -> 'total_ugx',
    'total_ican', v_plan -> 'total_ican',
    'ican_price_ugx', v_plan -> 'ican_price_ugx',
    'origin_port', v_plan -> 'origin_port',
    'dest_port', v_plan -> 'dest_port'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_quote_ship_cargo_journey TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Book the shipment. Same first ten parameters as before (an older app build
--    keeps working: both land legs, automatic vehicle); the last three are new.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mbg_request_ship_cargo_journey(TEXT, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.mbg_request_ship_cargo_journey(
  p_pickup_location TEXT, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_pickup_country TEXT,
  p_dropoff_location TEXT, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC, p_dropoff_country TEXT,
  p_cargo_description TEXT DEFAULT NULL,
  p_cargo_weight_kg NUMERIC DEFAULT NULL,
  p_pickup_leg BOOLEAN DEFAULT true,
  p_dropoff_leg BOOLEAN DEFAULT true,
  p_land_vehicle_type TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan JSONB;
  v_pickup_leg BOOLEAN := COALESCE(p_pickup_leg, true);
  v_dropoff_leg BOOLEAN := COALESCE(p_dropoff_leg, true);
  v_customer_id UUID;
  v_journey_id UUID;
  v_first_leg_id UUID;
  v_debit JSONB;
  v_order INT := 0;
  v_fare_ugx NUMERIC;
  v_fare_ican NUMERIC;
  v_op JSONB;
  v_dp JSONB;
  v_dest_address TEXT;
  v_dest_lat NUMERIC;
  v_dest_lng NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  v_plan := public.mbg_plan_ship_cargo_journey(
    p_pickup_lat, p_pickup_lng, p_pickup_country, p_dropoff_lat, p_dropoff_lng, p_dropoff_country,
    v_pickup_leg, v_dropoff_leg, p_land_vehicle_type, p_cargo_weight_kg
  );
  IF NOT COALESCE((v_plan ->> 'success')::BOOLEAN, false) THEN
    RETURN v_plan;
  END IF;
  v_op := v_plan -> 'origin_port';
  v_dp := v_plan -> 'dest_port';
  v_fare_ugx := (v_plan ->> 'total_ugx')::NUMERIC;
  v_fare_ican := (v_plan ->> 'total_ican')::NUMERIC;

  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();
  IF v_customer_id IS NULL THEN
    INSERT INTO public.mbg_customers (user_id) VALUES (auth.uid()) RETURNING id INTO v_customer_id;
  END IF;

  -- Charge first — fail fast rather than create a shipment nobody paid for.
  v_debit := public.mbg_debit_journey_fare(auth.uid(), v_fare_ican, 'mybodaguy', NULL);
  IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_debit ->> 'error', 'Payment failed'));
  END IF;

  -- With no delivery leg the cargo is collected at the arrival port, so that is
  -- the journey's destination.
  IF v_dropoff_leg THEN
    v_dest_address := p_dropoff_location; v_dest_lat := p_dropoff_lat; v_dest_lng := p_dropoff_lng;
  ELSE
    v_dest_address := (v_dp ->> 'name') || ', ' || (v_dp ->> 'city');
    v_dest_lat := (v_dp ->> 'lat')::NUMERIC; v_dest_lng := (v_dp ->> 'lng')::NUMERIC;
  END IF;

  INSERT INTO public.mbg_journeys (
    customer_id, journey_kind, status, origin_country, destination_country,
    destination_address, destination_lat, destination_lng, cargo_description, cargo_weight_kg,
    total_fare_ugx, total_fare_ican, ican_journey_tx_id
  ) VALUES (
    v_customer_id, 'cargo', 'confirmed', p_pickup_country, p_dropoff_country,
    v_dest_address, v_dest_lat, v_dest_lng, p_cargo_description, p_cargo_weight_kg,
    v_fare_ugx, v_fare_ican, (v_debit ->> 'tx_id')::UUID
  ) RETURNING id INTO v_journey_id;

  UPDATE ican_coin_transactions SET reference_id = v_journey_id::TEXT WHERE id = (v_debit ->> 'tx_id')::UUID;

  -- Legs are numbered 1..n over whichever ones are kept, so "advance to the next
  -- leg" (mbg_advance_cargo_journey_leg) needs no special case. The first leg is
  -- the one dispatched now.
  IF v_pickup_leg THEN
    v_order := v_order + 1;
    INSERT INTO public.mbg_journey_legs (
      journey_id, leg_order, leg_type, status,
      origin_country, origin_city, origin_lat, origin_lng,
      destination_country, destination_city, destination_lat, destination_lng,
      dispatch_after, fare_ugx, preferred_vehicle_type
    ) VALUES (
      v_journey_id, v_order, 'road_leg', 'ready_to_dispatch',
      p_pickup_country, p_pickup_location, p_pickup_lat, p_pickup_lng,
      v_op ->> 'country', v_op ->> 'city', (v_op ->> 'lat')::NUMERIC, (v_op ->> 'lng')::NUMERIC,
      now(), (v_plan ->> 'pickup_fare_ugx')::NUMERIC, p_land_vehicle_type
    );
  END IF;

  v_order := v_order + 1;
  INSERT INTO public.mbg_journey_legs (
    journey_id, leg_order, leg_type, status,
    origin_country, origin_city, origin_lat, origin_lng,
    destination_country, destination_city, destination_lat, destination_lng,
    dispatch_after, fare_ugx
  ) VALUES (
    v_journey_id, v_order, 'sea_leg', CASE WHEN v_order = 1 THEN 'ready_to_dispatch' ELSE 'pending' END,
    v_op ->> 'country', v_op ->> 'city', (v_op ->> 'lat')::NUMERIC, (v_op ->> 'lng')::NUMERIC,
    v_dp ->> 'country', v_dp ->> 'city', (v_dp ->> 'lat')::NUMERIC, (v_dp ->> 'lng')::NUMERIC,
    CASE WHEN v_order = 1 THEN now() ELSE NULL END, (v_plan ->> 'sea_fare_ugx')::NUMERIC
  );

  IF v_dropoff_leg THEN
    v_order := v_order + 1;
    INSERT INTO public.mbg_journey_legs (
      journey_id, leg_order, leg_type, status,
      origin_country, origin_city, origin_lat, origin_lng,
      destination_country, destination_city, destination_lat, destination_lng,
      dispatch_after, fare_ugx, preferred_vehicle_type
    ) VALUES (
      v_journey_id, v_order, 'road_leg', 'pending',
      v_dp ->> 'country', v_dp ->> 'city', (v_dp ->> 'lat')::NUMERIC, (v_dp ->> 'lng')::NUMERIC,
      p_dropoff_country, p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
      NULL, (v_plan ->> 'dropoff_fare_ugx')::NUMERIC, p_land_vehicle_type
    );
  END IF;

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
  RAISE NOTICE '✅ Parcel journeys (mbg_journeys.service_mode, parcel stamped on the courier rides) and ship cargo with optional land legs + vehicle choice, priced at the live ICAN value, are ready.';
END $$;
