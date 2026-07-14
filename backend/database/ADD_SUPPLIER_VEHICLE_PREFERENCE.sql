-- ============================================================================
-- Lets a supplier choose Car / Van / Truck for their delivery right when
-- they confirm an order (SupplierPortal.jsx's "Confirm Order" action),
-- instead of the vehicle type being decided entirely automatically at
-- manager-approval/dispatch time.
--
-- 'car' is a real, deliberate choice here (not a typo for 'van'/'truck'):
-- car-registered operators are always operator_type='passenger' (see
-- mbg_review_operator_application — only van/truck become 'cargo'), so
-- picking 'car' must also switch the match to operator_type='passenger',
-- not 'cargo'. A small/light supplier delivery genuinely can go by an
-- ordinary car driver; this isn't a workaround, it's the correct mapping
-- for how operators are actually registered.
--
-- Run after CREATE_JOURNEY_BOOKING_ENGINE.sql and ADD_SHIP_DISPATCH.sql.
-- ============================================================================

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS preferred_vehicle_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'purchase_orders' AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%preferred_vehicle_type%'
  ) THEN
    ALTER TABLE public.purchase_orders
      ADD CONSTRAINT purchase_orders_preferred_vehicle_type_check
      CHECK (preferred_vehicle_type IS NULL OR preferred_vehicle_type IN ('car', 'van', 'truck'));
  END IF;
END $$;

-- Same preference, carried onto a cross-bloc cargo journey (ADD_SHIP_DISPATCH.sql)
-- so the road legs (not the sea leg — that's a physical constraint, not a
-- preference) can honor it too.
ALTER TABLE public.mbg_journeys
  ADD COLUMN IF NOT EXISTS preferred_vehicle_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'mbg_journeys' AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%preferred_vehicle_type%'
  ) THEN
    ALTER TABLE public.mbg_journeys
      ADD CONSTRAINT mbg_journeys_preferred_vehicle_type_check
      CHECK (preferred_vehicle_type IS NULL OR preferred_vehicle_type IN ('car', 'van', 'truck'));
  END IF;
END $$;

-- ============================================================================
-- 1. mbg_dispatch_delivery_for_purchase_order gains a trailing
--    p_preferred_vehicle_type param — appending a parameter changes this
--    function's identity-argument list, so the old overload(s) must be
--    dropped first (CREATE OR REPLACE alone creates a second, ambiguous
--    overload rather than replacing it — the same class of bug this
--    project has hit before with mbg_apply_as_operator/
--    mbg_find_available_riders; no exceptions).
-- ============================================================================
DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mbg_dispatch_delivery_for_purchase_order'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.mbg_dispatch_delivery_for_purchase_order(%s)', fn.args);
  END LOOP;
END $$;

CREATE FUNCTION public.mbg_dispatch_delivery_for_purchase_order(
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

  -- A supplier's explicit choice wins outright; otherwise fall back to the
  -- existing automatic cross-border decision.
  IF p_preferred_vehicle_type IS NOT NULL THEN
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
-- 2. mbg_dispatch_cargo_for_purchase_order (ADD_SHIP_DISPATCH.sql's router)
--    also gains the trailing preference param — same drop-loop requirement.
-- ============================================================================
DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mbg_dispatch_cargo_for_purchase_order'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.mbg_dispatch_cargo_for_purchase_order(%s)', fn.args);
  END LOOP;
END $$;

CREATE FUNCTION public.mbg_dispatch_cargo_for_purchase_order(
  p_purchase_order_id UUID,
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_pickup_location TEXT, p_pickup_country TEXT,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC, p_dropoff_location TEXT, p_dropoff_country TEXT,
  p_preferred_vehicle_type TEXT DEFAULT NULL
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
    RETURN public.mbg_dispatch_delivery_for_purchase_order(
      p_purchase_order_id, p_pickup_lat, p_pickup_lng, p_pickup_location,
      p_dropoff_lat, p_dropoff_lng, p_dropoff_location, p_pickup_country,
      p_pickup_country IS DISTINCT FROM p_dropoff_country,
      p_preferred_vehicle_type
    );
  END IF;

  SELECT p.* INTO v_origin_port FROM public.mbg_country_ports cp JOIN public.mbg_ports p ON p.id = cp.port_id WHERE cp.country = p_pickup_country;
  SELECT p.* INTO v_dest_port   FROM public.mbg_country_ports cp JOIN public.mbg_ports p ON p.id = cp.port_id WHERE cp.country = p_dropoff_country;
  IF v_origin_port IS NULL OR v_dest_port IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No seaport route configured yet for this country pair');
  END IF;

  INSERT INTO public.mbg_journeys (purchase_order_id, journey_kind, status, origin_country, destination_country, preferred_vehicle_type)
  VALUES (p_purchase_order_id, 'cargo', 'confirmed', p_pickup_country, p_dropoff_country, p_preferred_vehicle_type)
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
GRANT EXECUTE ON FUNCTION public.mbg_dispatch_cargo_for_purchase_order(
  UUID, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, TEXT
) TO service_role, authenticated;

-- ============================================================================
-- 3. mbg_dispatch_cargo_leg: same signature (no drop needed) — road legs
--    honor the journey's preferred_vehicle_type when set; the sea leg
--    always needs 'ship' regardless (a physical constraint, not a choice).
--    'car' preference maps to operator_type='passenger' for the same
--    reason as mbg_dispatch_delivery_for_purchase_order above.
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
  ELSIF v_journey.preferred_vehicle_type IS NOT NULL THEN
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

-- ============================================================================
-- 4. The pg_cron PO retry job (ADD_SHIP_DISPATCH.sql) also routes through
--    mbg_dispatch_cargo_for_purchase_order — same signature, just reads
--    the supplier's preference off purchase_orders too, for retries that
--    happen minutes after the original dispatch attempt.
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
    SELECT po.id, po.supermarket_id, po.supplier_id, po.preferred_vehicle_type
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
      v_dropoff_lat, v_dropoff_lng, v_dropoff_location, COALESCE(v_supermarket_country, 'Uganda'),
      v_po.preferred_vehicle_type
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
  RAISE NOTICE '✅ Supplier vehicle preference ready: purchase_orders.preferred_vehicle_type (set from SupplierPortal.jsx confirm step) now drives dispatch vehicle-type/operator-type selection end to end.';
END $$;
