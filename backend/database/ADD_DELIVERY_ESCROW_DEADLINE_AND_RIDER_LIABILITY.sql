-- ============================================================================
-- Store-delivery escrow: pay the store on the seal scan, not on acceptance —
-- plus a customer-chosen delivery deadline and rider liability if it's missed.
--
-- TODAY (ADD_DELIVERY_GOODS_PAYMENT_TO_STORE.sql): the store's business
-- wallet is credited for the goods the MOMENT a rider accepts the job —
-- before the rider has even reached the store, let alone left it with the
-- product. That's too early to call the sale "done": nothing yet proves the
-- goods actually left the store.
--
-- icanera_delivery_receipts already has exactly the right hook for this:
-- icanera_confirm_pickup (ADD_DELIVERY_RECEIPT_APPROVAL_TRACKING.sql) is the
-- store/rider physically tapping "Approve" on the QR receipt at handoff —
-- i.e. the "seal scan" proving the product is out the door. It just never
-- gated any money. This file makes it do that:
--
--   1. Customer chooses a max delivery window (hours) when requesting a
--      store delivery (mbg_request_ride gains p_max_delivery_hours,
--      required for delivery_mode='supermarket', bounded by
--      delivery.min_deadline_hours/delivery.max_deadline_hours settings).
--   2. mbg_respond_to_ride still debits the customer at ACCEPTANCE (funds
--      guaranteed up front, unchanged) but no longer credits the store's
--      business wallet there — it hands that instruction to the receipt as
--      an unsettled "settlement leg" instead (icanera_delivery_receipts
--      gains a generic settlement_legs JSONB array, so this same mechanism
--      can carry more than one payee later — see the dropship follow-up).
--   3. icanera_confirm_pickup releases every settlement leg to its business
--      wallet ONLY once the seal is scanned, and starts the delivery clock
--      at that moment (delivery_due_at = now() + chosen hours) — the clock
--      starts when the goods actually leave, not when the order was placed.
--   4. A pg_cron sweep (every 5 min) flags any store delivery that blows
--      through its deadline — that's the automatic warning to the rider.
--   5. From there a real support call to the customer is a human step this
--      codebase has no telephony integration to automate — what IS
--      automated is the guardrail around it: the refund button
--      (icanera_request_delivery_refund) only becomes callable
--      delivery.overdue_grace_minutes AFTER the warning fires, giving that
--      call time to happen and the rider one last chance to deliver. When
--      the customer taps confirm, the order's full value is pulled from the
--      RIDER (not the store — the store already proved they released the
--      goods) — first from their own ICAN wallet, any shortfall recorded as
--      a debt on mbg_riders (same recoverable-debt pattern
--      ADD_CASH_COMMISSION_DEBT_TRACKING.sql already uses for cash-ride
--      commission), recovered automatically from their next wallet-paid
--      ride earning.
--
-- Run after ADD_DELIVERY_RECEIPT_ITEM_PROOF.sql and
-- ADD_CASH_COMMISSION_DEBT_TRACKING.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1 — SCHEMA
-- ----------------------------------------------------------------------------

ALTER TABLE public.icanera_delivery_receipts
  ADD COLUMN IF NOT EXISTS settlement_legs     JSONB,
  ADD COLUMN IF NOT EXISTS settled             BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settled_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_delivery_hours  NUMERIC,
  ADD COLUMN IF NOT EXISTS delivery_due_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overdue_warned_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refunded_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refund_ican_amount  NUMERIC;

CREATE INDEX IF NOT EXISTS icanera_delivery_receipts_overdue_idx
  ON public.icanera_delivery_receipts(status, delivery_due_at) WHERE status = 'picked_up';

ALTER TABLE public.icanera_delivery_receipts DROP CONSTRAINT IF EXISTS icanera_delivery_receipts_status_check;
ALTER TABLE public.icanera_delivery_receipts
  ADD CONSTRAINT icanera_delivery_receipts_status_check
  CHECK (status IN ('paid', 'picked_up', 'delivered', 'cancelled', 'refunded'));

ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS max_delivery_hours NUMERIC;

