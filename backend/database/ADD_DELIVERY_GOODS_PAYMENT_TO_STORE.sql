-- ============================================================================
-- Actually pay the store for a Bodagoera/Supermarkera store delivery.
--
-- ADD_DELIVERY_ACCEPTANCE_WALLET_CHARGE_AND_QR_RECEIPT.sql only ever charged
-- the customer the RIDE FARE (the transport fee that funds rider_earning +
-- chairperson commissions, same as a plain passenger ride) — store_owner_id
-- was stored on the QR receipt purely as display metadata. No money ever
-- moved to the store's business wallet, and no ican_coin_transactions row
-- documented a store sale. Root cause: mbg_rides never had a "cost of
-- goods" concept — order_notes is freeform text ("1x SHEA BUTTER..."),
-- never priced.
--
-- The priced-catalog UI already exists: ProductPicker.tsx (real
-- public.products/public.inventory data) already renders inside
-- EnhancedRideRequest.tsx for delivery_mode='supermarket' and already
-- collects a priced cart client-side — it just got flattened to a plain
-- notes string right before being sent to mbg_request_ride. This file wires
-- that structured cart all the way through:
--
--   1. mbg_request_ride gains p_cart JSONB ({product_id, quantity}[]),
--      required + lightly validated for delivery_mode='supermarket',
--      stored raw on the new mbg_rides.cart column. Fare computation is
--      untouched.
--   2. mbg_respond_to_ride's existing store-delivery accept branch (see
--      ADD_DELIVERY_ACCEPTANCE_WALLET_CHARGE_AND_QR_RECEIPT.sql) gains a
--      SEPARATE goods-payment leg: live price/stock re-check per cart line
--      (same shape as dropship_checkout's own re-check loop), stock
--      deduction, a customer wallet debit + ican_coin_transactions row, and
--      a credit to the store's REAL business wallet via
--      ican_settle_business_wallet_income(..., 'pos_sale', ...) — the exact
--      call dropship_checkout already uses for its own wholesale leg. This
--      is entirely separate from the fare leg, which still pays the
--      rider/chairpersons exactly as before.
--
-- Also folds in the "reject a second pending offer to the same rider" guard
-- that FIX_PREVENT_STALE_PENDING_RIDE_OFFERS.sql (uncommitted, on disk)
-- accidentally wrote against a STALE 13-arg mbg_request_ride signature
-- (missing p_payment_method, which ADD_RIDE_PAYMENT_METHOD_AND_COMMISSION.sql
-- added back on 2026-08-03 and which the frontend actually calls with) —
-- Postgres overloads by full signature, so that file's CREATE OR REPLACE
-- would have created a second, never-called function and silently never
-- protected real traffic. This file DROPs both possible existing overloads
-- and defines the one true 15-arg version.
--
-- No changes needed to dropship_checkout — it already pays the store
-- correctly (wholesale + tax to pichin_business_profile_id).
--
-- Run after ADD_DELIVERY_ACCEPTANCE_WALLET_CHARGE_AND_QR_RECEIPT.sql.
-- Do NOT separately run FIX_PREVENT_STALE_PENDING_RIDE_OFFERS.sql's
-- mbg_request_ride redefinition after this file — it would recreate the
-- stale orphaned overload this file just cleaned up. Its pg_cron sweep
-- (mbg_expire_stale_pending_ride_offers) is independent and fine either way.
-- ============================================================================

ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS cart             JSONB,
  ADD COLUMN IF NOT EXISTS goods_amount_ugx NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS goods_snapshot   JSONB;

-- ----------------------------------------------------------------------------
-- mbg_request_ride — drop every known overload, then define the one true
-- version (14-arg real signature + p_cart).
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT
);
DROP FUNCTION IF EXISTS public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT
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
  p_cart JSONB DEFAULT NULL
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

  -- Store deliveries must come with a real, priced cart now — no more
  -- freeform "1x whatever" notes standing in for something the store can
  -- actually be paid for. Only a light structural check here (product
  -- exists, belongs to this store, is active, quantity is positive) — the
  -- authoritative price/stock check happens once, live, at acceptance.
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
  -- Don't stack a second offer on a rider who hasn't answered the last one
  -- yet — that's what silently piled up 'pending' rows on the same driver
  -- and broke their own requests screen.
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

  -- Rider's own vehicle type decides the commission model, not whether a
  -- stage happens to be assigned (a stage is always assigned below for
  -- every ride, car/van/truck included — only boda-style vehicles are
  -- actually under a chairperson's supervision in practice).
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
    order_notes, payment_method, cart
  ) VALUES (
    v_customer_id, p_rider_id, v_stage_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(v_distance_km / 25 * 60)), v_fare,
    p_service_type, p_delivery_mode, p_supermarket_id,
    p_power_type_requested, COALESCE(p_umbrella_requested, false),
    v_multiplier, v_rider_earning, v_chair_total,
    p_order_notes, p_payment_method, p_cart
  ) RETURNING id INTO v_ride_id;

  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx) VALUES (v_ride_id, v_platform_fee);

  RETURN jsonb_build_object(
    'success', true, 'ride_id', v_ride_id, 'fare', v_fare,
    'distance_km', v_distance_km, 'rider_earning', v_rider_earning
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, JSONB
) TO authenticated;

