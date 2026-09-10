-- ============================================================================
-- A store delivery's two wallet debits (goods leg + ride-fare leg) landed in
-- DIFFERENT sides of the customer's own ICANera Wallet "Personal / Business"
-- split: the goods leg was hardcoded expense_classification='business_expense'
-- (tagged to the store), while the fare leg never set it at all and fell
-- back to the column's own 'person_transfer' default — so ONE delivery order
-- showed up as both a Business AND a Personal transaction, with no way for
-- the customer to say which it actually was.
--
-- Lets the customer choose once, per delivery request ('personal_expense' or
-- 'business_expense'), and applies that same choice to every wallet debit
-- the order produces:
--   - supermarket delivery: both the goods leg and the fare leg
--     (mbg_respond_to_ride, at acceptance)
--   - normal delivery: the single fare-at-completion debit
--     (mbg_complete_ride's wallet branch)
-- Ride bookings are untouched — this only applies when service_type='delivery'.
--
-- Requires ICAN/backend/ADD_JOURNEY_FARE_EXPENSE_CLASSIFICATION.sql to have
-- been run first (mbg_debit_journey_fare's new p_expense_classification
-- param). Run after ADD_AUTO_SETTLE_CASH_COMMISSION.sql and
-- FIX_GOODS_SNAPSHOT_TAX_INCLUSIVE_PRICE.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1 — SCHEMA
-- ----------------------------------------------------------------------------

ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS expense_classification TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'mbg_rides' AND c.contype = 'c'
      AND conname = 'mbg_rides_expense_classification_check'
  ) THEN
    ALTER TABLE public.mbg_rides
      ADD CONSTRAINT mbg_rides_expense_classification_check
      CHECK (expense_classification IS NULL OR expense_classification IN ('personal_expense', 'business_expense'));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 2 — mbg_request_ride: one new trailing DEFAULT NULL param. Not
