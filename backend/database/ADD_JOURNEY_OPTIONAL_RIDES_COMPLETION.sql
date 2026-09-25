-- ============================================================================
-- OPTIONAL AIRPORT RIDES — journey completion
-- Run after ADD_JOURNEY_RIDE_BENEFITS.sql (safe to re-run).
--
-- Either airport ride is now optional. Until now a journey only became
-- 'completed' when its arrival ride (local_dropoff) finished, so a journey
-- booked WITHOUT the arrival ride — flight only, or ride-to-airport + flight —
-- stayed 'confirmed' / 'in_progress' forever.
--
-- This adds one function + one pg_cron job that completes such a journey once
-- the flight has landed. It does NOT touch mbg_run_due_journey_dispatch,
-- mbg_dispatch_journey_leg or the ride-sync trigger, and journeys that DO have
-- an arrival ride are left exactly as they were (that ride still completes them).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_complete_flight_only_journeys()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_journey RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_journey IN
    SELECT j.id, fb.id AS booking_id
    FROM public.mbg_journeys j
    JOIN public.mbg_journey_legs fl
      ON fl.journey_id = j.id AND fl.leg_type = 'flight'
    JOIN public.mbg_flight_bookings fb
      ON fb.id = fl.flight_booking_id
    WHERE j.status IN ('confirmed', 'in_progress')
      -- only journeys with no arrival ride; the ride itself completes the rest
      AND NOT EXISTS (
        SELECT 1 FROM public.mbg_journey_legs d
        WHERE d.journey_id = j.id AND d.leg_type = 'local_dropoff'
      )
      AND fb.status IN ('booked', 'ticketed', 'delayed', 'rescheduled')
      -- the flight landed (with a 30 minute cushion for a late update from the airline)
      AND COALESCE(fb.current_arrival_at, fb.scheduled_arrival_at) <= now() - interval '30 minutes'
      -- the ride to the airport, if there was one, is finished — unless it has
      -- been hanging for a day after landing, which must not block completion forever
      AND (
        COALESCE(fb.current_arrival_at, fb.scheduled_arrival_at) <= now() - interval '24 hours'
        OR NOT EXISTS (
          SELECT 1 FROM public.mbg_journey_legs p
          WHERE p.journey_id = j.id AND p.leg_type = 'local_pickup'
            AND p.status NOT IN ('completed', 'cancelled', 'failed')
        )
      )
    LIMIT 100
  LOOP
    UPDATE public.mbg_journey_legs
    SET status = 'completed', completed_at = COALESCE(completed_at, now()), updated_at = now()
    WHERE journey_id = v_journey.id AND leg_type = 'flight' AND status <> 'completed';

    -- 'completed' also takes it out of the flight-status poller.
    UPDATE public.mbg_flight_bookings SET status = 'completed', updated_at = now()
    WHERE id = v_journey.booking_id;

    UPDATE public.mbg_journeys SET status = 'completed', updated_at = now() WHERE id = v_journey.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_complete_flight_only_journeys TO service_role;

-- Re-runnable: unschedule first (older pg_cron errors on a duplicate job name).
DO $$
BEGIN
  PERFORM cron.unschedule('mbg-complete-flight-only-journeys');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('mbg-complete-flight-only-journeys', '*/10 * * * *', $$ SELECT public.mbg_complete_flight_only_journeys(); $$);

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Journeys booked without an arrival ride now complete themselves 30 minutes after the flight lands (checked every 10 minutes).';
END $$;
