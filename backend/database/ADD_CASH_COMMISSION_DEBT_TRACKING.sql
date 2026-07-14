-- ============================================================================
-- Cash settlement no longer requires the rider to already hold enough ICAN
-- to pay their owed commission on the spot — mbg_confirm_cash_received
-- previously called mbg_debit_journey_fare on the RIDER's own wallet, which
-- could fail with "insufficient balance" and leave them stuck offline with
-- no way to clear it. Instead: the rider keeps the full cash fare (as
-- always), the chairperson (boda) is paid their real share immediately out
-- of the platform's own float, and the amount the rider owes for that is
-- recorded as a running debt on their own mbg_riders row — a negative
-- against their account, not their wallet balance. That debt is then
-- automatically recovered by withholding it from the NEXT wallet-paid
-- ride(s) they complete, before they're credited anything themselves.
-- Nothing about the ICAN wallet's own ican_balance >= 0 invariant changes —
-- this debt lives entirely on mbg_riders, a mybodaguy-only concept, not a
-- change to the shared cross-app wallet table.
--
-- Run after ADD_RIDE_PAYMENT_METHOD_AND_COMMISSION.sql.
-- ============================================================================

ALTER TABLE public.mbg_riders
  ADD COLUMN IF NOT EXISTS cash_commission_debt_ugx NUMERIC NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'mbg_riders' AND c.contype = 'c'
      AND conname = 'mbg_riders_cash_commission_debt_non_negative'
  ) THEN
    ALTER TABLE public.mbg_riders
      ADD CONSTRAINT mbg_riders_cash_commission_debt_non_negative CHECK (cash_commission_debt_ugx >= 0);
  END IF;
END $$;

-- ── mbg_confirm_cash_received: records debt instead of debiting the rider's
-- wallet. Same signature — plain replace. ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.mbg_confirm_cash_received(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_rider_id UUID;
  v_rider_vehicle_type TEXT;
  v_is_boda BOOLEAN;
  v_commission_ugx NUMERIC;
  v_commission_ican NUMERIC;
  v_payment_id UUID;
  v_region RECORD;
  v_level RECORD;
  v_chair_user_id UUID;
  v_pct NUMERIC;
  v_amount_ugx NUMERIC;
  v_amount_ican NUMERIC;
  ICAN_TO_UGX CONSTANT NUMERIC := 5000;
BEGIN
  SELECT id, vehicle_type::TEXT INTO v_rider_id, v_rider_vehicle_type
  FROM public.mbg_riders WHERE user_id = auth.uid();
  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id AND rider_id = v_rider_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ride not found or not yours');
  END IF;
  IF v_ride.status <> 'completed' OR v_ride.payment_method <> 'cash' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This ride has no cash payment awaiting confirmation');
  END IF;
  IF v_ride.cash_confirmed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Already confirmed');
  END IF;

  v_is_boda := v_rider_vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk');
  v_commission_ugx := v_ride.fare - v_ride.rider_earning;

  -- Chairperson (boda only) is paid for real right away — their commission
  -- doesn't wait on the rider's ability to pay; the rider's debt (below)
  -- is how the platform recovers what it just fronted on their behalf.
  IF v_is_boda THEN
    SELECT id INTO v_payment_id FROM public.mbg_payments WHERE ride_id = p_ride_id;

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
          IF v_payment_id IS NOT NULL THEN
            INSERT INTO public.mbg_commissions (
              ride_id, payment_id, recipient_id, recipient_role, region_type, region_id,
              ride_fare, commission_percentage, commission_amount, status, paid_at
            ) VALUES (
              p_ride_id, v_payment_id, v_chair_user_id, v_level.region_type::TEXT || '_chairperson',
              v_level.region_type, v_level.region_id,
              v_ride.fare, v_pct, v_amount_ugx, 'paid', now()
            );
          END IF;
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Record the debt (chairperson share for boda, platform's flat share for
  -- car/van/truck) against the rider's own account — recovered later out
  -- of their next wallet-paid ride credit(s), not their current balance.
  UPDATE public.mbg_riders
  SET cash_commission_debt_ugx = cash_commission_debt_ugx + GREATEST(v_commission_ugx, 0)
  WHERE id = v_rider_id;

  UPDATE public.mbg_rides SET cash_confirmed_at = now(), updated_at = now() WHERE id = p_ride_id;
  PERFORM set_config('mbg.trusted_write', 'true', true);
  UPDATE public.mbg_riders SET is_available = true, updated_at = now() WHERE id = v_rider_id;

  RETURN jsonb_build_object('success', true, 'commission_debt_recorded_ugx', v_commission_ugx);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_confirm_cash_received TO authenticated;

-- ── mbg_complete_ride: the wallet-payment branch now recovers any
-- outstanding cash_commission_debt_ugx from the rider's OWN earning credit
-- first, before crediting whatever's left to their wallet. Same signature
-- (p_ride_id UUID) — plain replace, no drop needed. ────────────────────────
CREATE OR REPLACE FUNCTION public.mbg_complete_ride(p_ride_id UUID)
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

  v_is_boda := v_rider_vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk');
  SELECT user_id INTO v_customer_user_id FROM public.mbg_customers WHERE id = v_ride.customer_id;

  UPDATE public.mbg_rides SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = p_ride_id;

  UPDATE public.mbg_payments SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE ride_id = p_ride_id RETURNING id INTO v_payment_id;

  UPDATE public.mbg_customers SET
    total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
  WHERE id = v_ride.customer_id;

  PERFORM set_config('mbg.trusted_write', 'true', true);

  IF v_ride.payment_method = 'wallet' THEN
    -- Real, tithe-free ICAN settlement: customer pays fare + 7% surcharge.
    v_fare_ican := ROUND(v_ride.fare / ICAN_TO_UGX, 8);
    v_customer_charge_ican := ROUND(v_fare_ican * (1 + v_wallet_surcharge_pct / 100), 8);
    v_debit := public.mbg_debit_journey_fare(v_customer_user_id, v_customer_charge_ican, 'mybodaguy', p_ride_id::TEXT);

    IF COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
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
    'payment_method', v_ride.payment_method,
    'commission_due_ugx', v_commission_due_ugx
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_complete_ride TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Cash-ride commission is now tracked as a debt on mbg_riders.cash_commission_debt_ugx, recovered automatically from the rider''s next wallet-paid ride credit instead of an immediate wallet debit.';
END $$;
