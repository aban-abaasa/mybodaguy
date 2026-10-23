-- ============================================================================
-- Delivery bag: a rider says whether they carry a bag, a customer can require one.
-- ============================================================================
-- Run this once in the Supabase SQL editor, after ADD_VEHICLE_CLASS_FARE_RATES.sql and
-- FIX_AUTO_DISPATCH_STAGGERED_OFFERS.sql (it re-creates functions from both).
--
-- Works the same way the rain cover (umbrella) does:
--   mbg_riders.has_delivery_bag       the rider's own switch (My Vehicle on the rider dashboard)
--   mbg_rides.delivery_bag_requested  the customer asked for a rider with a bag, for safe delivery
--
--   * mbg_find_available_riders(…, p_require_delivery_bag) leaves out riders without a bag
--     and tells the app which of the others carry one.
--   * mbg_request_ride(…, p_delivery_bag_requested) refuses a rider without a bag, so a
--     stale list on the customer's screen can't book one, and stores the request on the ride.
--   * The "Just Send" sweep keeps the requirement on every rider it adds to the shared request.
--   * The rider's own request card reads delivery_bag_requested straight from the ride row
--     (mbg_my_ride_offers returns the whole row), so it needs no function change.
--
-- Nothing is required of existing riders: everyone starts at "no bag", and a request that
-- doesn't ask for a bag matches exactly as before.
-- ============================================================================

ALTER TABLE public.mbg_riders
  ADD COLUMN IF NOT EXISTS has_delivery_bag BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS delivery_bag_requested BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 1. mbg_find_available_riders — same as ADD_VEHICLE_CLASS_FARE_RATES.sql section 6
--    except it takes p_require_delivery_bag (only riders who declared a bag) and
--    returns each rider's has_delivery_bag as a last column, so the ordering by
--    column number is unchanged.
-- ----------------------------------------------------------------------------
-- The new parameter and column change the signature, so every earlier version is dropped
-- first, by name (two overloads would make the call ambiguous for the app).

DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mbg_find_available_riders'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.mbg_find_available_riders(%s)', fn.args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.mbg_find_available_riders(
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_dropoff_area TEXT DEFAULT NULL,
  p_power_type TEXT DEFAULT NULL,
  p_require_umbrella BOOLEAN DEFAULT false,
  p_exclude_rider_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 10,
  p_vehicle_types TEXT[] DEFAULT NULL,
  p_business_profile_id UUID DEFAULT NULL,
  p_cargo_weight_kg NUMERIC DEFAULT NULL,
  p_cargo_class TEXT DEFAULT NULL,
  p_require_delivery_bag BOOLEAN DEFAULT false
)
RETURNS TABLE (
  rider_id UUID,
  full_name TEXT,
  phone TEXT,
  rating NUMERIC,
  total_rides INTEGER,
  vehicle_type TEXT,
  power_type TEXT,
  has_umbrella BOOLEAN,
  plate_number TEXT,
  vehicle_color TEXT,
  mode TEXT,
  distance_to_pickup_km NUMERIC,
  estimated_arrival_min INTEGER,
  knows_destination BOOLEAN,
  fare NUMERIC,
  distance_km NUMERIC,
  time_multiplier NUMERIC,
  verified_business_name TEXT,
  is_admin_verified_store_driver BOOLEAN,
  has_delivery_bag BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_distance_km NUMERIC := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  v_multiplier NUMERIC := public.mbg_current_time_multiplier();
  -- The live icaneracoin price is read once here (not once per rider), and only
  -- when a freight class (van / truck) could be among the results.
  v_ugx_per_usd NUMERIC := CASE
    WHEN p_vehicle_types IS NULL OR p_vehicle_types && ARRAY['van', 'truck'] THEN public.mbg_usd_to_ugx_rate()
  END;
BEGIN
  IF v_distance_km IS NULL THEN
    RAISE EXCEPTION 'Invalid pickup/dropoff coordinates';
  END IF;
  IF COALESCE(p_cargo_weight_kg, 0) < 0 THEN
    RAISE EXCEPTION 'Cargo weight cannot be negative';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    COALESCE(up.full_name, 'Rider'),
    COALESCE(NULLIF(up.phone, ''), NULLIF(u.phone, '')),
    r.rating,
    r.total_rides,
    r.vehicle_type::TEXT,
    r.power_type,
    r.has_umbrella,
    r.plate_number,
    r.vehicle_color,
    r.mode,
    dist.km,
    GREATEST(2, ROUND(COALESCE(dist.km, 5) / 20 * 60))::INTEGER,
    EXISTS (
      SELECT 1 FROM public.mbg_rider_locations kl
      WHERE kl.rider_user_id = r.user_id
        AND (
          (p_dropoff_area IS NOT NULL AND kl.name ILIKE '%' || p_dropoff_area || '%')
          OR public.mbg_haversine_km(kl.latitude, kl.longitude, p_dropoff_lat, p_dropoff_lng) <= 3
        )
    ),
    -- Priced for THIS rider's vehicle class, tier, rating, company rates and the
    -- cargo, so the number on the card is the number the ride is booked at.
    public.mbg_price_ride_for_rider(r, v_distance_km, v_multiplier, p_cargo_weight_kg, p_cargo_class, v_ugx_per_usd),
    v_distance_km,
    v_multiplier,
    CASE WHEN r.admin_verified_at IS NOT NULL THEN bp.business_name::TEXT ELSE NULL END,
    r.admin_verified_at IS NOT NULL,
    r.has_delivery_bag
  FROM public.mbg_riders r
  JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  LEFT JOIN public.mbg_rider_locations home ON home.rider_user_id = r.user_id AND home.is_home = true
  LEFT JOIN public.business_profiles bp ON bp.id = r.business_profile_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      public.mbg_haversine_km(r.current_lat, r.current_lng, p_pickup_lat, p_pickup_lng),
      public.mbg_haversine_km(home.latitude, home.longitude, p_pickup_lat, p_pickup_lng)
    ) AS km
  ) dist
  WHERE r.status = 'active'
    AND r.is_available = true
    AND NOT (r.id = ANY(p_exclude_rider_ids))
    AND (p_power_type IS NULL OR r.power_type = p_power_type)
    AND (NOT p_require_umbrella OR r.has_umbrella = true)
    AND (NOT COALESCE(p_require_delivery_bag, false) OR r.has_delivery_bag = true)
    AND (p_vehicle_types IS NULL OR r.vehicle_type::TEXT = ANY(p_vehicle_types))
    AND (p_business_profile_id IS NULL OR r.business_profile_id = p_business_profile_id)
    -- Only vehicles that can actually carry the declared load.
    AND (COALESCE(p_cargo_weight_kg, 0) <= 0 OR public.mbg_effective_capacity_kg(r) >= p_cargo_weight_kg)
  -- Nearest rider first (real GPS/home distance); "knows this destination"
  -- (column 14) and admin-verified store driver (column 19) only break ties
  -- among comparably-close riders, then rating.
  ORDER BY dist.km ASC NULLS LAST, 14 DESC, 19 DESC, r.rating DESC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_find_available_riders(
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN, UUID[], INT, TEXT[], UUID, NUMERIC, TEXT, BOOLEAN
) TO authenticated;


-- ----------------------------------------------------------------------------
-- 2. mbg_request_ride — same as ADD_VEHICLE_CLASS_FARE_RATES.sql section 7 except
--    it takes p_delivery_bag_requested, refuses a rider who has no bag, and stores
--    the request on the ride so the rider sees it and the auto-dispatch honours it.
-- ----------------------------------------------------------------------------
-- Callers (the app, the company-ride wrapper below, the escort flows) pass at most the
-- previous 20 arguments and keep working through the new default.

DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mbg_request_ride'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.mbg_request_ride(%s)', fn.args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.mbg_request_ride(
  p_service_type TEXT,
  p_delivery_mode TEXT,
  p_supermarket_id UUID,
  p_rider_id UUID,
  p_pickup_location TEXT, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_location TEXT, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_power_type_requested TEXT,
  p_umbrella_requested BOOLEAN,
  p_order_notes TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'wallet',
  p_cart JSONB DEFAULT NULL,
  p_max_delivery_hours NUMERIC DEFAULT NULL,
  p_expense_classification TEXT DEFAULT NULL,
  p_customer_business_profile_id UUID DEFAULT NULL,
  p_cargo_weight_kg NUMERIC DEFAULT NULL,
  p_cargo_class TEXT DEFAULT NULL,
  p_delivery_bag_requested BOOLEAN DEFAULT false
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id UUID;
  v_rider public.mbg_riders%ROWTYPE;
  v_stage_id UUID;
  v_distance_km NUMERIC;
  v_multiplier NUMERIC := public.mbg_current_time_multiplier();
  v_fare NUMERIC;
  v_is_boda BOOLEAN;
  v_platform_net NUMERIC;
  v_rider_earning NUMERIC;
  v_chair_total NUMERIC;
  v_ride_id UUID;
  v_cart_item JSONB;
  v_cart_qty NUMERIC;
  v_min_deadline_hours NUMERIC;
  v_max_deadline_hours NUMERIC;
  v_expense_classification TEXT;
  v_customer_business_profile_id UUID;
BEGIN
  IF p_service_type NOT IN ('ride', 'delivery') THEN
    RAISE EXCEPTION 'Invalid service_type: %', p_service_type;
  END IF;
  IF p_service_type = 'delivery' AND (p_delivery_mode IS NULL OR p_delivery_mode NOT IN ('supermarket', 'normal')) THEN
    RAISE EXCEPTION 'delivery_mode (supermarket|normal) is required for deliveries';
  END IF;
  IF p_delivery_mode = 'supermarket' AND p_supermarket_id IS NULL THEN
    RAISE EXCEPTION 'supermarket_id is required for supermarket deliveries';
  END IF;
  IF p_payment_method NOT IN ('wallet', 'cash') THEN
    RAISE EXCEPTION 'Invalid payment_method: %', p_payment_method;
  END IF;

  v_expense_classification := CASE
    WHEN p_service_type = 'delivery' THEN COALESCE(p_expense_classification, 'personal_expense')
    ELSE NULL
  END;

  v_customer_business_profile_id := CASE
    WHEN p_service_type = 'delivery' AND v_expense_classification = 'business_expense' THEN p_customer_business_profile_id
    ELSE NULL
  END;

  IF p_delivery_mode = 'supermarket' THEN
    IF p_cart IS NULL OR jsonb_typeof(p_cart) <> 'array' OR jsonb_array_length(p_cart) = 0 THEN
      RAISE EXCEPTION 'Pick at least one item from the store to request a delivery';
    END IF;
    FOR v_cart_item IN SELECT * FROM jsonb_array_elements(p_cart) LOOP
      v_cart_qty := (v_cart_item->>'quantity')::NUMERIC;
      IF v_cart_qty IS NULL OR v_cart_qty <= 0 THEN
        RAISE EXCEPTION 'Invalid quantity for product %', v_cart_item->>'product_id';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = (v_cart_item->>'product_id')::UUID
          AND p.supermarket_id = p_supermarket_id
          AND (p.is_active IS NULL OR p.is_active = TRUE)
      ) THEN
        RAISE EXCEPTION 'Product % is not available from this store', v_cart_item->>'product_id';
      END IF;
    END LOOP;

    v_min_deadline_hours := public.mbg_get_setting_numeric('delivery.min_deadline_hours', 1);
    v_max_deadline_hours := public.mbg_get_setting_numeric('delivery.max_deadline_hours', 48);
    IF p_max_delivery_hours IS NULL THEN
      RAISE EXCEPTION 'Choose a maximum delivery time for this order';
    END IF;
    IF p_max_delivery_hours < v_min_deadline_hours OR p_max_delivery_hours > v_max_deadline_hours THEN
      RAISE EXCEPTION 'Delivery window must be between % and % hours', v_min_deadline_hours, v_max_deadline_hours;
    END IF;
  END IF;

  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();
  IF v_customer_id IS NULL THEN
    INSERT INTO public.mbg_customers (user_id) VALUES (auth.uid()) RETURNING id INTO v_customer_id;
  END IF;

  SELECT * INTO v_rider FROM public.mbg_riders WHERE id = p_rider_id AND status = 'active' AND is_available = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected rider is no longer available';
  END IF;
  IF p_power_type_requested IS NOT NULL AND v_rider.power_type <> p_power_type_requested THEN
    RAISE EXCEPTION 'Selected rider does not match the requested vehicle power type';
  END IF;
  IF p_umbrella_requested AND NOT v_rider.has_umbrella THEN
    RAISE EXCEPTION 'Selected rider does not offer rain cover';
  END IF;
  IF COALESCE(p_delivery_bag_requested, false) AND NOT v_rider.has_delivery_bag THEN
    RAISE EXCEPTION 'Selected rider does not carry a delivery bag';
  END IF;
  IF EXISTS (SELECT 1 FROM public.mbg_rides WHERE rider_id = p_rider_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Selected rider already has a request awaiting their response — try again in a moment or pick another rider';
  END IF;

  -- Cargo declared for a van / truck booking: a known handling class, and a
  -- load this vehicle can actually carry.
  IF COALESCE(p_cargo_weight_kg, 0) < 0 THEN
    RAISE EXCEPTION 'Cargo weight cannot be negative';
  END IF;
  IF p_cargo_class IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mbg_cargo_classes WHERE code = p_cargo_class) THEN
    RAISE EXCEPTION 'Unknown cargo type: %', p_cargo_class;
  END IF;
  IF COALESCE(p_cargo_weight_kg, 0) > 0 AND public.mbg_effective_capacity_kg(v_rider) < p_cargo_weight_kg THEN
    RAISE EXCEPTION 'This vehicle cannot carry % kg — choose a larger vehicle', ROUND(p_cargo_weight_kg);
  END IF;

  v_distance_km := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  IF v_distance_km IS NULL THEN
    RAISE EXCEPTION 'Invalid pickup/dropoff coordinates';
  END IF;

  -- The fare depends on what is actually driving and what it is carrying: a
  -- boda, car, van and truck each have their own rates, van/truck add the cargo
  -- weight and handling class at the live icaneracoin price, a company's own
  -- rates win over the class rates, and the rider's mode applies on top.
  v_fare := public.mbg_price_ride_for_rider(v_rider, v_distance_km, v_multiplier, p_cargo_weight_kg, p_cargo_class);

  v_is_boda := v_rider.vehicle_type::TEXT IN ('motorcycle', 'bicycle', 'tuktuk');

  -- rider_earning is the ONE number the rider is shown and the exact amount
  -- they keep; the chairperson share and ICANera's net are recorded for
  -- reporting. All of the arithmetic (who fronts what, personal vs company
  -- rider) lives in mbg_compute_ride_split so it can't drift between here and
  -- the company-pricing trigger.
  SELECT s.o_rider_earning, s.o_chair_total, s.o_platform_net
    INTO v_rider_earning, v_chair_total, v_platform_net
    FROM public.mbg_compute_ride_split(
      v_fare, v_is_boda, v_rider.business_profile_id IS NOT NULL, p_payment_method
    ) s;

  SELECT id INTO v_stage_id FROM public.mbg_stages
  WHERE is_active = true AND location_lat IS NOT NULL AND location_lng IS NOT NULL
  ORDER BY public.mbg_haversine_km(location_lat, location_lng, p_pickup_lat, p_pickup_lng) ASC
  LIMIT 1;
  IF v_stage_id IS NULL THEN
    SELECT id INTO v_stage_id FROM public.mbg_stages WHERE is_active = true LIMIT 1;
  END IF;
  IF v_stage_id IS NULL THEN
    RAISE EXCEPTION 'No active stage is configured yet to route this request through';
  END IF;

  INSERT INTO public.mbg_rides (
    customer_id, rider_id, stage_id,
    pickup_location, pickup_lat, pickup_lng,
    dropoff_location, dropoff_lat, dropoff_lng,
    status, distance_km, duration_minutes, fare,
    service_type, delivery_mode, supermarket_id,
    power_type_requested, umbrella_requested, delivery_bag_requested,
    time_multiplier, rider_earning, chairperson_commission_total,
    order_notes, payment_method, cart, max_delivery_hours, expense_classification,
    customer_business_profile_id, cargo_weight_kg, cargo_class
  ) VALUES (
    v_customer_id, p_rider_id, v_stage_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(v_distance_km / 25 * 60)), v_fare,
    p_service_type, p_delivery_mode, p_supermarket_id,
    p_power_type_requested, COALESCE(p_umbrella_requested, false), COALESCE(p_delivery_bag_requested, false),
    v_multiplier, v_rider_earning, v_chair_total,
    p_order_notes, p_payment_method, p_cart, p_max_delivery_hours, v_expense_classification,
    v_customer_business_profile_id, NULLIF(p_cargo_weight_kg, 0), COALESCE(p_cargo_class, 'standard')
  ) RETURNING id, fare, rider_earning INTO v_ride_id, v_fare, v_rider_earning;

  -- A company rider's own pricing (trg_mbg_apply_business_pricing) can change
  -- the fare and split as the row is written, so the fee record and the
  -- response below use what was actually stored, not the pre-insert numbers.
  SELECT s.o_platform_net INTO v_platform_net
    FROM public.mbg_compute_ride_split(
      v_fare, v_is_boda, v_rider.business_profile_id IS NOT NULL, p_payment_method
    ) s;

  -- ICANera's expected net: the whole pool minus what the chairpersons take.
  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx) VALUES (v_ride_id, v_platform_net);

  RETURN jsonb_build_object(
    'success', true, 'ride_id', v_ride_id, 'fare', v_fare,
    'distance_km', v_distance_km, 'rider_earning', v_rider_earning
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, JSONB, NUMERIC, TEXT, UUID,
  NUMERIC, TEXT, BOOLEAN
) TO authenticated;


