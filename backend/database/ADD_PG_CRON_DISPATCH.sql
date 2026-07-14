-- ============================================================================
-- PG_CRON DISPATCH (Phase 1, "Supabase + Vercel only" variant)
-- Run after CREATE_JOURNEY_BOOKING_ENGINE.sql.
--
-- Replaces the separate always-on Node process (journeyDispatchScheduler.js
-- / flightStatusPoller.js) with two jobs running inside Supabase's own
-- Postgres via pg_cron — no Railway/Render/separate server needed:
--   1. Journey-leg dispatch is pure SQL (mbg_dispatch_journey_leg already
--      exists), so pg_cron calls it directly every 2 minutes.
--   2. Flight-status polling needs to call Duffel's HTTP API, which SQL
--      can't do directly — pg_net (also Supabase-native) makes an HTTP
--      POST to a Vercel serverless function every 15 minutes instead.
--
-- pg_cron and pg_net are both officially supported Supabase extensions —
-- enable them via Database -> Extensions in the Supabase dashboard first if
-- the CREATE EXTENSION statements below fail with a permission error.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================================
-- 1. Journey-leg dispatch — pure SQL, no external call.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_run_due_journey_dispatch()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_leg RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_leg IN
    SELECT id FROM public.mbg_journey_legs
    WHERE leg_type IN ('local_pickup', 'local_dropoff')
      AND status IN ('pending', 'ready_to_dispatch', 'awaiting_flight_update')
      AND dispatch_after <= now()
    LIMIT 50
  LOOP
    PERFORM public.mbg_dispatch_journey_leg(v_leg.id);
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_run_due_journey_dispatch TO service_role;

-- Re-runnable: unschedule before scheduling so this file can be re-applied
-- safely (pg_cron errors on a duplicate job name in older versions).
DO $$
BEGIN
  PERFORM cron.unschedule('mbg-journey-dispatch');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('mbg-journey-dispatch', '*/2 * * * *', $$ SELECT public.mbg_run_due_journey_dispatch(); $$);

-- ============================================================================
-- 2. Flight-status polling trigger — calls a Vercel serverless function via
--    pg_net, since Duffel's API can only be reached over HTTP, not from SQL.
--
--    After deploying mybodaguy/frontend to Vercel, set these two values:
--      UPDATE public.mbg_platform_settings SET value = 'https://<your-app>.vercel.app/api/jobs/poll-flights' WHERE key = 'journey.poll_flights_url';
--      UPDATE public.mbg_platform_settings SET value = '<same CRON_SECRET as the Vercel env var>' WHERE key = 'journey.cron_secret';
--    Until journey.poll_flights_url is set, this job is a harmless no-op.
-- ============================================================================
INSERT INTO public.mbg_platform_settings (key, value, value_type, description, category, is_public)
VALUES
  ('journey.poll_flights_url', '', 'string', 'Vercel URL for the flight-status poll job (set after deploying)', 'journey', false),
  ('journey.cron_secret', '', 'string', 'Shared secret sent as x-cron-secret header to journey.poll_flights_url', 'journey', false)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.mbg_trigger_flight_status_poll()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT value INTO v_url FROM public.mbg_platform_settings WHERE key = 'journey.poll_flights_url';
  SELECT value INTO v_secret FROM public.mbg_platform_settings WHERE key = 'journey.cron_secret';

  IF v_url IS NULL OR v_url = '' THEN
    RETURN; -- not configured yet — no-op until deployed
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_trigger_flight_status_poll TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('mbg-flight-status-poll');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('mbg-flight-status-poll', '*/15 * * * *', $$ SELECT public.mbg_trigger_flight_status_poll(); $$);

