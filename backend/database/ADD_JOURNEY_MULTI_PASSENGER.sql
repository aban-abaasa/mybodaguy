-- ============================================================================
-- Book a journey for more than one traveller.
--
-- The flight (Duffel) is booked for the whole party in one order — its price
-- already covers every traveller — and the customer pays one ICAN total. The
-- ground rides are one vehicle each, so:
--   · a party of 2+ always travels by CAR (a bike carries one traveller); the
--     confirm API records preferred_vehicle_type = 'car' on both ground legs;
--   · a car seats up to 4, so BodaGoEra airport rides can only be booked for a
--     party of up to 4 (bigger parties keep the flight and use their own way
--     to/from the airport — enforced in api/_lib/journeyQuote.js).
--
-- This file:
--   1. adds mbg_journeys.passenger_count (informational; the traveller list is
--      stored on mbg_flight_bookings.passenger_details as before);
--   2. makes mbg_dispatch_journey_leg honour preferred_vehicle_type on the
--      ARRIVAL leg too (before, only the airport pickup did). Same function as
--      ADD_JOURNEY_RIDE_BENEFITS.sql with just that one condition relaxed —
--      that file has been updated the same way so re-running it keeps this.
--
-- Run after ADD_JOURNEY_RIDE_BENEFITS.sql. Safe to re-run. Until it is run,
-- a solo booking is unaffected and a party's booking still works (the API
-- books without the count), but the arrival driver may be a bike.
-- ============================================================================

ALTER TABLE public.mbg_journeys
  ADD COLUMN IF NOT EXISTS passenger_count INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
  ALTER TABLE public.mbg_journeys
    ADD CONSTRAINT mbg_journeys_passenger_count_range CHECK (passenger_count BETWEEN 1 AND 9);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE OR REPLACE FUNCTION public.mbg_dispatch_journey_leg(p_journey_leg_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leg public.mbg_journey_legs%ROWTYPE;
  v_journey public.mbg_journeys%ROWTYPE;
  v_rider RECORD;
  v_split RECORD;
  v_rider_id UUID;
  v_vehicle_types TEXT[];
  v_country TEXT;
  v_waited_long BOOLEAN;
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

  -- A vehicle type recorded on the leg is honoured on BOTH ground legs: the
  -- customer's bike/car choice for the airport pickup, and 'car' for either leg
  -- of a party of two or more (a bike carries one traveller). A solo traveller's
  -- arrival leg has none, so it still matches any available passenger vehicle.
  v_vehicle_types := CASE
    WHEN v_leg.preferred_vehicle_type IS NOT NULL
      THEN ARRAY[v_leg.preferred_vehicle_type]
    ELSE ARRAY['motorcycle', 'car', 'tuktuk']
  END;
  v_country := COALESCE(v_leg.origin_country, 'Uganda');
  v_waited_long := v_leg.dispatch_after IS NOT NULL AND v_leg.dispatch_after < now() - interval '10 minutes';

  -- Strict: the customer's preferences, minus drivers who already declined.
  v_rider_id := public.mbg_find_journey_driver(
    v_leg.origin_lat, v_leg.origin_lng, v_country, v_vehicle_types, v_leg.excluded_rider_ids,
    v_leg.power_type_requested, v_leg.umbrella_requested, v_leg.preferred_business_profile_id
  );
  -- Nobody for 10 minutes past the due time: relax the optional preferences
  -- (a paid-for journey must not be left without a driver), then forgive
  -- earlier decliners as a last resort.
  IF v_rider_id IS NULL AND v_waited_long THEN
    v_rider_id := public.mbg_find_journey_driver(
      v_leg.origin_lat, v_leg.origin_lng, v_country, v_vehicle_types, v_leg.excluded_rider_ids
    );
    IF v_rider_id IS NULL THEN
      v_rider_id := public.mbg_find_journey_driver(
        v_leg.origin_lat, v_leg.origin_lng, v_country, v_vehicle_types, ARRAY[]::UUID[]
      );
    END IF;
  END IF;

  IF v_rider_id IS NULL THEN
    UPDATE public.mbg_journey_legs SET status = 'ready_to_dispatch', updated_at = now() WHERE id = p_journey_leg_id;
    RETURN jsonb_build_object('success', false, 'error', 'No available driver right now');
  END IF;

  v_distance_km := public.mbg_haversine_km(v_leg.origin_lat, v_leg.origin_lng, v_leg.destination_lat, v_leg.destination_lng);
  v_fare := ROUND(COALESCE(v_leg.fare_ugx, GREATEST(v_min_fare, v_base_fare + COALESCE(v_distance_km, 0) * v_per_km)) / 100) * 100;

  SELECT vehicle_type::TEXT AS vehicle_type, business_profile_id IS NOT NULL AS is_company
    INTO v_rider FROM public.mbg_riders WHERE id = v_rider_id;
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
    payment_method, wallet_charged_at_acceptance, is_journey_prepaid,
    power_type_requested, umbrella_requested
  ) VALUES (
    v_journey.customer_id, v_rider_id, NULL,
    COALESCE(v_leg.origin_city, v_journey.origin_city, 'Origin'), v_leg.origin_lat, v_leg.origin_lng,
    COALESCE(v_leg.destination_city, v_journey.destination_city, 'Destination'), v_leg.destination_lat, v_leg.destination_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(COALESCE(v_distance_km, 5) / 25 * 60)), v_fare,
    'ride', v_country, v_leg.origin_city,
    1, v_split.o_rider_earning, v_split.o_chair_total,
    'wallet', true, true,
    v_leg.power_type_requested, COALESCE(v_leg.umbrella_requested, false)
  ) RETURNING id INTO v_ride_id;

  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx)
  VALUES (v_ride_id, v_split.o_platform_net);

  -- "Just Send": hand the airport ride to the auto-dispatch cascade so it moves
  -- to the next nearest driver every 10 s until one accepts. Needs the
  -- destination coordinates (the sweep can't match without them, and a null
  -- there would make it fail for every other ride too), and is skipped where
  -- ADD_AUTO_DISPATCH_CASCADE.sql hasn't been run. The arrival-country driver
  -- is left to the leg re-queue below, because the cascade isn't country-aware.
  IF v_leg.leg_type = 'local_pickup' AND v_leg.destination_lat IS NOT NULL AND v_leg.destination_lng IS NOT NULL THEN
    BEGIN
      UPDATE public.mbg_rides
      SET dispatch_mode = 'auto', offer_sent_at = now(), declined_rider_ids = '{}',
          dispatch_attempts = 1, dispatch_vehicle_types = v_vehicle_types
      WHERE id = v_ride_id;
    EXCEPTION WHEN undefined_column THEN
      NULL;
    END;
  END IF;

  UPDATE public.mbg_journey_legs
  SET ride_id = v_ride_id, status = 'dispatched', dispatched_at = now(), updated_at = now()
  WHERE id = p_journey_leg_id;

  RETURN jsonb_build_object('success', true, 'ride_id', v_ride_id, 'rider_id', v_rider_id, 'fare', v_fare);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dispatch_journey_leg TO service_role;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Multi-passenger journeys ready: mbg_journeys.passenger_count, and both ground legs now honour preferred_vehicle_type (a party travels by car).';
END $$;
