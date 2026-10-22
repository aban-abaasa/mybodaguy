-- ============================================================================
-- "Just Send" cascade: each rider gets 7 seconds, then the ride moves on.
-- ============================================================================
-- Run this once in the Supabase SQL editor. It replaces the cascade sweep
-- (last defined in ADD_VEHICLE_CLASS_FARE_RATES.sql section 9) and keeps its
-- matching logic exactly — same exclusions, same cargo/vehicle filters, same
-- 15-attempt cap. Four things change:
--
--   1. It actually runs. Both earlier versions were SECURITY DEFINER with a
--      SET search_path clause, and Postgres forbids COMMIT inside such a
--      procedure ("invalid transaction termination"). Every pg_cron run of
--      mbg-auto-dispatch-cascade failed at its first COMMIT and rolled back,
--      so the cascade never moved a ride on to a second rider — the customer
--      just sat on the first one until the 3-minute stale-offer cleanup.
--      This version has neither clause. Every object it touches is already
--      schema-qualified, and pg_cron runs it as its owner (postgres), who
--      bypasses RLS, so nothing else is needed.
--
--   2. The per-rider window is 7 seconds (was 10).
--
--   3. The sweep ticks every second (was every 10). With a 10s tick a 7s
--      window would still be noticed up to 10s late — a rider would effectively
--      get 7-17s. At a 1s tick it is 7-8s.
--
--   4. The sweep now reads the real clock. A PROCEDURE that COMMITs starts a
--      fresh transaction straight away, so now() is frozen at the moment of
--      the COMMIT — i.e. BEFORE the pg_sleep that follows it. The old sweep
--      compared offer_sent_at against that stale now() and stamped the next
--      offer with it too, so its clock ran up to a whole tick behind. For the
--      first rider (stamped by mbg_mark_ride_auto_dispatch with a true now())
--      that stretched the wait to 20-30s instead of 10s. clock_timestamp() is
--      the wall clock and does not have this problem.
--
-- The "pick a specific rider" flow is not touched here: that offer lasts 30
-- seconds and is timed by the customer's app (EnhancedRideRequest.tsx, then
-- mbg_withdraw_ride_offer).
--
-- Keep v_offer_window below in step with AUTO_DISPATCH_OFFER_SECONDS in
-- frontend/src/mybodaguy/services/offerWindows.ts — the rider's countdown and
-- the customer's progress bar are drawn from that number.
-- ============================================================================

-- No SECURITY DEFINER and no SET clause: either one makes COMMIT illegal below.
CREATE OR REPLACE PROCEDURE public.mbg_sweep_auto_dispatch_cascade()
LANGUAGE plpgsql AS $$
DECLARE
  -- How long one rider has to answer before the ride is offered to the next.
  v_offer_window CONSTANT INTERVAL := interval '7 seconds';
  -- Seconds between sweeps. Sets how late an expired offer can be noticed.
  v_tick_seconds CONSTANT DOUBLE PRECISION := 1;
  -- pg_cron starts this once a minute and never runs two copies at once, so
  -- ending just short of 60s leaves no stretch of the minute without a sweep.
  v_run_until TIMESTAMPTZ := clock_timestamp() + interval '59 seconds';
  v_ride RECORD;
  v_next_rider UUID;
  v_new_declined UUID[];
  v_search_exclude UUID[];
  v_total INT := 0;