-- ============================================================================
-- 3. Supermarkera cargo dispatch retry — same resilience for supplier
--    deliveries that journey legs already get via dispatch_after.
--
--    dispatchDeliveryForPurchaseOrder() in deliveryDispatchService.js calls
--    mbg_dispatch_delivery_for_purchase_order() once, immediately, when a
--    manager approves a purchase order. If no cargo vehicle was available
--    at that exact moment (or the store/supplier wasn't geocoded yet), that
--    attempt was the only one — nothing retried it. This job closes that
--    gap by retrying any approved purchase order that still has no active
--    delivery, every 5 minutes, until a vehicle picks it up.
--
--    Supplier/supermarket columns are read defensively via to_jsonb(...)->>
--    because this codebase has more than one historical suppliers/
--    supermarkets schema variant on disk (see deliveryDispatchService.js's
--    comments) — ->> on a jsonb built from the live row returns NULL for a
--    column that doesn't exist on this particular deployment instead of
--    erroring, so this function works regardless of which variant is live.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_run_due_cargo_dispatch()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_po RECORD;
  v_pickup_lat NUMERIC;
  v_pickup_lng NUMERIC;
  v_pickup_location TEXT;
  v_dropoff_lat NUMERIC;
  v_dropoff_lng NUMERIC;
  v_dropoff_location TEXT;
  v_supplier_country TEXT;
  v_supermarket_country TEXT;
  v_country TEXT;
  v_cross_border BOOLEAN;
  v_count INTEGER := 0;
BEGIN
  FOR v_po IN
    SELECT po.id, po.supermarket_id, po.supplier_id
    FROM public.purchase_orders po
    WHERE po.status = 'approved'
      AND NOT EXISTS (
        SELECT 1 FROM public.mbg_rides r
        WHERE r.purchase_order_id = po.id AND r.status NOT IN ('cancelled', 'failed')
      )
    LIMIT 50
  LOOP
    -- Dropoff: the store (supermarkets.id = purchase_orders.supermarket_id)
    SELECT sm.latitude, sm.longitude,
           COALESCE(to_jsonb(sm.*) ->> 'address', to_jsonb(sm.*) ->> 'name', 'Store'),
           to_jsonb(sm.*) ->> 'country'
    INTO v_dropoff_lat, v_dropoff_lng, v_dropoff_location, v_supermarket_country
    FROM public.supermarkets sm
    WHERE sm.id = v_po.supermarket_id;

    -- Pickup: the supplier. purchase_orders.supplier_id is documented as
    -- "auth.uid() of supplier", so resolve through users first (same join
    -- deliveryDispatchService.js does via getSupplierOrderMatchIds), same
    -- fallback to matching directly on suppliers.user_id if that's what
    -- was actually stored.
    SELECT s.latitude, s.longitude,
           COALESCE(to_jsonb(s.*) ->> 'address', to_jsonb(s.*) ->> 'company_name', 'Supplier'),
           to_jsonb(s.*) ->> 'country'
    INTO v_pickup_lat, v_pickup_lng, v_pickup_location, v_supplier_country
    FROM public.suppliers s
    LEFT JOIN public.users u ON (u.auth_id = v_po.supplier_id OR u.id = v_po.supplier_id) AND u.role = 'supplier'
    WHERE s.user_id = COALESCE(u.id, v_po.supplier_id)
    LIMIT 1;

    IF v_pickup_lat IS NULL OR v_pickup_lng IS NULL OR v_dropoff_lat IS NULL OR v_dropoff_lng IS NULL THEN
      CONTINUE; -- not geocoded yet — leave for the next pass, same as the JS path
    END IF;

    v_country := COALESCE(v_supermarket_country, v_supplier_country, 'Uganda');
    v_cross_border := (v_supplier_country IS NOT NULL AND v_supermarket_country IS NOT NULL AND v_supplier_country <> v_supermarket_country);

    PERFORM public.mbg_dispatch_delivery_for_purchase_order(
      v_po.id, v_pickup_lat, v_pickup_lng, v_pickup_location,
      v_dropoff_lat, v_dropoff_lng, v_dropoff_location,
      v_country, v_cross_border
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_run_due_cargo_dispatch TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('mbg-cargo-dispatch-retry');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('mbg-cargo-dispatch-retry', '*/5 * * * *', $$ SELECT public.mbg_run_due_cargo_dispatch(); $$);

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ pg_cron dispatch ready for BOTH sides: BodaGo journey legs dispatch every 2 min, supermarkera cargo delivery retry every 5 min (pure SQL, no external call for either), flight-status poll trigger every 15 min (set journey.poll_flights_url/journey.cron_secret after deploying to Vercel).';
END $$;
