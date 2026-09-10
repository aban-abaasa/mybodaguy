-- ============================================================================
-- Store deliveries had a "seal scan" proving the goods left the store
-- (icanera_confirm_pickup), but nothing on the other end proving they
-- actually reached the customer — a rider marking "Mark Delivered" in their
-- own app was self-reported and paid them immediately, no second party ever
-- involved. This adds that second confirmation: the CUSTOMER — specifically,
-- signed in as the account that placed the order, the same accountability-
-- via-email pattern icanera_confirm_pickup already uses for the store side —
-- scans the same QR code (or opens its verify_url) and taps "Confirm
-- Received" once the rider has handed the package over. The rider's fare
-- earning + chairperson commissions are now held back until that happens,
-- instead of releasing the moment the rider taps "Mark Delivered".
--
-- The rider still goes back online immediately (is_available = true) when
-- they mark the trip complete — only the MONEY is gated, not their ability
-- to take new jobs. A rider who is never confirmed is simply never paid for
-- that leg — there's no automatic timeout/fallback release here (unlike the
-- customer's own overdue-delivery refund path in
-- ADD_DELIVERY_ESCROW_DEADLINE_AND_RIDER_LIABILITY.sql); consider adding one
-- later if silent non-confirmation turns out to be a real problem.
--
-- Only applies to supermarket (store) deliveries — the only flow with a QR
-- receipt at all. Plain rides and normal deliveries are untouched: the rider
-- is still paid the moment mbg_complete_ride runs, exactly as before.
--
-- Run after ADD_DELIVERY_EXPENSE_CLASSIFICATION.sql.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1 — SCHEMA
-- ----------------------------------------------------------------------------

ALTER TABLE public.icanera_delivery_receipts
  ADD COLUMN IF NOT EXISTS delivered_confirmed_by       UUID,
  ADD COLUMN IF NOT EXISTS delivered_confirmed_by_email TEXT;

