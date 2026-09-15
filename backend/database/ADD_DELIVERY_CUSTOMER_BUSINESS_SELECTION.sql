-- ============================================================================
-- A customer can belong to more than one real business (owner of one,
-- team member of another, co-owner of a third — see business_profiles /
-- business_team_members / business_co_owners, the same three tables the
-- ICAN Wallet's PayMoneyModal.jsx already queries to build its own
-- "Choose the business for this report" picker). Marking a delivery
-- expense_classification='business_expense' (ADD_DELIVERY_EXPENSE_CLASSIFICATION.sql)
-- had no way to say WHICH of those businesses it belongs to — this adds
-- that, the same way PayMoneyModal already records it for a direct ICAN
-- payment (transfer_ican's p_business_profile_id).
--
-- Deliberately a NEW column, not a reuse of ican_coin_transactions.business_profile_id
-- — that column already carries a different meaning for a store delivery's
-- goods leg (the STORE's own pichin_business_profile_id, i.e. who got paid;
-- see ADD_DELIVERY_EXPENSE_CLASSIFICATION.sql's mbg_respond_to_ride). This
-- one instead records whose records, on the CUSTOMER's side, the order
-- should be filed under — a different question with a different answer.
--
-- Run after ADD_DELIVERY_EXPENSE_CLASSIFICATION.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1 — SCHEMA
-- ----------------------------------------------------------------------------

ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS customer_business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- SECTION 2 — mbg_request_ride: one new trailing DEFAULT NULL param, same
-- additive pattern as p_expense_classification before it. Not validated
-- against the caller's actual membership here — the frontend only ever
-- offers ids from the customer's own mbg_my_business_memberships() result,
-- and a stray/unrelated id here is harmless (just an FK to a business the
-- customer doesn't belong to, visible only to them on their own order).
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, JSONB, NUMERIC, TEXT
);

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
  p_customer_business_profile_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id UUID;
  v_rider public.mbg_riders%ROWTYPE;
  v_stage_id UUID;
  v_distance_km NUMERIC;
  v_multiplier NUMERIC := public.mbg_current_time_multiplier();
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('ride.base_fare', 1000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('ride.per_km_rate', 1000);
  v_min_fare  NUMERIC := public.mbg_get_setting_numeric('ride.minimum_fare', 2000);
  v_fare NUMERIC;
  v_is_boda BOOLEAN;
  v_platform_fee NUMERIC;
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

  -- Every wallet debit this order produces (goods leg + fare leg for a store
  -- delivery, or just the fare leg for a normal one) gets tagged with this
  -- same choice, so the whole order lands on one side of the customer's own
  -- ICANera Wallet Personal/Business split instead of being split across both.
  v_expense_classification := CASE
    WHEN p_service_type = 'delivery' THEN COALESCE(p_expense_classification, 'personal_expense')
    ELSE NULL
  END;

  -- Only meaningful (and only ever set by the frontend) alongside
  -- 'business_expense' — a personal delivery has no business to file it
  -- under, so silently drop it rather than trust an inconsistent pairing.
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

    -- The customer must choose how long they're willing to wait — this is
    -- what the seal-scan-gated escrow measures the rider against once the
    -- order actually leaves the store.
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
  IF EXISTS (SELECT 1 FROM public.mbg_rides WHERE rider_id = p_rider_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Selected rider already has a request awaiting their response — try again in a moment or pick another rider';
  END IF;

  v_distance_km := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  IF v_distance_km IS NULL THEN
    RAISE EXCEPTION 'Invalid pickup/dropoff coordinates';
  END IF;

  v_fare := GREATEST(v_min_fare, v_base_fare + v_distance_km * v_per_km) * v_multiplier;
  IF v_rider.mode = 'vip' THEN
    v_fare := v_fare * (1 + v_rider.vip_surcharge_pct / 100);
  ELSIF v_rider.mode = 'discount' THEN
    v_fare := v_fare * (1 - v_rider.discount_pct / 100);
  ELSIF v_rider.mode = 'return' THEN
    v_fare := v_fare * (1 - v_rider.return_discount_pct / 100);
  END IF;
  v_fare := ROUND(v_fare / 100) * 100;

  v_is_boda := v_rider.vehicle_type::TEXT IN ('motorcycle', 'bicycle', 'tuktuk');
  IF v_is_boda THEN
    v_chair_total   := ROUND(v_fare * public.mbg_get_setting_numeric('commission.boda_chair_total_percentage', 5) / 100);
    v_rider_earning := v_fare - v_chair_total;
    v_platform_fee  := 0;
  ELSE
    v_platform_fee  := ROUND(v_fare * public.mbg_get_setting_numeric('commission.nonboda_platform_percentage', 15) / 100);
    v_rider_earning := v_fare - v_platform_fee;
    v_chair_total   := 0;
  END IF;

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
    power_type_requested, umbrella_requested,
    time_multiplier, rider_earning, chairperson_commission_total,
    order_notes, payment_method, cart, max_delivery_hours, expense_classification,
    customer_business_profile_id
  ) VALUES (
    v_customer_id, p_rider_id, v_stage_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(v_distance_km / 25 * 60)), v_fare,
    p_service_type, p_delivery_mode, p_supermarket_id,
    p_power_type_requested, COALESCE(p_umbrella_requested, false),
    v_multiplier, v_rider_earning, v_chair_total,
    p_order_notes, p_payment_method, p_cart, p_max_delivery_hours, v_expense_classification,
    v_customer_business_profile_id
  ) RETURNING id INTO v_ride_id;

  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx) VALUES (v_ride_id, v_platform_fee);

  RETURN jsonb_build_object(
    'success', true, 'ride_id', v_ride_id, 'fare', v_fare,
    'distance_km', v_distance_km, 'rider_earning', v_rider_earning
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, JSONB, NUMERIC, TEXT, UUID
) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 3 — mbg_my_business_memberships: every real business the caller
-- belongs to (owner, active team member, or co-owner), for the delivery
-- form's business picker. Same three tables PayMoneyModal.jsx already
-- queries client-side for the exact same purpose — centralized here as one
-- RPC instead of three separate round-trips, and usable from anywhere else
-- that needs the same "which of my businesses" list later.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_my_business_memberships()
RETURNS TABLE (id UUID, business_name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT bp.id, bp.business_name
  FROM public.business_profiles bp
  WHERE bp.user_id = auth.uid()
     OR EXISTS (
       SELECT 1 FROM public.business_team_members m
       WHERE m.business_profile_id = bp.id AND m.user_id = auth.uid() AND m.status = 'active'
     )
     OR EXISTS (
       SELECT 1 FROM public.business_co_owners co
       WHERE co.business_profile_id = bp.id
         AND (co.user_id = auth.uid() OR co.owner_email = (SELECT email FROM auth.users WHERE id = auth.uid()))
     )
  ORDER BY bp.business_name;
$$;
REVOKE ALL ON FUNCTION public.mbg_my_business_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_my_business_memberships() TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_rides.customer_business_profile_id added; mbg_request_ride records which of the customer''s own businesses a delivery is filed under; mbg_my_business_memberships() lists them for the picker.';
END $$;
