-- ============================================================================
-- REAL SHIP DISPATCH — cross-bloc cargo (e.g. Uganda -> Nigeria/USA/UAE) gets
-- a genuine multi-leg route (road to a real seaport, sea leg, road from the
-- destination port), instead of today's single "truck OR ship" flat match
-- (mbg_dispatch_delivery_for_purchase_order), which is geographically
-- nonsensical for a landlocked origin like Uganda — no ship can dock in
-- Kampala. Reuses the passenger journey/leg pattern (mbg_journeys /
-- mbg_journey_legs, CREATE_JOURNEY_BOOKING_ENGINE.sql) generalized for
-- cargo, since a "sea leg" is architecturally identical to a "road leg" —
-- both are just "dispatch a cargo mbg_rides row to some vehicle-type set
-- via mbg_find_available_vehicles". There is no third-party ship-booking
-- API integrated (unlike Duffel for flights) — a "ship" is just another
-- registered mbg_riders row (vehicle_type='ship', operator_type='cargo').
--
-- Same-bloc cross-border cargo (e.g. Uganda <-> Kenya) is completely
-- unaffected — it keeps going through the existing, unchanged
-- mbg_dispatch_delivery_for_purchase_order single-hop path.
--
-- Run after CREATE_JOURNEY_BOOKING_ENGINE.sql and ADD_PG_CRON_DISPATCH.sql.
-- ============================================================================

-- ============================================================================
-- 1. Real ports + country->port + trade-bloc reference data.
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

-- Every real (non-'Other') country from data/countries.ts maps to its
-- dispatch port — landlocked countries map to a real neighboring port.
-- Known v1 simplification: DR Congo's real western Atlantic corridor
-- (Matadi) isn't modeled; Rwanda/South Sudan could equally route via
-- Dar es Salaam (Central Corridor) instead of Mombasa (Northern Corridor).
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

