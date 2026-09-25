-- ============================================================================
-- The ground legs of a journey (ride to the airport, ride from the arrival
-- airport) are REAL rides, so they now get the benefits of "Book a Ride":
--
--   1. Ride preferences on the airport ride — electric or fuel bike, an
--      umbrella, or one specific transport company's drivers — matched by the
--      same nearest-first logic as a normal ride. If nobody matching the
--      preferences is free 10 minutes after the ride is due, the preferences
--      are relaxed so a paid-for journey is never left without a driver.
--   2. "Just Send" auto-dispatch for the airport ride: if the first driver
--      doesn't accept within 10 seconds it cascades to the next nearest
--      (ADD_AUTO_DISPATCH_CASCADE.sql does the sweeping; nothing changes there).
--   3. A driver who declines, times out or cancels no longer strands the leg:
--      the leg is put back in the queue, the driver is excluded, and the next
--      nearest is tried straight away (and again every 2 min by the existing
--      pg_cron job if nobody is free yet).
--   4. Live status: the leg — and the journey — now follow the ride
--      (in progress -> completed; the journey completes when the ride from the
--      arrival airport completes). Before this, a passenger journey stayed
--      "confirmed" for ever; only cargo journeys were kept in sync.
--
-- Everything stays prepaid (see ADD_JOURNEY_PREPAID_LEG_FARES.sql): no second
-- charge, fixed fare, no cash handover.
--
-- Run after ADD_JOURNEY_PREPAID_LEG_FARES.sql. ADD_AUTO_DISPATCH_CASCADE.sql is
-- optional (without it step 2 is simply skipped). Safe to re-run.
-- ============================================================================

ALTER TABLE public.mbg_journey_legs
  ADD COLUMN IF NOT EXISTS excluded_rider_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS power_type_requested TEXT,
  ADD COLUMN IF NOT EXISTS umbrella_requested BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preferred_business_profile_id UUID;

-- ----------------------------------------------------------------------------
-- 1. Driver matching for a journey leg: mbg_find_available_vehicles (country +
--    vehicle-type aware, so the arrival-country driver is matched in that
--    country) plus the ride-booking preference filters.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_find_journey_driver(
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_country TEXT,
  p_vehicle_types TEXT[],
  p_exclude_rider_ids UUID[],
  p_power_type TEXT DEFAULT NULL,
  p_require_umbrella BOOLEAN DEFAULT false,
  p_business_profile_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id
  FROM public.mbg_riders r
  LEFT JOIN public.mbg_rider_locations home ON home.rider_user_id = r.user_id AND home.is_home = true
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      public.mbg_haversine_km(r.current_lat, r.current_lng, p_pickup_lat, p_pickup_lng),
      public.mbg_haversine_km(home.latitude, home.longitude, p_pickup_lat, p_pickup_lng)
    ) AS km
  ) dist
  WHERE r.status = 'active'
    AND r.is_available = true
    AND r.operator_type = 'passenger'
    AND r.vehicle_type::TEXT = ANY(p_vehicle_types)
    AND p_country = ANY(r.service_countries)
    AND NOT (r.id = ANY(COALESCE(p_exclude_rider_ids, ARRAY[]::UUID[])))
    AND (p_power_type IS NULL OR r.power_type = p_power_type)
    AND (NOT COALESCE(p_require_umbrella, false) OR r.has_umbrella = true)
    AND (p_business_profile_id IS NULL OR r.business_profile_id = p_business_profile_id)
    -- Not already sitting on somebody else's unanswered offer (same guard as
    -- mbg_request_ride, FIX_PREVENT_STALE_PENDING_RIDE_OFFERS.sql).
    AND NOT EXISTS (SELECT 1 FROM public.mbg_rides o WHERE o.rider_id = r.id AND o.status = 'pending')
  ORDER BY dist.km ASC NULLS LAST, r.rating DESC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_find_journey_driver TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Dispatch of a passenger leg: prepaid ride (as in
--    ADD_JOURNEY_PREPAID_LEG_FARES.sql) + preferences + auto-dispatch cascade.
-- ----------------------------------------------------------------------------
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

  v_vehicle_types := CASE
    WHEN v_leg.leg_type = 'local_pickup' AND v_leg.preferred_vehicle_type IS NOT NULL
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

-- ----------------------------------------------------------------------------
-- 3. Keep the leg and journey in step with the ride; re-queue a lapsed offer.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_sync_journey_leg_with_ride()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leg public.mbg_journey_legs%ROWTYPE;
BEGIN
  IF NOT COALESCE(NEW.is_journey_prepaid, false) OR NEW.service_type <> 'ride' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_leg FROM public.mbg_journey_legs
  WHERE ride_id = NEW.id AND leg_type IN ('local_pickup', 'local_dropoff');
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress' THEN
    UPDATE public.mbg_journey_legs SET status = 'in_progress', updated_at = now() WHERE id = v_leg.id;
    UPDATE public.mbg_journeys SET status = 'in_progress', updated_at = now()
    WHERE id = v_leg.journey_id AND status = 'confirmed';

  ELSIF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    UPDATE public.mbg_journey_legs SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = v_leg.id;
    IF v_leg.leg_type = 'local_pickup' THEN
      UPDATE public.mbg_journeys SET status = 'in_progress', updated_at = now()
      WHERE id = v_leg.journey_id AND status = 'confirmed';
    ELSE
      -- The ride from the arrival airport is the last step: the flight is
      -- necessarily over, and so is the journey.
      UPDATE public.mbg_journey_legs SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
      WHERE journey_id = v_leg.journey_id AND leg_type = 'flight' AND status <> 'completed';
      UPDATE public.mbg_journeys SET status = 'completed', updated_at = now() WHERE id = v_leg.journey_id;
    END IF;

  ELSIF v_leg.status IN ('dispatched', 'in_progress')
    AND (
      (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
        -- a flight-time change withdraws the ride itself and re-times the leg
        -- (retimeDropoffLeg.js), so don't dispatch a new driver at the old time
        AND COALESCE(NEW.cancellation_reason, '') NOT LIKE 'Flight schedule changed%')
      OR (NEW.status = 'pending' AND OLD.rider_id IS NOT NULL AND NEW.rider_id IS NULL)
    ) THEN
    -- The driver declined, never answered, or cancelled: put the leg back in
    -- the queue (excluding that driver) and try the next one straight away.
    UPDATE public.mbg_journey_legs
    SET status = 'ready_to_dispatch', ride_id = NULL, dispatch_after = now(), dispatched_at = NULL,
        excluded_rider_ids = CASE WHEN OLD.rider_id IS NULL THEN excluded_rider_ids ELSE excluded_rider_ids || OLD.rider_id END,
        updated_at = now()
    WHERE id = v_leg.id;

    -- The withdrawn offer must not linger as a pending ride (the leg no longer
    -- points at it, so this update finds no leg to sync).
    IF NEW.status = 'pending' THEN
      UPDATE public.mbg_rides SET status = 'cancelled', updated_at = now() WHERE id = NEW.id;
    END IF;

    BEGIN
      PERFORM public.mbg_dispatch_journey_leg(v_leg.id);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- the 2-minute pg_cron dispatch picks it up
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mbg_sync_journey_leg_with_ride_trg ON public.mbg_rides;
CREATE TRIGGER mbg_sync_journey_leg_with_ride_trg
  AFTER UPDATE OF status, rider_id ON public.mbg_rides
  FOR EACH ROW EXECUTE FUNCTION public.mbg_sync_journey_leg_with_ride();

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Journey rides now behave like booked rides: preferences, auto-dispatch cascade, re-queue on decline, live leg/journey status.';
END $$;
