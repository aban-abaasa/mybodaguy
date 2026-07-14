-- ============================================================================
-- JOURNEY BOOKING ENGINE (Phase 1)
-- ============================================================================
-- Adds a multi-leg "journey" on top of the existing single-leg mbg_rides
-- matching engine (CREATE_REAL_RIDE_MATCHING_ENGINE.sql — run that first):
--   local_pickup (boda/car in Uganda) -> flight (real Duffel booking) ->
--   local_dropoff (driver at the destination country, to the final address)
--
-- Also generalizes the matching engine so it can be reused, unmodified in
-- its core matching logic, for supermarkera's supplier -> vehicle dispatch
-- (cargo_delivery rides with no customer, linked to a purchase_order_id
-- instead) — this is decision #3 from the approved plan: extend, don't
-- duplicate, the existing engine.
--
-- Nothing existing is altered in a breaking way: mbg_find_available_riders,
-- mbg_request_ride, mbg_respond_to_ride, mbg_start_ride, mbg_complete_ride,
-- mbg_cancel_ride all keep working exactly as before for plain rides.
-- ============================================================================

-- ============================================================================
-- 1. VEHICLE TYPE + CROSS-BORDER GENERALIZATION OF THE EXISTING ENGINE
-- ============================================================================

-- Each ADD VALUE must be its own statement, not batched inside a DO block or
-- transaction that also uses the new value — Postgres enum-safety rule.
ALTER TYPE public.mbg_vehicle_type ADD VALUE IF NOT EXISTS 'car';
ALTER TYPE public.mbg_vehicle_type ADD VALUE IF NOT EXISTS 'van';
ALTER TYPE public.mbg_vehicle_type ADD VALUE IF NOT EXISTS 'truck';
ALTER TYPE public.mbg_vehicle_type ADD VALUE IF NOT EXISTS 'trailer';
ALTER TYPE public.mbg_vehicle_type ADD VALUE IF NOT EXISTS 'ship';

-- Cross-border + cargo-operator plumbing on riders. stage_id is dropped to
-- NOT NULL -> nullable because it's Uganda's chairperson-commission
-- hierarchy (see mbg_complete_ride's commission cascade) and simply doesn't
-- generalize to a driver based in another country — non-Uganda operators
-- are created with stage_id = NULL and get no chairperson commission split
-- in Phase 1 (flagged, not silently swallowed: mbg_complete_ride already
-- short-circuits its commission loop when stage_id IS NULL).
ALTER TABLE public.mbg_riders
  ADD COLUMN IF NOT EXISTS operator_type       TEXT NOT NULL DEFAULT 'passenger' CHECK (operator_type IN ('passenger', 'cargo')),
  ADD COLUMN IF NOT EXISTS cargo_capacity_kg    NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS operator_country     TEXT NOT NULL DEFAULT 'Uganda',
  ADD COLUMN IF NOT EXISTS operator_home_city   TEXT,
  ADD COLUMN IF NOT EXISTS service_countries    TEXT[] NOT NULL DEFAULT ARRAY['Uganda'];
ALTER TABLE public.mbg_riders ALTER COLUMN stage_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS mbg_riders_operator_type_idx ON public.mbg_riders(operator_type);
CREATE INDEX IF NOT EXISTS mbg_riders_operator_country_idx ON public.mbg_riders(operator_country);

-- Cargo-delivery + cross-border plumbing on rides. customer_id and stage_id
-- both drop to nullable: a cargo_delivery ride belongs to a purchase_order,
-- not a customer, and may have no Uganda stage to route through.
ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS country            TEXT NOT NULL DEFAULT 'Uganda',
  ADD COLUMN IF NOT EXISTS city               TEXT,
  ADD COLUMN IF NOT EXISTS purchase_order_id  UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL;
ALTER TABLE public.mbg_rides ALTER COLUMN stage_id DROP NOT NULL;
ALTER TABLE public.mbg_rides ALTER COLUMN customer_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS mbg_rides_purchase_order_idx ON public.mbg_rides(purchase_order_id);
CREATE INDEX IF NOT EXISTS mbg_rides_country_idx ON public.mbg_rides(country);

-- Widen service_type to add 'cargo_delivery' (re-runnable: drop then
-- recreate the CHECK, same idempotent-constraint pattern already used
-- elsewhere in this codebase, e.g. ADD_BUSINESS_TYPE_TO_SUPERMARKETS.sql).
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'mbg_rides' AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%service_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.mbg_rides DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;
ALTER TABLE public.mbg_rides
  ADD CONSTRAINT mbg_rides_service_type_check
  CHECK (service_type IN ('ride', 'delivery', 'cargo_delivery'));

-- A ride is either a passenger/goods ride tied to a customer, or a cargo
-- delivery tied to a purchase order — never both, never neither.
DO $$
DECLARE
  con RECORD;
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
  );

