-- ============================================================================
-- Let the rider confirm how the customer ACTUALLY paid at delivery time,
-- instead of blindly trusting whatever payment_method was picked when the
-- ride was booked. In practice a customer who booked "cash" sometimes pays
-- through the app instead, and vice versa — the rider is standing there
-- with the customer and is the one who actually knows.
--
-- mbg_complete_ride now takes an explicit p_payment_method ('cash' | wallet
-- values matching mbg_rides.payment_method) from the rider's "Mark
-- Delivered" screen. It defaults to the ride's originally-booked method
-- when omitted, so any other/older caller keeps working unchanged.
--
-- Also fixes a real gap in the previous version: for wallet settlement, the
-- ride was marked 'completed' and mbg_payments/mbg_customers stats were
-- already updated BEFORE mbg_debit_journey_fare was attempted — so if the
-- customer's ICAN balance was insufficient, the debit silently failed
-- (v_debit.success = false), nothing was charged, the rider was never
-- credited, and the ride still ended up 'completed' as if nothing were
-- wrong. Now the wallet debit is attempted FIRST, before any ride/payment
-- row is touched. If it fails, mbg_complete_ride returns success:false
-- with the underlying error and the ride stays 'in_progress' untouched —
-- the rider's UI can show the error and let them pick Cash instead.
--
-- Both sides of a wallet settlement keep landing as separate
-- ican_coin_transactions rows exactly as before — one debit
-- (sender_user_id = customer) from mbg_debit_journey_fare, one credit
-- (recipient_user_id = rider) from mbg_credit_ride_earning — so both
-- parties see the transaction in their own wallet history without any
-- extra bookkeeping needed here.
--
-- Run after ADD_CASH_COMMISSION_DEBT_TRACKING.sql.
-- ============================================================================

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
  IF v_actual_method NOT IN ('cash', 'wallet') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment method must be cash or wallet');
  END IF;

  v_is_boda := v_rider_vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk');
  SELECT user_id INTO v_customer_user_id FROM public.mbg_customers WHERE id = v_ride.customer_id;

  -- ── Wallet settlement is attempted FIRST, before anything else is
  -- mutated. If the customer can't actually cover it, we bail out here
  -- with the ride left exactly as it was (still in_progress) so the rider
  -- can retry the same "Mark Delivered" action with Cash instead. ─────────
  IF v_actual_method = 'wallet' THEN
    v_fare_ican := ROUND(v_ride.fare / ICAN_TO_UGX, 8);
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

  -- ── Settlement is confirmed (wallet already debited above, or it's cash
  -- which never fails up front) — now safe to actually mark the ride done.
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
  RAISE NOTICE '✅ mbg_complete_ride now takes the rider''s confirmed payment method at delivery time (defaults to the ride''s booked method if omitted), and no longer completes a wallet-paid ride whose debit actually failed.';
END $$;
