-- ============================================================================
-- "Just Send": share the request with many riders — the first to accept takes it.
-- ============================================================================
-- Run this once in the Supabase SQL editor. It replaces the cascade sweep (which
-- passed the request from one rider to the next, and — in the versions in
-- ADD_AUTO_DISPATCH_CASCADE.sql / ADD_VEHICLE_CLASS_FARE_RATES.sql — could never
-- run at all: SECURITY DEFINER procedures cannot COMMIT) with a shared request:
--
--   * A new rider is ADDED every 7 seconds (the nearest available one first).
--   * Every rider KEEPS the request for 30 seconds from the moment they got it,
--     whether or not newer riders have been added after them. So the request is
--     open to several riders at once (about 4-5 at a time).
--   * Whoever accepts first takes it. Everyone else's request disappears at
--     once; a rider who taps a moment too late is told it was already taken.
--   * A rider who declines drops out; if nobody is left holding the request, the
--     next rider is added straight away instead of waiting for the 7 seconds.
--   * Once there is no one left to ask and every offer has run out, the request is
--     cancelled and the customer sees "no riders available" (up to 15 riders).
--
-- How it works
--   mbg_ride_offers  one row per (ride, rider): when it was offered, when it runs
--                    out, and what became of it. A ride has had a single rider_id
--                    until now, which cannot describe "offered to several riders".
--   mbg_accept_ride_offer   the rider's Accept. Locks the ride, checks the rider
--                    still holds a live offer, makes them the ride's rider and then
--                    runs the existing mbg_respond_to_ride — so payments, the
--                    delivery wallet charge, receipts etc. are untouched. If that
--                    refuses (e.g. wallet too low) the claim is undone.
--   mbg_decline_ride_offer / mbg_my_ride_offers / mbg_ride_dispatch_status
--                    the rider's Decline, the rider's list of live offers (each
--                    priced for THEIR vehicle class), and what the customer sees.
--   mbg_sweep_auto_dispatch_cascade   still run once a minute by pg_cron and loops
--                    every second inside; expires offers and adds the next rider.
--
-- Not touched: the "pick a specific rider" flow (30s, rider_id, mbg_respond_to_ride).
--
-- Keep the two numbers in step with frontend/src/mybodaguy/services/offerWindows.ts:
--   v_window  in mbg_make_ride_offer          = OFFER_SECONDS (30)
--   v_stagger in mbg_sweep_auto_dispatch_cascade = AUTO_DISPATCH_STAGGER_SECONDS (7)
-- ============================================================================

-- Present in the live database already (added outside the repo's SQL files); the
-- cascade now honours it so a ride tied to one business only reaches its riders.
ALTER TABLE public.mbg_rides ADD COLUMN IF NOT EXISTS dispatch_business_profile_id UUID;

-- ── Offers ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mbg_ride_offers (
  ride_id    UUID NOT NULL REFERENCES public.mbg_rides(id) ON DELETE CASCADE,
  rider_id   UUID NOT NULL REFERENCES public.mbg_riders(id) ON DELETE CASCADE,
  offered_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL,
  -- active: the rider can still answer. accepted: they took it. lost: someone else
  -- took it. declined / expired: they said no / ran out of time. closed: the
  -- request was cancelled or withdrawn.
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'accepted', 'lost', 'declined', 'expired', 'closed')),
  PRIMARY KEY (ride_id, rider_id)
);

