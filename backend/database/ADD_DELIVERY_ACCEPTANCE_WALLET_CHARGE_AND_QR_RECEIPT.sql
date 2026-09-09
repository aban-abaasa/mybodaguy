-- ============================================================================
-- Store deliveries ("Bodagoera"/"Supermarkera" rides with
-- delivery_mode = 'supermarket') now charge the customer's ICAN wallet at
-- ACCEPTANCE time, not at drop-off. Previously (ADD_RIDER_CONFIRMED_
-- PAYMENT_METHOD_AT_COMPLETION.sql) a rider could accept a store delivery,
-- ride all the way there, and only then discover the customer's wallet
-- couldn't cover it. For a store handing over real stock, that's too late —
-- the store needs the money guaranteed the moment a rider takes the job.
--
-- mbg_respond_to_ride now branches: for a plain 'ride', a general
-- delivery_mode='normal' delivery, or a 'cargo_delivery', acceptance works
-- exactly as before. For a delivery_mode='supermarket' delivery it:
--   1. requires payment_method = 'wallet' (cash can't be guaranteed before
--      the rider even leaves, so store deliveries are wallet-only),
--   2. debits the customer immediately via the same mbg_debit_journey_fare
--      call mbg_complete_ride already uses (same fare + wallet-surcharge
--      formula), bailing out with the ride left untouched if it fails,
--   3. creates a 3-party QR verification receipt (customer/store/rider) via
--      icanera_create_delivery_receipt — see
--      ICAN/backend/ADD_DELIVERY_RECEIPT_VERIFICATION.sql, run that first.
--
-- mbg_complete_ride is updated to match: mbg_rides.wallet_charged_at_
-- acceptance marks a ride as already paid, so completion skips the second
-- wallet debit (no double charge) while still doing the payouts — rider
-- earning credit, cash-commission-debt recovery, chairperson commissions —
-- exactly as before. It also syncs the receipt to 'delivered'.
--
-- Run after ADD_RIDER_CONFIRMED_PAYMENT_METHOD_AT_COMPLETION.sql and
-- ICAN/backend/ADD_DELIVERY_RECEIPT_VERIFICATION.sql.
-- ============================================================================

ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS wallet_charged_at_acceptance BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- mbg_respond_to_ride
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
      -- the rider is dispatched, same wallet-first principle
      -- ADD_RIDER_CONFIRMED_PAYMENT_METHOD_AT_COMPLETION.sql already uses at
      -- completion — just moved earlier, to acceptance. ─────────────────────
      IF v_ride.payment_method <> 'wallet' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Store deliveries must be paid by ICAN wallet so the store is guaranteed payment before releasing the order');
      END IF;

      SELECT user_id INTO v_customer_user_id FROM public.mbg_customers WHERE id = v_ride.customer_id;
      IF v_customer_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Customer wallet not found');
      END IF;

      v_wallet_surcharge_pct := public.mbg_get_setting_numeric('commission.wallet_customer_surcharge_percentage', 7);
      v_fare_ican := ROUND(v_ride.fare / ICAN_TO_UGX, 8);
      v_customer_charge_ican := ROUND(v_fare_ican * (1 + v_wallet_surcharge_pct / 100), 8);

      v_debit := public.mbg_debit_journey_fare(v_customer_user_id, v_customer_charge_ican, 'mybodaguy', p_ride_id::TEXT);
      IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
        RETURN jsonb_build_object('success', false, 'error', COALESCE(v_debit ->> 'error', 'Wallet payment failed'));
      END IF;

      SELECT owner_user_id, COALESCE(NULLIF(name, ''), NULLIF(location, ''), 'Store') AS store_name
      INTO v_store
      FROM public.supermarkets WHERE id = v_ride.supermarket_id;

      IF v_store.owner_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This store has no payment account configured');
      END IF;

      UPDATE public.mbg_rides SET
        status = 'accepted', accepted_at = now(), updated_at = now(), wallet_charged_at_acceptance = true
      WHERE id = p_ride_id;

      INSERT INTO public.mbg_payments (ride_id, customer_id, rider_id, amount, status)
      VALUES (p_ride_id, v_ride.customer_id, v_rider_id, v_ride.fare, 'pending');

      UPDATE public.mbg_riders SET is_available = false, updated_at = now() WHERE id = v_rider_id;

      v_receipt := public.icanera_create_delivery_receipt(
        'mybodaguy', 'mbg_ride', p_ride_id,
        v_customer_user_id, v_store.owner_user_id, auth.uid(),
        v_store.store_name, v_ride.order_notes, v_customer_charge_ican
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

-- ----------------------------------------------------------------------------
-- mbg_complete_ride — skip the wallet debit when it already happened at
-- acceptance, keep everything else (payouts, chairperson commissions)
-- identical to ADD_RIDER_CONFIRMED_PAYMENT_METHOD_AT_COMPLETION.sql.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.mbg_complete_ride(UUID);

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
    -- The store already got paid electronically when the rider accepted
    -- this delivery — the rider can't retroactively turn that into a cash
    -- settlement, so ignore any p_payment_method override here.
    v_actual_method := 'wallet';
  END IF;
  IF v_actual_method NOT IN ('cash', 'wallet') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment method must be cash or wallet');
  END IF;

  v_is_boda := v_rider_vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk');
  SELECT user_id INTO v_customer_user_id FROM public.mbg_customers WHERE id = v_ride.customer_id;

  -- ── Wallet settlement is attempted FIRST, before anything else is
  -- mutated — unless it was already settled at acceptance (store
  -- deliveries), in which case there is nothing left to charge here. ───────
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

  -- ── Settlement is confirmed (wallet already debited above or at
  -- acceptance, or it's cash which never fails up front) — now safe to
  -- actually mark the ride done.
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

    -- Recover any outstanding cash-commission debt from this credit
    -- FIRST — the rider only ever sees whatever's left after that, same
    -- "nothing itemized" principle as the surcharge itself.
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

    IF v_rider_credit_ican > 0 THEN
      PERFORM public.mbg_credit_ride_earning(v_rider_user_id, v_rider_credit_ican, 'mybodaguy', p_ride_id::TEXT, 'Ride earning');
    END IF;

    -- Real per-level chairperson payout, boda-style vehicles only.
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

    -- Settlement is automatic — rider is free to take new jobs right away.
    UPDATE public.mbg_riders SET
      is_available = true, total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
    WHERE id = v_rider_id;

  ELSE
    -- Cash: the rider already holds the full fare physically. They stay
    -- offline (is_available = false) until mbg_confirm_cash_received
    -- records the owed commission as a debt (no longer an immediate debit).
    v_commission_due_ugx := v_ride.fare - v_ride.rider_earning;

    UPDATE public.mbg_riders SET
      is_available = false, total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
    WHERE id = v_rider_id;
  END IF;

  -- Best-effort: close out the QR verification receipt, if this ride had
  -- one (store deliveries only). Wrapped so a missing/older table never
  -- blocks completing an otherwise-normal ride.
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
  RAISE NOTICE '✅ Store deliveries (delivery_mode=supermarket) now charge the customer''s wallet at acceptance and create a 3-party QR verification receipt; mbg_complete_ride no longer double-charges them.';
END $$;
