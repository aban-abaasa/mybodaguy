-- ============================================================================
-- Exact fare to the rider, platform charges added ON TOP for the customer —
-- the same for cash and wallet.
--
-- Before this file the money depended on the payment method and the rider
-- silently lost part of their own fare (F = the fare, the exact transport fee):
--   wallet — customer charged F + 8% (shown as one total), rider shown F - 7%
--   cash   — customer handed over F only, rider shown F - 15% (the rider
--            fronted both slices and owed it back as a debt)
-- so the customer's price changed with the payment method and the rider never
-- got the fee they were quoted.
--
-- Now ONE rule for every regular ride and delivery, every vehicle type:
--   · the customer pays F + C, where C = F x commission.icanera_platform_fee_
--     percentage (8% by default, developer-editable). The charge is only ever
--     added on top of the exact fee, so the customer sees one full amount and it
--     is identical for cash and wallet;
--   · the rider ALWAYS receives exactly F (rider_earning = fare). Nothing is
--     taken out of the fare, so the "You take home" figure is the real fee;
--   · wallet: the customer's wallet is debited F + C, the rider is credited F;
--   · cash:   the customer hands the rider F + C in cash and the rider's own
--     wallet is debited C straight away, so the rider nets exactly F. Whatever
--     the wallet balance can't cover becomes cash_commission_debt_ugx and is
--     recovered from their next wallet-paid ride, exactly as before;
--   · C is settled the moment it is collected: the boda chairpersons (personal
--     boda rides only) are paid out of C through mbg_distribute_chair_
--     commissions (ADD_CHAIN_COMMISSION_AND_COMMITTEE_SHARING.sql) and ICANera
--     keeps the rest. Money is conserved: customer pays F + C, rider gets F,
--     chairpersons + ICANera share C.
--
-- Because the rider is no longer charged a slice, the platform's take per ride
-- drops from the old 15% of the fare to the single 8% charge; raise
-- commission.icanera_platform_fee_percentage in the Developer Dashboard's
-- Commissions tab to change that (it moves the customer's price too).
--
-- Switching cash <-> wallet at completion (the rider confirms how they were
-- actually paid) no longer needs any repricing: rider_earning, the charge and
-- the chair payout do not depend on the payment method.
--
-- What changes (all CREATE OR REPLACE, signatures unchanged):
--   mbg_compute_ride_charges  NEW — replaces mbg_compute_ride_split for
--                             regular rides: customer charge + rider_earning = fare
--   mbg_settle_ride_charge    NEW — pays chairpersons out of the charge, credits
--                             ICANera the remainder (idempotent per ride)
--   mbg_request_ride          stores rider_earning = fare, returns the customer total
--   mbg_apply_business_pricing, mbg_reprice_ride_on_rider_change
--                             same rule for company riders / auto-dispatch re-pricing
--   mbg_respond_to_ride       store deliveries settle the charge at acceptance
--   mbg_complete_ride         wallet: settle the charge; cash: debit the rider's
--                             wallet, shortfall -> debt
--
-- Deliberately NOT changed:
--   · mbg_pay_rider_for_ride — it already credits the rider fare x rider_earning
--     / fare and pays chairpersons from (fare - rider_earning); with
--     rider_earning = fare that gap is simply zero, and rides priced under the
--     old rule (accepted store deliveries, prepaid journey legs) keep settling
--     exactly as they did.
--   · mbg_compute_ride_split — prepaid journey legs are quoted and paid up
--     front at a fixed price and keep their own rule; mbg_apply_business_pricing
--     still uses it for those (is_journey_prepaid).
--   · company-billed rides (payment_method 'company') and escort add-on fees.
--
-- Rides still in flight when this runs (pending / accepted / in progress, not
-- yet charged) are re-quoted onto the new rule by the backfill at the bottom.
-- Accepted store deliveries are already charged and settle on the old terms.
--
-- Run after ADD_VEHICLE_CLASS_FARE_RATES.sql (latest mbg_request_ride /
-- mbg_apply_business_pricing / mbg_reprice_ride_on_rider_change),
-- ADD_ICANERA_UNIFIED_PLATFORM_FEE.sql (latest mbg_respond_to_ride /
-- mbg_complete_ride, patched by ADD_CHAIN_COMMISSION_AND_COMMITTEE_SHARING.sql
-- to pay chairpersons through mbg_distribute_chair_commissions) and
-- ICAN/backend/ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql
-- (fn_credit_platform_fee_to_business). Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Settings: one charge, said plainly. The two rider-side cuts are retired —
--    nothing reads them any more, they stay so historical reports still make sense.
-- ----------------------------------------------------------------------------

UPDATE public.mbg_platform_settings
   SET description = 'The platform charge added ON TOP of the exact fare of every ride/delivery, every vehicle type, identical for cash and wallet: the customer pays fare + this %, the rider always receives the exact fare. Wallet: debited from the customer together with the fare. Cash: handed over by the customer together with the fare, then debited from the rider''s wallet (any shortfall becomes cash-commission debt). Chairpersons are paid out of it. Developer-editable from the Commissions tab.',
       updated_at = NOW()
 WHERE key = 'commission.icanera_platform_fee_percentage';

UPDATE public.mbg_platform_settings
   SET description = 'RETIRED — riders now always receive the exact fare; nothing is taken from it any more (the platform charge is added on top for the customer instead, see commission.icanera_platform_fee_percentage). Kept only so historical rides stay meaningful in reports.',
       updated_at = NOW()
 WHERE key IN ('commission.rider_platform_cut_percentage', 'commission.company_platform_cut_percentage');

-- ----------------------------------------------------------------------------
-- 1. The customer's charge, and the new split.
-- ----------------------------------------------------------------------------

-- The platform charge, in UGX, added on top of a fare.
CREATE OR REPLACE FUNCTION public.mbg_ride_customer_charge_ugx(p_fare NUMERIC)
RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT ROUND(COALESCE(p_fare, 0) * public.mbg_get_setting_numeric('commission.icanera_platform_fee_percentage', 8) / 100);
$$;
REVOKE ALL ON FUNCTION public.mbg_ride_customer_charge_ugx(NUMERIC) FROM PUBLIC, anon, authenticated;

-- The most the chairpersons can take out of a charge: mbg_distribute_chair_
-- commissions pays stage = pool x chain%, parish = stage x chain%, ... down five
-- levels (committee shares come out of a chairperson's own amount, so they don't
-- change the total). Vacant seats pay nothing, so this is an upper bound — used
-- only for the figures recorded on the ride for reporting.
CREATE OR REPLACE FUNCTION public.mbg_chair_chain_share_ugx(p_pool_ugx NUMERIC)
RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(SUM(COALESCE(p_pool_ugx, 0) * power(c.rate, i.n)), 0)
    FROM (SELECT public.mbg_get_setting_numeric('commission.chain_percentage', 5) / 100 AS rate) c,
         generate_series(1, 5) AS i(n);
$$;
REVOKE ALL ON FUNCTION public.mbg_chair_chain_share_ugx(NUMERIC) FROM PUBLIC, anon, authenticated;

-- The ONE place the regular-ride split is computed (requests, the company-
-- pricing trigger and the auto-dispatch re-pricing all go through it):
--   o_customer_charge  what the customer pays on top of the fare
--   o_rider_earning    always the whole fare
--   o_chair_total      most the boda chairpersons can take out of the charge
--                      (personal boda rides only)
--   o_platform_net     what ICANera keeps of the charge at that most
-- It does not depend on the payment method.
CREATE OR REPLACE FUNCTION public.mbg_compute_ride_charges(
  p_fare NUMERIC,
  p_is_boda BOOLEAN,
  p_is_company BOOLEAN
) RETURNS TABLE (o_customer_charge NUMERIC, o_rider_earning NUMERIC, o_chair_total NUMERIC, o_platform_net NUMERIC)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  o_customer_charge := public.mbg_ride_customer_charge_ugx(p_fare);
  o_rider_earning   := p_fare;
  o_chair_total     := CASE
    WHEN p_is_boda AND NOT COALESCE(p_is_company, FALSE) THEN ROUND(public.mbg_chair_chain_share_ugx(o_customer_charge))
    ELSE 0
  END;
  o_platform_net    := GREATEST(o_customer_charge - o_chair_total, 0);
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_compute_ride_charges(NUMERIC, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- Settles a charge the moment it is collected: pays the chairpersons out of it
-- (when p_pay_chairs) and credits ICANera the rest to the platform-fee business
-- wallet. Returns what the chairpersons were paid, in UGX. The ICANera credit is
-- idempotent on p_fee_reference and, like every other platform-fee credit, can
-- never fail the ride it is attached to.
CREATE OR REPLACE FUNCTION public.mbg_settle_ride_charge(
  p_ride_id UUID,
  p_payment_id UUID,
  p_stage_id UUID,
  p_fare NUMERIC,
  p_charge_ugx NUMERIC,
  p_pay_chairs BOOLEAN,
  p_actor_user_id UUID,
  p_fee_reference TEXT,
  p_chair_note TEXT,
  p_fee_note TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_chairs_paid_ugx NUMERIC := 0;
  ICAN_TO_UGX CONSTANT NUMERIC := 5000;
BEGIN
  IF COALESCE(p_charge_ugx, 0) <= 0 THEN
    RETURN 0;
  END IF;

  IF p_pay_chairs THEN
    v_chairs_paid_ugx := public.mbg_distribute_chair_commissions(
      p_ride_id, p_payment_id, p_stage_id, p_fare, p_charge_ugx, p_chair_note, false
    );
  END IF;

  IF p_charge_ugx - v_chairs_paid_ugx > 0 THEN
    PERFORM public.fn_credit_platform_fee_to_business(
      p_amount_ican      => ROUND((p_charge_ugx - v_chairs_paid_ugx) / ICAN_TO_UGX, 8),
      p_source_app       => 'mybodaguy',
      p_source_reference => p_fee_reference,
      p_fee_type         => 'icanera_platform_fee',
      p_actor_user_id    => p_actor_user_id,
      p_note             => p_fee_note
    );
  END IF;

  RETURN v_chairs_paid_ugx;
END;
$$;
-- Internal money movement (SECURITY DEFINER, takes any ride id): never callable
-- from the API. Supabase grants new public functions to anon/authenticated by
-- default and REVOKE ... FROM PUBLIC does not undo that, so name them too — same
-- as mbg_distribute_chair_commissions does. The ride functions that call it are
-- SECURITY DEFINER themselves and keep working.
REVOKE ALL ON FUNCTION public.mbg_settle_ride_charge(UUID, UUID, UUID, NUMERIC, NUMERIC, BOOLEAN, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. mbg_request_ride — same as ADD_VEHICLE_CLASS_FARE_RATES.sql except the rider's
--    take-home is always the whole fare and the response carries the charge and the
--    customer's total. Same 20-arg signature — plain CREATE OR REPLACE.
-- ----------------------------------------------------------------------------

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
  p_expense_classification TEXT DEFAULT NULL,
  p_customer_business_profile_id UUID DEFAULT NULL,
  p_cargo_weight_kg NUMERIC DEFAULT NULL,
  p_cargo_class TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id UUID;
  v_rider public.mbg_riders%ROWTYPE;
  v_stage_id UUID;
  v_distance_km NUMERIC;
  v_multiplier NUMERIC := public.mbg_current_time_multiplier();
  v_fare NUMERIC;
  v_is_boda BOOLEAN;
  v_platform_net NUMERIC;
  v_rider_earning NUMERIC;
  v_chair_total NUMERIC;
  v_customer_charge NUMERIC;
  v_ride_id UUID;
  v_cart_item JSONB;
  v_cart_qty NUMERIC;
  v_min_deadline_hours NUMERIC;
  v_max_deadline_hours NUMERIC;
  v_expense_classification TEXT;
  v_customer_business_profile_id UUID;
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

  v_expense_classification := CASE
    WHEN p_service_type = 'delivery' THEN COALESCE(p_expense_classification, 'personal_expense')
    ELSE NULL
  END;

  v_customer_business_profile_id := CASE
    WHEN p_service_type = 'delivery' AND v_expense_classification = 'business_expense' THEN p_customer_business_profile_id
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

  -- Cargo declared for a van / truck booking: a known handling class, and a
  -- load this vehicle can actually carry.
  IF COALESCE(p_cargo_weight_kg, 0) < 0 THEN
    RAISE EXCEPTION 'Cargo weight cannot be negative';
  END IF;
  IF p_cargo_class IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mbg_cargo_classes WHERE code = p_cargo_class) THEN
    RAISE EXCEPTION 'Unknown cargo type: %', p_cargo_class;
  END IF;
  IF COALESCE(p_cargo_weight_kg, 0) > 0 AND public.mbg_effective_capacity_kg(v_rider) < p_cargo_weight_kg THEN
    RAISE EXCEPTION 'This vehicle cannot carry % kg — choose a larger vehicle', ROUND(p_cargo_weight_kg);
  END IF;

  v_distance_km := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  IF v_distance_km IS NULL THEN
    RAISE EXCEPTION 'Invalid pickup/dropoff coordinates';
  END IF;

  -- The fare depends on what is actually driving and what it is carrying: a
  -- boda, car, van and truck each have their own rates, van/truck add the cargo
  -- weight and handling class at the live icaneracoin price, a company's own
  -- rates win over the class rates, and the rider's mode applies on top.
  v_fare := public.mbg_price_ride_for_rider(v_rider, v_distance_km, v_multiplier, p_cargo_weight_kg, p_cargo_class);

  v_is_boda := v_rider.vehicle_type::TEXT IN ('motorcycle', 'bicycle', 'tuktuk');

  -- rider_earning is the ONE number the rider is shown and the exact amount
  -- they keep: always the whole fare, whatever the payment method. The
  -- platform's charge is added on top of the fare for the customer (the same
  -- for cash and wallet); the chairperson share and ICANera's net of it are
  -- recorded for reporting. All of the arithmetic lives in
  -- mbg_compute_ride_charges so it can't drift between here and the
  -- company-pricing trigger.
  SELECT s.o_customer_charge, s.o_rider_earning, s.o_chair_total, s.o_platform_net
    INTO v_customer_charge, v_rider_earning, v_chair_total, v_platform_net
    FROM public.mbg_compute_ride_charges(
      v_fare, v_is_boda, v_rider.business_profile_id IS NOT NULL
    ) s;

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
    order_notes, payment_method, cart, max_delivery_hours, expense_classification,
    customer_business_profile_id, cargo_weight_kg, cargo_class
  ) VALUES (
    v_customer_id, p_rider_id, v_stage_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(v_distance_km / 25 * 60)), v_fare,
    p_service_type, p_delivery_mode, p_supermarket_id,
    p_power_type_requested, COALESCE(p_umbrella_requested, false),
    v_multiplier, v_rider_earning, v_chair_total,
    p_order_notes, p_payment_method, p_cart, p_max_delivery_hours, v_expense_classification,
    v_customer_business_profile_id, NULLIF(p_cargo_weight_kg, 0), COALESCE(p_cargo_class, 'standard')
  ) RETURNING id, fare, rider_earning INTO v_ride_id, v_fare, v_rider_earning;

  -- A company rider's own pricing (trg_mbg_apply_business_pricing) can change
  -- the fare and split as the row is written, so the fee record and the
  -- response below use what was actually stored, not the pre-insert numbers.
  SELECT s.o_customer_charge, s.o_platform_net INTO v_customer_charge, v_platform_net
    FROM public.mbg_compute_ride_charges(
      v_fare, v_is_boda, v_rider.business_profile_id IS NOT NULL
    ) s;

  -- ICANera's expected net: the charge minus what the chairpersons take.
  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx) VALUES (v_ride_id, v_platform_net);

  RETURN jsonb_build_object(
    'success', true, 'ride_id', v_ride_id, 'fare', v_fare,
    'distance_km', v_distance_km, 'rider_earning', v_rider_earning,
    'platform_charge', v_customer_charge, 'customer_total', v_fare + v_customer_charge
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, JSONB, NUMERIC, TEXT, UUID,
  NUMERIC, TEXT
) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Company-pricing and auto-dispatch re-pricing triggers — same as
--    ADD_VEHICLE_CLASS_FARE_RATES.sql except the split comes from
--    mbg_compute_ride_charges (prepaid journey legs keep mbg_compute_ride_split).
--    The triggers themselves already exist on mbg_rides.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_apply_business_pricing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider public.mbg_riders%ROWTYPE;
  v_pricing public.mbg_business_pricing_settings%ROWTYPE;
  v_split RECORD;
