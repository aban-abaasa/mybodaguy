-- ============================================================================
-- "Just Send" — auto-dispatch cascade for ride/delivery requests.
-- ============================================================================
-- Until now a customer always had to pick one specific rider from
-- mbg_find_available_riders' results (EnhancedRideRequest.tsx's "Find
-- Available Riders" list) and manually retry a different one if that rider
-- didn't respond within the client's own 30s countdown
-- (mbg_withdraw_ride_offer). This adds a second path: "Just Send — Any
-- Available Rider" hands the whole thing to the server instead —
--   1. The ride is created against the best-matched rider exactly as
--      before (same mbg_request_ride, same mbg_find_available_riders
--      ranking), then flagged dispatch_mode='auto' via
--      mbg_mark_ride_auto_dispatch.
--   2. Every 10 seconds, mbg_sweep_auto_dispatch_cascade checks every
--      'auto' ride still 'pending' past its 10s window and — if the
--      current rider hasn't answered — reassigns rider_id to the next-best
--      candidate (excluding everyone already tried), resets the clock, and
--      repeats. The newly-assigned rider's own app picks it up exactly the
--      way it already picks up any offer (RiderRideRequests.tsx's existing
--      poll + realtime subscription on rider_id) — nothing rider-side
--      needed to change for that part.
--   3. If every candidate is exhausted (or 15 attempts pass), the ride is
--      cancelled and the customer's screen shows "no riders available".
--
-- The "pick a specific rider" path is completely untouched: same 30s
-- client-side wait, same mbg_withdraw_ride_offer on timeout, same
-- mbg_request_ride call with an explicit p_rider_id. dispatch_mode defaults
-- to 'direct' so every existing ride/row behaves exactly as it does today.
--
-- pg_cron granularity note: every other job in this project schedules at
-- whole-minute granularity (see FIX_PREVENT_STALE_PENDING_RIDE_OFFERS.sql,
-- ADD_PG_CRON_DISPATCH.sql) — there's no precedent here for pg_cron's
-- second-level interval syntax actually being available on this Supabase
-- project, so rather than gamble on `cron.schedule('name', '10 seconds', ..)`
-- outright failing, mbg_sweep_auto_dispatch_cascade is scheduled at the
-- same safe 1-minute cadence as everything else and loops internally
-- (6 x 10s pg_sleep) to get the actual 10s cascade cadence. This also means
-- cron.job_run_details only gains ONE row per minute for this job — same
-- log growth rate as the existing jobs, not 6x — which matters on the
-- Supabase Free Plan's storage cap. It also self-trims old run-history for
-- every mbg-* job while it's at it, so that table doesn't grow unbounded
-- regardless.
-- ============================================================================

ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS dispatch_mode TEXT NOT NULL DEFAULT 'direct' CHECK (dispatch_mode IN ('direct', 'auto')),
  ADD COLUMN IF NOT EXISTS offer_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS declined_rider_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dispatch_attempts INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS dispatch_vehicle_types TEXT[];

CREATE INDEX IF NOT EXISTS mbg_rides_auto_dispatch_idx
  ON public.mbg_rides (offer_sent_at)
  WHERE dispatch_mode = 'auto' AND status = 'pending';

-- ── Customer-facing: flip a just-created pending ride into cascade mode ────
CREATE OR REPLACE FUNCTION public.mbg_mark_ride_auto_dispatch(
  p_ride_id UUID,
  p_vehicle_types TEXT[] DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id UUID;
  v_updated UUID;
BEGIN
  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();

  UPDATE public.mbg_rides
  SET dispatch_mode = 'auto',
      offer_sent_at = now(),
      declined_rider_ids = '{}',
      dispatch_attempts = 1,
      dispatch_vehicle_types = p_vehicle_types,
      updated_at = now()
  WHERE id = p_ride_id
    AND customer_id = v_customer_id
    AND status = 'pending'
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ride not found, not yours, or no longer pending');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_mark_ride_auto_dispatch(UUID, TEXT[]) TO authenticated;

-- ── Server-side: the actual cascade sweep ──────────────────────────────────
-- Not exposed to authenticated/anon — this has no per-row auth check
-- (there's no calling user in a cron context), so it must only ever run as
-- the service/cron role, same posture as mbg_expire_stale_pending_ride_offers.
--
-- A PROCEDURE, not a FUNCTION: this runs one internal tick every ~10s across
-- a ~60s pg_cron invocation (see file header), and a plain FUNCTION can't
-- COMMIT mid-execution — every row it locked with FOR UPDATE in tick 1 would
-- stay locked for the entire ~60s, including through every pg_sleep, since
-- row locks only release at transaction end. That would block a rider's own
-- "Accept" tap (mbg_respond_to_ride's own FOR UPDATE on the same row) for up
-- to a minute if it landed on a row this sweep had already touched. A
-- PROCEDURE can COMMIT after each tick, releasing those locks immediately
-- instead of holding them through the sleep.
CREATE OR REPLACE PROCEDURE public.mbg_sweep_auto_dispatch_cascade()
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tick INT;
  v_ride RECORD;
  v_next_rider UUID;
  v_new_declined UUID[];
  v_search_exclude UUID[];
  v_total INT := 0;
BEGIN
  FOR v_tick IN 1..6 LOOP
    FOR v_ride IN
      SELECT * FROM public.mbg_rides
      WHERE status = 'pending'
        AND dispatch_mode = 'auto'
        AND rider_id IS NOT NULL
        AND offer_sent_at IS NOT NULL
        AND offer_sent_at < now() - interval '10 seconds'
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
        SET status = 'cancelled', rider_id = NULL, updated_at = now()
        WHERE id = v_ride.id;
        v_total := v_total + 1;
        CONTINUE;
      END IF;

      SELECT far.rider_id INTO v_next_rider
      FROM public.mbg_find_available_riders(
        v_ride.pickup_lat, v_ride.pickup_lng, v_ride.dropoff_lat, v_ride.dropoff_lng,
        NULL, v_ride.power_type_requested, COALESCE(v_ride.umbrella_requested, false),
        v_search_exclude, 1, v_ride.dispatch_vehicle_types, NULL
      ) AS far
      LIMIT 1;

      IF v_next_rider IS NOT NULL THEN
        UPDATE public.mbg_rides
        SET rider_id = v_next_rider,
            offer_sent_at = now(),
            declined_rider_ids = v_new_declined,
            dispatch_attempts = dispatch_attempts + 1,
            updated_at = now()
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
          v_new_declined, 1, v_ride.dispatch_vehicle_types, NULL
        )
      ) THEN
        NULL;
      ELSE
        -- Truly no one left to try.
        UPDATE public.mbg_rides
        SET status = 'cancelled', rider_id = NULL, updated_at = now()
        WHERE id = v_ride.id;
      END IF;

      v_total := v_total + 1;
    END LOOP;

    -- Release this tick's row locks now, before sleeping, instead of
    -- holding them for the rest of this ~60s call (see comment above).
    COMMIT;

    IF v_tick < 6 THEN
      PERFORM pg_sleep(10);
    END IF;
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
GRANT EXECUTE ON PROCEDURE public.mbg_sweep_auto_dispatch_cascade TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('mbg-auto-dispatch-cascade');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('mbg-auto-dispatch-cascade', '* * * * *', $$ CALL public.mbg_sweep_auto_dispatch_cascade(); $$);

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Auto-dispatch cascade ready — "Just Send" rides reassign to the next available rider every ~10s (server-side, up to 15 tries) instead of requiring the customer to manually retry.';
END $$;