-- ----------------------------------------------------------------------------
-- mbg_respond_to_ride — add the goods-payment leg to the existing store-
-- delivery accept branch. Signature is unchanged, plain CREATE OR REPLACE.
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
  v_line_total_ugx NUMERIC;
  v_goods_ugx NUMERIC := 0;
  v_goods_ican NUMERIC := 0;
  v_goods_snapshot JSONB := '[]'::JSONB;
  v_item_summary TEXT;
  v_tx_record_id TEXT;
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
      -- ── Store delivery: settle with the store's wallet guaranteed BEFORE
      -- the rider is dispatched, same wallet-first principle used
      -- throughout this flow. Two SEPARATE legs: the goods themselves (paid
      -- to the store) and the ride fare (paid to the rider/chairpersons,
      -- unchanged). Everything below is validated BEFORE any write, so a
      -- failure never needs a compensating refund. ─────────────────────────
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

      v_wallet_surcharge_pct := public.mbg_get_setting_numeric('commission.wallet_customer_surcharge_percentage', 7);
      v_fare_ican := ROUND(v_ride.fare / ICAN_TO_UGX, 8);
      v_customer_charge_ican := ROUND(v_fare_ican * (1 + v_wallet_surcharge_pct / 100), 8);

      -- ── Goods leg: live price/stock re-check per cart line (same shape
      -- dropship_checkout already uses for its own re-check), only if this
      -- ride actually has one (older in-flight rides from before this cart
      -- column existed have none — they just skip straight to the fare
      -- debit below, exactly as before). ──────────────────────────────────
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

          -- Locks the inventory row (not just reads it) so a concurrent
          -- accept on the same product can't oversell — same pattern
          -- dropship_checkout already uses for its own stock check.
          IF NOT EXISTS (
            SELECT 1 FROM public.inventory inv
            WHERE inv.product_id = (v_cart_item->>'product_id')::UUID
              AND inv.supermarket_id = v_ride.supermarket_id
              AND GREATEST(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0) >= v_cart_qty
            FOR UPDATE
          ) THEN
            RETURN jsonb_build_object('success', false, 'error', format('%s is out of stock', v_product.name));
          END IF;

          v_line_total_ugx := ROUND(v_product.selling_price * v_cart_qty * (1 + COALESCE(v_product.tax_rate, 0) / 100), 2);
          v_goods_ugx := v_goods_ugx + v_line_total_ugx;
          v_goods_snapshot := v_goods_snapshot || jsonb_build_object(
            'product_id', v_cart_item->>'product_id', 'product_name', v_product.name,
            'quantity', v_cart_qty, 'unit_price', v_product.selling_price, 'line_total', v_line_total_ugx
          );
        END LOOP;

        v_goods_ican := ROUND(v_goods_ugx / ICAN_TO_UGX, 8);
      END IF;

      -- ── One balance check covering BOTH legs, before touching anything.
      SELECT ican_balance INTO v_wallet_balance FROM public.ican_user_wallets WHERE user_id = v_customer_user_id FOR UPDATE;
      IF v_wallet_balance IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Customer wallet not found');
      END IF;
      IF v_wallet_balance < v_customer_charge_ican + v_goods_ican THEN
        RETURN jsonb_build_object('success', false, 'error', 'Insufficient ICAN balance for this order');
      END IF;

      -- ── Commit the goods leg: deduct stock, debit customer, credit the
      -- store's REAL business wallet — the same settlement entrypoint
      -- dropship_checkout uses for its wholesale leg. ─────────────────────
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
           v_goods_ugx, 'UGX', v_store.store_name, 'business', 'business_expense',
           'mybodaguy', v_tx_record_id || '_GOODS',
           format('Bodagoera delivery order from %s', v_store.store_name),
           v_store.pichin_business_profile_id);

        PERFORM public.ican_settle_business_wallet_income(
          v_store.pichin_business_profile_id, v_goods_ican, 'mybodaguy', v_tx_record_id || '_GOODS', 'pos_sale',
          'Bodagoera delivery order',
          jsonb_build_object('ride_id', p_ride_id)
        );
      END IF;

      -- ── Fare leg: unchanged — pays the rider/chairpersons at completion,
      -- exactly as before. Guaranteed to succeed: balance already covers
      -- fare + goods combined, and the wallet row has stayed locked since
      -- the check above so nothing could have changed it in between. ──────
      v_debit := public.mbg_debit_journey_fare(v_customer_user_id, v_customer_charge_ican, 'mybodaguy', p_ride_id::TEXT);
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
        v_store.store_name, v_item_summary, v_customer_charge_ican + v_goods_ican
      );

      RETURN jsonb_build_object(
        'success', true, 'status', 'accepted',
        'verification_code', v_receipt ->> 'verification_code',
        'verify_url', v_receipt ->> 'verify_url'
      );
    END IF;

    -- Plain ride / general delivery / cargo delivery — unchanged.
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
GRANT EXECUTE ON FUNCTION public.mbg_respond_to_ride TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Store deliveries now pay the store''s real business wallet for the goods themselves (separate from the ride fare), with a proper ican_coin_transactions record — mbg_request_ride requires a real priced cart for delivery_mode=supermarket, and the stray duplicate mbg_request_ride overload has been cleaned up.';
END $$;
