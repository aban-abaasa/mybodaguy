-- ============================================================================
-- Smart ocean/air-crossing handling for ride & delivery requests.
-- ============================================================================
-- Until now, a plain "Request a Ride"/"Request a Delivery" (EnhancedRideRequest.tsx
-- -> mbg_request_ride / mbg_request_cross_border_delivery) never checked
-- whether pickup and dropoff even share a reachable trade bloc — a customer
-- could search for and request a real nearby boda/car rider for a trip that
-- physically requires a plane or ship (e.g. Uganda -> a Caribbean island),
-- and the request would just sit there since no real rider can fulfil it.
-- The Journey Booking Engine (CREATE_JOURNEY_BOOKING_ENGINE.sql,
-- ADD_SHIP_DISPATCH.sql) already exists for exactly this, but nothing
-- steered the customer there automatically.
--
-- mbg_route_needs_sea_leg (ADD_SHIP_DISPATCH.sql) already has the right
-- signal (same trade bloc = direct hop, different bloc = needs a real
-- long-haul leg) but isn't safely callable by a customer session (no
-- SECURITY DEFINER, no grant -> depends on direct table grants on
-- mbg_country_trade_blocs that authenticated doesn't have) and is named
-- for cargo/ship specifically. mbg_route_needs_long_haul_transport below is
-- a thin, generic, customer-callable wrapper used by the frontend for BOTH
-- the passenger-flight and cargo-ship redirect decision.
--
-- Separately: ship cargo legs are currently priced by distance across open
-- ocean (base_fare + distance_km * per_km, same formula as a road delivery)
-- in both mbg_dispatch_cargo_leg (the per-leg driver-facing fare) and
-- mbg_request_ship_cargo_journey (the customer's upfront combined quote).
-- Real ocean freight isn't priced per km the way a road trip is, so the
-- sea-crossing portion becomes a flat fee here; the road portions
-- (pickup->port, port->dropoff) are untouched.
--
-- Section 0 below is a defensive, fully idempotent replay of the schema
-- pieces ADD_SHIP_DISPATCH.sql / ADD_SHIP_CARGO_JOURNEY.sql are supposed to
-- have already created (mbg_ports/mbg_country_ports/mbg_country_trade_blocs,
-- mbg_journeys columns, the widened CHECK constraints). Confirmed via a live
-- pg_catalog check on this project's own database that those never actually
-- ran — only some later function BODIES that assume they exist did (a
-- plpgsql/sql function body isn't validated against its dependencies until
-- it's actually called, so CREATE FUNCTION silently "succeeded" even though
-- calling mbg_request_ship_cargo_journey would fail at the first missing
-- table/column). Every statement here uses IF NOT EXISTS / DROP-then-CREATE,
-- so this is safe to run even on a database where those files WERE already
-- applied correctly.
--
-- mbg_dispatch_cargo_leg in section 2 is written to match the version of
-- that function already confirmed live on this project (via
-- pg_get_functiondef) — the vehicle-preference routing merged in from
-- ADD_SUPPLIER_VEHICLE_PREFERENCE.sql — plus the flat sea-crossing fee, so
-- running this file doesn't regress that already-deployed improvement.
-- ============================================================================

-- ============================================================================
-- 0. Prerequisite schema — ports/trade-bloc reference data, mbg_journeys'
--    cargo-ownership columns, and the two CHECK constraints that allow a
--    customer (not just a purchase_order) to own a cargo_delivery ride/journey.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.mbg_ports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country     TEXT NOT NULL,
  city        TEXT NOT NULL,
  port_name   TEXT NOT NULL,
  latitude    DECIMAL(10, 8) NOT NULL,
  longitude   DECIMAL(11, 8) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.mbg_ports (country, city, port_name, latitude, longitude)
SELECT * FROM (VALUES
  ('Kenya', 'Mombasa', 'Kilindini Harbour (Port of Mombasa)', -4.0435::DECIMAL(10,8), 39.6682::DECIMAL(11,8)),
  ('Tanzania', 'Dar es Salaam', 'Port of Dar es Salaam', -6.8160, 39.2803),
  ('Nigeria', 'Lagos', 'Apapa Port', 6.4550, 3.3841),
  ('Ghana', 'Tema', 'Tema Port', 5.6698, -0.0166),
  ('South Africa', 'Durban', 'Port of Durban', -29.8587, 31.0218),
  ('United Arab Emirates', 'Dubai', 'Jebel Ali Port', 25.0119, 55.0617),
  ('United States', 'New York', 'Port of New York and New Jersey', 40.6700, -74.0432),
  ('United Kingdom', 'Felixstowe', 'Port of Felixstowe', 51.9540, 1.3510),
  ('Canada', 'Halifax', 'Port of Halifax', 44.6488, -63.5752)
) AS v(country, city, port_name, latitude, longitude)
WHERE NOT EXISTS (SELECT 1 FROM public.mbg_ports p WHERE p.port_name = v.port_name);

CREATE TABLE IF NOT EXISTS public.mbg_country_ports (
  country  TEXT PRIMARY KEY,
  port_id  UUID NOT NULL REFERENCES public.mbg_ports(id)
);

INSERT INTO public.mbg_country_ports (country, port_id)
SELECT v.country, p.id
FROM (VALUES
  ('Uganda', 'Kilindini Harbour (Port of Mombasa)'),
  ('Kenya', 'Kilindini Harbour (Port of Mombasa)'),
  ('Rwanda', 'Kilindini Harbour (Port of Mombasa)'),
  ('South Sudan', 'Kilindini Harbour (Port of Mombasa)'),
  ('Tanzania', 'Port of Dar es Salaam'),
  ('DR Congo', 'Port of Dar es Salaam'),
  ('Nigeria', 'Apapa Port'),
  ('Ghana', 'Tema Port'),
  ('South Africa', 'Port of Durban'),
  ('United Arab Emirates', 'Jebel Ali Port'),
  ('United States', 'Port of New York and New Jersey'),
  ('United Kingdom', 'Port of Felixstowe'),
  ('Canada', 'Port of Halifax')
) AS v(country, port_name)
JOIN public.mbg_ports p ON p.port_name = v.port_name
ON CONFLICT (country) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.mbg_country_trade_blocs (
  country TEXT PRIMARY KEY,
  bloc    TEXT NOT NULL
);

INSERT INTO public.mbg_country_trade_blocs (country, bloc) VALUES
  ('Uganda', 'EAC_CENTRAL'), ('Kenya', 'EAC_CENTRAL'), ('Tanzania', 'EAC_CENTRAL'),
  ('Rwanda', 'EAC_CENTRAL'), ('South Sudan', 'EAC_CENTRAL'), ('DR Congo', 'EAC_CENTRAL'),
  ('Nigeria', 'WEST_AFRICA'), ('Ghana', 'WEST_AFRICA'),
  ('South Africa', 'SOUTHERN_AFRICA'),
  ('United Arab Emirates', 'MIDDLE_EAST'),
  ('United States', 'NORTH_AMERICA'), ('Canada', 'NORTH_AMERICA'),
  ('United Kingdom', 'EUROPE')
ON CONFLICT (country) DO UPDATE SET bloc = EXCLUDED.bloc;

CREATE OR REPLACE FUNCTION public.mbg_route_needs_sea_leg(p_origin_country TEXT, p_destination_country TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT p_origin_country IS DISTINCT FROM p_destination_country
    AND COALESCE(
      (SELECT bloc FROM public.mbg_country_trade_blocs WHERE country = p_origin_country) IS DISTINCT FROM
      (SELECT bloc FROM public.mbg_country_trade_blocs WHERE country = p_destination_country),
      true -- unmapped country (e.g. 'Other') -> conservatively assume a sea leg is needed
    );
$$;

ALTER TABLE public.mbg_journeys
  ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS journey_kind TEXT NOT NULL DEFAULT 'passenger',
  ADD COLUMN IF NOT EXISTS cargo_description TEXT,
  ADD COLUMN IF NOT EXISTS cargo_weight_kg NUMERIC;

ALTER TABLE public.mbg_journeys ALTER COLUMN customer_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'mbg_journeys' AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%journey_kind%IN%'
  ) THEN
    ALTER TABLE public.mbg_journeys
      ADD CONSTRAINT mbg_journeys_journey_kind_check CHECK (journey_kind IN ('passenger', 'cargo'));
  END IF;
END $$;

-- Final, simplified ownership rule (supersedes the journey_kind-tied version
-- ADD_SHIP_DISPATCH.sql originally introduced, per ADD_SHIP_CARGO_JOURNEY.sql):
-- exactly one of customer_id/purchase_order_id, regardless of journey_kind.
ALTER TABLE public.mbg_journeys DROP CONSTRAINT IF EXISTS mbg_journeys_customer_or_cargo_check;
ALTER TABLE public.mbg_journeys
  ADD CONSTRAINT mbg_journeys_customer_or_cargo_check
  CHECK (
    (customer_id IS NOT NULL AND purchase_order_id IS NULL)
    OR (customer_id IS NULL AND purchase_order_id IS NOT NULL)
  );

DO $$
DECLARE con RECORD;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'mbg_journey_legs' AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%leg_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.mbg_journey_legs DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;
ALTER TABLE public.mbg_journey_legs
  ADD CONSTRAINT mbg_journey_legs_leg_type_check
  CHECK (leg_type IN ('local_pickup', 'flight', 'local_dropoff', 'road_leg', 'sea_leg'));

-- A customer-booked ship-cargo journey's leg lands in mbg_rides with
-- service_type='cargo_delivery', customer_id = the journey's own
-- customer_id, and purchase_order_id NULL (see the live mbg_dispatch_cargo_leg
-- body below) — the original 2-branch constraint from
-- CREATE_JOURNEY_BOOKING_ENGINE.sql only allowed cargo_delivery paired with
-- a purchase_order, so that insert would otherwise fail the CHECK.
ALTER TABLE public.mbg_rides DROP CONSTRAINT IF EXISTS mbg_rides_customer_or_cargo_check;
ALTER TABLE public.mbg_rides
  ADD CONSTRAINT mbg_rides_customer_or_cargo_check
  CHECK (
    (service_type IN ('ride', 'delivery') AND customer_id IS NOT NULL AND purchase_order_id IS NULL)
    OR (service_type = 'cargo_delivery' AND purchase_order_id IS NOT NULL AND customer_id IS NULL)
    OR (service_type = 'cargo_delivery' AND customer_id IS NOT NULL AND purchase_order_id IS NULL)
  );

-- ============================================================================
-- 1. Generic long-haul-transport check, safe for a customer session to call
--    directly (unlike mbg_route_needs_sea_leg, which has no grant/security
--    definer and isn't meant to be called outside another SECURITY DEFINER
--    function).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_route_needs_long_haul_transport(
  p_origin_country TEXT, p_destination_country TEXT
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.mbg_route_needs_sea_leg(p_origin_country, p_destination_country);
$$;
GRANT EXECUTE ON FUNCTION public.mbg_route_needs_long_haul_transport(TEXT, TEXT) TO authenticated;

-- ============================================================================
-- 2. Flat fee for the sea-crossing portion of a cargo journey. Placeholder
--    default (250,000 UGX) — this needs real business tuning via
--    mbg_platform_settings ('journey.sea_leg_flat_fee_ugx'), it is not a
--    researched shipping rate. Otherwise identical to the live function
--    (vehicle-preference routing from ADD_SUPPLIER_VEHICLE_PREFERENCE.sql,
--    confirmed via pg_get_functiondef) so that improvement isn't regressed.
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

  IF v_leg.leg_type = 'sea_leg' THEN
    -- Flat crossing fee, regardless of nautical distance — not billed like
    -- a road trip.
    v_fare := ROUND(v_sea_flat_fee / 100) * 100;
  ELSE
    v_fare := ROUND((v_base_fare + COALESCE(v_distance_km, 0) * v_per_km) / 100) * 100;
  END IF;

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

-- ============================================================================
-- 3. Customer's upfront combined quote for a ship-cargo journey — same flat
--    fee for the port->port sea portion, road portions (pickup->port,
--    port->dropoff) stay per-km. Otherwise identical to the live function
--    (confirmed via pg_get_functiondef).
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
  v_road_km NUMERIC;
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('cargo.base_fare', 5000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('cargo.per_km_rate', 2000);
  v_sea_flat_fee NUMERIC := public.mbg_get_setting_numeric('journey.sea_leg_flat_fee_ugx', 250000);
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

  -- Only the road portions (pickup->port, port->dropoff) are billed by
  -- distance; the port->port sea crossing is the flat fee below regardless
  -- of nautical distance.
  v_road_km := COALESCE(public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, v_origin_port.latitude, v_origin_port.longitude), 0)
             + COALESCE(public.mbg_haversine_km(v_dest_port.latitude, v_dest_port.longitude, p_dropoff_lat, p_dropoff_lng), 0);
  v_fare_ugx := ROUND((v_base_fare + v_road_km * v_per_km + v_sea_flat_fee) / 100) * 100;
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
  RAISE NOTICE '✅ Prerequisite ship-cargo schema backfilled; mbg_route_needs_long_haul_transport ready for customer-side redirect; sea-leg cargo now charges a flat crossing fee instead of per-km ocean distance.';
END $$;
