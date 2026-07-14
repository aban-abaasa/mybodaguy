-- ============================================================================
-- Lets the customer choose Bike or Car for a journey's first leg (boda/car
-- to the airport) instead of mbg_dispatch_journey_leg silently matching
-- whichever of motorcycle/car/tuktuk happens to be available first.
--
-- Only affects the local_pickup leg — local_dropoff (destination-country
-- driver) still matches any available passenger vehicle, since the
-- customer has no way to know what's realistically available there.
--
-- Run after CREATE_JOURNEY_BOOKING_ENGINE.sql.
-- ============================================================================

ALTER TABLE public.mbg_journey_legs
  ADD COLUMN IF NOT EXISTS preferred_vehicle_type TEXT;

CREATE OR REPLACE FUNCTION public.mbg_dispatch_journey_leg(p_journey_leg_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leg public.mbg_journey_legs%ROWTYPE;
  v_journey public.mbg_journeys%ROWTYPE;
  v_candidate RECORD;
  v_vehicle_types TEXT[];
  v_distance_km NUMERIC;
  v_multiplier NUMERIC := public.mbg_current_time_multiplier();
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('ride.base_fare', 1000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('ride.per_km_rate', 1000);
  v_min_fare  NUMERIC := public.mbg_get_setting_numeric('ride.minimum_fare', 2000);
  v_fare NUMERIC;
  v_platform_pct NUMERIC := public.mbg_get_setting_numeric('commission.platform_fee_percentage', 5);
  v_rider_pct    NUMERIC := public.mbg_get_setting_numeric('commission.rider_percentage', 70);
  v_rider_earning NUMERIC;
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

  -- Only the pickup leg has a customer-facing bike/car choice — the
  -- destination-country dropoff leg still matches any available vehicle.
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
    -- No driver available right now — leave the leg pending so the
    -- scheduler retries on its next pass instead of failing the journey.
    UPDATE public.mbg_journey_legs SET status = 'ready_to_dispatch', updated_at = now() WHERE id = p_journey_leg_id;
    RETURN jsonb_build_object('success', false, 'error', 'No available driver right now');
  END IF;

  v_distance_km := public.mbg_haversine_km(v_leg.origin_lat, v_leg.origin_lng, v_leg.destination_lat, v_leg.destination_lng);
  v_fare := GREATEST(v_min_fare, v_base_fare + COALESCE(v_distance_km, 0) * v_per_km) * v_multiplier;
  v_fare := ROUND(v_fare / 100) * 100;
  v_rider_earning := ROUND(v_fare * v_rider_pct / 100);

  INSERT INTO public.mbg_rides (
    customer_id, rider_id, stage_id,
    pickup_location, pickup_lat, pickup_lng,
    dropoff_location, dropoff_lat, dropoff_lng,
    status, distance_km, duration_minutes, fare,
    service_type, country, city,
    time_multiplier, rider_earning,
    chairperson_commission_total
  ) VALUES (
    v_journey.customer_id, v_candidate.rider_id, NULL,
    COALESCE(v_leg.origin_city, v_journey.origin_city, 'Origin'), v_leg.origin_lat, v_leg.origin_lng,
    COALESCE(v_leg.destination_city, v_journey.destination_city, 'Destination'), v_leg.destination_lat, v_leg.destination_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(COALESCE(v_distance_km, 5) / 25 * 60)), v_fare,
    'ride', COALESCE(v_leg.origin_country, 'Uganda'), v_leg.origin_city,
    v_multiplier, v_rider_earning,
    0
  ) RETURNING id INTO v_ride_id;

  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx)
  VALUES (v_ride_id, ROUND(v_fare * v_platform_pct / 100));

  UPDATE public.mbg_journey_legs
  SET ride_id = v_ride_id, status = 'dispatched', dispatched_at = now(), updated_at = now()
  WHERE id = p_journey_leg_id;

  RETURN jsonb_build_object('success', true, 'ride_id', v_ride_id, 'rider_id', v_candidate.rider_id, 'fare', v_fare);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dispatch_journey_leg TO service_role;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Journey pickup vehicle choice ready: mbg_journey_legs.preferred_vehicle_type, mbg_dispatch_journey_leg matches only that type for local_pickup when set.';
END $$;
