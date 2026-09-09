-- ============================================================================
-- The public QR verification page (bodagoera.icanera.space/verify/<code>,
-- VerifyReceiptPage.tsx) currently proves a receipt is real but only shows
-- item_summary — a flattened string like "2x Rice, 1x Soap". No one scanning
-- the code can see what was actually charged per item, so there is no real
-- proof of the goods purchase itself, only of the order existing.
--
-- ADD_DELIVERY_GOODS_PAYMENT_TO_STORE.sql already computes a fully priced,
-- itemized v_goods_snapshot inside mbg_respond_to_ride (product name,
-- quantity, unit price, line total per line) and stores it on
-- mbg_rides.goods_snapshot — it just never made it onto the public receipt
-- row. This file carries that same snapshot onto
-- icanera_delivery_receipts.goods_snapshot and returns it from
-- icanera_verify_delivery_receipt, so the public page can render a real
-- itemized "Proof of purchase" tab instead of a bare text summary.
--
-- icanera_create_delivery_receipt gains an 10th, trailing DEFAULT NULL
-- parameter (p_goods_snapshot). Postgres allows extending a function's
-- parameter list this way via plain CREATE OR REPLACE as long as the new
-- parameter is trailing and defaulted — so the existing dropship_checkout
-- caller (ICAN/backend/ADD_DROPSHIP_QR_RECEIPT.sql, 9 positional args, no
-- per-item snapshot available there) keeps working unmodified and its
-- receipts simply keep a NULL goods_snapshot, exactly as before.
--
-- Run after ICAN/backend/ADD_DELIVERY_RECEIPT_APPROVAL_TRACKING.sql and
-- mybodaguy/backend/database/ADD_DELIVERY_GOODS_PAYMENT_TO_STORE.sql.
-- ============================================================================

ALTER TABLE public.icanera_delivery_receipts
  ADD COLUMN IF NOT EXISTS goods_snapshot JSONB;

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
  p_goods_snapshot   JSONB DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code TEXT;
  v_id UUID;
BEGIN
  v_code := upper(substr(md5(gen_random_uuid()::text), 1, 10));

  INSERT INTO public.icanera_delivery_receipts (
    verification_code, source_app, reference_type, reference_id,
    customer_user_id, store_owner_user_id, rider_user_id,
    store_name, item_summary, amount_ican, goods_snapshot
  ) VALUES (
    v_code, p_source_app, p_reference_type, p_reference_id,
    p_customer_user_id, p_store_owner_user_id, p_rider_user_id,
    p_store_name, p_item_summary, p_amount_ican, p_goods_snapshot
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'success', true,
    'receipt_id', v_id,
    'verification_code', v_code,
    'verify_url', 'https://bodagoera.icanera.space/verify/' || v_code
  );
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_create_delivery_receipt(TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_create_delivery_receipt(TEXT, TEXT, UUID, UUID, UUID, UUID, TEXT, TEXT, NUMERIC, JSONB) TO authenticated, service_role;

-- Public lookup — still anon-safe: goods_snapshot only ever holds product
-- name/qty/unit_price/line_total, no customer identity or payment details.
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
    'delivered_at', v_receipt.delivered_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_verify_delivery_receipt(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_verify_delivery_receipt(TEXT) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- mbg_respond_to_ride — pass the itemized v_goods_snapshot it already builds
-- through to the receipt. Signature is unchanged, plain CREATE OR REPLACE.
-- Identical to the body in ADD_DELIVERY_GOODS_PAYMENT_TO_STORE.sql except
-- for the one added argument on the icanera_create_delivery_receipt call.
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
        v_store.store_name, v_item_summary, v_customer_charge_ican + v_goods_ican,
        v_goods_snapshot
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
  RAISE NOTICE '✅ Public delivery receipts now carry the itemized goods_snapshot (product/qty/unit price/line total), so the QR verification page can show real proof of what was purchased, not just a text summary.';
END $$;
