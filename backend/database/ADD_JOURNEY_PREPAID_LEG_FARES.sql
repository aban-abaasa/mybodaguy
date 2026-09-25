-- ============================================================================
-- Journey legs (the ride to the airport / seaport, the ride from the arrival
-- airport, the cargo road + sea legs) are PREPAID as part of the journey's
-- single upfront ICAN payment (confirm.js / mbg_request_ship_cargo_journey).
-- They must not be priced or charged like a normal ride booking.
--
-- What was wrong before this file:
--   1. The dispatched ride was a normal wallet-paid mbg_rides row
--      (payment_method defaults to 'wallet', wallet_charged_at_acceptance
--      false), so when the rider completed it mbg_complete_ride debited the
--      customer AGAIN (fare + the 8% wallet surcharge) — a double charge — or,
--      if the rider picked "cash", the rider was told to collect cash from a
--      customer who had already paid and was handed a cash-commission debt.
--   2. The ride's fare was recomputed at dispatch with the normal ride formula
--      and the time-of-day multiplier, so it no longer matched what the
--      customer was quoted/charged for that leg (company riders' own price
--      lists overrode it again through trg_mbg_apply_business_pricing).
--   3. Cargo legs were priced with a separate base fare each, although the
--      customer's upfront quote contains ONE base fare for the whole shipment,
--      and never set rider_earning at all.
--
-- After this file every journey ride is created already settled:
--   · fare            = the fixed price the customer was quoted for that leg
--                       (mbg_journey_legs.fare_ugx) — no time multiplier, no
--                       company price list, no surcharge on top;
--   · payment_method  = 'wallet' and wallet_charged_at_acceptance = true, so
--                       mbg_complete_ride never debits the customer again and
--                       never treats it as cash — it just pays the rider;
--   · is_journey_prepaid = true (also makes the company-pricing trigger keep
--                       the fixed fare);
--   · rider_earning   = the rider's ONE final take-home number, from the same
--                       mbg_compute_ride_split every other wallet ride uses.
-- Legs on rows created before this file (fare_ugx NULL) fall back to the
-- distance formula for the amount, but are still prepaid.
--
-- Purchase-order (supplier) cargo journeys, which have no customer_id, are not
-- touched — they keep their existing behaviour.
--
-- Run after ADD_ICANERA_UNIFIED_PLATFORM_FEE.sql (mbg_compute_ride_split),
-- ADD_JOURNEY_PICKUP_VEHICLE_CHOICE.sql and
-- ADD_LONG_HAUL_DETECTION_AND_SEA_FLAT_FEE.sql. Safe to re-run.
-- ============================================================================

