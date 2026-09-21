-- ============================================================================
-- ICANera's own cut of every ride is now ONE flat, developer-configurable
-- percentage (commission.icanera_platform_fee_percentage, default 8%) that
-- applies the same way to every vehicle type — motorcycle/bicycle/tuktuk
-- and car/van/truck alike. Replaces the earlier split model (a boda-only 7%
-- fronted by the rider on cash, a separate 15% embedded in a non-boda
-- ride's fare) with one number everyone shares the same rule for. Chosen
-- via the Developer Dashboard's existing Commissions tab — any row in
-- mbg_platform_settings with category='commission' already shows up there
-- (mbg_dev_get_commission_settings / mbg_dev_update_commission_setting,
-- ADD_DEV_COMMISSION_SETTINGS_ACCESS.sql), so no new UI is needed, just
-- this new row.
--
-- Model (fare F = 100%). The platform's pool per ride is 15% of F, made of
-- two silent slices, and the chairperson (boda only) is paid out of that
-- pool — never on top of it, never as a separate rider deduction:
--   · 8% from the CUSTOMER  (commission.icanera_platform_fee_percentage)
--   · 7% from the RIDER     (commission.rider_platform_cut_percentage)
--   · 5% of the 15% goes to the chairpersons (commission.*_chair_percentage,
--     summing to commission.boda_chair_total_percentage = 5); ICANera keeps
--     the other 10% (all 15% on a non-boda ride, or if a chair seat is empty).
-- Nobody sees a breakdown. WHO actually fronts the pool depends on payment
-- method, decided once at request time and never adjusted afterwards:
--   wallet — the customer is charged F + 8% as ONE total (never itemized).
--     The rider is shown ONE flat number, F − 7%, which is exactly what
--     lands in their wallet: rider_earning IS the true final take-home.
--     Customer pays 108, rider gets 93, chairs 5, ICANera 10.
--   cash — the app can never add anything on top of a fixed cash handover,
--     so the rider fronts BOTH slices (15%): rider_earning = F − 15%, again
--     the number shown and the number kept. The chairs' 5% and ICANera's 10%
--     are paid immediately out of the platform's own float when the ride
--     completes and recovered from the rider as a running debt
--     (cash_commission_debt_ugx) against their NEXT wallet-paid ride.
--
-- COMPANY riders (mbg_riders.business_profile_id set) are on a simpler deal:
-- ICANera takes the customer's 8% (silent, on top of a wallet total) plus a
-- flat 5% out of the ride's pay (commission.company_platform_cut_percentage)
-- and nothing else — no chairperson share. The company's admin sets their own
-- FARE rates (mbg_set_business_pricing); the fee split is the platform's.
-- Wallet: customer pays F + 8%, rider gets F − 5%. Cash: rider gets F − 13%.
-- The arithmetic for both kinds of rider lives in mbg_compute_ride_split, used
-- by mbg_request_ride and by the company-pricing trigger
-- (mbg_apply_business_pricing, redefined here).
--
-- This SUPERSEDES ADD_ICANERA_REAL_PLATFORM_FEE_BODA_7PCT.sql, which never
-- shipped (written and revised within the same session) — deleted rather
-- than left alongside this one, same "nothing has shipped on that shape
-- yet" precedent as ADD_SERVICE_BOOKING_FORM_MULTISELECT.sql's own
-- predecessor. commission.nonboda_platform_percentage (15) and
-- commission.wallet_customer_surcharge_percentage (7) are left in the
-- settings table unused by the code path below (historical/reporting only,
-- same reasoning ADD_RIDE_PAYMENT_METHOD_AND_COMMISSION.sql already used
-- for the settings it superseded) rather than deleted.
--
-- Four call sites touch real money and all four need the same fix:
--   1. mbg_request_ride       — one unified, payment-method-aware split.
--   2. mbg_respond_to_ride    — store (supermarket) deliveries charge the
--                                wallet surcharge at ACCEPTANCE, not
--                                completion — every vehicle type.
--   3. mbg_complete_ride      — regular wallet-paid rides charge it at
--                                completion; cash rides front ICANera's cut
--                                immediately out of the float, alongside
--                                the chairperson's share where one exists.
--   4. mbg_pay_rider_for_ride — unchanged from before ICANera had any real
--                                cut at all: with the fee now always either
--                                a separate customer-side surcharge (wallet)
--                                or pre-subtracted into rider_earning before
--                                this function ever runs (cash), there's no
--                                fare-embedded gap left for this function to
--                                recover — the rider's own credit here is
--                                already exactly right.
--
-- Every fn_credit_platform_fee_to_business() call below is idempotent
-- (unique on (source_app, source_reference)) and never allowed to fail the
-- ride/delivery it's attached to — that safety is already built into the
-- function itself.
--
-- Run after ADD_DELIVERY_CUSTOMER_BUSINESS_SELECTION.sql (latest
-- mbg_request_ride), ADD_DELIVERY_EXPENSE_CLASSIFICATION.sql (latest
-- mbg_respond_to_ride), ADD_CUSTOMER_DELIVERY_CONFIRMATION.sql (latest
-- mbg_complete_ride / mbg_pay_rider_for_ride), ADD_DEV_COMMISSION_SETTINGS_
-- ACCESS.sql (Developer Dashboard editing), CREATE_BODAGOERA_BUSINESS_PRICING.sql
-- (company pricing table + trigger), and
-- ICAN/backend/ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql
-- (fn_credit_platform_fee_to_business).
-- ============================================================================

INSERT INTO public.mbg_platform_settings (key, value, value_type, description, category, is_public) VALUES
  ('commission.icanera_platform_fee_percentage', '8.0', 'number',
   'ICANera''s own flat platform-fee percentage on every ride/delivery, every vehicle type. Wallet: folded into the customer''s single total, never itemized. Cash: fronted by the rider, recovered from their next wallet-paid ride. Developer-editable from the Commissions tab.',
   'commission', true)
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

-- The rider's own silent slice of the platform pool (the 8% above is the
-- customer's). Wallet: subtracted from the flat price the rider is shown.
-- Cash: added to the 8% the rider fronts. Developer-editable, same tab.
INSERT INTO public.mbg_platform_settings (key, value, value_type, description, category, is_public) VALUES
  ('commission.rider_platform_cut_percentage', '7.0', 'number',
   'Rider''s slice of the platform pool, taken silently from the fare (rider is shown one flat take-home price). Together with commission.icanera_platform_fee_percentage (customer''s slice) this forms the pool the boda chairpersons are paid out of. Developer-editable from the Commissions tab.',
   'commission', false)
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

-- Chairpersons are now paid 5% of the fare OUT OF the platform pool (was 12%
-- deducted from the rider). Same 40/24/16/12/8 split across the five levels.
UPDATE public.mbg_platform_settings SET value = '5.0',  updated_at = NOW(),
  description = 'Boda chairpersons'' total share of each ride, paid OUT OF the platform pool (customer % + rider %), not deducted from the rider. Keep the five level rows below adding up to this — payouts use the individual levels.'
  WHERE key = 'commission.boda_chair_total_percentage';
UPDATE public.mbg_platform_settings SET value = '2.0',  updated_at = NOW() WHERE key = 'commission.stage_chair_percentage';
UPDATE public.mbg_platform_settings SET value = '1.2',  updated_at = NOW() WHERE key = 'commission.parish_chair_percentage';
UPDATE public.mbg_platform_settings SET value = '0.8',  updated_at = NOW() WHERE key = 'commission.subcounty_chair_percentage';
UPDATE public.mbg_platform_settings SET value = '0.6',  updated_at = NOW() WHERE key = 'commission.division_chair_percentage';
UPDATE public.mbg_platform_settings SET value = '0.4',  updated_at = NOW() WHERE key = 'commission.district_chair_percentage';

-- Both of these were the ACTIVE rate at earlier points this same session
-- (nonboda_platform_percentage before boda ever had a real cut at all;
-- wallet_customer_surcharge_percentage briefly doing double duty as boda's
-- cash-fee rate) — neither is read by any function below anymore, both
-- fully replaced by the one shared commission.icanera_platform_fee_percentage
-- above. Left in the table rather than deleted (old rides may still
-- reference the percentage that applied at the time), but their
-- descriptions must say so plainly — both rows are still category='commission'
-- and so still visible/editable in the Developer Dashboard's Commissions
-- tab, where a stale description claiming either is still "ICANera's real
-- rate" would send a developer editing the wrong number.
UPDATE public.mbg_platform_settings
   SET description = 'RETIRED — no longer read by any code path. ICANera''s real platform-fee percentage now lives entirely in commission.icanera_platform_fee_percentage. Kept only so historical rides that used this rate stay meaningful in reports.',
       updated_at = NOW()
 WHERE key = 'commission.nonboda_platform_percentage';

UPDATE public.mbg_platform_settings
   SET description = 'RETIRED — no longer read by any code path (was briefly reused as ICANera''s boda cash-fee rate earlier in development; that role now belongs to commission.icanera_platform_fee_percentage). Kept only so historical rides that used this rate stay meaningful in reports.',
       updated_at = NOW()
 WHERE key = 'commission.wallet_customer_surcharge_percentage';

-- ----------------------------------------------------------------------------
-- 0. Company riders + the ONE place the split is computed.
--
-- A rider who belongs to a company (mbg_riders.business_profile_id set) is on
-- a simpler deal: ICANera takes the customer's 8% (silent, on top of a wallet
-- total) plus a flat 5% out of the ride's pay — and that is all. No
-- chairperson share. The company's admin sets the FARE rates for their own
-- drivers (mbg_set_business_pricing / mbg_business_pricing_settings, applied
-- by trg_mbg_apply_business_pricing below); ICANera's cut is not theirs to set.
-- ----------------------------------------------------------------------------

