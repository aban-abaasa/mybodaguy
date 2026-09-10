-- ============================================================================
-- Cash-ride commission settlement no longer waits on the rider tapping
-- through a "Confirm cash received" screen. mbg_complete_ride's cash branch
-- used to set mbg_riders.is_available = false and leave the rider stuck
-- offline — unable to take new jobs — until they called
-- mbg_confirm_cash_received by hand. That confirmation step is now inlined
-- directly into mbg_complete_ride: the moment a cash trip is marked
-- complete, the chairperson (boda) is paid immediately out of the
-- platform's float and the rider's share of that is recorded as a debt on
-- mbg_riders.cash_commission_debt_ugx, recovered automatically from their
-- next wallet-paid ride credit — exactly as before, just without the
-- rider having to do anything or ever see a prompt about it. The rider
-- stays online (is_available = true) the whole time.
--
-- This replaces mbg_complete_ride(UUID, TEXT) as last defined in
-- ADD_DELIVERY_ESCROW_DEADLINE_AND_RIDER_LIABILITY.sql — same signature,
-- same wallet branch (incl. wallet_charged_at_acceptance short-circuit and
-- cash_commission_debt_ugx / delivery_liability_debt_ugx recovery), only
-- the cash (ELSE) branch changes.
--
-- mbg_confirm_cash_received is left in place (now effectively unused —
-- cash_confirmed_at is already set by the time it could be called, so it
-- just returns "Already confirmed") rather than dropped, in case anything
-- else still references it.
--
-- Run after ADD_DELIVERY_ESCROW_DEADLINE_AND_RIDER_LIABILITY.sql.
-- ============================================================================

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
  RAISE NOTICE '✅ Cash-ride commission now auto-settles inside mbg_complete_ride — riders stay online and are never shown a confirmation prompt.';
END $$;