BEGIN
  LOOP
    FOR v_ride IN
      SELECT * FROM public.mbg_rides
      WHERE status = 'pending'
        AND dispatch_mode = 'auto'
        AND rider_id IS NOT NULL
        AND offer_sent_at IS NOT NULL
        AND offer_sent_at < clock_timestamp() - v_offer_window
      FOR UPDATE SKIP LOCKED
    LOOP
      v_new_declined := array_append(v_ride.declined_rider_ids, v_ride.rider_id);

      -- Also skip (for THIS search only — not persisted into
      -- declined_rider_ids, since it's a transient state that can clear up
      -- moments later) anyone who currently holds a DIFFERENT unanswered
      -- pending offer — mirrors mbg_request_ride's own stacking guard
      -- (FIX_PREVENT_STALE_PENDING_RIDE_OFFERS.sql). mbg_find_available_riders
      -- alone doesn't know this (is_available only flips on accept, not
      -- while an offer sits unanswered), so without this a reassignment
      -- here could stack a second pending row onto a rider who's already
      -- mid-decision on an unrelated request.
      v_search_exclude := v_new_declined || COALESCE(
        (SELECT array_agg(DISTINCT r2.rider_id) FROM public.mbg_rides r2
         WHERE r2.status = 'pending' AND r2.rider_id IS NOT NULL AND r2.id <> v_ride.id),
        ARRAY[]::UUID[]
      );

      -- Hard cap so a rider-dense area can't ring dozens of people for one
      -- request forever — after 15 tries, stop offering it around.
      IF v_ride.dispatch_attempts >= 15 THEN
        UPDATE public.mbg_rides
        SET status = 'cancelled', rider_id = NULL, updated_at = clock_timestamp()
        WHERE id = v_ride.id;
        v_total := v_total + 1;
        CONTINUE;
      END IF;

      SELECT far.rider_id INTO v_next_rider
      FROM public.mbg_find_available_riders(
        v_ride.pickup_lat, v_ride.pickup_lng, v_ride.dropoff_lat, v_ride.dropoff_lng,
        NULL, v_ride.power_type_requested, COALESCE(v_ride.umbrella_requested, false),
        v_search_exclude, 1, v_ride.dispatch_vehicle_types, NULL,
        v_ride.cargo_weight_kg, v_ride.cargo_class
      ) AS far
      LIMIT 1;

      IF v_next_rider IS NOT NULL THEN
        UPDATE public.mbg_rides
        SET rider_id = v_next_rider,
            offer_sent_at = clock_timestamp(),
            declined_rider_ids = v_new_declined,
            dispatch_attempts = dispatch_attempts + 1,
            updated_at = clock_timestamp()
        WHERE id = v_ride.id;
      ELSIF EXISTS (
        -- Nobody free RIGHT NOW — but before giving up, check against just
        -- the permanent exclusion list (no transiently-busy riders skipped)
        -- whether anyone still qualifies at all. If so, they're only busy
        -- with something else for the moment — leave offer_sent_at as-is so
        -- this ride is picked up again (still stale) next tick instead of
        -- being cancelled out from under a rider who'll likely free up soon.
        SELECT 1 FROM public.mbg_find_available_riders(
          v_ride.pickup_lat, v_ride.pickup_lng, v_ride.dropoff_lat, v_ride.dropoff_lng,
          NULL, v_ride.power_type_requested, COALESCE(v_ride.umbrella_requested, false),
          v_new_declined, 1, v_ride.dispatch_vehicle_types, NULL,
          v_ride.cargo_weight_kg, v_ride.cargo_class
        )
      ) THEN
        NULL;
      ELSE
        -- Truly no one left to try.
        UPDATE public.mbg_rides
        SET status = 'cancelled', rider_id = NULL, updated_at = clock_timestamp()
        WHERE id = v_ride.id;
      END IF;

      v_total := v_total + 1;
    END LOOP;

    -- Release this tick's row locks now, before sleeping, so a rider's own
    -- "Accept" (mbg_respond_to_ride locks the same row) is never held up.
    COMMIT;

    EXIT WHEN clock_timestamp() + make_interval(secs => v_tick_seconds) >= v_run_until;
    PERFORM pg_sleep(v_tick_seconds);
  END LOOP;

  -- Housekeeping: keep every mbg-* cron job's run history bounded regardless
  -- of how often each fires — this project is watching Supabase Free Plan
  -- storage growth.
  DELETE FROM cron.job_run_details
  WHERE end_time < now() - interval '2 days'
    AND jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'mbg-%');
  COMMIT;

  RAISE NOTICE 'mbg_sweep_auto_dispatch_cascade: % ride(s) reassigned or cancelled this run', v_total;
END;
$$;
-- Cron/service use only: it has no per-user check, so nobody else gets to call it.
REVOKE ALL ON PROCEDURE public.mbg_sweep_auto_dispatch_cascade FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON PROCEDURE public.mbg_sweep_auto_dispatch_cascade TO service_role;

-- Same job and cadence as ADD_AUTO_DISPATCH_CASCADE.sql (once a minute — the
-- procedure itself ticks every second). Re-registered so this file is enough
-- on its own.
DO $$
BEGIN
  PERFORM cron.unschedule('mbg-auto-dispatch-cascade');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('mbg-auto-dispatch-cascade', '* * * * *', $$ CALL public.mbg_sweep_auto_dispatch_cascade(); $$);

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Just Send now gives each rider 7 seconds, then offers the ride to the next (swept every second, up to 15 riders).';
END $$;