INSERT INTO public.mbg_platform_settings (key, value, value_type, description, category, is_public) VALUES
  ('commission.company_platform_cut_percentage', '5.0', 'number',
   'Company riders only: ICANera''s flat cut taken from the ride''s pay (on top of the customer-side platform fee). No chairperson share applies to company rides. Developer-editable from the Commissions tab.',
   'commission', false)
ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description;

-- rider_earning is the ONE number a rider is shown and keeps. Wallet: the
-- customer carries their own slice, so only the rider-side slice comes off.
-- Cash (or anything not paid from the wallet): nothing can be added on top of
-- the handover, so the rider fronts both slices. o_platform_net is what
-- ICANera expects to keep (whole pool minus the chairpersons).
CREATE OR REPLACE FUNCTION public.mbg_compute_ride_split(
  p_fare NUMERIC,
  p_is_boda BOOLEAN,
  p_is_company BOOLEAN,
  p_payment_method TEXT
) RETURNS TABLE (o_rider_earning NUMERIC, o_chair_total NUMERIC, o_platform_net NUMERIC)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_customer_slice NUMERIC := ROUND(p_fare * public.mbg_get_setting_numeric('commission.icanera_platform_fee_percentage', 8) / 100);
  v_rider_slice NUMERIC;
  v_chair NUMERIC;
