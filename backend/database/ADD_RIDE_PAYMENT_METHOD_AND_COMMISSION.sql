-- ============================================================================
-- Wallet vs Cash payment for ordinary rides/deliveries (mbg_request_ride),
-- with a new flat commission model that REPLACES the old 5-level
-- stage/parish/subcounty/division/district split (10+6+4+3+2 = 25% total)
-- for boda-style vehicles (motorcycle/bicycle/tuktuk), and introduces a
-- separate flat platform commission for car/van/truck (which have never
-- had a chairperson — mbg_request_ride always assigns a stage_id today
-- regardless of vehicle type, but only boda-style riders are actually
-- under a chairperson's supervision in practice).
--
-- New model (fare = 100%):
--   Boda (motorcycle/bicycle/tuktuk): rider keeps 95%, chairpersons share
--     5% total, split across the SAME 5-level hierarchy as before but
--     rescaled to sum to 5% instead of 25% (same relative weights:
--     stage 2% / parish 1.2% / subcounty 0.8% / division 0.6% / district 0.4%).
--   Car/van/truck: rider keeps 85%, platform keeps 15% (no chairperson —
--     this is simply the gap between what the rider is credited and what
--     the customer paid; there's no real "platform wallet" to transfer
--     into, same as the old platform_fee_percentage never moved real coin
--     either — it just wasn't credited onward to anyone).
--
-- Payment method (chosen by the customer at request time):
--   'wallet' — customer is charged fare + 7% (a convenience surcharge for
--     instant automatic settlement) via a real, tithe-free ICAN debit.
--     The rider is credited their net earning automatically and instantly;
--     for boda rides, each resolved chairperson is ALSO credited their
--     real slice automatically. Nothing is itemized for the rider — they
--     just see the net amount land, same as today's "You earned UGX X" toast.
--   'cash' — the customer pays the rider directly in physical cash; the
--     app never touches that money, so it can't automatically deduct
--     anything. The rider must explicitly tap "Confirm cash received"
--     (mbg_confirm_cash_received) before being offered new jobs again —
--     that action is what actually debits the owed commission (5%/15%)
--     from the RIDER'S OWN ICAN wallet and pays it out to the
--     chairperson(s)/platform. This is the one path where the rider does
--     see/feel the deduction, since they have to consciously pay it.
--
-- Run after CREATE_REAL_RIDE_MATCHING_ENGINE.sql, ADD_RIDE_ORDER_NOTES.sql,
-- and ICAN/backend/ADD_RIDE_EARNING_CREDIT_FUNCTION.sql (mbg_credit_ride_earning).
-- ============================================================================

-- ── 1. Rescale existing chairperson settings (5% total, same weights) ──────
INSERT INTO public.mbg_platform_settings (key, value, value_type, description, category, is_public) VALUES
  ('commission.stage_chair_percentage',     '2.0', 'number', 'Stage chairperson commission percentage (of a 5% boda total)', 'commission', true),
  ('commission.parish_chair_percentage',    '1.2', 'number', 'Parish chairperson commission percentage (of a 5% boda total)', 'commission', true),
  ('commission.subcounty_chair_percentage', '0.8', 'number', 'Subcounty chairperson commission percentage (of a 5% boda total)', 'commission', true),
  ('commission.division_chair_percentage',  '0.6', 'number', 'Division chairperson commission percentage (of a 5% boda total)', 'commission', true),
  ('commission.district_chair_percentage',  '0.4', 'number', 'District chairperson commission percentage (of a 5% boda total)', 'commission', true),
  ('commission.boda_chair_total_percentage','5.0', 'number', 'Total chairperson commission for boda-style rides (motorcycle/bicycle/tuktuk)', 'commission', true),
  ('commission.nonboda_platform_percentage','15.0','number', 'Flat platform commission for car/van/truck rides (no chairperson)', 'commission', true),
  ('commission.wallet_customer_surcharge_percentage', '7.0', 'number', 'Extra % charged to the customer for paying via ICANera wallet instead of cash', 'commission', true)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description;

-- platform_fee_percentage/rider_percentage superseded by the vehicle-type-aware
-- calc below; left in place (unused by the new code path) rather than deleted,
-- since other reporting code may still read them for historical rides.

-- ── 2. mbg_rides: payment method + cash-settlement tracking ────────────────
ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'wallet',
  ADD COLUMN IF NOT EXISTS cash_confirmed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class rel ON rel.oid = c.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public' AND rel.relname = 'mbg_rides' AND c.contype = 'c'
      AND conname = 'mbg_rides_payment_method_check'
  ) THEN
    ALTER TABLE public.mbg_rides
      ADD CONSTRAINT mbg_rides_payment_method_check CHECK (payment_method IN ('wallet', 'cash'));
  END IF;
END $$;

-- ── 3. mbg_request_ride gains p_payment_method (trailing param — signature
-- change, so the old overload must be dropped first; no exceptions, see
-- every prior ADD_*.sql in this project). ──────────────────────────────────
DROP FUNCTION IF EXISTS public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT
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
  p_payment_method TEXT DEFAULT 'wallet'
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
    order_notes, payment_method
  ) VALUES (
    v_customer_id, p_rider_id, v_stage_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(v_distance_km / 25 * 60)), v_fare,
    p_service_type, p_delivery_mode, p_supermarket_id,
    p_power_type_requested, COALESCE(p_umbrella_requested, false),
    v_multiplier, v_rider_earning, v_chair_total,
    p_order_notes, p_payment_method
  ) RETURNING id INTO v_ride_id;

  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx) VALUES (v_ride_id, v_platform_fee);

  RETURN jsonb_build_object(
    'success', true, 'ride_id', v_ride_id, 'fare', v_fare,
    'distance_km', v_distance_km, 'rider_earning', v_rider_earning
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT
) TO authenticated;