ALTER TABLE public.mbg_journey_legs ADD COLUMN IF NOT EXISTS fare_ugx NUMERIC;
ALTER TABLE public.mbg_rides ADD COLUMN IF NOT EXISTS is_journey_prepaid BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 1. Company-pricing trigger: identical to ADD_ICANERA_UNIFIED_PLATFORM_FEE.sql
--    except a prepaid journey ride keeps its fixed fare (the split is still
--    recomputed for the company rider).
-- ----------------------------------------------------------------------------
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
     AND NOT COALESCE(NEW.is_journey_prepaid, false)
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
-- 2. Passenger journey legs (ride to the airport, ride from the arrival
--    airport). Same matching as ADD_JOURNEY_PICKUP_VEHICLE_CHOICE.sql; the ride
--    is created prepaid at the leg's fixed fare.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_dispatch_journey_leg(p_journey_leg_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leg public.mbg_journey_legs%ROWTYPE;
  v_journey public.mbg_journeys%ROWTYPE;
  v_candidate RECORD;
  v_rider RECORD;
  v_split RECORD;
  v_vehicle_types TEXT[];
  v_distance_km NUMERIC;
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('ride.base_fare', 1000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('ride.per_km_rate', 1000);
  v_min_fare  NUMERIC := public.mbg_get_setting_numeric('ride.minimum_fare', 2000);
  v_fare NUMERIC;
  v_ride_id UUID;
BEGIN
  SELECT * INTO v_leg FROM public.mbg_journey_legs WHERE id = p_journey_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journey leg not found';
  END IF;
  IF v_leg.leg_type NOT IN ('local_pickup', 'local_dropoff') THEN
    RAISE EXCEPTION 'Only local_pickup/local_dropoff legs can be dispatched directly';
  END IF;
  IF v_leg.status NOT IN ('pending', 'ready_to_dispatch', 'awaiting_flight_update') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Leg is not awaiting dispatch');
  END IF;

  SELECT * INTO v_journey FROM public.mbg_journeys WHERE id = v_leg.journey_id;

  v_vehicle_types := CASE
    WHEN v_leg.leg_type = 'local_pickup' AND v_leg.preferred_vehicle_type IS NOT NULL
      THEN ARRAY[v_leg.preferred_vehicle_type]
    ELSE ARRAY['motorcycle', 'car', 'tuktuk']
  END;

  SELECT * INTO v_candidate
  FROM public.mbg_find_available_vehicles(
    v_leg.origin_lat, v_leg.origin_lng, v_leg.destination_lat, v_leg.destination_lng,
    COALESCE(v_leg.origin_country, 'Uganda'),
    v_vehicle_types,
    'passenger',
    NULL,
    ARRAY[]::UUID[],
    1
  );

  IF v_candidate.rider_id IS NULL THEN
    UPDATE public.mbg_journey_legs SET status = 'ready_to_dispatch', updated_at = now() WHERE id = p_journey_leg_id;
    RETURN jsonb_build_object('success', false, 'error', 'No available driver right now');
  END IF;

  v_distance_km := public.mbg_haversine_km(v_leg.origin_lat, v_leg.origin_lng, v_leg.destination_lat, v_leg.destination_lng);

  -- The customer already paid a fixed price for this leg — that IS the fare.
  -- No time-of-day multiplier. Only a leg from before fare_ugx existed falls
  -- back to the distance formula for the amount.
  v_fare := ROUND(COALESCE(v_leg.fare_ugx, GREATEST(v_min_fare, v_base_fare + COALESCE(v_distance_km, 0) * v_per_km)) / 100) * 100;

  SELECT vehicle_type::TEXT AS vehicle_type, business_profile_id IS NOT NULL AS is_company
    INTO v_rider FROM public.mbg_riders WHERE id = v_candidate.rider_id;

  SELECT * INTO v_split FROM public.mbg_compute_ride_split(
    v_fare, v_rider.vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk'), COALESCE(v_rider.is_company, false), 'wallet'
  );

  INSERT INTO public.mbg_rides (
    customer_id, rider_id, stage_id,
    pickup_location, pickup_lat, pickup_lng,
    dropoff_location, dropoff_lat, dropoff_lng,
    status, distance_km, duration_minutes, fare,
    service_type, country, city,
    time_multiplier, rider_earning, chairperson_commission_total,
    payment_method, wallet_charged_at_acceptance, is_journey_prepaid
  ) VALUES (
    v_journey.customer_id, v_candidate.rider_id, NULL,
    COALESCE(v_leg.origin_city, v_journey.origin_city, 'Origin'), v_leg.origin_lat, v_leg.origin_lng,
    COALESCE(v_leg.destination_city, v_journey.destination_city, 'Destination'), v_leg.destination_lat, v_leg.destination_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(COALESCE(v_distance_km, 5) / 25 * 60)), v_fare,
    'ride', COALESCE(v_leg.origin_country, 'Uganda'), v_leg.origin_city,
    1, v_split.o_rider_earning, v_split.o_chair_total,
    'wallet', true, true
  ) RETURNING id INTO v_ride_id;

  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx)
  VALUES (v_ride_id, v_split.o_platform_net);

  UPDATE public.mbg_journey_legs
  SET ride_id = v_ride_id, status = 'dispatched', dispatched_at = now(), updated_at = now()
  WHERE id = p_journey_leg_id;

  RETURN jsonb_build_object('success', true, 'ride_id', v_ride_id, 'rider_id', v_candidate.rider_id, 'fare', v_fare);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dispatch_journey_leg TO service_role;