-- ----------------------------------------------------------------------------
-- 2b. mbg_request_company_ride — same as ADD_VEHICLE_CLASS_FARE_RATES.sql section 7b
--    except it passes the bag request through to mbg_request_ride.
-- ----------------------------------------------------------------------------

DO $$
DECLARE fn RECORD;
BEGIN
  FOR fn IN
    SELECT pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'mbg_request_company_ride'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.mbg_request_company_ride(%s)', fn.args);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.mbg_request_company_ride(
  p_service_type TEXT, p_delivery_mode TEXT, p_supermarket_id UUID, p_rider_id UUID,
  p_pickup_location TEXT, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_location TEXT, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_power_type_requested TEXT, p_umbrella_requested BOOLEAN,
  p_order_notes TEXT DEFAULT NULL,
  p_cargo_weight_kg NUMERIC DEFAULT NULL,
  p_cargo_class TEXT DEFAULT NULL,
  p_delivery_bag_requested BOOLEAN DEFAULT false
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_benefit JSONB; v_result JSONB; v_ride_id UUID;
BEGIN
  v_benefit := public.mbg_get_company_transport_benefit();
  IF COALESCE((v_benefit->>'eligible')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'This Gmail account has no active company transport allocation';
  END IF;
  v_result := public.mbg_request_ride(
    p_service_type, p_delivery_mode, p_supermarket_id, p_rider_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    p_power_type_requested, p_umbrella_requested, p_order_notes, 'wallet',
    p_cargo_weight_kg => p_cargo_weight_kg, p_cargo_class => p_cargo_class,
    p_delivery_bag_requested => p_delivery_bag_requested
  );
  v_ride_id := NULLIF(v_result->>'ride_id','')::UUID;
  UPDATE public.mbg_rides
     SET payment_method = 'company',
         company_profile_id = NULLIF(v_benefit->>'business_profile_id','')::UUID,
         company_employee_user_id = auth.uid(),
         company_transport_allocation_id = NULLIF(v_benefit->>'allocation_id','')::UUID,
         company_billing_mode = COALESCE(v_benefit->>'billing_mode','per_ride')
   WHERE id = v_ride_id AND customer_id IN (
     SELECT id FROM public.mbg_customers WHERE user_id = auth.uid()
   );
  RETURN v_result || jsonb_build_object(
    'payment_method','company',
    'company_profile_id',v_benefit->>'business_profile_id',
    'billing_mode',v_benefit->>'billing_mode'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_request_company_ride(TEXT,TEXT,UUID,UUID,TEXT,NUMERIC,NUMERIC,TEXT,NUMERIC,NUMERIC,TEXT,BOOLEAN,TEXT,NUMERIC,TEXT,BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_request_company_ride(TEXT,TEXT,UUID,UUID,TEXT,NUMERIC,NUMERIC,TEXT,NUMERIC,NUMERIC,TEXT,BOOLEAN,TEXT,NUMERIC,TEXT,BOOLEAN) TO authenticated;


-- ----------------------------------------------------------------------------
-- 3. mbg_ride_dispatch_status — same as FIX_AUTO_DISPATCH_STAGGERED_OFFERS.sql
--    except the rider it reports back also says whether they carry a delivery bag.
-- ----------------------------------------------------------------------------

-- ── Customer: how is my request going? ──────────────────────────────────────
-- Who is being asked right now, how many riders have been asked in all, and — once
-- someone accepts — who. (The customer's screen used to assume the rider it
-- first picked; with a shared request the winner is usually someone else.)
CREATE OR REPLACE FUNCTION public.mbg_ride_dispatch_status(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_customer_id UUID;
  v_active UUID[];
  v_total INT;
  v_rider JSONB;
BEGIN
  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();
  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id;
  IF NOT FOUND OR v_customer_id IS NULL OR v_ride.customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  SELECT COALESCE(array_agg(o.rider_id ORDER BY o.offered_at), ARRAY[]::UUID[]) INTO v_active
  FROM public.mbg_ride_offers o
  WHERE o.ride_id = p_ride_id AND o.status = 'active' AND o.expires_at > clock_timestamp();
  SELECT count(*) INTO v_total FROM public.mbg_ride_offers WHERE ride_id = p_ride_id;

  IF v_ride.status::TEXT IN ('accepted', 'in_progress', 'completed') AND v_ride.rider_id IS NOT NULL THEN
    SELECT jsonb_build_object(
             'rider_id', r.id,
             'full_name', COALESCE(up.full_name, 'Rider'),
             'phone', COALESCE(NULLIF(up.phone, ''), NULLIF(u.phone, '')),
             'rating', r.rating,
             'total_rides', r.total_rides,
             'vehicle_type', r.vehicle_type::TEXT,
             'power_type', r.power_type,
             'has_umbrella', r.has_umbrella,
             'has_delivery_bag', r.has_delivery_bag,
             'plate_number', r.plate_number,
             'vehicle_color', r.vehicle_color,
             'mode', r.mode
           )
    INTO v_rider
    FROM public.mbg_riders r
    JOIN public.mbg_users u ON u.id = r.user_id
    LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
    WHERE r.id = v_ride.rider_id;
  END IF;

  RETURN jsonb_build_object(
    'status', v_ride.status::TEXT,
    'rider_id', v_ride.rider_id,
    'fare', v_ride.fare,
    'active_rider_ids', to_jsonb(v_active),
    'offered_total', v_total,
    'rider', v_rider
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_ride_dispatch_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_ride_dispatch_status(UUID) TO authenticated;


-- ----------------------------------------------------------------------------
-- 4. mbg_sweep_auto_dispatch_cascade — same as FIX_AUTO_DISPATCH_STAGGERED_OFFERS.sql
--    except a shared ("Just Send") request that asked for a delivery bag is only ever
--    offered to riders who have one. The pg_cron job already calls this by name.
-- ----------------------------------------------------------------------------

-- ── The sweep ───────────────────────────────────────────────────────────────
-- No SECURITY DEFINER and no SET clause: either one makes COMMIT illegal below
-- ("invalid transaction termination"). pg_cron runs it as the owner (postgres).
-- Reads the real clock (clock_timestamp), not now(): after a COMMIT, now() is
-- frozen before the pg_sleep that follows it.
CREATE OR REPLACE PROCEDURE public.mbg_sweep_auto_dispatch_cascade()
LANGUAGE plpgsql AS $$
DECLARE
  -- A new rider is added to a request this often.
  v_stagger CONSTANT INTERVAL := interval '7 seconds';
  -- How soon to look again when the request has nobody left holding it.
  v_retry CONSTANT INTERVAL := interval '1 second';
  -- Most riders one request is ever offered to.
  v_max_offers CONSTANT INT := 15;
  -- Seconds between sweeps.
  v_tick_seconds CONSTANT DOUBLE PRECISION := 1;
  -- pg_cron starts this once a minute and never runs two copies at once, so
  -- ending just short of 60s leaves no stretch of the minute without a sweep.
  v_run_until TIMESTAMPTZ := clock_timestamp() + interval '59 seconds';
  v_ride RECORD;
  v_active INT;
  v_next_rider UUID;
  v_offered UUID[];
  v_busy UUID[];
  v_total INT := 0;
BEGIN
  LOOP
    -- Offers that ran out their 30 seconds.
    UPDATE public.mbg_ride_offers SET status = 'expired'
    WHERE status = 'active' AND expires_at <= clock_timestamp();

    -- Requests due another rider: it is 7 seconds since one was last added, or
    -- nobody is holding the request any more. Only live requests — an old stuck
    -- one (rider_id cleared by mbg_expire_stale_pending_ride_offers) is left alone.
    FOR v_ride IN
      SELECT r.* FROM public.mbg_rides r
      WHERE r.status = 'pending'
        AND r.dispatch_mode = 'auto'
        AND r.rider_id IS NOT NULL
        AND r.offer_sent_at IS NOT NULL
        AND r.created_at > clock_timestamp() - interval '5 minutes'
        AND (
          r.offer_sent_at <= clock_timestamp() - v_stagger
          OR (
            r.offer_sent_at <= clock_timestamp() - v_retry
            AND NOT EXISTS (SELECT 1 FROM public.mbg_ride_offers o WHERE o.ride_id = r.id AND o.status = 'active')
          )
        )
      FOR UPDATE OF r SKIP LOCKED
    LOOP
      SELECT count(*) INTO v_active
      FROM public.mbg_ride_offers WHERE ride_id = v_ride.id AND status = 'active';

      -- Riders already offered this ride (answered, ran out, or still holding it)
      -- never get it twice; declined_rider_ids carries any riders ruled out up front.
      v_offered := COALESCE((SELECT array_agg(o.rider_id) FROM public.mbg_ride_offers o WHERE o.ride_id = v_ride.id), ARRAY[]::UUID[])
                   || COALESCE(v_ride.declined_rider_ids, ARRAY[]::UUID[]);

      -- Also skip anyone who is mid-decision on a DIFFERENT request — an open
      -- offer on another shared ride, or a pending ride handed to them directly —
      -- mirrors mbg_request_ride's own stacking guard
      -- (FIX_PREVENT_STALE_PENDING_RIDE_OFFERS.sql).
      v_busy := COALESCE((
        SELECT array_agg(DISTINCT b.rider_id) FROM (
          SELECT o.rider_id FROM public.mbg_ride_offers o
          WHERE o.status = 'active' AND o.ride_id <> v_ride.id
          UNION
          SELECT r2.rider_id FROM public.mbg_rides r2
          WHERE r2.status = 'pending' AND r2.dispatch_mode <> 'auto' AND r2.rider_id IS NOT NULL AND r2.id <> v_ride.id
        ) b
      ), ARRAY[]::UUID[]);

      -- Hard cap so a rider-dense area can't ring dozens of people for one request.
      IF v_ride.dispatch_attempts >= v_max_offers THEN
        IF v_active = 0 THEN
          UPDATE public.mbg_rides
          SET status = 'cancelled', rider_id = NULL, updated_at = clock_timestamp()
          WHERE id = v_ride.id;
        ELSE
          UPDATE public.mbg_rides SET offer_sent_at = clock_timestamp() WHERE id = v_ride.id;
        END IF;
        v_total := v_total + 1;
        CONTINUE;
      END IF;

      SELECT far.rider_id INTO v_next_rider
      FROM public.mbg_find_available_riders(
        v_ride.pickup_lat, v_ride.pickup_lng, v_ride.dropoff_lat, v_ride.dropoff_lng,
        NULL, v_ride.power_type_requested, COALESCE(v_ride.umbrella_requested, false),
        v_offered || v_busy, 1, v_ride.dispatch_vehicle_types, v_ride.dispatch_business_profile_id,
        v_ride.cargo_weight_kg, v_ride.cargo_class, COALESCE(v_ride.delivery_bag_requested, false)
      ) AS far
      LIMIT 1;

      IF v_next_rider IS NOT NULL THEN
        PERFORM public.mbg_make_ride_offer(v_ride.id, v_next_rider);
        UPDATE public.mbg_rides
        SET offer_sent_at = clock_timestamp(),
            dispatch_attempts = dispatch_attempts + 1,
            updated_at = clock_timestamp()
        WHERE id = v_ride.id;
      ELSIF EXISTS (
        -- Nobody free RIGHT NOW — but before giving up, check against just the
        -- riders already offered (no transiently-busy riders skipped) whether
        -- anyone still qualifies at all. If so they're only busy with something
        -- else for the moment, so keep the request open and look again soon.
        SELECT 1 FROM public.mbg_find_available_riders(
          v_ride.pickup_lat, v_ride.pickup_lng, v_ride.dropoff_lat, v_ride.dropoff_lng,
          NULL, v_ride.power_type_requested, COALESCE(v_ride.umbrella_requested, false),
          v_offered, 1, v_ride.dispatch_vehicle_types, v_ride.dispatch_business_profile_id,
          v_ride.cargo_weight_kg, v_ride.cargo_class, COALESCE(v_ride.delivery_bag_requested, false)
        )
      ) THEN
        IF v_active > 0 THEN
          UPDATE public.mbg_rides SET offer_sent_at = clock_timestamp() WHERE id = v_ride.id;
        END IF;
      ELSIF v_active = 0 THEN
        -- Everyone has been asked and no offer is left open: nobody took it.
        UPDATE public.mbg_rides
        SET status = 'cancelled', rider_id = NULL, updated_at = clock_timestamp()
        WHERE id = v_ride.id;
      ELSE
        -- Everyone has been asked; wait for the offers still open to run out.
        UPDATE public.mbg_rides SET offer_sent_at = clock_timestamp() WHERE id = v_ride.id;
      END IF;

      v_total := v_total + 1;
    END LOOP;

    -- Release this tick's row locks now, before sleeping, so a rider's own
    -- "Accept" (which locks the same ride row) is never held up.
    COMMIT;

    EXIT WHEN clock_timestamp() + make_interval(secs => v_tick_seconds) >= v_run_until;
    PERFORM pg_sleep(v_tick_seconds);
  END LOOP;

  -- Housekeeping: keep every mbg-* cron job's run history bounded regardless
  -- of how often each fires — this project is watching Supabase Free Plan
  -- storage growth.
  DELETE FROM cron.job_run_details
  WHERE end_time < now() - interval '2 days'
    AND jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'mbg-%');
  COMMIT;

  RAISE NOTICE 'mbg_sweep_auto_dispatch_cascade: % request(s) advanced or cancelled this run', v_total;
END;
$$;
-- Cron/service use only: it has no per-user check, so nobody else gets to call it.
REVOKE ALL ON PROCEDURE public.mbg_sweep_auto_dispatch_cascade FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON PROCEDURE public.mbg_sweep_auto_dispatch_cascade TO service_role;


NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Delivery bag ready — riders can say they carry one, customers can require one for a delivery.';
END $$;