-- Deliberately coarse lookup-table heuristic (not a routing graph): same
-- bloc = plain truck across the border (today's existing path, unchanged);
-- cross-bloc = needs a sea leg. Known limitation: this will misclassify
-- some real corridors (e.g. a South Africa<->East Africa road corridor
-- genuinely exists) — accepted for v1.
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

-- ============================================================================
-- 2. Widen mbg_journeys/mbg_journey_legs to also carry cargo journeys —
--    mirrors exactly how mbg_rides was already generalized for cargo in
--    CREATE_JOURNEY_BOOKING_ENGINE.sql (mbg_rides_customer_or_cargo_check).
-- ============================================================================
ALTER TABLE public.mbg_journeys
  ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS journey_kind TEXT NOT NULL DEFAULT 'passenger';

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

ALTER TABLE public.mbg_journeys ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE public.mbg_journeys DROP CONSTRAINT IF EXISTS mbg_journeys_customer_or_cargo_check;
ALTER TABLE public.mbg_journeys
  ADD CONSTRAINT mbg_journeys_customer_or_cargo_check
  CHECK (
    (journey_kind = 'passenger' AND customer_id IS NOT NULL AND purchase_order_id IS NULL)
    OR (journey_kind = 'cargo' AND purchase_order_id IS NOT NULL AND customer_id IS NULL)
  );

-- leg_type CHECK widened to add 'road_leg'/'sea_leg' — existing
-- 'local_pickup'/'flight'/'local_dropoff' rows/values untouched.
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

-- ============================================================================
-- 3. Dispatch a single cargo leg (road or sea) — deliberately a SEPARATE
--    function from the live mbg_dispatch_journey_leg (passenger flights),
--    duplicating its leg-lookup/lock/candidate-search/insert shape rather
--    than branching cargo logic into it. Real trade-off (some duplication),
--    chosen to keep the blast radius on the already-depended-upon
--    passenger-flight dispatch path at zero.
-- ============================================================================
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
    v_vehicle_types, 'cargo', NULL, ARRAY[]::UUID[], 1
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
    NULL, v_candidate.rider_id, NULL,
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
-- 4. On a cargo ride completing, advance to the next leg (or complete the
--    journey if it was the last one) — generalizes by leg_order, no
--    road-vs-sea special-casing needed.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_advance_cargo_journey_leg()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leg RECORD;
  v_next public.mbg_journey_legs%ROWTYPE;
BEGIN
  IF NEW.service_type = 'cargo_delivery' AND NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    SELECT * INTO v_leg FROM public.mbg_journey_legs WHERE ride_id = NEW.id;
    IF FOUND THEN
      UPDATE public.mbg_journey_legs SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = v_leg.id;

      SELECT * INTO v_next FROM public.mbg_journey_legs
      WHERE journey_id = v_leg.journey_id AND leg_order = v_leg.leg_order + 1;

      IF FOUND THEN
        UPDATE public.mbg_journey_legs SET status = 'ready_to_dispatch', dispatch_after = now(), updated_at = now() WHERE id = v_next.id;
      ELSE
        UPDATE public.mbg_journeys SET status = 'completed', updated_at = now() WHERE id = v_leg.journey_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS mbg_advance_cargo_journey_leg_trg ON public.mbg_rides;
CREATE TRIGGER mbg_advance_cargo_journey_leg_trg
  AFTER UPDATE ON public.mbg_rides
  FOR EACH ROW EXECUTE FUNCTION public.mbg_advance_cargo_journey_leg();

-- ============================================================================
-- 5. Router — the new entry point suppliers'/cron's code calls instead of
--    mbg_dispatch_delivery_for_purchase_order directly. Same-bloc pairs
--    (e.g. Uganda<->Kenya) fall through to that existing, unchanged
--    function; cross-bloc pairs get a real 3-leg road->sea->road journey.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_dispatch_cargo_for_purchase_order(
  p_purchase_order_id UUID,
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_pickup_location TEXT, p_pickup_country TEXT,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC, p_dropoff_location TEXT, p_dropoff_country TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_needs_sea BOOLEAN;
  v_origin_port RECORD;
  v_dest_port RECORD;
  v_journey_id UUID;
  v_first_leg_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.mbg_journeys
    WHERE purchase_order_id = p_purchase_order_id AND status NOT IN ('cancelled', 'failed')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'A cargo journey is already dispatched for this purchase order');
  END IF;

  v_needs_sea := public.mbg_route_needs_sea_leg(p_pickup_country, p_dropoff_country);

  IF NOT v_needs_sea THEN
    -- Unchanged existing behavior: same-bloc cargo stays a single truck/van hop.
    RETURN public.mbg_dispatch_delivery_for_purchase_order(
      p_purchase_order_id, p_pickup_lat, p_pickup_lng, p_pickup_location,
      p_dropoff_lat, p_dropoff_lng, p_dropoff_location, p_pickup_country,
      p_pickup_country IS DISTINCT FROM p_dropoff_country
    );
  END IF;

  SELECT p.* INTO v_origin_port FROM public.mbg_country_ports cp JOIN public.mbg_ports p ON p.id = cp.port_id WHERE cp.country = p_pickup_country;
  SELECT p.* INTO v_dest_port   FROM public.mbg_country_ports cp JOIN public.mbg_ports p ON p.id = cp.port_id WHERE cp.country = p_dropoff_country;
  IF v_origin_port IS NULL OR v_dest_port IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No seaport route configured yet for this country pair');
  END IF;

  INSERT INTO public.mbg_journeys (purchase_order_id, journey_kind, status, origin_country, destination_country)
  VALUES (p_purchase_order_id, 'cargo', 'confirmed', p_pickup_country, p_dropoff_country)
  RETURNING id INTO v_journey_id;

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

  RETURN jsonb_build_object('success', true, 'journey_id', v_journey_id, 'via_sea', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dispatch_cargo_for_purchase_order TO service_role, authenticated;

-- ============================================================================
-- 6. Give cargo legs the same automatic no-vehicle-available retry
--    passenger legs already get, for free, via the existing 2-min pg_cron
--    job (same function name/signature — CREATE OR REPLACE picks this up
--    without needing to re-schedule the cron job).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_run_due_journey_dispatch()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leg RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_leg IN
    SELECT id FROM public.mbg_journey_legs
    WHERE leg_type IN ('local_pickup', 'local_dropoff')
      AND status IN ('pending', 'ready_to_dispatch', 'awaiting_flight_update')
      AND dispatch_after <= now()
    LIMIT 50
  LOOP
    PERFORM public.mbg_dispatch_journey_leg(v_leg.id);
    v_count := v_count + 1;
  END LOOP;

  FOR v_leg IN
    SELECT id FROM public.mbg_journey_legs
    WHERE leg_type IN ('road_leg', 'sea_leg')
      AND status IN ('pending', 'ready_to_dispatch')
      AND dispatch_after <= now()
    LIMIT 50
  LOOP
    PERFORM public.mbg_dispatch_cargo_leg(v_leg.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_run_due_journey_dispatch TO service_role;

-- ============================================================================
-- 7. Route the supplier PO retry job through the new router — supplies
--    pickup/dropoff country separately instead of one flattened
--    country/cross_border pair, so mbg_route_needs_sea_leg can decide.
--    Same function name/signature as ADD_PG_CRON_DISPATCH.sql's version, so
--    CREATE OR REPLACE picks this up without re-scheduling the cron job.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_run_due_cargo_dispatch()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_po RECORD;
  v_pickup_lat NUMERIC;
  v_pickup_lng NUMERIC;
  v_pickup_location TEXT;
  v_dropoff_lat NUMERIC;
  v_dropoff_lng NUMERIC;
  v_dropoff_location TEXT;
  v_supplier_country TEXT;
  v_supermarket_country TEXT;
  v_count INTEGER := 0;
BEGIN
  FOR v_po IN
    SELECT po.id, po.supermarket_id, po.supplier_id
    FROM public.purchase_orders po
    WHERE po.status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM public.mbg_rides r WHERE r.purchase_order_id = po.id AND r.status NOT IN ('cancelled', 'failed')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.mbg_journeys j WHERE j.purchase_order_id = po.id AND j.status NOT IN ('cancelled', 'failed')
      )
    LIMIT 50
  LOOP
    SELECT sm.latitude, sm.longitude,
           COALESCE(to_jsonb(sm.*) ->> 'address', to_jsonb(sm.*) ->> 'name', 'Store'),
           to_jsonb(sm.*) ->> 'country'
    INTO v_dropoff_lat, v_dropoff_lng, v_dropoff_location, v_supermarket_country
    FROM public.supermarkets sm
    WHERE sm.id = v_po.supermarket_id;

    SELECT s.latitude, s.longitude,
           COALESCE(to_jsonb(s.*) ->> 'address', to_jsonb(s.*) ->> 'company_name', 'Supplier'),
           to_jsonb(s.*) ->> 'country'
    INTO v_pickup_lat, v_pickup_lng, v_pickup_location, v_supplier_country
    FROM public.suppliers s
    LEFT JOIN public.users u ON (u.auth_id = v_po.supplier_id OR u.id = v_po.supplier_id) AND u.role = 'supplier'
    WHERE s.user_id = COALESCE(u.id, v_po.supplier_id)
    LIMIT 1;

    IF v_pickup_lat IS NULL OR v_pickup_lng IS NULL OR v_dropoff_lat IS NULL OR v_dropoff_lng IS NULL THEN
      CONTINUE;
    END IF;

    PERFORM public.mbg_dispatch_cargo_for_purchase_order(
      v_po.id, v_pickup_lat, v_pickup_lng, v_pickup_location, COALESCE(v_supplier_country, 'Uganda'),
      v_dropoff_lat, v_dropoff_lng, v_dropoff_location, COALESCE(v_supermarket_country, 'Uganda')
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_run_due_cargo_dispatch TO service_role;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Real ship dispatch ready: mbg_ports/mbg_country_ports/mbg_country_trade_blocs seeded, cross-bloc cargo now gets a real road->sea->road mbg_journeys route (mbg_dispatch_cargo_for_purchase_order), same-bloc cargo unchanged. pg_cron jobs updated in place.';
END $$;