BEGIN
  IF NEW.rider_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_rider FROM public.mbg_riders WHERE id = NEW.rider_id;
  IF v_rider.business_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_pricing FROM public.mbg_business_pricing_settings WHERE business_profile_id = v_rider.business_profile_id;
  IF FOUND
     AND NOT COALESCE(NEW.is_journey_prepaid, false)
     AND NEW.distance_km IS NOT NULL
     AND NOT (v_pricing.base_fare IS NULL AND v_pricing.per_km_rate IS NULL AND v_pricing.min_fare IS NULL) THEN
    -- The company's own rates win field by field; anything it left blank
    -- falls back to the rider's vehicle-class rate card (a company van falls
    -- back to the van rates, not the boda ones).
    NEW.fare := public.mbg_price_ride_for_rider(
      v_rider, NEW.distance_km, COALESCE(NEW.time_multiplier, 1), NEW.cargo_weight_kg, NEW.cargo_class
    );
  END IF;

  IF COALESCE(NEW.fare, 0) > 0 THEN
    IF COALESCE(NEW.is_journey_prepaid, false) THEN
      -- A prepaid journey leg is quoted and paid up front at a fixed price: it
      -- keeps its own split rule, as before.
      SELECT * INTO v_split FROM public.mbg_compute_ride_split(
        NEW.fare,
        v_rider.vehicle_type::TEXT IN ('motorcycle', 'bicycle', 'tuktuk'),
        TRUE,
        NEW.payment_method
      );
    ELSE
      -- Every other ride: the rider gets the whole fare and the platform's
      -- charge goes on top for the customer, company rider or not.
      SELECT o_rider_earning, o_chair_total INTO v_split FROM public.mbg_compute_ride_charges(
        NEW.fare,
        v_rider.vehicle_type::TEXT IN ('motorcycle', 'bicycle', 'tuktuk'),
        TRUE
      );
    END IF;
    NEW.rider_earning := v_split.o_rider_earning;
    NEW.chairperson_commission_total := v_split.o_chair_total;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.mbg_reprice_ride_on_rider_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider public.mbg_riders%ROWTYPE;
  v_split RECORD;