BEGIN
  IF p_is_company THEN
    v_rider_slice := ROUND(p_fare * public.mbg_get_setting_numeric('commission.company_platform_cut_percentage', 5) / 100);
    v_chair := 0;
  ELSE
    v_rider_slice := ROUND(p_fare * public.mbg_get_setting_numeric('commission.rider_platform_cut_percentage', 7) / 100);
    v_chair := CASE WHEN p_is_boda
      THEN ROUND(p_fare * public.mbg_get_setting_numeric('commission.boda_chair_total_percentage', 5) / 100)
      ELSE 0
    END;
  END IF;

  o_rider_earning := p_fare - v_rider_slice - CASE WHEN COALESCE(p_payment_method, 'wallet') = 'wallet' THEN 0 ELSE v_customer_slice END;
  o_chair_total   := v_chair;
  o_platform_net  := GREATEST(v_customer_slice + v_rider_slice - v_chair, 0);
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_compute_ride_split(NUMERIC, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC;

-- Company pricing trigger (originally CREATE_BODAGOERA_BUSINESS_PRICING.sql).
-- Still recomputes the FARE from the business's own base/per-km/min rates when
-- they've set any, but the fee split is no longer the old 70%-rider / 5%-
-- platform / rest-to-chairpersons model: every company rider's ride now gets
-- the company split above, whether or not the business set custom rates.
-- The trigger itself already exists on mbg_rides; replacing the function is
-- enough.
CREATE OR REPLACE FUNCTION public.mbg_apply_business_pricing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider public.mbg_riders%ROWTYPE;
  v_pricing public.mbg_business_pricing_settings%ROWTYPE;
  v_fare NUMERIC;
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
     AND NEW.distance_km IS NOT NULL
     AND NOT (v_pricing.base_fare IS NULL AND v_pricing.per_km_rate IS NULL AND v_pricing.min_fare IS NULL) THEN
    v_fare := GREATEST(
      COALESCE(v_pricing.min_fare, public.mbg_get_setting_numeric('ride.minimum_fare', 2000)),
      COALESCE(v_pricing.base_fare, public.mbg_get_setting_numeric('ride.base_fare', 1000))
        + NEW.distance_km * COALESCE(v_pricing.per_km_rate, public.mbg_get_setting_numeric('ride.per_km_rate', 1000))
    ) * COALESCE(NEW.time_multiplier, 1);

    IF v_rider.mode = 'vip' THEN
      v_fare := v_fare * (1 + COALESCE(v_rider.vip_surcharge_pct, 0) / 100);
    ELSIF v_rider.mode = 'discount' THEN
      v_fare := v_fare * (1 - COALESCE(v_rider.discount_pct, 0) / 100);
    ELSIF v_rider.mode = 'return' THEN
      v_fare := v_fare * (1 - COALESCE(v_rider.return_discount_pct, 0) / 100);
    END IF;
    NEW.fare := ROUND(v_fare / 100) * 100;
  END IF;

  IF COALESCE(NEW.fare, 0) > 0 THEN
    SELECT * INTO v_split FROM public.mbg_compute_ride_split(
      NEW.fare,
      v_rider.vehicle_type::TEXT IN ('motorcycle', 'bicycle', 'tuktuk'),
      TRUE,
      NEW.payment_method
    );
    NEW.rider_earning := v_split.o_rider_earning;
    NEW.chairperson_commission_total := v_split.o_chair_total;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. mbg_request_ride — one unified split. Same 18-param signature as
--    ADD_DELIVERY_CUSTOMER_BUSINESS_SELECTION.sql — plain CREATE OR
--    REPLACE, no DROP needed.
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
  p_customer_business_profile_id UUID DEFAULT NULL
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
  v_platform_net NUMERIC;
  v_rider_earning NUMERIC;
  v_chair_total NUMERIC;
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

  -- rider_earning is the ONE number the rider is shown and the exact amount
  -- they keep; the chairperson share and ICANera's net are recorded for
  -- reporting. All of the arithmetic (who fronts what, personal vs company
  -- rider) lives in mbg_compute_ride_split so it can't drift between here and
  -- the company-pricing trigger.
  SELECT s.o_rider_earning, s.o_chair_total, s.o_platform_net
    INTO v_rider_earning, v_chair_total, v_platform_net
    FROM public.mbg_compute_ride_split(
      v_fare, v_is_boda, v_rider.business_profile_id IS NOT NULL, p_payment_method
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
    customer_business_profile_id
  ) VALUES (
    v_customer_id, p_rider_id, v_stage_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(v_distance_km / 25 * 60)), v_fare,
    p_service_type, p_delivery_mode, p_supermarket_id,
    p_power_type_requested, COALESCE(p_umbrella_requested, false),
    v_multiplier, v_rider_earning, v_chair_total,
    p_order_notes, p_payment_method, p_cart, p_max_delivery_hours, v_expense_classification,
    v_customer_business_profile_id
  ) RETURNING id, fare, rider_earning INTO v_ride_id, v_fare, v_rider_earning;

  -- A company rider's own pricing (trg_mbg_apply_business_pricing) can change
  -- the fare and split as the row is written, so the fee record and the
  -- response below use what was actually stored, not the pre-insert numbers.
  SELECT s.o_platform_net INTO v_platform_net
    FROM public.mbg_compute_ride_split(
      v_fare, v_is_boda, v_rider.business_profile_id IS NOT NULL, p_payment_method
    ) s;

  -- ICANera's expected net: the whole pool minus what the chairpersons take.
  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx) VALUES (v_ride_id, v_platform_net);

  RETURN jsonb_build_object(
    'success', true, 'ride_id', v_ride_id, 'fare', v_fare,
    'distance_km', v_distance_km, 'rider_earning', v_rider_earning
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, JSONB, NUMERIC, TEXT, UUID
) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. mbg_respond_to_ride — credit ICANera's real fee the moment a store
--    delivery's wallet surcharge is collected at acceptance, every vehicle
--    type. Same (UUID, BOOLEAN) signature as
--    ADD_DELIVERY_EXPENSE_CLASSIFICATION.sql — plain CREATE OR REPLACE.
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

      -- The wallet surcharge just collected above IS ICANera's real per-ride
      -- platform fee — credit it for real, same treatment every other
      -- platform fee already gets (ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql).
      -- Never itemized to the customer, never allowed to fail the delivery.
      PERFORM public.fn_credit_platform_fee_to_business(
        p_amount_ican      => v_customer_charge_ican - v_fare_ican,
        p_source_app       => 'mybodaguy',
        p_source_reference => 'ride-wallet-surcharge:' || p_ride_id::text,
        p_fee_type         => 'icanera_platform_fee',
        p_actor_user_id    => v_customer_user_id,
        p_note             => format('ICANera platform fee on store delivery %s (wallet surcharge, charged at acceptance)', p_ride_id)
      );

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
GRANT EXECUTE ON FUNCTION public.mbg_respond_to_ride(UUID, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. mbg_complete_ride — credit the wallet surcharge at completion (when not
--    already charged at acceptance), and pay ICANera's cash-ride cut
--    immediately out of the platform float, same principle as the
--    chairperson payout right next to it. Same (UUID, TEXT) signature as
--    ADD_CUSTOMER_DELIVERY_CONFIRMATION.sql — plain CREATE OR REPLACE.
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
  v_region RECORD;
  v_level RECORD;
  v_chair_user_id UUID;
  v_pct NUMERIC;
  v_amount_ugx NUMERIC;
  v_amount_ican NUMERIC;
  v_fare_ican NUMERIC;
  v_platform_fee_pct NUMERIC := public.mbg_get_setting_numeric('commission.icanera_platform_fee_percentage', 8);
  v_customer_charge_ican NUMERIC;
  v_debit JSONB;
  v_commission_due_ugx NUMERIC := 0;
  v_actual_method TEXT;
  v_is_pending_customer_confirmation BOOLEAN;
  v_platform_fee_ugx NUMERIC;
  v_chairs_paid_ugx NUMERIC := 0;
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

      -- ICANera's real per-ride cut: the surcharge just collected, baked
      -- silently into the single total the customer was charged (never
      -- itemized to them) — credited for real instead of vanishing.
      PERFORM public.fn_credit_platform_fee_to_business(
        p_amount_ican      => v_customer_charge_ican - v_fare_ican,
        p_source_app       => 'mybodaguy',
        p_source_reference => 'ride-wallet-surcharge:' || p_ride_id::text,
        p_fee_type         => 'icanera_platform_fee',
        p_actor_user_id    => v_customer_user_id,
        p_note             => format('ICANera platform fee on ride/delivery %s (wallet surcharge)', p_ride_id)
      );
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
      NULL;
    ELSE
      PERFORM public.mbg_pay_rider_for_ride(p_ride_id);
    END IF;

    UPDATE public.mbg_riders SET
      is_available = true, total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
    WHERE id = v_rider_id;

  ELSE
    -- Cash: the rider keeps the full fare physically and fronted the whole
    -- platform pool (customer's 8% + rider's 7%) — that pool is exactly
    -- fare − rider_earning, and it becomes the rider's debt, recovered from
    -- their next wallet-paid ride. Out of the platform's float, the
    -- chairpersons (boda) are paid their share immediately, and ICANera is
    -- credited the rest of the pool immediately (below) rather than discarded.
    v_commission_due_ugx := v_ride.fare - v_ride.rider_earning;

    -- Chairpersons are paid on personal boda rides only, never company rides.
    IF v_is_boda AND NOT COALESCE(v_is_company, FALSE) AND v_payment_id IS NOT NULL THEN
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
            v_chairs_paid_ugx := v_chairs_paid_ugx + v_amount_ugx;
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

    -- ICANera keeps whatever of the pool the chairpersons didn't take (all of
    -- it on a non-boda ride or when a chair seat is empty).
    v_platform_fee_ugx := GREATEST(v_commission_due_ugx - v_chairs_paid_ugx, 0);
    IF v_platform_fee_ugx > 0 THEN
      PERFORM public.fn_credit_platform_fee_to_business(
        p_amount_ican      => ROUND(v_platform_fee_ugx / ICAN_TO_UGX, 8),
        p_source_app       => 'mybodaguy',
        p_source_reference => 'ride-cash-platform-fee:' || p_ride_id::text,
        p_fee_type         => 'icanera_platform_fee',
        p_actor_user_id    => v_rider_user_id,
        p_note             => format('ICANera platform fee on cash ride %s (fronted from platform float, recovered via rider debt)', p_ride_id)
      );
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
    'commission_due_ugx', v_commission_due_ugx,
    'awaiting_customer_confirmation', v_is_pending_customer_confirmation AND v_actual_method = 'wallet'
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_complete_ride(UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. mbg_pay_rider_for_ride — unchanged in substance from before ICANera had
--    any real cut: with the fee now always either a separate customer-side
--    surcharge (wallet, credited above) or pre-subtracted into
--    rider_earning before this function ever runs (cash, credited in
--    mbg_complete_ride above), the rider's own credit computed here
--    (fare_ican * rider_earning / fare) is already exactly right — no
--    fare-embedded gap left for this function to separately recover. Same
--    UUID signature as ADD_CUSTOMER_DELIVERY_CONFIRMATION.sql — plain
--    CREATE OR REPLACE. Not GRANTed to any client role, as before.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_pay_rider_for_ride(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_rider_id UUID;
  v_rider_user_id UUID;
  v_rider_vehicle_type TEXT;
  v_is_boda BOOLEAN;
  v_is_company BOOLEAN;
  v_payment_id UUID;
  v_region RECORD;
  v_level RECORD;
  v_chair_user_id UUID;
  v_pct NUMERIC;
  v_amount_ugx NUMERIC;
  v_amount_ican NUMERIC;
  v_fare_ican NUMERIC;
  v_rider_credit_ican NUMERIC;
  v_rider_gross_ican NUMERIC;
  v_chairs_paid_ican NUMERIC := 0;
  v_platform_share_ican NUMERIC;
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

  SELECT id, user_id, vehicle_type::TEXT, business_profile_id IS NOT NULL
    INTO v_rider_id, v_rider_user_id, v_rider_vehicle_type, v_is_company
  FROM public.mbg_riders WHERE id = v_ride.rider_id;
  IF v_rider_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No rider on this ride');
  END IF;

  SELECT id INTO v_payment_id FROM public.mbg_payments WHERE ride_id = p_ride_id;

  v_is_boda := v_rider_vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk');
  v_fare_ican := ROUND(v_ride.fare / ICAN_TO_UGX, 8);
  v_rider_credit_ican := ROUND(v_fare_ican * v_ride.rider_earning / NULLIF(v_ride.fare, 0), 8);
  v_rider_gross_ican  := v_rider_credit_ican;

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

  -- ...then any outstanding delivery-liability debt the same way.
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

  -- Chairpersons are paid on personal boda rides only, never company rides.
  IF v_is_boda AND NOT COALESCE(v_is_company, FALSE) AND v_payment_id IS NOT NULL THEN
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
          v_chairs_paid_ican := v_chairs_paid_ican + v_amount_ican;
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

  -- ICANera's real share of the rider's slice: whatever of the fare was held
  -- back from the rider (fare − rider_earning) that the chairpersons didn't
  -- take. Credited for real, once (idempotent per ride), never allowed to
  -- fail the payout. (The customer's own 8% was already credited when the
  -- wallet was charged.)
  v_platform_share_ican := ROUND(v_fare_ican - v_rider_gross_ican - v_chairs_paid_ican, 8);
  IF v_platform_share_ican > 0 THEN
    PERFORM public.fn_credit_platform_fee_to_business(
      p_amount_ican      => v_platform_share_ican,
      p_source_app       => 'mybodaguy',
      p_source_reference => 'ride-rider-cut:' || p_ride_id::text,
      p_fee_type         => 'icanera_platform_fee',
      p_actor_user_id    => v_rider_user_id,
      p_note             => format('ICANera share of the rider slice on ride/delivery %s (after chairperson payouts)', p_ride_id)
    );
  END IF;

  UPDATE public.mbg_rides SET rider_paid_at = now(), updated_at = now() WHERE id = p_ride_id;

  RETURN jsonb_build_object('success', true, 'rider_credited_ican', v_rider_credit_ican);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_pay_rider_for_ride(UUID) FROM PUBLIC;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ ICANera''s real per-ride cut is now one flat, developer-configurable percentage (commission.icanera_platform_fee_percentage, default 8%%) across every vehicle type — customer-borne on wallet, rider-fronted on cash — actually credited to the platform-fee business wallet, editable live from the Developer Dashboard Commissions tab.';
END $$;