-- ============================================================================
-- 2. JOURNEY / LEG / FLIGHT-BOOKING TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mbg_journeys (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id           UUID NOT NULL REFERENCES public.mbg_customers(id) ON DELETE RESTRICT,
  status                TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'pending_payment', 'confirmed', 'in_progress', 'completed', 'cancelled', 'failed')),
  origin_country        TEXT NOT NULL DEFAULT 'Uganda',
  origin_city           TEXT,
  destination_country   TEXT NOT NULL,
  destination_city      TEXT,
  destination_address   TEXT,
  destination_lat       DECIMAL(10, 8),
  destination_lng       DECIMAL(11, 8),
  total_fare_ugx        DECIMAL(12, 2),
  total_fare_ican       DECIMAL(18, 8),
  -- Reference-only: ican_coin_transactions lives in ICAN's schema. No hard
  -- FK across app boundaries by design (mirrors how source_app/reference_id
  -- is used everywhere else in the ICAN wiring instead of a real FK).
  ican_journey_tx_id    UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mbg_journeys_customer_idx ON public.mbg_journeys(customer_id);
CREATE INDEX IF NOT EXISTS mbg_journeys_status_idx ON public.mbg_journeys(status);

CREATE TABLE IF NOT EXISTS public.mbg_journey_legs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id            UUID NOT NULL REFERENCES public.mbg_journeys(id) ON DELETE CASCADE,
  leg_order             SMALLINT NOT NULL,
  leg_type              TEXT NOT NULL CHECK (leg_type IN ('local_pickup', 'flight', 'local_dropoff')),
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'ready_to_dispatch', 'searching_driver', 'dispatched',
    'in_progress', 'completed', 'cancelled', 'failed', 'awaiting_flight_update'
  )),
  ride_id               UUID REFERENCES public.mbg_rides(id) ON DELETE SET NULL,
  -- flight_booking_id FK added below, after mbg_flight_bookings exists
  -- (the two tables reference each other).
  flight_booking_id     UUID,
  origin_country        TEXT,
  origin_city           TEXT,
  origin_lat            DECIMAL(10, 8),
  origin_lng            DECIMAL(11, 8),
  destination_country   TEXT,
  destination_city      TEXT,
  destination_lat       DECIMAL(10, 8),
  destination_lng       DECIMAL(11, 8),
  -- The field the auto-re-dispatch trigger recomputes: for the
  -- local_dropoff leg this is set to flight arrival + buffer, and gets
  -- overwritten every time the airline reports a schedule change.
  dispatch_after        TIMESTAMPTZ,
  dispatched_at         TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(journey_id, leg_order)
);
CREATE INDEX IF NOT EXISTS mbg_journey_legs_journey_idx ON public.mbg_journey_legs(journey_id);
CREATE INDEX IF NOT EXISTS mbg_journey_legs_dispatch_idx ON public.mbg_journey_legs(leg_type, status, dispatch_after);

CREATE TABLE IF NOT EXISTS public.mbg_flight_bookings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_leg_id          UUID NOT NULL UNIQUE REFERENCES public.mbg_journey_legs(id) ON DELETE CASCADE,
  provider                TEXT NOT NULL DEFAULT 'duffel',
  provider_offer_id       TEXT,
  provider_order_id       TEXT,
  pnr                     TEXT,
  status                  TEXT NOT NULL DEFAULT 'quote'
    CHECK (status IN ('quote', 'booked', 'ticketed', 'delayed', 'rescheduled', 'cancelled', 'completed')),
  origin_iata             TEXT,
  destination_iata        TEXT,
  carrier                 TEXT,
  flight_number           TEXT,
  scheduled_departure_at  TIMESTAMPTZ,
  scheduled_arrival_at    TIMESTAMPTZ,
  -- Updated on every airline-initiated change — "updated flight hours".
  current_departure_at    TIMESTAMPTZ,
  current_arrival_at      TIMESTAMPTZ,
  last_status_check_at    TIMESTAMPTZ,
  fare_amount_fiat        DECIMAL(12, 2),
  fare_currency           TEXT,
  fare_amount_ugx         DECIMAL(12, 2),
  passenger_details       JSONB NOT NULL DEFAULT '[]',
  raw_provider_payload    JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mbg_flight_bookings_order_idx ON public.mbg_flight_bookings(provider_order_id);