-- ----------------------------------------------------------------------------
-- 3. Cargo legs (road to the port, sea crossing, road from the port). Same as
--    ADD_LONG_HAUL_DETECTION_AND_SEA_FLAT_FEE.sql, but for a customer-booked
--    shipment (journey has a customer_id) the ride is created prepaid, and the
--    road legs share the ONE base fare the customer's upfront quote contains
--    (base on the first leg only) so the legs add up to what was paid.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_dispatch_cargo_leg(p_journey_leg_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leg public.mbg_journey_legs%ROWTYPE;
  v_journey public.mbg_journeys%ROWTYPE;
  v_candidate RECORD;
  v_rider RECORD;
  v_split RECORD;
  v_vehicle_types TEXT[];
  v_operator_type TEXT;
  v_distance_km NUMERIC;
  v_fare NUMERIC;
  v_prepaid BOOLEAN;
  v_ride_id UUID;
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('cargo.base_fare', 5000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('cargo.per_km_rate', 2000);
  v_sea_flat_fee NUMERIC := public.mbg_get_setting_numeric('journey.sea_leg_flat_fee_ugx', 250000);
BEGIN
  SELECT * INTO v_leg FROM public.mbg_journey_legs WHERE id = p_journey_leg_id FOR UPDATE;
  IF NOT FOUND OR v_leg.leg_type NOT IN ('road_leg', 'sea_leg') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a dispatchable cargo leg');
  END IF;
  IF v_leg.status NOT IN ('pending', 'ready_to_dispatch') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Leg is not awaiting dispatch');
  END IF;
  SELECT * INTO v_journey FROM public.mbg_journeys WHERE id = v_leg.journey_id;
  v_prepaid := v_journey.customer_id IS NOT NULL;

  IF v_leg.leg_type = 'sea_leg' THEN
    v_vehicle_types := ARRAY['ship'];
    v_operator_type := 'cargo';
  ELSIF v_journey.preferred_vehicle_type IS NOT NULL AND v_journey.preferred_vehicle_type <> 'ship' THEN
    v_vehicle_types := ARRAY[v_journey.preferred_vehicle_type];
    v_operator_type := CASE WHEN v_journey.preferred_vehicle_type = 'car' THEN 'passenger' ELSE 'cargo' END;
  ELSE
    v_vehicle_types := ARRAY['truck', 'van'];
    v_operator_type := 'cargo';
  END IF;

  SELECT * INTO v_candidate FROM public.mbg_find_available_vehicles(
    v_leg.origin_lat, v_leg.origin_lng, v_leg.destination_lat, v_leg.destination_lng,
    COALESCE(v_leg.origin_country, v_journey.origin_country, 'Uganda'),
    v_vehicle_types, v_operator_type, v_journey.cargo_weight_kg, ARRAY[]::UUID[], 1
  );

  IF v_candidate.rider_id IS NULL THEN
    UPDATE public.mbg_journey_legs SET status = 'ready_to_dispatch', updated_at = now() WHERE id = p_journey_leg_id;
    RETURN jsonb_build_object('success', false, 'error', 'No available vehicle right now');
  END IF;

  v_distance_km := public.mbg_haversine_km(v_leg.origin_lat, v_leg.origin_lng, v_leg.destination_lat, v_leg.destination_lng);

  IF v_leg.leg_type = 'sea_leg' THEN
    v_fare := ROUND(COALESCE(v_leg.fare_ugx, v_sea_flat_fee) / 100) * 100;
  ELSIF v_prepaid THEN
    v_fare := ROUND(COALESCE(
      v_leg.fare_ugx,
      CASE WHEN v_leg.leg_order = 1 THEN v_base_fare ELSE 0 END + COALESCE(v_distance_km, 0) * v_per_km
    ) / 100) * 100;
  ELSE
    v_fare := ROUND((v_base_fare + COALESCE(v_distance_km, 0) * v_per_km) / 100) * 100;
  END IF;

  IF v_prepaid THEN
    SELECT vehicle_type::TEXT AS vehicle_type, business_profile_id IS NOT NULL AS is_company
      INTO v_rider FROM public.mbg_riders WHERE id = v_candidate.rider_id;
    SELECT * INTO v_split FROM public.mbg_compute_ride_split(
      v_fare, v_rider.vehicle_type IN ('motorcycle', 'bicycle', 'tuktuk'), COALESCE(v_rider.is_company, false), 'wallet'
    );

    INSERT INTO public.mbg_rides (
      customer_id, rider_id, stage_id, pickup_location, pickup_lat, pickup_lng,
      dropoff_location, dropoff_lat, dropoff_lng, status, distance_km, duration_minutes, fare,
      service_type, purchase_order_id, country,
      rider_earning, chairperson_commission_total,
      payment_method, wallet_charged_at_acceptance, is_journey_prepaid
    ) VALUES (
      v_journey.customer_id, v_candidate.rider_id, NULL,
      COALESCE(v_leg.origin_city, 'Origin'), v_leg.origin_lat, v_leg.origin_lng,
      COALESCE(v_leg.destination_city, 'Destination'), v_leg.destination_lat, v_leg.destination_lng,
      'pending', v_distance_km, GREATEST(5, ROUND(COALESCE(v_distance_km, 5) / 40 * 60)), v_fare,
      'cargo_delivery', NULL, COALESCE(v_leg.origin_country, 'Uganda'),
      v_split.o_rider_earning, v_split.o_chair_total,
      'wallet', true, true
    ) RETURNING id INTO v_ride_id;
  ELSE
    INSERT INTO public.mbg_rides (
      customer_id, rider_id, stage_id, pickup_location, pickup_lat, pickup_lng,
      dropoff_location, dropoff_lat, dropoff_lng, status, distance_km, duration_minutes, fare,
      service_type, purchase_order_id, country
    ) VALUES (
      NULL, v_candidate.rider_id, NULL,
      COALESCE(v_leg.origin_city, 'Origin'), v_leg.origin_lat, v_leg.origin_lng,
      COALESCE(v_leg.destination_city, 'Destination'), v_leg.destination_lat, v_leg.destination_lng,
      'pending', v_distance_km, GREATEST(5, ROUND(COALESCE(v_distance_km, 5) / 40 * 60)), v_fare,
      'cargo_delivery', v_journey.purchase_order_id, COALESCE(v_leg.origin_country, 'Uganda')
    ) RETURNING id INTO v_ride_id;
  END IF;

  UPDATE public.mbg_journey_legs
  SET ride_id = v_ride_id, status = 'dispatched', dispatched_at = now(), updated_at = now()
  WHERE id = p_journey_leg_id;

  RETURN jsonb_build_object('success', true, 'ride_id', v_ride_id, 'rider_id', v_candidate.rider_id, 'fare', v_fare);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dispatch_cargo_leg TO service_role;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Journey legs are now prepaid: fixed leg fare, no second wallet debit / cash handover at completion, rider paid from the journey payment.';
END $$;