-- strictly required (unlike p_max_delivery_hours) — the frontend makes the
-- picker mandatory for a delivery, but the backend degrades gracefully to
-- 'personal_expense' rather than hard-failing, so mbg_request_company_ride
-- and any other caller that doesn't yet pass it keep working unchanged.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, JSONB, NUMERIC
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
  p_expense_classification TEXT DEFAULT NULL
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
    order_notes, payment_method, cart, max_delivery_hours, expense_classification
  ) VALUES (
    v_customer_id, p_rider_id, v_stage_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(v_distance_km / 25 * 60)), v_fare,
    p_service_type, p_delivery_mode, p_supermarket_id,
    p_power_type_requested, COALESCE(p_umbrella_requested, false),
    v_multiplier, v_rider_earning, v_chair_total,
    p_order_notes, p_payment_method, p_cart, p_max_delivery_hours, v_expense_classification
  ) RETURNING id INTO v_ride_id;

  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx) VALUES (v_ride_id, v_platform_fee);

  RETURN jsonb_build_object(
    'success', true, 'ride_id', v_ride_id, 'fare', v_fare,
    'distance_km', v_distance_km, 'rider_earning', v_rider_earning
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, JSONB, NUMERIC, TEXT
) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_request_ride now takes the customer''s Personal/Business choice for a delivery (mbg_rides.expense_classification), applied consistently to every wallet debit that order produces.';
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 3 — mbg_respond_to_ride: the store-delivery (supermarket) path tags
-- BOTH the goods leg and the fare leg with the customer's own choice instead
-- of hardcoding the goods leg to 'business_expense'. Signature unchanged from
-- FIX_GOODS_SNAPSHOT_TAX_INCLUSIVE_PRICE.sql — plain CREATE OR REPLACE.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_respond_to_ride(p_ride_id UUID, p_accept BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_rider_id UUID;
  v_customer_user_id UUID;
  v_store RECORD;
  v_wallet_surcharge_pct NUMERIC;
  v_fare_ican NUMERIC;
  v_customer_charge_ican NUMERIC;
  v_debit JSONB;
  v_receipt JSONB;
  v_wallet_balance NUMERIC;
  v_cart_item JSONB;
  v_cart_qty NUMERIC;
  v_product RECORD;
  v_unit_price_incl_ugx NUMERIC;
  v_line_total_ugx NUMERIC;
  v_goods_ugx NUMERIC := 0;
  v_goods_ican NUMERIC := 0;
  v_goods_snapshot JSONB := '[]'::JSONB;
  v_settlement_legs JSONB := '[]'::JSONB;
  v_item_summary TEXT;
  v_tx_record_id TEXT;
  v_expense_classification TEXT;
  ICAN_TO_UGX CONSTANT NUMERIC := 5000;
BEGIN
  SELECT id INTO v_rider_id FROM public.mbg_riders WHERE user_id = auth.uid();
  IF v_rider_id IS NULL THEN
    RAISE EXCEPTION 'No rider profile for current user';
  END IF;

  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.rider_id IS DISTINCT FROM v_rider_id THEN
    RAISE EXCEPTION 'This ride was not offered to you';
  END IF;
  IF v_ride.status <> 'pending' THEN
    RAISE EXCEPTION 'This offer is no longer pending';
  END IF;

  IF p_accept THEN
    IF v_ride.service_type = 'delivery' AND v_ride.delivery_mode = 'supermarket' AND v_ride.supermarket_id IS NOT NULL THEN
      -- ── Store delivery: guarantee the money BEFORE the rider is
      -- dispatched, same wallet-first principle as before. The fare leg is
      -- still paid to the rider/chairpersons as before. The goods leg is
      -- now debited from the customer here but only RELEASED to the store's
      -- business wallet once icanera_confirm_pickup proves the goods left
      -- the store (see SECTION 3 above). ────────────────────────────────────
      IF v_ride.payment_method <> 'wallet' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Store deliveries must be paid by ICAN wallet so the store is guaranteed payment before releasing the order');
      END IF;

      SELECT user_id INTO v_customer_user_id FROM public.mbg_customers WHERE id = v_ride.customer_id;
      IF v_customer_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Customer wallet not found');
      END IF;

      SELECT owner_user_id, COALESCE(NULLIF(name, ''), NULLIF(location, ''), 'Store') AS store_name, pichin_business_profile_id
      INTO v_store
      FROM public.supermarkets WHERE id = v_ride.supermarket_id;

      IF v_store.owner_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This store has no payment account configured');
      END IF;

      -- The customer's own choice at request time — never re-derived from
      -- the store or anything else, so both legs below always agree.
      v_expense_classification := COALESCE(v_ride.expense_classification, 'personal_expense');

      v_wallet_surcharge_pct := public.mbg_get_setting_numeric('commission.wallet_customer_surcharge_percentage', 7);
      v_fare_ican := ROUND(v_ride.fare / ICAN_TO_UGX, 8);
      v_customer_charge_ican := ROUND(v_fare_ican * (1 + v_wallet_surcharge_pct / 100), 8);

      IF v_ride.cart IS NOT NULL AND jsonb_array_length(v_ride.cart) > 0 THEN
        IF v_store.pichin_business_profile_id IS NULL THEN
          RETURN jsonb_build_object('success', false, 'error', 'This store has no business wallet configured for delivery settlement');
        END IF;

        FOR v_cart_item IN SELECT * FROM jsonb_array_elements(v_ride.cart) LOOP
          v_cart_qty := (v_cart_item->>'quantity')::NUMERIC;

          SELECT name, selling_price, tax_rate, is_active
          INTO v_product
          FROM public.products
          WHERE id = (v_cart_item->>'product_id')::UUID AND supermarket_id = v_ride.supermarket_id;

          IF NOT FOUND OR v_product.is_active IS FALSE THEN
            RETURN jsonb_build_object('success', false, 'error', format('%s is no longer available at this store', COALESCE(v_product.name, 'An item')));
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM public.inventory inv
            WHERE inv.product_id = (v_cart_item->>'product_id')::UUID
              AND inv.supermarket_id = v_ride.supermarket_id
              AND GREATEST(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0) >= v_cart_qty
            FOR UPDATE
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', format('%s is out of stock', v_product.name));
          END IF;

          -- Tax is always folded into the price the customer sees, never
          -- added silently after the fact — unit_price here already
          -- includes it, so unit_price × quantity = line_total exactly.
          v_unit_price_incl_ugx := ROUND(v_product.selling_price * (1 + COALESCE(v_product.tax_rate, 0) / 100), 2);
          v_line_total_ugx := ROUND(v_unit_price_incl_ugx * v_cart_qty, 2);
          v_goods_ugx := v_goods_ugx + v_line_total_ugx;
          v_goods_snapshot := v_goods_snapshot || jsonb_build_object(
            'product_id', v_cart_item->>'product_id', 'product_name', v_product.name,
            'quantity', v_cart_qty, 'unit_price', v_unit_price_incl_ugx, 'line_total', v_line_total_ugx
          );
        END LOOP;

        v_goods_ican := ROUND(v_goods_ugx / ICAN_TO_UGX, 8);
      END IF;

      SELECT ican_balance INTO v_wallet_balance FROM public.ican_user_wallets WHERE user_id = v_customer_user_id FOR UPDATE;
      IF v_wallet_balance IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Customer wallet not found');
      END IF;
      IF v_wallet_balance < v_customer_charge_ican + v_goods_ican THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient ICAN balance for this order');
      END IF;

      -- ── Goods leg: deduct stock and debit the customer now (funds
      -- guaranteed), but DO NOT credit the store yet — that instruction is
      -- carried on the receipt as an unsettled leg, released on seal scan. ──
      IF v_goods_ican > 0 THEN
        v_tx_record_id := 'MBGDLV_' || p_ride_id::TEXT;

        FOR v_cart_item IN SELECT * FROM jsonb_array_elements(v_ride.cart) LOOP
          UPDATE public.inventory
          SET current_stock = current_stock - (v_cart_item->>'quantity')::NUMERIC, updated_at = now()
          WHERE product_id = (v_cart_item->>'product_id')::UUID AND supermarket_id = v_ride.supermarket_id;
        END LOOP;

        UPDATE public.ican_user_wallets
        SET ican_balance = ican_balance - v_goods_ican, total_spent = total_spent + v_goods_ican
        WHERE user_id = v_customer_user_id;

        INSERT INTO public.ican_coin_transactions
          (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
           merchant_name, counterparty_type, expense_classification, source_app, reference_id, note, business_profile_id)
        VALUES
          (v_customer_user_id, v_goods_ican, 'transfer_out', 'transfer_out', 'completed',
           v_goods_ugx, 'UGX', v_store.store_name, 'business', v_expense_classification,
           'mybodaguy', v_tx_record_id || '_GOODS',
           format('Bodagoera delivery order from %s (held until dispatch is confirmed)', v_store.store_name),
           v_store.pichin_business_profile_id);

        v_settlement_legs := jsonb_build_array(jsonb_build_object(
          'payee_type', 'business',
          'payee_id', v_store.pichin_business_profile_id,
          'ican_amount', v_goods_ican,
          'ugx_amount', v_goods_ugx,
          'note', 'Bodagoera delivery order'
        ));
      END IF;

      v_debit := public.mbg_debit_journey_fare(v_customer_user_id, v_customer_charge_ican, 'mybodaguy', p_ride_id::TEXT, v_expense_classification);
      IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
        RETURN jsonb_build_object('success', false, 'error', COALESCE(v_debit ->> 'error', 'Wallet payment failed'));
      END IF;

      v_item_summary := COALESCE((
        SELECT string_agg((line->>'quantity') || 'x ' || (line->>'product_name'), ', ')
        FROM jsonb_array_elements(v_goods_snapshot) line
      ), v_ride.order_notes);

      UPDATE public.mbg_rides SET
        status = 'accepted', accepted_at = now(), updated_at = now(),
        wallet_charged_at_acceptance = true,
        goods_amount_ugx = v_goods_ugx, goods_snapshot = v_goods_snapshot
      WHERE id = p_ride_id;

      INSERT INTO public.mbg_payments (ride_id, customer_id, rider_id, amount, status)
      VALUES (p_ride_id, v_ride.customer_id, v_rider_id, v_ride.fare, 'pending');

      UPDATE public.mbg_riders SET is_available = false, updated_at = now() WHERE id = v_rider_id;

      v_receipt := public.icanera_create_delivery_receipt(
        'mybodaguy', 'mbg_ride', p_ride_id,
        v_customer_user_id, v_store.owner_user_id, auth.uid(),
        v_store.store_name, v_item_summary, v_customer_charge_ican + v_goods_ican,
        v_goods_snapshot, v_settlement_legs, v_ride.max_delivery_hours
      );

      RETURN jsonb_build_object(
        'success', true, 'status', 'accepted',
        'verification_code', v_receipt ->> 'verification_code',
        'verify_url', v_receipt ->> 'verify_url'
      );
    END IF;

    UPDATE public.mbg_rides SET status = 'accepted', accepted_at = now(), updated_at = now() WHERE id = p_ride_id;

    INSERT INTO public.mbg_payments (ride_id, customer_id, rider_id, amount, status)
    VALUES (p_ride_id, v_ride.customer_id, v_rider_id, v_ride.fare, 'pending');

    UPDATE public.mbg_riders SET is_available = false, updated_at = now() WHERE id = v_rider_id;

    RETURN jsonb_build_object('success', true, 'status', 'accepted');
  ELSE
    UPDATE public.mbg_rides SET rider_id = NULL, updated_at = now() WHERE id = p_ride_id;
    RETURN jsonb_build_object('success', true, 'status', 'declined');
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_respond_to_ride(UUID, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_respond_to_ride now tags both the goods leg and the fare leg of a store delivery with the customer''s own Personal/Business choice, instead of hardcoding the goods leg to business.';
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 4 — mbg_complete_ride: the wallet-paid fare debit (normal delivery
-- or a ride) now carries the customer's delivery classification too, but
-- ONLY for deliveries — ride bookings are untouched (NULL, same as before).
-- Signature unchanged from ADD_AUTO_SETTLE_CASH_COMMISSION.sql — plain
-- CREATE OR REPLACE.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_complete_ride(p_ride_id UUID, p_payment_method TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_rider_id UUID;
  v_rider_user_id UUID;
  v_rider_vehicle_type TEXT;
  v_is_boda BOOLEAN;
  v_customer_user_id UUID;
  v_payment_id UUID;
  v_region RECORD;
  v_level RECORD;
  v_chair_user_id UUID;
  v_pct NUMERIC;
  v_amount_ugx NUMERIC;
  v_amount_ican NUMERIC;
  v_fare_ican NUMERIC;
  v_wallet_surcharge_pct NUMERIC := public.mbg_get_setting_numeric('commission.wallet_customer_surcharge_percentage', 7);
  v_customer_charge_ican NUMERIC;
  v_rider_credit_ican NUMERIC;
  v_debit JSONB;
  v_commission_due_ugx NUMERIC := 0;
  v_debt_ugx NUMERIC;
  v_debt_ican NUMERIC;
  v_recovered_ican NUMERIC;
  v_actual_method TEXT;
  ICAN_TO_UGX CONSTANT NUMERIC := 5000;
BEGIN
  SELECT id, user_id, vehicle_type::TEXT INTO v_rider_id, v_rider_user_id, v_rider_vehicle_type
  FROM public.mbg_riders WHERE user_id = auth.uid();
  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id AND rider_id = v_rider_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found or not yours';
  END IF;
  IF v_ride.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Ride must be in progress to complete';
  END IF;

  v_actual_method := lower(COALESCE(p_payment_method, v_ride.payment_method));
  IF v_ride.wallet_charged_at_acceptance THEN
    v_actual_method := 'wallet';
  END IF;
  IF v_actual_method NOT IN ('cash', 'wallet') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment method must be cash or wallet');
  END IF;

  v_is_boda := v_rider_vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk');
  SELECT user_id INTO v_customer_user_id FROM public.mbg_customers WHERE id = v_ride.customer_id;

  IF v_actual_method = 'wallet' THEN
    v_fare_ican := ROUND(v_ride.fare / ICAN_TO_UGX, 8);

    IF NOT v_ride.wallet_charged_at_acceptance THEN
      v_customer_charge_ican := ROUND(v_fare_ican * (1 + v_wallet_surcharge_pct / 100), 8);
      v_debit := public.mbg_debit_journey_fare(
        v_customer_user_id, v_customer_charge_ican, 'mybodaguy', p_ride_id::TEXT,
        CASE WHEN v_ride.service_type = 'delivery' THEN COALESCE(v_ride.expense_classification, 'personal_expense') ELSE NULL END
      );

      IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', COALESCE(v_debit ->> 'error', 'Wallet payment failed'),
          'payment_method_attempted', 'wallet'
        );
      END IF;
    END IF;
  END IF;

  UPDATE public.mbg_rides SET
    status = 'completed', payment_method = v_actual_method, completed_at = now(), updated_at = now()
  WHERE id = p_ride_id;

  UPDATE public.mbg_payments SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE ride_id = p_ride_id RETURNING id INTO v_payment_id;

  UPDATE public.mbg_customers SET
    total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
  WHERE id = v_ride.customer_id;

  PERFORM set_config('mbg.trusted_write', 'true', true);

  IF v_actual_method = 'wallet' THEN
    v_rider_credit_ican := ROUND(v_fare_ican * v_ride.rider_earning / NULLIF(v_ride.fare, 0), 8);

    -- Recover any outstanding cash-commission debt first...
    SELECT cash_commission_debt_ugx INTO v_debt_ugx FROM public.mbg_riders WHERE id = v_rider_id;
    IF v_debt_ugx > 0 THEN
      v_debt_ican := ROUND(v_debt_ugx / ICAN_TO_UGX, 8);
      v_recovered_ican := LEAST(v_rider_credit_ican, v_debt_ican);
      IF v_recovered_ican > 0 THEN
        v_rider_credit_ican := v_rider_credit_ican - v_recovered_ican;
        UPDATE public.mbg_riders
        SET cash_commission_debt_ugx = GREATEST(0, cash_commission_debt_ugx - ROUND(v_recovered_ican * ICAN_TO_UGX))
        WHERE id = v_rider_id;
      END IF;
    END IF;

    -- ...then any outstanding delivery-liability debt (refunds this rider
    -- caused by missing a delivery deadline) the same way, out of whatever
    -- credit is left.
    SELECT delivery_liability_debt_ugx INTO v_debt_ugx FROM public.mbg_riders WHERE id = v_rider_id;
    IF v_debt_ugx > 0 THEN
      v_debt_ican := ROUND(v_debt_ugx / ICAN_TO_UGX, 8);
      v_recovered_ican := LEAST(v_rider_credit_ican, v_debt_ican);
      IF v_recovered_ican > 0 THEN
        v_rider_credit_ican := v_rider_credit_ican - v_recovered_ican;
        UPDATE public.mbg_riders
        SET delivery_liability_debt_ugx = GREATEST(0, delivery_liability_debt_ugx - ROUND(v_recovered_ican * ICAN_TO_UGX))
        WHERE id = v_rider_id;
      END IF;
    END IF;

    IF v_rider_credit_ican > 0 THEN
      PERFORM public.mbg_credit_ride_earning(v_rider_user_id, v_rider_credit_ican, 'mybodaguy', p_ride_id::TEXT, 'Ride earning');
    END IF;

    IF v_is_boda AND v_payment_id IS NOT NULL THEN
      SELECT s.parish_id AS parish_id, p.subcounty_id AS subcounty_id, sc.division_id AS division_id, dv.district_id AS district_id
      INTO v_region
      FROM public.mbg_stages s
      JOIN public.mbg_parishes p ON p.id = s.parish_id
      JOIN public.mbg_subcounties sc ON sc.id = p.subcounty_id
      JOIN public.mbg_divisions dv ON dv.id = sc.division_id
      WHERE s.id = v_ride.stage_id;

      IF FOUND THEN
        FOR v_level IN
          SELECT * FROM (VALUES
            ('stage'::public.mbg_region_type,     v_ride.stage_id,        'commission.stage_chair_percentage'),
            ('parish'::public.mbg_region_type,    v_region.parish_id,     'commission.parish_chair_percentage'),
            ('subcounty'::public.mbg_region_type, v_region.subcounty_id,  'commission.subcounty_chair_percentage'),
            ('division'::public.mbg_region_type,  v_region.division_id,  'commission.division_chair_percentage'),
            ('district'::public.mbg_region_type,  v_region.district_id,  'commission.district_chair_percentage')
          ) AS t(region_type, region_id, setting_key)
        LOOP
          v_pct := public.mbg_get_setting_numeric(v_level.setting_key, 0);
          v_amount_ugx := ROUND(v_ride.fare * v_pct / 100);
          v_amount_ican := ROUND(v_fare_ican * v_pct / 100, 8);

          SELECT cm.user_id INTO v_chair_user_id
          FROM public.mbg_committee_members cm
          WHERE cm.region_type = v_level.region_type AND cm.region_id = v_level.region_id AND cm.is_active = true
          ORDER BY cm.appointed_at ASC LIMIT 1;

          IF v_chair_user_id IS NOT NULL AND v_amount_ugx > 0 THEN
            PERFORM public.mbg_credit_ride_earning(v_chair_user_id, v_amount_ican, 'mybodaguy', p_ride_id::TEXT, v_level.region_type::TEXT || ' chairperson commission');
            INSERT INTO public.mbg_commissions (
              ride_id, payment_id, recipient_id, recipient_role, region_type, region_id,
              ride_fare, commission_percentage, commission_amount, status, paid_at
            ) VALUES (
              p_ride_id, v_payment_id, v_chair_user_id, v_level.region_type::TEXT || '_chairperson',
              v_level.region_type, v_level.region_id,
              v_ride.fare, v_pct, v_amount_ugx, 'paid', now()
            );
          END IF;
        END LOOP;
      END IF;
    END IF;

    UPDATE public.mbg_riders SET
      is_available = true, total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
    WHERE id = v_rider_id;

  ELSE
    -- Cash: the rider keeps the full fare physically. Settlement of what
    -- they owe happens right here, automatically — no "confirm you were
    -- paid" prompt and no offline gate. The chairperson (boda only) is
    -- paid immediately out of the platform's float, exactly like the
    -- wallet branch above, and the rider's share of that commission is
    -- recorded as a running debt (mbg_riders.cash_commission_debt_ugx),
    -- silently recovered from their next wallet-paid ride credit.
    v_commission_due_ugx := v_ride.fare - v_ride.rider_earning;

    IF v_is_boda AND v_payment_id IS NOT NULL THEN
      SELECT s.parish_id AS parish_id, p.subcounty_id AS subcounty_id, sc.division_id AS division_id, dv.district_id AS district_id
      INTO v_region
      FROM public.mbg_stages s
      JOIN public.mbg_parishes p ON p.id = s.parish_id
      JOIN public.mbg_subcounties sc ON sc.id = p.subcounty_id
      JOIN public.mbg_divisions dv ON dv.id = sc.division_id
      WHERE s.id = v_ride.stage_id;

      IF FOUND THEN
        FOR v_level IN
          SELECT * FROM (VALUES
            ('stage'::public.mbg_region_type,     v_ride.stage_id,        'commission.stage_chair_percentage'),
            ('parish'::public.mbg_region_type,    v_region.parish_id,     'commission.parish_chair_percentage'),
            ('subcounty'::public.mbg_region_type, v_region.subcounty_id,  'commission.subcounty_chair_percentage'),
            ('division'::public.mbg_region_type,  v_region.division_id,  'commission.division_chair_percentage'),
            ('district'::public.mbg_region_type,  v_region.district_id,  'commission.district_chair_percentage')
          ) AS t(region_type, region_id, setting_key)
        LOOP
          v_pct := public.mbg_get_setting_numeric(v_level.setting_key, 0);
          v_amount_ugx := ROUND(v_ride.fare * v_pct / 100);
          v_amount_ican := ROUND(v_amount_ugx / ICAN_TO_UGX, 8);

          SELECT cm.user_id INTO v_chair_user_id
          FROM public.mbg_committee_members cm
          WHERE cm.region_type = v_level.region_type AND cm.region_id = v_level.region_id AND cm.is_active = true
          ORDER BY cm.appointed_at ASC LIMIT 1;

          IF v_chair_user_id IS NOT NULL AND v_amount_ugx > 0 THEN
            PERFORM public.mbg_credit_ride_earning(v_chair_user_id, v_amount_ican, 'mybodaguy', p_ride_id::TEXT, v_level.region_type::TEXT || ' chairperson commission (cash settlement)');
            INSERT INTO public.mbg_commissions (
              ride_id, payment_id, recipient_id, recipient_role, region_type, region_id,
              ride_fare, commission_percentage, commission_amount, status, paid_at
            ) VALUES (
              p_ride_id, v_payment_id, v_chair_user_id, v_level.region_type::TEXT || '_chairperson',
              v_level.region_type, v_level.region_id,
              v_ride.fare, v_pct, v_amount_ugx, 'paid', now()
            );
          END IF;
        END LOOP;
      END IF;
    END IF;

    UPDATE public.mbg_riders
    SET cash_commission_debt_ugx = cash_commission_debt_ugx + GREATEST(v_commission_due_ugx, 0)
    WHERE id = v_rider_id;

    UPDATE public.mbg_rides SET cash_confirmed_at = now(), updated_at = now() WHERE id = p_ride_id;

    UPDATE public.mbg_riders SET
      is_available = true, total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
    WHERE id = v_rider_id;
  END IF;

  BEGIN
    UPDATE public.icanera_delivery_receipts
    SET status = 'delivered', delivered_at = now()
    WHERE source_app = 'mybodaguy' AND reference_type = 'mbg_ride' AND reference_id = p_ride_id
      AND status IN ('paid', 'picked_up');
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'rider_earning', v_ride.rider_earning,
    'payment_method', v_actual_method,
    'commission_due_ugx', v_commission_due_ugx
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_complete_ride(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_complete_ride now tags a normal delivery''s fare-at-completion debit with the customer''s Personal/Business choice too (rides are untouched).';
END $$;