CREATE INDEX IF NOT EXISTS mbg_flight_bookings_status_idx ON public.mbg_flight_bookings(status);

ALTER TABLE public.mbg_journey_legs
  DROP CONSTRAINT IF EXISTS mbg_journey_legs_flight_booking_fkey;
ALTER TABLE public.mbg_journey_legs
  ADD CONSTRAINT mbg_journey_legs_flight_booking_fkey
  FOREIGN KEY (flight_booking_id) REFERENCES public.mbg_flight_bookings(id) ON DELETE SET NULL;

-- ============================================================================
-- 3. RLS
-- ============================================================================
ALTER TABLE public.mbg_journeys       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_journey_legs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_flight_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_journeys_read_own ON public.mbg_journeys;
CREATE POLICY mbg_journeys_read_own ON public.mbg_journeys FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.mbg_customers c WHERE c.id = mbg_journeys.customer_id AND c.user_id = auth.uid())
);
DROP POLICY IF EXISTS mbg_journeys_service_role ON public.mbg_journeys;
CREATE POLICY mbg_journeys_service_role ON public.mbg_journeys FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_journey_legs_read_own_customer ON public.mbg_journey_legs;
CREATE POLICY mbg_journey_legs_read_own_customer ON public.mbg_journey_legs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.mbg_journeys j
    JOIN public.mbg_customers c ON c.id = j.customer_id
    WHERE j.id = mbg_journey_legs.journey_id AND c.user_id = auth.uid()
  )
);
DROP POLICY IF EXISTS mbg_journey_legs_read_own_rider ON public.mbg_journey_legs;
CREATE POLICY mbg_journey_legs_read_own_rider ON public.mbg_journey_legs FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.mbg_rides r
    JOIN public.mbg_riders rd ON rd.id = r.rider_id
    WHERE r.id = mbg_journey_legs.ride_id AND rd.user_id = auth.uid()
  )
);
DROP POLICY IF EXISTS mbg_journey_legs_service_role ON public.mbg_journey_legs;
CREATE POLICY mbg_journey_legs_service_role ON public.mbg_journey_legs FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_flight_bookings_read_own ON public.mbg_flight_bookings;
CREATE POLICY mbg_flight_bookings_read_own ON public.mbg_flight_bookings FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.mbg_journey_legs jl
    JOIN public.mbg_journeys j ON j.id = jl.journey_id
    JOIN public.mbg_customers c ON c.id = j.customer_id
    WHERE jl.id = mbg_flight_bookings.journey_leg_id AND c.user_id = auth.uid()
  )
);
DROP POLICY IF EXISTS mbg_flight_bookings_service_role ON public.mbg_flight_bookings;
CREATE POLICY mbg_flight_bookings_service_role ON public.mbg_flight_bookings FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- 4. MATCHING: superset of mbg_find_available_riders with vehicle-type,
--    country, and cargo-capacity filters. mbg_find_available_riders itself
--    is untouched, so every existing passenger-ride call site keeps working.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_find_available_vehicles(
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
  distance_to_pickup_km NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    dist.km
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

-- Cargo fare has its own (higher) base rate than passenger rides.
INSERT INTO public.mbg_platform_settings (key, value, value_type, description, category, is_public)
VALUES
  ('cargo.base_fare', '5000', 'number', 'Base fare in UGX for cargo_delivery rides', 'cargo', true),
  ('cargo.per_km_rate', '2000', 'number', 'Rate per kilometer in UGX for cargo_delivery rides', 'cargo', true),
  ('journey.dropoff_buffer_minutes', '45', 'number', 'Minutes after flight arrival before the local dropoff leg dispatches', 'journey', true)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 5. DISPATCH RPCs — both are service-role only. They are called by the
--    backend scheduler/webhook (mybodaguy/backend/server) and by
--    digital-city-era's deliveryDispatchService, never directly by a client.
-- ============================================================================

-- Dispatches ONE journey leg (local_pickup or local_dropoff) by finding the
-- nearest available driver and creating a real mbg_rides offer for them,
-- exactly like mbg_request_ride does for an ordinary ride — this function
-- exists (rather than reusing mbg_request_ride) because mbg_request_ride
-- requires auth.uid() to resolve the customer and a rider the customer
-- picked client-side; here the caller is a backend job with no customer
-- session, picking the driver itself via mbg_find_available_vehicles.
CREATE OR REPLACE FUNCTION public.mbg_dispatch_journey_leg(p_journey_leg_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leg public.mbg_journey_legs%ROWTYPE;
  v_journey public.mbg_journeys%ROWTYPE;
  v_candidate RECORD;
  v_distance_km NUMERIC;
  v_multiplier NUMERIC := public.mbg_current_time_multiplier();
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('ride.base_fare', 1000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('ride.per_km_rate', 1000);
  v_min_fare  NUMERIC := public.mbg_get_setting_numeric('ride.minimum_fare', 2000);
  v_fare NUMERIC;
  v_platform_pct NUMERIC := public.mbg_get_setting_numeric('commission.platform_fee_percentage', 5);
  v_rider_pct    NUMERIC := public.mbg_get_setting_numeric('commission.rider_percentage', 70);
  v_rider_earning NUMERIC;
  v_ride_id UUID;
BEGIN
  SELECT * INTO v_leg FROM public.mbg_journey_legs WHERE id = p_journey_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey leg not found';
  END IF;
  IF v_leg.leg_type NOT IN ('local_pickup', 'local_dropoff') THEN
    RAISE EXCEPTION 'Only local_pickup/local_dropoff legs can be dispatched directly';
  END IF;
  IF v_leg.status NOT IN ('pending', 'ready_to_dispatch', 'awaiting_flight_update') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Leg is not awaiting dispatch');
  END IF;

  SELECT * INTO v_journey FROM public.mbg_journeys WHERE id = v_leg.journey_id;

  SELECT * INTO v_candidate
  FROM public.mbg_find_available_vehicles(
    v_leg.origin_lat, v_leg.origin_lng, v_leg.destination_lat, v_leg.destination_lng,
    COALESCE(v_leg.origin_country, 'Uganda'),
    ARRAY['motorcycle', 'car', 'tuktuk'],
    'passenger',
    NULL,
    ARRAY[]::UUID[],
    1
  );

  IF v_candidate.rider_id IS NULL THEN
    -- No driver available right now — leave the leg pending so the
    -- scheduler retries on its next pass instead of failing the journey.
    UPDATE public.mbg_journey_legs SET status = 'ready_to_dispatch', updated_at = now() WHERE id = p_journey_leg_id;
    RETURN jsonb_build_object('success', false, 'error', 'No available driver right now');
  END IF;

  v_distance_km := public.mbg_haversine_km(v_leg.origin_lat, v_leg.origin_lng, v_leg.destination_lat, v_leg.destination_lng);
  v_fare := GREATEST(v_min_fare, v_base_fare + COALESCE(v_distance_km, 0) * v_per_km) * v_multiplier;
  v_fare := ROUND(v_fare / 100) * 100;
  v_rider_earning := ROUND(v_fare * v_rider_pct / 100);

  INSERT INTO public.mbg_rides (
    customer_id, rider_id, stage_id,
    pickup_location, pickup_lat, pickup_lng,
    dropoff_location, dropoff_lat, dropoff_lng,
    status, distance_km, duration_minutes, fare,
    service_type, country, city,
    time_multiplier, rider_earning,
    chairperson_commission_total
  ) VALUES (
    v_journey.customer_id, v_candidate.rider_id, NULL,
    COALESCE(v_leg.origin_city, v_journey.origin_city, 'Origin'), v_leg.origin_lat, v_leg.origin_lng,
    COALESCE(v_leg.destination_city, v_journey.destination_city, 'Destination'), v_leg.destination_lat, v_leg.destination_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(COALESCE(v_distance_km, 5) / 25 * 60)), v_fare,
    'ride', COALESCE(v_leg.origin_country, 'Uganda'), v_leg.origin_city,
    v_multiplier, v_rider_earning,
    0
  ) RETURNING id INTO v_ride_id;

  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx)
  VALUES (v_ride_id, ROUND(v_fare * v_platform_pct / 100));

  UPDATE public.mbg_journey_legs
  SET ride_id = v_ride_id, status = 'dispatched', dispatched_at = now(), updated_at = now()
  WHERE id = p_journey_leg_id;

  RETURN jsonb_build_object('success', true, 'ride_id', v_ride_id, 'rider_id', v_candidate.rider_id, 'fare', v_fare);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dispatch_journey_leg TO service_role;

-- Supermarkera's entry point: called right after a purchase order is
-- approved (digital-city-era/frontend/src/components/SupplierOrderManagement.jsx
-- — a manager-side, client-authenticated action, not a backend service-role
-- call, so this must be reachable by an ordinary `authenticated` session).
-- Pickup/dropoff are resolved by the caller (deliveryDispatchService.js,
-- which knows the actual suppliers/supermarkets column shape) rather than
-- looked up here, since this file must not assume a specific schema for
-- tables it doesn't own.
--
-- Fine-grained role checking (is this caller actually a manager/admin for
-- this supermarket?) is intentionally left to the app layer, matching this
-- codebase's existing convention for cross-app RPCs — see
-- dce_credit_supplier_delivery in ICAN_CROSS_APP_WALLET_MIGRATION.sql
-- ("Role check skipped — enforce in application layer").
CREATE OR REPLACE FUNCTION public.mbg_dispatch_delivery_for_purchase_order(
  p_purchase_order_id UUID,
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_pickup_location TEXT,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC, p_dropoff_location TEXT,
  p_country TEXT DEFAULT 'Uganda',
  p_cross_border BOOLEAN DEFAULT false
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vehicle_types TEXT[] := CASE WHEN p_cross_border THEN ARRAY['truck', 'ship'] ELSE ARRAY['van', 'truck'] END;
  v_candidate RECORD;
  v_distance_km NUMERIC;
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('cargo.base_fare', 5000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('cargo.per_km_rate', 2000);
  v_fare NUMERIC;
  v_ride_id UUID;
BEGIN
  -- auth.role() reflects the PostgREST-set JWT role and is only present at
  -- all when the call arrived through PostgREST (a real client request —
  -- anon or authenticated). A pg_cron job (see ADD_PG_CRON_DISPATCH.sql's
  -- mbg_run_due_cargo_dispatch) or any other raw internal SQL call has NO
  -- request context, so auth.role() is NULL there — that's the trusted,
  -- can't-be-spoofed-by-a-browser case, distinct from an anonymous client
  -- request (which PostgREST always stamps with a role, e.g. 'anon').
  IF auth.role() IS NOT NULL AND auth.role() <> 'service_role' AND auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  IF EXISTS (SELECT 1 FROM public.mbg_rides WHERE purchase_order_id = p_purchase_order_id AND status NOT IN ('cancelled', 'failed')) THEN
    RETURN jsonb_build_object('success', false, 'error', 'A delivery is already dispatched or in progress for this purchase order');
  END IF;

  SELECT * INTO v_candidate
  FROM public.mbg_find_available_vehicles(
    p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng,
    p_country, v_vehicle_types, 'cargo', NULL, ARRAY[]::UUID[], 1
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

  -- Best-effort sync into digital-city-era's own supplier_deliveries table
  -- (same database). Wrapped so a missing/older table shape never blocks
  -- dispatch of the actual vehicle.
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
GRANT EXECUTE ON FUNCTION public.mbg_dispatch_delivery_for_purchase_order TO service_role, authenticated;

-- Best-effort columns supplier_deliveries needs for the sync above — added
-- here (rather than only in a digital-city-era migration) so this file is
-- self-sufficient if run before ADD_SUPPLIER_TABLES.sql's later revisions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'supplier_deliveries') THEN
    ALTER TABLE public.supplier_deliveries ADD COLUMN IF NOT EXISTS delivery_vehicle_number TEXT;
    ALTER TABLE public.supplier_deliveries ADD COLUMN IF NOT EXISTS mbg_ride_id UUID;
  END IF;
END $$;

-- Auto-sync: when a cargo_delivery ride completes, mark the matching
-- supplier_deliveries row delivered and stamp the vehicle's plate number —
-- this is the "automatically" part of supplier-approve -> truck -> arrival.
CREATE OR REPLACE FUNCTION public.mbg_sync_cargo_delivery_completion()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.service_type = 'cargo_delivery' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    BEGIN
      UPDATE public.supplier_deliveries sd
      SET delivery_status = 'delivered',
          delivered_at = now(),
          delivery_vehicle_number = r.plate_number,
          updated_at = now()
      FROM public.mbg_riders r
      WHERE sd.purchase_order_id = NEW.purchase_order_id AND r.id = NEW.rider_id;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS mbg_sync_cargo_delivery_completion_trg ON public.mbg_rides;
CREATE TRIGGER mbg_sync_cargo_delivery_completion_trg
  AFTER UPDATE ON public.mbg_rides
  FOR EACH ROW EXECUTE FUNCTION public.mbg_sync_cargo_delivery_completion();

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Journey booking engine ready: mbg_journeys/mbg_journey_legs/mbg_flight_bookings, cross-border + cargo vehicle matching, journey and purchase-order dispatch RPCs.';
END $$;