-- ── 4. mbg_complete_ride: real settlement, branching on payment_method.
-- Same signature (p_ride_id UUID) — no drop needed, plain replace. ─────────
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
    -- Real, tithe-free ICAN settlement: customer pays fare + 7% surcharge;
    -- rider is credited their net earning automatically. Nothing is
    -- itemized for the rider — they only ever see the net amount land.
    v_fare_ican := ROUND(v_ride.fare / ICAN_TO_UGX, 8);
    v_customer_charge_ican := ROUND(v_fare_ican * (1 + v_wallet_surcharge_pct / 100), 8);
    v_debit := public.mbg_debit_journey_fare(v_customer_user_id, v_customer_charge_ican, 'mybodaguy', p_ride_id::TEXT);

    IF COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
      v_rider_credit_ican := ROUND(v_fare_ican * v_ride.rider_earning / NULLIF(v_ride.fare, 0), 8);
      PERFORM public.mbg_credit_ride_earning(v_rider_user_id, v_rider_credit_ican, 'mybodaguy', p_ride_id::TEXT, 'Ride earning');

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
    -- actually collects the owed commission from their own wallet.
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

-- ── 5. mbg_confirm_cash_received — rider-invoked, pays the owed commission
-- out of the rider's own ICAN wallet and unblocks new job matching. ────────
CREATE OR REPLACE FUNCTION public.mbg_confirm_cash_received(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_rider_id UUID;
  v_rider_user_id UUID;
  v_rider_vehicle_type TEXT;
  v_is_boda BOOLEAN;
  v_commission_ugx NUMERIC;
  v_commission_ican NUMERIC;
  v_debit JSONB;
  v_payment_id UUID;
  v_region RECORD;
  v_level RECORD;
  v_chair_user_id UUID;
  v_pct NUMERIC;
  v_amount_ugx NUMERIC;
  v_amount_ican NUMERIC;
  ICAN_TO_UGX CONSTANT NUMERIC := 5000;
BEGIN
  SELECT id, user_id, vehicle_type::TEXT INTO v_rider_id, v_rider_user_id, v_rider_vehicle_type
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
  v_commission_ican := ROUND(v_commission_ugx / ICAN_TO_UGX, 8);

  IF v_commission_ican > 0 THEN
    v_debit := public.mbg_debit_journey_fare(v_rider_user_id, v_commission_ican, 'mybodaguy', p_ride_id::TEXT);
    IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_debit ->> 'error', 'Payment failed — top up your ICAN wallet and try again'));
    END IF;
  END IF;

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

  UPDATE public.mbg_rides SET cash_confirmed_at = now(), updated_at = now() WHERE id = p_ride_id;
  PERFORM set_config('mbg.trusted_write', 'true', true);
  UPDATE public.mbg_riders SET is_available = true, updated_at = now() WHERE id = v_rider_id;

  RETURN jsonb_build_object('success', true, 'commission_paid_ugx', v_commission_ugx);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_confirm_cash_received TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Ride payment method (wallet/cash) + flat commission (5%% boda chairperson / 15%% non-boda platform) ready. Real ICAN settlement now runs on mbg_complete_ride/mbg_confirm_cash_received.';
END $$;