BEGIN
  IF NEW.rider_id IS NULL
     OR NEW.status <> 'pending'
     OR COALESCE(NEW.dispatch_mode, 'direct') <> 'auto'
     OR COALESCE(NEW.is_journey_prepaid, false)
     OR NEW.distance_km IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_rider FROM public.mbg_riders WHERE id = NEW.rider_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  NEW.fare := public.mbg_price_ride_for_rider(
    v_rider, NEW.distance_km, COALESCE(NEW.time_multiplier, 1), NEW.cargo_weight_kg, NEW.cargo_class
  );

  SELECT * INTO v_split FROM public.mbg_compute_ride_charges(
    NEW.fare,
    v_rider.vehicle_type::TEXT IN ('motorcycle', 'bicycle', 'tuktuk'),
    v_rider.business_profile_id IS NOT NULL
  );
  NEW.rider_earning := v_split.o_rider_earning;
  NEW.chairperson_commission_total := v_split.o_chair_total;

  UPDATE public.mbg_ride_platform_fees SET platform_fee_ugx = v_split.o_platform_net WHERE ride_id = NEW.id;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 4. mbg_respond_to_ride — same as ADD_ICANERA_UNIFIED_PLATFORM_FEE.sql except a
--    store delivery's charge is settled (chairpersons + ICANera) the moment the
--    wallet is debited at acceptance. Same (UUID, BOOLEAN) signature.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_respond_to_ride(p_ride_id UUID, p_accept BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_rider_id UUID;
  v_customer_user_id UUID;
  v_store RECORD;
  v_platform_fee_pct NUMERIC;
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
  v_rider_vehicle_type TEXT;
  v_rider_is_company BOOLEAN;
  v_payment_id UUID;
  ICAN_TO_UGX CONSTANT NUMERIC := 5000;
BEGIN
  SELECT id, vehicle_type::TEXT, business_profile_id IS NOT NULL
    INTO v_rider_id, v_rider_vehicle_type, v_rider_is_company
    FROM public.mbg_riders WHERE user_id = auth.uid();
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

      v_expense_classification := COALESCE(v_ride.expense_classification, 'personal_expense');

      v_platform_fee_pct := public.mbg_get_setting_numeric('commission.icanera_platform_fee_percentage', 8);
      v_fare_ican := ROUND(v_ride.fare / ICAN_TO_UGX, 8);
      v_customer_charge_ican := ROUND(v_fare_ican * (1 + v_platform_fee_pct / 100), 8);

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
      VALUES (p_ride_id, v_ride.customer_id, v_rider_id, v_ride.fare, 'pending')
      RETURNING id INTO v_payment_id;

      -- The charge just collected on top of the fare IS ICANera's per-ride
      -- platform fee: settle it now — chairpersons (personal boda) are paid
      -- out of it, ICANera is credited the rest (same treatment every other
      -- platform fee gets, ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql). Never
      -- itemized to the customer, never allowed to fail the delivery.
      PERFORM public.mbg_settle_ride_charge(
        p_ride_id, v_payment_id, v_ride.stage_id, v_ride.fare,
        public.mbg_ride_customer_charge_ugx(v_ride.fare),
        v_rider_vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk') AND NOT COALESCE(v_rider_is_company, FALSE),
        v_customer_user_id, 'ride-wallet-surcharge:' || p_ride_id::text,
        'chairperson commission',
        format('ICANera platform fee on store delivery %s (charge on top of the fare, collected at acceptance)', p_ride_id)
      );

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

-- ----------------------------------------------------------------------------
-- 5. mbg_complete_ride — wallet: collect F + C (unless already collected at
--    acceptance) and settle C; cash: the customer already handed F + C over, so
--    settle C and take it back from the rider's wallet now. Same (UUID, TEXT)
--    signature as ADD_ICANERA_UNIFIED_PLATFORM_FEE.sql — plain CREATE OR REPLACE.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_complete_ride(p_ride_id UUID, p_payment_method TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_rider_id UUID;
  v_rider_user_id UUID;
  v_rider_vehicle_type TEXT;
  v_is_boda BOOLEAN;
  v_is_company BOOLEAN;
  v_customer_user_id UUID;
  v_payment_id UUID;
  v_fare_ican NUMERIC;
  v_platform_fee_pct NUMERIC := public.mbg_get_setting_numeric('commission.icanera_platform_fee_percentage', 8);
  v_customer_charge_ican NUMERIC;
  v_debit JSONB;
  v_charge_ugx NUMERIC;
  v_charged_now BOOLEAN := FALSE;
  v_actual_method TEXT;
  v_is_pending_customer_confirmation BOOLEAN;
  v_rider_balance_ican NUMERIC;
  v_owed_ican NUMERIC;
  v_taken_ican NUMERIC := 0;
  v_taken_ugx NUMERIC := 0;
  v_debt_added_ugx NUMERIC := 0;
  ICAN_TO_UGX CONSTANT NUMERIC := 5000;
BEGIN
  SELECT id, user_id, vehicle_type::TEXT, business_profile_id IS NOT NULL
    INTO v_rider_id, v_rider_user_id, v_rider_vehicle_type, v_is_company
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

  v_is_pending_customer_confirmation := (v_ride.service_type = 'delivery' AND v_ride.delivery_mode = 'supermarket');

  -- The platform charge the customer pays on top of the fare — the same
  -- amount whether this ends up cash or wallet.
  v_charge_ugx := public.mbg_ride_customer_charge_ugx(v_ride.fare);

  IF v_actual_method = 'wallet' THEN
    v_fare_ican := ROUND(v_ride.fare / ICAN_TO_UGX, 8);

    IF NOT v_ride.wallet_charged_at_acceptance THEN
      v_customer_charge_ican := ROUND(v_fare_ican * (1 + v_platform_fee_pct / 100), 8);
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

      -- Settled below, once the payment row exists for the chairperson records.
      v_charged_now := TRUE;
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
    -- The charge just collected on top of the fare: chairpersons are paid out
    -- of it, ICANera credited the rest. (A store delivery's charge was already
    -- settled when the wallet was debited at acceptance.)
    IF v_charged_now THEN
      PERFORM public.mbg_settle_ride_charge(
        p_ride_id, v_payment_id, v_ride.stage_id, v_ride.fare, v_charge_ugx,
        v_is_boda AND NOT COALESCE(v_is_company, FALSE) AND v_payment_id IS NOT NULL,
        v_customer_user_id, 'ride-wallet-surcharge:' || p_ride_id::text,
        'chairperson commission',
        format('ICANera platform fee on ride/delivery %s (charge on top of the fare, wallet)', p_ride_id)
      );
    END IF;

    IF v_is_pending_customer_confirmation THEN
      NULL;
    ELSE
      PERFORM public.mbg_pay_rider_for_ride(p_ride_id);
    END IF;

    UPDATE public.mbg_riders SET
      is_available = true, total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
    WHERE id = v_rider_id;

  ELSE
    -- Cash: the customer handed the rider the fare PLUS the charge, so the
    -- rider is holding the platform's money and keeps exactly the fare once
    -- it is taken back. Out of the platform's float, the chairpersons (boda)
    -- are paid and ICANera is credited the rest of the charge immediately...
    PERFORM public.mbg_settle_ride_charge(
      p_ride_id, v_payment_id, v_ride.stage_id, v_ride.fare, v_charge_ugx,
      v_is_boda AND NOT COALESCE(v_is_company, FALSE) AND v_payment_id IS NOT NULL,
      v_rider_user_id, 'ride-cash-platform-fee:' || p_ride_id::text,
      'chairperson commission (cash settlement)',
      format('ICANera platform fee on cash ride %s (charge on top of the fare, taken from the rider''s wallet)', p_ride_id)
    );

    -- ...and the charge is debited from the rider's wallet now. Whatever the
    -- balance can't cover becomes the running debt, recovered from their next
    -- wallet-paid ride (mbg_pay_rider_for_ride).
    IF v_charge_ugx > 0 THEN
      v_owed_ican := ROUND(v_charge_ugx / ICAN_TO_UGX, 8);
      SELECT ican_balance INTO v_rider_balance_ican
        FROM public.ican_user_wallets WHERE user_id = v_rider_user_id FOR UPDATE;
      v_taken_ican := LEAST(GREATEST(COALESCE(v_rider_balance_ican, 0), 0), v_owed_ican);

      IF v_taken_ican > 0 THEN
        v_debit := public.mbg_debit_journey_fare(v_rider_user_id, v_taken_ican, 'mybodaguy', p_ride_id::TEXT, NULL);
        IF COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
          UPDATE public.ican_coin_transactions
             SET note = format('ICANera platform charge on cash ride (ref: %s)', p_ride_id)
           WHERE id = (v_debit ->> 'tx_id')::UUID;
        ELSE
          v_taken_ican := 0;
        END IF;
      END IF;

      v_taken_ugx := ROUND(v_taken_ican * ICAN_TO_UGX);
      v_debt_added_ugx := GREATEST(v_charge_ugx - v_taken_ugx, 0);
    END IF;

    IF v_debt_added_ugx > 0 THEN
      UPDATE public.mbg_riders
         SET cash_commission_debt_ugx = cash_commission_debt_ugx + v_debt_added_ugx
       WHERE id = v_rider_id;
    END IF;

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
    'platform_charge_ugx', v_charge_ugx,
    'customer_total_ugx', v_ride.fare + v_charge_ugx,
    'commission_due_ugx', CASE WHEN v_actual_method = 'cash' THEN v_charge_ugx ELSE 0 END,
    'charge_taken_from_wallet_ugx', v_taken_ugx,
    'charge_added_to_debt_ugx', v_debt_added_ugx,
    'awaiting_customer_confirmation', v_is_pending_customer_confirmation AND v_actual_method = 'wallet'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_complete_ride(UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Rides still in flight and not yet charged: re-quote them onto the new rule
--    (the rider's take-home becomes the whole fare). Store deliveries already
--    charged at acceptance and prepaid journey legs keep the numbers they were
--    settled on. Idempotent.
-- ----------------------------------------------------------------------------

WITH target AS (
  SELECT r.id, r.fare,
         rd.vehicle_type::TEXT IN ('motorcycle', 'bicycle', 'tuktuk') AS is_boda,
         rd.business_profile_id IS NOT NULL AS is_company
    FROM public.mbg_rides r
    JOIN public.mbg_riders rd ON rd.id = r.rider_id
   WHERE r.status::TEXT IN ('pending', 'accepted', 'in_progress')
     AND NOT COALESCE(r.is_journey_prepaid, false)
     AND NOT COALESCE(r.wallet_charged_at_acceptance, false)
     AND COALESCE(r.fare, 0) > 0
     AND r.rider_earning IS DISTINCT FROM r.fare
), requoted AS (
  SELECT t.id, c.o_rider_earning, c.o_chair_total, c.o_platform_net
    FROM target t
    CROSS JOIN LATERAL public.mbg_compute_ride_charges(t.fare, t.is_boda, t.is_company) c
), updated AS (
  UPDATE public.mbg_rides r
     SET rider_earning = q.o_rider_earning,
         chairperson_commission_total = q.o_chair_total
    FROM requoted q
   WHERE r.id = q.id
  RETURNING r.id
)
UPDATE public.mbg_ride_platform_fees pf
   SET platform_fee_ugx = q.o_platform_net
  FROM requoted q
 WHERE pf.ride_id = q.id;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Rides now pay the rider the exact fare; the platform charge (commission.icanera_platform_fee_percentage, default 8%%) is added on top for the customer, identical for cash and wallet. Cash charges are debited from the rider''s wallet at completion, any shortfall becomes cash-commission debt.';
END $$;