-- Guards mbg_pay_rider_for_ride against ever crediting the same ride twice —
-- the primary guard is icanera_confirm_delivery only calling it once
-- (receipt.status transitions 'picked_up' -> 'delivered' under a row lock),
-- this is defense in depth for any other future caller.
ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS rider_paid_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- SECTION 2 — mbg_pay_rider_for_ride: the debt-recovery + rider-credit +
-- chairperson-payout logic extracted verbatim out of mbg_complete_ride's
-- wallet branch, unchanged in substance, just made reusable — mbg_complete_ride
-- still calls it directly (immediately) for a plain ride or a normal
-- delivery, while icanera_confirm_delivery (SECTION 4) calls it instead, once
-- the customer confirms, for a supermarket delivery. Not GRANTed to any
-- client role — only reachable from another SECURITY DEFINER function owned
-- by the same role (an implicit privilege every function owner already has
-- over their own functions), never directly via RPC.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_pay_rider_for_ride(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_rider_id UUID;
  v_rider_user_id UUID;
  v_rider_vehicle_type TEXT;
  v_is_boda BOOLEAN;
  v_payment_id UUID;
  v_region RECORD;
  v_level RECORD;
  v_chair_user_id UUID;
  v_pct NUMERIC;
  v_amount_ugx NUMERIC;
  v_amount_ican NUMERIC;
  v_fare_ican NUMERIC;
  v_rider_credit_ican NUMERIC;
  v_debt_ugx NUMERIC;
  v_debt_ican NUMERIC;
  v_recovered_ican NUMERIC;
  ICAN_TO_UGX CONSTANT NUMERIC := 5000;
BEGIN
  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ride not found');
  END IF;
  IF v_ride.rider_paid_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rider already paid for this ride');
  END IF;

  SELECT id, user_id, vehicle_type::TEXT INTO v_rider_id, v_rider_user_id, v_rider_vehicle_type
  FROM public.mbg_riders WHERE id = v_ride.rider_id;
  IF v_rider_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No rider on this ride');
  END IF;

  SELECT id INTO v_payment_id FROM public.mbg_payments WHERE ride_id = p_ride_id;

  v_is_boda := v_rider_vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk');
  v_fare_ican := ROUND(v_ride.fare / ICAN_TO_UGX, 8);
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

  UPDATE public.mbg_rides SET rider_paid_at = now(), updated_at = now() WHERE id = p_ride_id;

  RETURN jsonb_build_object('success', true, 'rider_credited_ican', v_rider_credit_ican);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_pay_rider_for_ride(UUID) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- SECTION 3 — mbg_complete_ride: for a supermarket delivery, skip paying the
-- rider here — defer to icanera_confirm_delivery. Every other branch (rides,
-- normal deliveries, cash) now calls mbg_pay_rider_for_ride immediately,
-- same as inline before. is_available/total_rides/completed_rides still
-- flips right away regardless — only the money is deferred.
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
  v_debit JSONB;
  v_commission_due_ugx NUMERIC := 0;
  v_actual_method TEXT;
  v_is_pending_customer_confirmation BOOLEAN;
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

  -- Store (supermarket) deliveries always ride wallet_charged_at_acceptance,
  -- and are the only kind with a QR receipt for the customer to confirm
  -- against — that's exactly the case this gates.
  v_is_pending_customer_confirmation := (v_ride.service_type = 'delivery' AND v_ride.delivery_mode = 'supermarket');

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
    IF v_is_pending_customer_confirmation THEN
      -- Held: rider is paid once the customer confirms receipt via the QR
      -- code (icanera_confirm_delivery), not the moment the rider taps
      -- "Mark Delivered" here.
      NULL;
    ELSE
      PERFORM public.mbg_pay_rider_for_ride(p_ride_id);
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

  -- mbg_complete_ride no longer auto-marks the receipt "delivered" itself —
  -- every receipt this function could ever touch is reference_type='mbg_ride',
  -- and that status transition now only happens once the customer actually
  -- confirms receipt (icanera_confirm_delivery, SECTION 4), which is also
  -- what releases the rider's payment. The old unconditional UPDATE here
  -- (present in every prior version of this function) is removed rather than
  -- narrowed with an always-false condition, to keep this readable.

  RETURN jsonb_build_object(
    'success', true,
    'rider_earning', v_ride.rider_earning,
    'payment_method', v_actual_method,
    'commission_due_ugx', v_commission_due_ugx,
    'awaiting_customer_confirmation', v_is_pending_customer_confirmation AND v_actual_method = 'wallet'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_complete_ride(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_complete_ride no longer pays a supermarket-delivery rider immediately — that now waits for icanera_confirm_delivery.';
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 4 — icanera_confirm_delivery: the customer's own confirmation,
-- gated on their real account (unlike icanera_confirm_pickup's deliberately
-- open "anyone physically present" policy for store staff) — this is what
-- actually releases the rider's payment for a store delivery.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.icanera_confirm_delivery(p_verification_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_receipt public.icanera_delivery_receipts%ROWTYPE;
  v_email TEXT;
  v_ride_status TEXT;
  v_pay_result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Sign in with Google to confirm you received this delivery');
  END IF;

  SELECT * INTO v_receipt FROM public.icanera_delivery_receipts
  WHERE verification_code = upper(p_verification_code) FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Receipt not found');
  END IF;

  IF auth.uid() <> v_receipt.customer_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only the customer who placed this order can confirm it was delivered');
  END IF;

  IF v_receipt.status = 'delivered' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'You already confirmed this delivery' ||
        CASE WHEN v_receipt.delivered_at IS NOT NULL THEN ' at ' || to_char(v_receipt.delivered_at, 'YYYY-MM-DD HH24:MI') ELSE '' END,
      'status', v_receipt.status
    );
  END IF;

  IF v_receipt.status <> 'picked_up' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', CASE WHEN v_receipt.status = 'paid' THEN 'This order has not been picked up from the store yet'
                     ELSE 'This order is not in a state that can be confirmed' END,
      'status', v_receipt.status
    );
  END IF;

  IF v_receipt.reference_type = 'mbg_ride' THEN
    SELECT status INTO v_ride_status FROM public.mbg_rides WHERE id = v_receipt.reference_id;
    IF v_ride_status IS DISTINCT FROM 'completed' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Your rider hasn''t marked this delivery complete on their end yet — try again in a moment');
    END IF;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();

  UPDATE public.icanera_delivery_receipts
  SET status = 'delivered', delivered_at = now(),
      delivered_confirmed_by = auth.uid(), delivered_confirmed_by_email = v_email
  WHERE id = v_receipt.id;

  IF v_receipt.reference_type = 'mbg_ride' THEN
    v_pay_result := public.mbg_pay_rider_for_ride(v_receipt.reference_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'delivered', 'confirmed_by_email', v_email, 'rider_payment', v_pay_result);
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_confirm_delivery(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_confirm_delivery(TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 5 — icanera_verify_delivery_receipt: surface delivered-by and
-- whether the CURRENT viewer is the customer on this order, so
-- VerifyReceiptPage knows when to show the "Confirm Received" action instead
-- of just read-only status. Still no sensitive fields for anyone else.
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
    'delivered_by_email', v_receipt.delivered_confirmed_by_email,
    'delivery_due_at', v_receipt.delivery_due_at,
    'is_overdue', (v_receipt.overdue_warned_at IS NOT NULL AND v_receipt.refunded_at IS NULL),
    'refunded_at', v_receipt.refunded_at,
    'is_customer', (auth.uid() IS NOT NULL AND auth.uid() = v_receipt.customer_user_id)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.icanera_verify_delivery_receipt(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.icanera_verify_delivery_receipt(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Store-delivery riders are now paid only once the customer confirms receipt (icanera_confirm_delivery), signed in as themselves — not the moment the rider marks the trip complete.';
END $$;