-- mbg_rides.status is the mbg_ride_status enum ('pending','accepted',
-- 'in_progress','completed','cancelled','failed') — needs a 'refunded'
-- label for the best-effort ride sync inside icanera_request_delivery_refund
-- below. Safe outside a transaction that also reads the new value (nothing
-- here does — the value is only ever used later, inside function bodies).
ALTER TYPE public.mbg_ride_status ADD VALUE IF NOT EXISTS 'refunded';

ALTER TABLE public.mbg_riders
  ADD COLUMN IF NOT EXISTS delivery_liability_debt_ugx NUMERIC NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'mbg_riders' AND c.contype = 'c'
      AND conname = 'mbg_riders_delivery_liability_debt_non_negative'
  ) THEN
    ALTER TABLE public.mbg_riders
      ADD CONSTRAINT mbg_riders_delivery_liability_debt_non_negative CHECK (delivery_liability_debt_ugx >= 0);
  END IF;
END $$;

INSERT INTO public.mbg_platform_settings (key, value, value_type, description, category, is_public)
VALUES
  ('delivery.min_deadline_hours',   '1',  'number', 'Shortest delivery window a customer can choose for a store order', 'delivery', true),
  ('delivery.max_deadline_hours',   '48', 'number', 'Longest delivery window a customer can choose for a store order', 'delivery', true),
  ('delivery.overdue_grace_minutes','30', 'number', 'Minutes after a rider is warned before the customer can confirm a refund', 'delivery', false)
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- SECTION 2 — icanera_create_delivery_receipt: 2 new trailing DEFAULT NULL
-- params (p_settlement_legs, p_max_delivery_hours). Postgres allows extending
-- a function's parameter list this way via plain CREATE OR REPLACE as long as
-- the new parameters are trailing and defaulted (already relied on twice for
-- this exact function) — every existing caller keeps working unmodified.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.icanera_create_delivery_receipt(
  p_source_app       TEXT,
  p_reference_type   TEXT,
  p_reference_id     UUID,
  p_customer_user_id UUID,
  p_store_owner_user_id UUID,
  p_rider_user_id    UUID,
  p_store_name       TEXT,
  p_item_summary     TEXT,
  p_amount_ican      NUMERIC,
  p_goods_snapshot   JSONB DEFAULT NULL,
  p_settlement_legs  JSONB DEFAULT NULL,
  p_max_delivery_hours NUMERIC DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code TEXT;
  v_id UUID;
BEGIN
  v_code := upper(substr(md5(gen_random_uuid()::text), 1, 10));

  INSERT INTO public.icanera_delivery_receipts (
    verification_code, source_app, reference_type, reference_id,
    customer_user_id, store_owner_user_id, rider_user_id,
    store_name, item_summary, amount_ican, goods_snapshot,
    settlement_legs, max_delivery_hours
  ) VALUES (
    v_code, p_source_app, p_reference_type, p_reference_id,
    p_customer_user_id, p_store_owner_user_id, p_rider_user_id,
    p_store_name, p_item_summary, p_amount_ican, p_goods_snapshot,
    COALESCE(p_settlement_legs, '[]'::JSONB), p_max_delivery_hours
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_id,
    'verification_code', v_code,
    'verify_url', 'https://bodagoera.icanera.space/verify/' || v_code
  );
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_create_delivery_receipt(TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC, JSONB, JSONB, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_create_delivery_receipt(TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC, JSONB, JSONB, NUMERIC) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- SECTION 3 — icanera_confirm_pickup: the seal scan. Now releases every
-- escrowed settlement leg and starts the delivery clock. Signature unchanged
-- from ADD_DELIVERY_RECEIPT_APPROVAL_TRACKING.sql — same "anyone signed in
-- who has the code, one-shot, accountability via recorded email" policy,
-- untouched.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.icanera_confirm_pickup(p_verification_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt public.icanera_delivery_receipts%ROWTYPE;
  v_email TEXT;
  v_leg JSONB;
  v_leg_index INT := 0;
  v_tx_id TEXT;
  v_has_legs BOOLEAN;
  v_due_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sign in with Google to approve this pickup');
  END IF;

  SELECT * INTO v_receipt FROM public.icanera_delivery_receipts
  WHERE verification_code = upper(p_verification_code) FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Receipt not found');
  END IF;

  IF v_receipt.status <> 'paid' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', CASE
        WHEN v_receipt.status IN ('picked_up', 'delivered') THEN
          'Already approved by ' || COALESCE(v_receipt.picked_up_confirmed_by_email, 'someone')
            || ' at ' || to_char(v_receipt.picked_up_at, 'YYYY-MM-DD HH24:MI')
        ELSE 'This receipt is not awaiting pickup'
      END,
      'status', v_receipt.status,
      'picked_up_by_email', v_receipt.picked_up_confirmed_by_email,
      'picked_up_at', v_receipt.picked_up_at
    );
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  -- ── Release every escrowed leg (goods to the store, margin to a reseller,
  -- a delivery fee to a rider — whichever this order has) now that pickup is
  -- proven. Every leg was already priced and balance-checked when the order
  -- was placed/accepted, so this can't fail for a balance reason. ──────────
  -- Each leg names WHO gets paid via payee_type: 'business' (a store or
  -- reseller's Pichin business wallet, via the trusted pos_sale settlement
  -- entrypoint) or 'personal' (a rider's own ICAN wallet — e.g. a delivery
  -- fee — via the same ride-earning credit primitive mbg_complete_ride
  -- uses). payee_id is a business_profile_id or a user_id accordingly.
  -- Legs written before this field existed have no payee_type — they were
  -- always business legs, so that's the default.
  v_has_legs := v_receipt.settlement_legs IS NOT NULL AND jsonb_array_length(v_receipt.settlement_legs) > 0;
  IF v_has_legs THEN
    FOR v_leg IN SELECT * FROM jsonb_array_elements(v_receipt.settlement_legs) LOOP
      v_leg_index := v_leg_index + 1;
      v_tx_id := 'DLV_' || v_receipt.verification_code || '_LEG' || v_leg_index;
      IF COALESCE(v_leg->>'payee_type', 'business') = 'personal' THEN
        PERFORM public.mbg_credit_ride_earning(
          (v_leg->>'payee_id')::UUID,
          (v_leg->>'ican_amount')::NUMERIC,
          v_receipt.source_app, v_tx_id,
          COALESCE(v_leg->>'note', 'Delivery order settlement')
        );
      ELSE
        PERFORM public.ican_settle_business_wallet_income(
          (v_leg->>'payee_id')::UUID,
          (v_leg->>'ican_amount')::NUMERIC,
          v_receipt.source_app, v_tx_id, 'pos_sale',
          COALESCE(v_leg->>'note', 'Delivery order settlement'),
          jsonb_build_object('receipt_id', v_receipt.id, 'reference_type', v_receipt.reference_type, 'reference_id', v_receipt.reference_id)
        );
      END IF;
    END LOOP;
  END IF;

  -- ── Start the delivery clock now — responsibility shifts fully to the
  -- rider from this moment, not from when the order was placed. ───────────
  IF v_receipt.max_delivery_hours IS NOT NULL THEN
    v_due_at := now() + (v_receipt.max_delivery_hours || ' hours')::INTERVAL;
  END IF;

  UPDATE public.icanera_delivery_receipts
  SET status = 'picked_up', picked_up_at = now(), picked_up_confirmed_by = auth.uid(),
      picked_up_confirmed_by_email = v_email,
      settled = v_has_legs, settled_at = CASE WHEN v_has_legs THEN now() ELSE NULL END,
      delivery_due_at = v_due_at
  WHERE id = v_receipt.id;

  RETURN jsonb_build_object('success', true, 'status', 'picked_up', 'picked_up_by_email', v_email, 'delivery_due_at', v_due_at);
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_confirm_pickup(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_confirm_pickup(TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 4 — icanera_verify_delivery_receipt: surface the deadline/overdue
-- state on the public page too (still no sensitive fields).
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.icanera_verify_delivery_receipt(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt public.icanera_delivery_receipts%ROWTYPE;
BEGIN
  SELECT * INTO v_receipt FROM public.icanera_delivery_receipts
  WHERE verification_code = upper(p_code);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  RETURN jsonb_build_object(
    'is_valid', true,
    'status', v_receipt.status,
    'store_name', v_receipt.store_name,
    'item_summary', v_receipt.item_summary,
    'goods_snapshot', v_receipt.goods_snapshot,
    'created_at', v_receipt.created_at,
    'picked_up_at', v_receipt.picked_up_at,
    'picked_up_by_email', v_receipt.picked_up_confirmed_by_email,
    'delivered_at', v_receipt.delivered_at,
    'delivery_due_at', v_receipt.delivery_due_at,
    'is_overdue', (v_receipt.overdue_warned_at IS NOT NULL AND v_receipt.refunded_at IS NULL),
    'refunded_at', v_receipt.refunded_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_verify_delivery_receipt(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_verify_delivery_receipt(TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 5 — mbg_request_ride: customer picks the delivery window. Required
-- for delivery_mode='supermarket' (same treatment as p_cart), ignored
-- otherwise. Old 15-arg overload is dropped first, per this file's own prior
-- practice of never leaving a stale orphaned overload behind.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, JSONB
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
  p_max_delivery_hours NUMERIC DEFAULT NULL
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
    order_notes, payment_method, cart, max_delivery_hours
  ) VALUES (
    v_customer_id, p_rider_id, v_stage_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(v_distance_km / 25 * 60)), v_fare,
    p_service_type, p_delivery_mode, p_supermarket_id,
    p_power_type_requested, COALESCE(p_umbrella_requested, false),
    v_multiplier, v_rider_earning, v_chair_total,
    p_order_notes, p_payment_method, p_cart, p_max_delivery_hours
  ) RETURNING id INTO v_ride_id;

  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx) VALUES (v_ride_id, v_platform_fee);

  RETURN jsonb_build_object(
    'success', true, 'ride_id', v_ride_id, 'fare', v_fare,
    'distance_km', v_distance_km, 'rider_earning', v_rider_earning
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, JSONB, NUMERIC
) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 6 — mbg_respond_to_ride: the goods leg is now handed to the
-- receipt as an unsettled settlement leg instead of being paid immediately.
-- Customer debit, stock deduction and the goods snapshot are unchanged.
-- Signature unchanged — plain CREATE OR REPLACE.
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
  v_settlement_legs JSONB := '[]'::JSONB;
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

          v_line_total_ugx := ROUND(v_product.selling_price * v_cart_qty * (1 + COALESCE(v_product.tax_rate, 0) / 100), 2);
          v_goods_ugx := v_goods_ugx + v_line_total_ugx;
          v_goods_snapshot := v_goods_snapshot || jsonb_build_object(
            'product_id', v_cart_item->>'product_id', 'product_name', v_product.name,
            'quantity', v_cart_qty, 'unit_price', v_product.selling_price, 'line_total', v_line_total_ugx
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
           v_goods_ugx, 'UGX', v_store.store_name, 'business', 'business_expense',
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
GRANT EXECUTE ON FUNCTION public.mbg_respond_to_ride TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 7 — mbg_complete_ride: also recover delivery_liability_debt_ugx
-- from the rider's own next wallet-paid earning credit, same LEAST()-capped
-- pattern already used for cash_commission_debt_ugx (recovered first).
-- Signature unchanged — plain CREATE OR REPLACE.
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
      v_debit := public.mbg_debit_journey_fare(v_customer_user_id, v_customer_charge_ican, 'mybodaguy', p_ride_id::TEXT);

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
    v_commission_due_ugx := v_ride.fare - v_ride.rider_earning;

    UPDATE public.mbg_riders SET
      is_available = false, total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
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

-- ----------------------------------------------------------------------------
-- SECTION 8 — overdue sweep (pg_cron, every 5 min) + the customer-triggered
-- refund, funded entirely from the rider's own wallet/debt.
-- ----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.icanera_sweep_overdue_deliveries()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.icanera_delivery_receipts
  SET overdue_warned_at = now()
  WHERE status = 'picked_up'
    AND delivery_due_at IS NOT NULL
    AND delivery_due_at <= now()
    AND overdue_warned_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.icanera_sweep_overdue_deliveries TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('icanera-overdue-delivery-sweep');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('icanera-overdue-delivery-sweep', '*/5 * * * *', $$ SELECT public.icanera_sweep_overdue_deliveries(); $$);

-- ── Customer confirms "restore my money". Only becomes callable
-- delivery.overdue_grace_minutes after the automatic warning above — that
-- window is the software's stand-in for the real support call this codebase
-- has no telephony integration to place automatically; wire an actual call
-- (Twilio or similar) into that gap later without changing anything below.
CREATE OR REPLACE FUNCTION public.icanera_request_delivery_refund(p_verification_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt public.icanera_delivery_receipts%ROWTYPE;
  v_grace_minutes NUMERIC;
  v_refund_available_at TIMESTAMPTZ;
  v_rider_balance NUMERIC;
  v_from_wallet NUMERIC := 0;
  v_shortfall_ican NUMERIC := 0;
  v_debit JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sign in required');
  END IF;

  SELECT * INTO v_receipt FROM public.icanera_delivery_receipts
  WHERE verification_code = upper(p_verification_code) FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Receipt not found');
  END IF;
  IF auth.uid() <> v_receipt.customer_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the customer on this order can request this refund');
  END IF;
  IF v_receipt.status <> 'picked_up' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This order is not in a refundable state', 'status', v_receipt.status);
  END IF;
  IF v_receipt.overdue_warned_at IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This order is not overdue yet');
  END IF;

  v_grace_minutes := public.mbg_get_setting_numeric('delivery.overdue_grace_minutes', 30);
  v_refund_available_at := v_receipt.overdue_warned_at + (v_grace_minutes || ' minutes')::INTERVAL;
  IF now() < v_refund_available_at THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('The rider was just warned — you can confirm this refund in about %s minute(s), giving them a last chance to deliver',
        CEIL(EXTRACT(EPOCH FROM (v_refund_available_at - now())) / 60)),
      'refund_available_at', v_refund_available_at
    );
  END IF;
  IF v_receipt.rider_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No rider is on record for this delivery — contact support');
  END IF;

  -- ── Pull the full order value from the RIDER — the store already proved
  -- (seal scan) it released the goods, so the store keeps its payment; the
  -- rider held sole responsibility for the goods from that moment on. Take
  -- whatever's in their wallet first; anything short becomes a recoverable
  -- debt, same pattern as cash-ride commission debt. ────────────────────────
  SELECT ican_balance INTO v_rider_balance FROM public.ican_user_wallets WHERE user_id = v_receipt.rider_user_id FOR UPDATE;
  v_from_wallet := LEAST(GREATEST(COALESCE(v_rider_balance, 0), 0), v_receipt.amount_ican);
  v_shortfall_ican := v_receipt.amount_ican - v_from_wallet;

  IF v_from_wallet > 0 THEN
    v_debit := public.mbg_debit_journey_fare(v_receipt.rider_user_id, v_from_wallet, 'mybodaguy', 'REFUND_' || v_receipt.verification_code);
    IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
      RAISE EXCEPTION 'Could not debit rider wallet for delivery refund: %', v_debit ->> 'error';
    END IF;
  END IF;

  IF v_shortfall_ican > 0 THEN
    UPDATE public.mbg_riders
    SET delivery_liability_debt_ugx = delivery_liability_debt_ugx + ROUND(v_shortfall_ican * 5000)
    WHERE user_id = v_receipt.rider_user_id;
  END IF;

  PERFORM public.mbg_credit_ride_earning(
    v_receipt.customer_user_id, v_receipt.amount_ican, 'mybodaguy',
    'REFUND_' || v_receipt.verification_code,
    format('Delivery refund — %s order not delivered within the chosen window', v_receipt.store_name)
  );

  UPDATE public.icanera_delivery_receipts
  SET status = 'refunded', refunded_at = now(), refund_ican_amount = v_receipt.amount_ican,
      refund_requested_at = COALESCE(refund_requested_at, now())
  WHERE id = v_receipt.id;

  -- Best-effort: sync the underlying ride/order so it stops looking active.
  -- Never blocks the refund itself, which has already committed above.
  BEGIN
    IF v_receipt.reference_type = 'mbg_ride' THEN
      UPDATE public.mbg_rides SET status = 'refunded', updated_at = now() WHERE id = v_receipt.reference_id;
    ELSIF v_receipt.reference_type = 'dropship_order' THEN
      UPDATE public.dropship_orders SET status = 'refunded' WHERE id = v_receipt.reference_id;
      UPDATE public.mbg_rides SET status = 'refunded', updated_at = now()
      WHERE id = (SELECT bodago_delivery_request_id FROM public.dropship_orders WHERE id = v_receipt.reference_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'refunded_ican', v_receipt.amount_ican,
    'recovered_from_rider_wallet_ican', v_from_wallet,
    'recorded_as_rider_debt_ugx', ROUND(v_shortfall_ican * 5000)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_request_delivery_refund(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_request_delivery_refund(TEXT) TO authenticated;

-- ── Read-only helpers so the rider and customer apps have something to
-- poll/list against without any push-notification infra (none exists in
-- this codebase yet — that's a real gap, not simulated here).
CREATE OR REPLACE FUNCTION public.icanera_my_overdue_deliveries()
RETURNS SETOF public.icanera_delivery_receipts LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.icanera_delivery_receipts
  WHERE rider_user_id = auth.uid() AND status = 'picked_up'
    AND overdue_warned_at IS NOT NULL AND refunded_at IS NULL
  ORDER BY delivery_due_at ASC;
$$;
REVOKE ALL ON FUNCTION public.icanera_my_overdue_deliveries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_my_overdue_deliveries() TO authenticated;

CREATE OR REPLACE FUNCTION public.icanera_my_refundable_deliveries()
RETURNS TABLE (
  verification_code TEXT, store_name TEXT, item_summary TEXT, amount_ican NUMERIC,
  picked_up_at TIMESTAMPTZ, delivery_due_at TIMESTAMPTZ, overdue_warned_at TIMESTAMPTZ,
  refund_available_at TIMESTAMPTZ
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.verification_code, r.store_name, r.item_summary, r.amount_ican,
         r.picked_up_at, r.delivery_due_at, r.overdue_warned_at,
         r.overdue_warned_at + (public.mbg_get_setting_numeric('delivery.overdue_grace_minutes', 30) || ' minutes')::INTERVAL
  FROM public.icanera_delivery_receipts r
  WHERE r.customer_user_id = auth.uid() AND r.status = 'picked_up'
    AND r.overdue_warned_at IS NOT NULL AND r.refunded_at IS NULL
  ORDER BY r.overdue_warned_at ASC;
$$;
REVOKE ALL ON FUNCTION public.icanera_my_refundable_deliveries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_my_refundable_deliveries() TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Store deliveries now hold the goods payment in escrow until the seal scan (icanera_confirm_pickup) releases it to the store, start a customer-chosen delivery clock at that moment, warn the rider automatically when it lapses (pg_cron every 5 min), and let the customer pull a full refund out of the RIDER''s own wallet/debt delivery.overdue_grace_minutes after the warning.';
END $$;