CREATE INDEX IF NOT EXISTS mbg_ride_offers_rider_active_idx
  ON public.mbg_ride_offers (rider_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS mbg_ride_offers_expiry_idx
  ON public.mbg_ride_offers (expires_at) WHERE status = 'active';

-- Which rider profiles belong to the signed-in user (a person can hold several,
-- one per vehicle). A function so the policy below does not depend on the
-- caller's own access to mbg_riders.
CREATE OR REPLACE FUNCTION public.mbg_my_rider_ids()
RETURNS UUID[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(id), ARRAY[]::UUID[]) FROM public.mbg_riders WHERE user_id = auth.uid();
$$;
REVOKE ALL ON FUNCTION public.mbg_my_rider_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_my_rider_ids() TO authenticated, service_role;

-- A rider can read their own offers (this is what makes a new offer appear on
-- their phone instantly, over realtime). Nobody writes this table directly —
-- only the functions below do.
ALTER TABLE public.mbg_ride_offers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mbg_ride_offers_read_own ON public.mbg_ride_offers;
CREATE POLICY mbg_ride_offers_read_own ON public.mbg_ride_offers
  FOR SELECT TO authenticated USING (rider_id = ANY (public.mbg_my_rider_ids()));
DROP POLICY IF EXISTS mbg_ride_offers_service_role ON public.mbg_ride_offers;
CREATE POLICY mbg_ride_offers_service_role ON public.mbg_ride_offers
  FOR ALL USING (auth.role() = 'service_role');
REVOKE ALL ON public.mbg_ride_offers FROM anon, authenticated;
GRANT SELECT ON public.mbg_ride_offers TO authenticated;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.mbg_ride_offers;
EXCEPTION
  WHEN duplicate_object THEN NULL;   -- already published
  WHEN undefined_object THEN NULL;   -- no realtime publication here
END $$;

-- ── What the ride pays THIS rider ───────────────────────────────────────────
-- A "Just Send" ride can be open to a boda, a car and a van at once, and each is
-- paid by their own vehicle's rate. This is exactly the calculation
-- trg_mbg_reprice_ride_on_rider_change applies when a rider is made the ride's
-- rider, so the figure a rider sees on the offer is the figure they get.
CREATE OR REPLACE FUNCTION public.mbg_ride_pricing_for_rider(p_ride public.mbg_rides, p_rider_id UUID)
RETURNS TABLE (o_fare NUMERIC, o_rider_earning NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider public.mbg_riders%ROWTYPE;
  v_split RECORD;
  v_fare NUMERIC;
BEGIN
  o_fare := p_ride.fare;
  o_rider_earning := p_ride.rider_earning;

  IF COALESCE(p_ride.is_journey_prepaid, false) OR p_ride.distance_km IS NULL THEN
    RETURN NEXT;
    RETURN;
  END IF;
  SELECT * INTO v_rider FROM public.mbg_riders WHERE id = p_rider_id;
  IF NOT FOUND THEN
    RETURN NEXT;
    RETURN;
  END IF;

  v_fare := public.mbg_price_ride_for_rider(
    v_rider, p_ride.distance_km, COALESCE(p_ride.time_multiplier, 1), p_ride.cargo_weight_kg, p_ride.cargo_class
  );
  SELECT * INTO v_split FROM public.mbg_compute_ride_charges(
    v_fare,
    v_rider.vehicle_type::TEXT IN ('motorcycle', 'bicycle', 'tuktuk'),
    v_rider.business_profile_id IS NOT NULL
  );
  o_fare := v_fare;
  o_rider_earning := v_split.o_rider_earning;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_ride_pricing_for_rider(public.mbg_rides, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_ride_pricing_for_rider(public.mbg_rides, UUID) TO service_role;

-- ── Offer a ride to one more rider ──────────────────────────────────────────
-- Every offer lasts 30 seconds from now. Returns false if this rider was already
-- offered this ride. Riders get a push notification (the ride's own push only
-- fires for the rider_id on the ride row, which is just the first rider).
CREATE OR REPLACE FUNCTION public.mbg_make_ride_offer(p_ride_id UUID, p_rider_id UUID, p_push BOOLEAN DEFAULT TRUE)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_window CONSTANT INTERVAL := interval '30 seconds';
  v_ride public.mbg_rides%ROWTYPE;
  v_pricing RECORD;
  v_user UUID;
  v_rows INT;
BEGIN
  INSERT INTO public.mbg_ride_offers (ride_id, rider_id, offered_at, expires_at)
  VALUES (p_ride_id, p_rider_id, clock_timestamp(), clock_timestamp() + v_window)
  ON CONFLICT (ride_id, rider_id) DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN FALSE;
  END IF;

  IF p_push THEN
    BEGIN
      SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id;
      SELECT user_id INTO v_user FROM public.mbg_riders WHERE id = p_rider_id;
      SELECT * INTO v_pricing FROM public.mbg_ride_pricing_for_rider(v_ride, p_rider_id);
      PERFORM public.mbg_push(
        v_user, 'bodagoera_ride', 'New ride request',
        left(v_ride.pickup_location, 40) || ' → ' || left(v_ride.dropoff_location, 40)
          || ' · UGX ' || to_char(v_pricing.o_fare, 'FM999,999,999'),
        p_ride_id, 'mbg-ride-' || p_ride_id
      );
    EXCEPTION WHEN OTHERS THEN
      NULL; -- a failed push must never lose the offer
    END;
  END IF;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_make_ride_offer(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_make_ride_offer(UUID, UUID, BOOLEAN) TO service_role;

-- The rider a ride was first handed to (mbg_request_ride) holds the first offer.
-- Fires when a ride becomes a "Just Send" ride — from the customer's request
-- (mbg_mark_ride_auto_dispatch) or a journey leg's dispatch alike. That rider has
-- already been pushed by the ride's own notification, so no second push.
CREATE OR REPLACE FUNCTION public.mbg_offer_to_assigned_rider()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.mbg_make_ride_offer(NEW.id, NEW.rider_id, false);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_offer_to_assigned_rider() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_offer_to_assigned_rider() TO service_role;

DROP TRIGGER IF EXISTS trg_mbg_offer_to_assigned_rider ON public.mbg_rides;
CREATE TRIGGER trg_mbg_offer_to_assigned_rider
  AFTER INSERT OR UPDATE OF dispatch_mode, rider_id ON public.mbg_rides
  FOR EACH ROW
  WHEN (NEW.dispatch_mode = 'auto' AND NEW.status = 'pending' AND NEW.rider_id IS NOT NULL)
  EXECUTE FUNCTION public.mbg_offer_to_assigned_rider();

-- When a ride leaves 'pending' every offer still open on it is settled: the rider
-- who now holds the ride is marked accepted, everyone else lost it (or the request
-- was cancelled). This is what takes the request off the other riders' screens the
-- moment someone accepts — through any path, including a plain mbg_respond_to_ride.
CREATE OR REPLACE FUNCTION public.mbg_settle_ride_offers()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.mbg_ride_offers o
  SET status = CASE
        WHEN NEW.status::TEXT IN ('accepted', 'in_progress', 'completed') AND o.rider_id = NEW.rider_id THEN 'accepted'
        WHEN NEW.status::TEXT IN ('accepted', 'in_progress', 'completed') THEN 'lost'
        ELSE 'closed'
      END
  WHERE o.ride_id = NEW.id AND o.status = 'active';
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_settle_ride_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_settle_ride_offers() TO service_role;

DROP TRIGGER IF EXISTS trg_mbg_settle_ride_offers ON public.mbg_rides;
CREATE TRIGGER trg_mbg_settle_ride_offers
  AFTER UPDATE OF status ON public.mbg_rides
  FOR EACH ROW
  WHEN (OLD.status = 'pending' AND NEW.status <> 'pending')
  EXECUTE FUNCTION public.mbg_settle_ride_offers();

-- ── Rider: accept ───────────────────────────────────────────────────────────
-- The ride row is locked first, so two riders tapping Accept together are
-- handled one after the other: exactly one wins, the other is told it was taken.
CREATE OR REPLACE FUNCTION public.mbg_accept_ride_offer(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_rider_id UUID;
  v_result JSONB;
BEGIN
  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.status <> 'pending' THEN
    RAISE EXCEPTION 'This request was already taken by another rider, or is no longer available';
  END IF;

  SELECT o.rider_id INTO v_rider_id
  FROM public.mbg_ride_offers o
  JOIN public.mbg_riders r ON r.id = o.rider_id
  WHERE o.ride_id = p_ride_id
    AND r.user_id = auth.uid()
    AND o.status = 'active'
    AND o.expires_at > clock_timestamp()
  ORDER BY o.offered_at DESC
  LIMIT 1;
  IF v_rider_id IS NULL THEN
    RAISE EXCEPTION 'Your time to answer this request ran out, or it was not offered to you';
  END IF;

  BEGIN
    -- Make this rider the ride's rider (re-priced for their vehicle by
    -- trg_mbg_reprice_ride_on_rider_change), then accept exactly as always.
    UPDATE public.mbg_rides SET rider_id = v_rider_id, updated_at = clock_timestamp() WHERE id = p_ride_id;
    v_result := public.mbg_respond_to_ride(p_ride_id, true);
    IF COALESCE((v_result ->> 'success')::BOOLEAN, false) IS NOT TRUE THEN
      -- The accept was refused with a message (not an error). Undo the claim so
      -- the request stays open to everyone, and hand the message back.
      RAISE EXCEPTION USING ERRCODE = 'MB001', MESSAGE = 'accept refused';
    END IF;
  EXCEPTION WHEN SQLSTATE 'MB001' THEN
    RETURN v_result;
  END;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_accept_ride_offer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_accept_ride_offer(UUID) TO authenticated;

-- ── Rider: decline ──────────────────────────────────────────────────────────
-- Only this rider drops out; the request carries on with everyone else.
CREATE OR REPLACE FUNCTION public.mbg_decline_ride_offer(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.mbg_ride_offers o
  SET status = 'declined'
  WHERE o.ride_id = p_ride_id AND o.status = 'active' AND o.rider_id = ANY (public.mbg_my_rider_ids());
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_decline_ride_offer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_decline_ride_offer(UUID) TO authenticated;

-- ── Rider: the requests open to me right now ────────────────────────────────
-- Each row is the ride as the rider's screen already reads it, plus: which of my
-- rider profiles it was offered to, how many seconds I have left (measured on the
-- server, so a phone with a wrong clock still shows the right countdown), and the
-- fare and take-home for MY vehicle.
CREATE OR REPLACE FUNCTION public.mbg_my_ride_offers()
RETURNS SETOF JSONB LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(r) || jsonb_build_object(
           'offer_rider_id', o.rider_id,
           'offer_seconds_left', GREATEST(0, EXTRACT(EPOCH FROM (o.expires_at - clock_timestamp()))),
           'fare', pr.o_fare,
           'rider_earning', pr.o_rider_earning
         )
  FROM public.mbg_ride_offers o
  JOIN public.mbg_rides r ON r.id = o.ride_id
  CROSS JOIN LATERAL public.mbg_ride_pricing_for_rider(r, o.rider_id) pr
  WHERE o.rider_id = ANY (public.mbg_my_rider_ids())
    AND o.status = 'active'
    AND o.expires_at > clock_timestamp()
    AND r.status = 'pending'
  ORDER BY o.offered_at DESC;
$$;
REVOKE ALL ON FUNCTION public.mbg_my_ride_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_my_ride_offers() TO authenticated;

-- ── Customer: how is my request going? ──────────────────────────────────────
-- Who is being asked right now, how many riders have been asked in all, and — once
-- someone accepts — who. (The customer's screen used to assume the rider it
-- first picked; with a shared request the winner is usually someone else.)
CREATE OR REPLACE FUNCTION public.mbg_ride_dispatch_status(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_customer_id UUID;
  v_active UUID[];
  v_total INT;
  v_rider JSONB;
BEGIN
  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();
  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id;
  IF NOT FOUND OR v_customer_id IS NULL OR v_ride.customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;

  SELECT COALESCE(array_agg(o.rider_id ORDER BY o.offered_at), ARRAY[]::UUID[]) INTO v_active
  FROM public.mbg_ride_offers o
  WHERE o.ride_id = p_ride_id AND o.status = 'active' AND o.expires_at > clock_timestamp();
  SELECT count(*) INTO v_total FROM public.mbg_ride_offers WHERE ride_id = p_ride_id;

  IF v_ride.status::TEXT IN ('accepted', 'in_progress', 'completed') AND v_ride.rider_id IS NOT NULL THEN
    SELECT jsonb_build_object(
             'rider_id', r.id,
             'full_name', COALESCE(up.full_name, 'Rider'),
             'phone', COALESCE(NULLIF(up.phone, ''), NULLIF(u.phone, '')),
             'rating', r.rating,
             'total_rides', r.total_rides,
             'vehicle_type', r.vehicle_type::TEXT,
             'power_type', r.power_type,
             'has_umbrella', r.has_umbrella,
             'plate_number', r.plate_number,
             'vehicle_color', r.vehicle_color,
             'mode', r.mode
           )
    INTO v_rider
    FROM public.mbg_riders r
    JOIN public.mbg_users u ON u.id = r.user_id
    LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
    WHERE r.id = v_ride.rider_id;
  END IF;

  RETURN jsonb_build_object(
    'status', v_ride.status::TEXT,
    'rider_id', v_ride.rider_id,
    'fare', v_ride.fare,
    'active_rider_ids', to_jsonb(v_active),
    'offered_total', v_total,
    'rider', v_rider
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_ride_dispatch_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_ride_dispatch_status(UUID) TO authenticated;

-- ── The sweep ───────────────────────────────────────────────────────────────
-- No SECURITY DEFINER and no SET clause: either one makes COMMIT illegal below
-- ("invalid transaction termination"). pg_cron runs it as the owner (postgres).
-- Reads the real clock (clock_timestamp), not now(): after a COMMIT, now() is
-- frozen before the pg_sleep that follows it.
CREATE OR REPLACE PROCEDURE public.mbg_sweep_auto_dispatch_cascade()
LANGUAGE plpgsql AS $$
DECLARE
  -- A new rider is added to a request this often.
  v_stagger CONSTANT INTERVAL := interval '7 seconds';
  -- How soon to look again when the request has nobody left holding it.
  v_retry CONSTANT INTERVAL := interval '1 second';
  -- Most riders one request is ever offered to.
  v_max_offers CONSTANT INT := 15;
  -- Seconds between sweeps.
  v_tick_seconds CONSTANT DOUBLE PRECISION := 1;
  -- pg_cron starts this once a minute and never runs two copies at once, so
  -- ending just short of 60s leaves no stretch of the minute without a sweep.
  v_run_until TIMESTAMPTZ := clock_timestamp() + interval '59 seconds';
  v_ride RECORD;
  v_active INT;
  v_next_rider UUID;
  v_offered UUID[];
  v_busy UUID[];
  v_total INT := 0;
BEGIN
  LOOP
    -- Offers that ran out their 30 seconds.
    UPDATE public.mbg_ride_offers SET status = 'expired'
    WHERE status = 'active' AND expires_at <= clock_timestamp();

    -- Requests due another rider: it is 7 seconds since one was last added, or
    -- nobody is holding the request any more. Only live requests — an old stuck
    -- one (rider_id cleared by mbg_expire_stale_pending_ride_offers) is left alone.
    FOR v_ride IN
      SELECT r.* FROM public.mbg_rides r
      WHERE r.status = 'pending'
        AND r.dispatch_mode = 'auto'
        AND r.rider_id IS NOT NULL
        AND r.offer_sent_at IS NOT NULL
        AND r.created_at > clock_timestamp() - interval '5 minutes'
        AND (
          r.offer_sent_at <= clock_timestamp() - v_stagger
          OR (
            r.offer_sent_at <= clock_timestamp() - v_retry
            AND NOT EXISTS (SELECT 1 FROM public.mbg_ride_offers o WHERE o.ride_id = r.id AND o.status = 'active')
          )
        )
      FOR UPDATE OF r SKIP LOCKED
    LOOP
      SELECT count(*) INTO v_active
      FROM public.mbg_ride_offers WHERE ride_id = v_ride.id AND status = 'active';

      -- Riders already offered this ride (answered, ran out, or still holding it)
      -- never get it twice; declined_rider_ids carries any riders ruled out up front.
      v_offered := COALESCE((SELECT array_agg(o.rider_id) FROM public.mbg_ride_offers o WHERE o.ride_id = v_ride.id), ARRAY[]::UUID[])
                   || COALESCE(v_ride.declined_rider_ids, ARRAY[]::UUID[]);

      -- Also skip anyone who is mid-decision on a DIFFERENT request — an open
      -- offer on another shared ride, or a pending ride handed to them directly —
      -- mirrors mbg_request_ride's own stacking guard
      -- (FIX_PREVENT_STALE_PENDING_RIDE_OFFERS.sql).
      v_busy := COALESCE((
        SELECT array_agg(DISTINCT b.rider_id) FROM (
          SELECT o.rider_id FROM public.mbg_ride_offers o
          WHERE o.status = 'active' AND o.ride_id <> v_ride.id
          UNION
          SELECT r2.rider_id FROM public.mbg_rides r2
          WHERE r2.status = 'pending' AND r2.dispatch_mode <> 'auto' AND r2.rider_id IS NOT NULL AND r2.id <> v_ride.id
        ) b
      ), ARRAY[]::UUID[]);

      -- Hard cap so a rider-dense area can't ring dozens of people for one request.
      IF v_ride.dispatch_attempts >= v_max_offers THEN
        IF v_active = 0 THEN
          UPDATE public.mbg_rides
          SET status = 'cancelled', rider_id = NULL, updated_at = clock_timestamp()
          WHERE id = v_ride.id;
        ELSE
          UPDATE public.mbg_rides SET offer_sent_at = clock_timestamp() WHERE id = v_ride.id;
        END IF;
        v_total := v_total + 1;
        CONTINUE;
      END IF;

      SELECT far.rider_id INTO v_next_rider
      FROM public.mbg_find_available_riders(
        v_ride.pickup_lat, v_ride.pickup_lng, v_ride.dropoff_lat, v_ride.dropoff_lng,
        NULL, v_ride.power_type_requested, COALESCE(v_ride.umbrella_requested, false),
        v_offered || v_busy, 1, v_ride.dispatch_vehicle_types, v_ride.dispatch_business_profile_id,
        v_ride.cargo_weight_kg, v_ride.cargo_class
      ) AS far
      LIMIT 1;

      IF v_next_rider IS NOT NULL THEN
        PERFORM public.mbg_make_ride_offer(v_ride.id, v_next_rider);
        UPDATE public.mbg_rides
        SET offer_sent_at = clock_timestamp(),
            dispatch_attempts = dispatch_attempts + 1,
            updated_at = clock_timestamp()
        WHERE id = v_ride.id;
      ELSIF EXISTS (
        -- Nobody free RIGHT NOW — but before giving up, check against just the
        -- riders already offered (no transiently-busy riders skipped) whether
        -- anyone still qualifies at all. If so they're only busy with something
        -- else for the moment, so keep the request open and look again soon.
        SELECT 1 FROM public.mbg_find_available_riders(
          v_ride.pickup_lat, v_ride.pickup_lng, v_ride.dropoff_lat, v_ride.dropoff_lng,
          NULL, v_ride.power_type_requested, COALESCE(v_ride.umbrella_requested, false),
          v_offered, 1, v_ride.dispatch_vehicle_types, v_ride.dispatch_business_profile_id,
          v_ride.cargo_weight_kg, v_ride.cargo_class
        )
      ) THEN
        IF v_active > 0 THEN
          UPDATE public.mbg_rides SET offer_sent_at = clock_timestamp() WHERE id = v_ride.id;
        END IF;
      ELSIF v_active = 0 THEN
        -- Everyone has been asked and no offer is left open: nobody took it.
        UPDATE public.mbg_rides
        SET status = 'cancelled', rider_id = NULL, updated_at = clock_timestamp()
        WHERE id = v_ride.id;
      ELSE
        -- Everyone has been asked; wait for the offers still open to run out.
        UPDATE public.mbg_rides SET offer_sent_at = clock_timestamp() WHERE id = v_ride.id;
      END IF;

      v_total := v_total + 1;
    END LOOP;

    -- Release this tick's row locks now, before sleeping, so a rider's own
    -- "Accept" (which locks the same ride row) is never held up.
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

  RAISE NOTICE 'mbg_sweep_auto_dispatch_cascade: % request(s) advanced or cancelled this run', v_total;
END;
$$;
-- Cron/service use only: it has no per-user check, so nobody else gets to call it.
REVOKE ALL ON PROCEDURE public.mbg_sweep_auto_dispatch_cascade FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON PROCEDURE public.mbg_sweep_auto_dispatch_cascade TO service_role;

-- Same job and cadence as before (once a minute — the procedure ticks every
-- second). Re-registered so this file is enough on its own.
DO $$
BEGIN
  PERFORM cron.unschedule('mbg-auto-dispatch-cascade');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('mbg-auto-dispatch-cascade', '* * * * *', $$ CALL public.mbg_sweep_auto_dispatch_cascade(); $$);

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Just Send now shares a request: a new rider every 7s, each keeps it 30s, the first to accept takes it.';
END $$;
