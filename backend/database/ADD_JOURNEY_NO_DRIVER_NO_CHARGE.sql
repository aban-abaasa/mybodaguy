-- ============================================================================
-- NO DRIVER, NO CHARGE — complete journeys
-- Run after ADD_JOURNEY_PREPAID_LEG_FARES.sql, ADD_PG_CRON_DISPATCH.sql,
-- ADD_JOURNEY_OPTIONAL_RIDES_COMPLETION.sql and
-- ADD_CANCEL_WITH_REASON_AND_DELETE_ORDERS.sql (safe to re-run).
--
-- The problem
--   A complete journey is paid in ONE upfront ICAN payment that already includes
--   the ride to the airport and the ride from the arrival airport. When no driver
--   or rider could be found for one of those rides, mbg_dispatch_journey_leg just
--   left the leg in 'ready_to_dispatch' and the 2-minute pg_cron job kept trying
--   forever — the customer had PAID for a ride that was never going to happen,
--   and the only way to get the money back was to cancel the whole journey by hand.
--
-- The fix
--   If a ground leg still has no driver a grace period after the moment it was
--   meant to go out, the customer does not pay for it:
--     · the leg's own coin price (fare_ican) goes back to whoever paid — the
--       company wallet for a company-paid journey, otherwise the customer's own
--       wallet (a full reversal, no tithe — same as mbg_cancel_journey);
--     · the leg is closed ('cancelled', no_driver_at set) so it stops retrying;
--     · the customer gets a push saying so.
--   The air ticket, the other ride and the rest of the journey are untouched. A
--   journey whose arrival ride was dropped this way completes itself once the
--   flight has landed, exactly like a journey booked without an arrival ride.
--
--   Only passenger/parcel airport rides (local_pickup / local_dropoff) are
--   covered. A leg that already has a driver (even one who has not accepted yet:
--   a declined offer is re-queued by mbg_sync_journey_leg_with_ride) is never
--   touched, and each leg can be refunded at most once.
--
-- The grace period is journey.no_driver_refund_minutes in mbg_platform_settings
-- (default 30). It counts from the leg's dispatch_after: for the ride to the
-- airport that is the latest time the customer had to leave; for the arrival
-- ride it is the time the flight lands.
-- ============================================================================

ALTER TABLE public.mbg_journey_legs ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
ALTER TABLE public.mbg_journey_legs ADD COLUMN IF NOT EXISTS fare_ican NUMERIC;
-- Set when the leg was given up because no driver could be found (and refunded).
ALTER TABLE public.mbg_journey_legs ADD COLUMN IF NOT EXISTS no_driver_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 1. Refund ONE ground leg that has no driver and close it. Idempotent.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_refund_journey_leg_no_driver(p_leg_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_journey_id   UUID;
  v_journey      public.mbg_journeys%ROWTYPE;
  v_leg          public.mbg_journey_legs%ROWTYPE;
  v_refund_ican  NUMERIC := 0;
  v_company      UUID;
  v_customer     UUID;
  v_debit        RECORD;
  v_ref          TEXT := 'journey-leg-refund:' || p_leg_id::TEXT;
  v_what         TEXT;
BEGIN
  -- Same lock order as mbg_cancel_journey (journey first, then its legs).
  SELECT journey_id INTO v_journey_id FROM public.mbg_journey_legs WHERE id = p_leg_id;
  IF v_journey_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey leg not found');
  END IF;

  SELECT * INTO v_journey FROM public.mbg_journeys WHERE id = v_journey_id FOR UPDATE;
  SELECT * INTO v_leg FROM public.mbg_journey_legs WHERE id = p_leg_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  IF v_leg.leg_type NOT IN ('local_pickup', 'local_dropoff') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only an airport ride can be given up for lack of a driver');
  END IF;
  -- Not waiting for a driver any more (one was found, it was cancelled, it was
  -- already refunded): nothing to do. Re-checked here under the lock because a
  -- driver may have been matched since the caller looked.
  IF v_leg.ride_id IS NOT NULL
     OR v_leg.refunded_at IS NOT NULL
     OR v_leg.status NOT IN ('pending', 'ready_to_dispatch', 'awaiting_flight_update') THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;
  IF v_journey.status NOT IN ('confirmed', 'in_progress') THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  -- What this leg cost, in coins. Legs booked before fare_ican existed are worked
  -- out from fare_ugx at the journey's own ICAN-per-UGX ratio (it was paid at one rate).
  IF COALESCE(v_leg.fare_ican, 0) > 0 THEN
    v_refund_ican := v_leg.fare_ican;
  ELSIF COALESCE(v_leg.fare_ugx, 0) > 0
        AND COALESCE(v_journey.total_fare_ugx, 0) > 0
        AND COALESCE(v_journey.total_fare_ican, 0) > 0 THEN
    v_refund_ican := v_leg.fare_ugx * v_journey.total_fare_ican / v_journey.total_fare_ugx;
  END IF;
  v_refund_ican := LEAST(round(v_refund_ican, 8), COALESCE(v_journey.total_fare_ican, 0));

  SELECT user_id INTO v_customer FROM public.mbg_customers WHERE id = v_journey.customer_id;
  v_what := CASE
    WHEN COALESCE(to_jsonb(v_journey)->>'service_mode', '') = 'parcel' THEN
      CASE v_leg.leg_type WHEN 'local_pickup' THEN 'courier to the airport' ELSE 'courier from the airport' END
    ELSE
      CASE v_leg.leg_type WHEN 'local_pickup' THEN 'ride to the airport' ELSE 'ride from the airport' END
  END;

  IF v_refund_ican > 0 AND v_journey.ican_journey_tx_id IS NOT NULL THEN
    -- company_profile_id only exists once ADD_JOURNEY_COMPANY_PAYMENT.sql has been run.
    v_company := NULLIF(to_jsonb(v_journey)->>'company_profile_id', '')::UUID;

    IF v_company IS NOT NULL THEN
      PERFORM public.mbg_refund_company_wallet(
        v_company, v_refund_ican, v_ref,
        format('Company-paid %s not charged: no driver was available', v_what), v_customer);
    ELSIF NOT EXISTS (
      SELECT 1 FROM public.ican_coin_transactions WHERE transaction_type = 'refund' AND reference_id = v_ref
    ) THEN
      SELECT sender_user_id INTO v_debit
      FROM public.ican_coin_transactions
      WHERE id = v_journey.ican_journey_tx_id AND transaction_type = 'journey_payment';
      IF v_debit.sender_user_id IS NULL THEN
        -- Leave the leg as it is so the next pass (or support) can settle it, rather
        -- than closing a leg whose money could not be returned.
        RETURN jsonb_build_object('success', false, 'error', 'Original payment not found');
      END IF;

      -- Reverse part of the debit in full — not credit_ican_earning(), which would tithe money the customer never earned.
      UPDATE public.ican_user_wallets
      SET ican_balance = ican_balance + v_refund_ican,
          total_spent  = GREATEST(total_spent - v_refund_ican, 0)
      WHERE user_id = v_debit.sender_user_id;
      INSERT INTO public.ican_coin_transactions
        (recipient_user_id, ican_amount, transaction_type, source_app, reference_id, note, status)
      VALUES
        (v_debit.sender_user_id, v_refund_ican, 'refund', 'mybodaguy', v_ref,
         format('No driver was available for your %s — you were not charged for it', v_what), 'completed');
    END IF;
  ELSE
    v_refund_ican := 0;  -- nothing was taken through the wallet for this leg, so nothing to give back
  END IF;

  UPDATE public.mbg_journey_legs
  SET status = 'cancelled',
      no_driver_at = now(),
      refunded_at = CASE WHEN v_refund_ican > 0 THEN now() ELSE refunded_at END,
      updated_at = now()
  WHERE id = p_leg_id;

  -- A push is a courtesy: never let a missing push relay undo the refund.
  BEGIN
    PERFORM public.mbg_push(
      v_customer, 'bodagoera_ride', 'No driver available — you were not charged',
      format('No driver could be found for your %s%s.', v_what,
             CASE WHEN v_refund_ican > 0
                  THEN format(', so %s ICAN was returned', trim_scale(v_refund_ican)::TEXT)
                  ELSE ' and you were not charged for it' END),
      NULL, 'mbg-leg-nodriver-' || p_leg_id::TEXT);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true, 'refunded_ican', v_refund_ican, 'leg_type', v_leg.leg_type);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_refund_journey_leg_no_driver(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_refund_journey_leg_no_driver(UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. The sweep: every ground leg that has been waiting for a driver longer than
--    the grace period. 'ready_to_dispatch' is the state mbg_dispatch_journey_leg
--    leaves a leg in after it failed to find a driver, so a leg nobody has tried
--    to dispatch yet ('pending') is never given up on.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_refund_unstaffed_journey_legs()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_grace_minutes NUMERIC := GREATEST(public.mbg_get_setting_numeric('journey.no_driver_refund_minutes', 30), 1);
  v_leg RECORD;
  v_result JSONB;
  v_count INTEGER := 0;
BEGIN
  FOR v_leg IN
    SELECT l.id
    FROM public.mbg_journey_legs l
    JOIN public.mbg_journeys j ON j.id = l.journey_id
    WHERE l.leg_type IN ('local_pickup', 'local_dropoff')
      AND l.status = 'ready_to_dispatch'
      AND l.ride_id IS NULL
      AND l.refunded_at IS NULL
      AND j.status IN ('confirmed', 'in_progress')
      AND l.dispatch_after IS NOT NULL
      AND l.dispatch_after <= now() - (v_grace_minutes * INTERVAL '1 minute')
    ORDER BY l.dispatch_after
    LIMIT 50
  LOOP
    BEGIN
      v_result := public.mbg_refund_journey_leg_no_driver(v_leg.id);
      IF COALESCE((v_result ->> 'success')::BOOLEAN, false) AND NOT COALESCE((v_result ->> 'skipped')::BOOLEAN, false) THEN
        v_count := v_count + 1;
      ELSIF NOT COALESCE((v_result ->> 'success')::BOOLEAN, false) THEN
        RAISE WARNING 'No-driver refund for journey leg % failed: %', v_leg.id, v_result ->> 'error';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- One bad leg must not stop the others; it is retried on the next pass.
      RAISE WARNING 'No-driver refund for journey leg % raised: %', v_leg.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_refund_unstaffed_journey_legs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_refund_unstaffed_journey_legs() TO service_role;

-- Re-runnable: unschedule first (older pg_cron errors on a duplicate job name).
DO $$
BEGIN
  PERFORM cron.unschedule('mbg-refund-unstaffed-journey-legs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
SELECT cron.schedule('mbg-refund-unstaffed-journey-legs', '*/5 * * * *', $$ SELECT public.mbg_refund_unstaffed_journey_legs(); $$);

-- ----------------------------------------------------------------------------
-- 3. A journey whose arrival ride was given up must still be able to finish.
--    mbg_complete_flight_only_journeys completes a journey once the flight has
--    landed — but only when it has NO arrival-ride leg at all. A dropped arrival
--    ride is a leg that is now 'cancelled', so ignore cancelled/failed ones.
--    Patches ONE line of the deployed function (so anything else a later
--    migration changed in it is kept). Safe to re-run — once patched it is a no-op.
-- ----------------------------------------------------------------------------
DO $patch$
DECLARE
  v_def TEXT;
  v_old CONSTANT TEXT := $$WHERE d.journey_id = j.id AND d.leg_type = 'local_dropoff'$$;
  v_new CONSTANT TEXT := $$WHERE d.journey_id = j.id AND d.leg_type = 'local_dropoff' AND d.status NOT IN ('cancelled', 'failed')$$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'mbg_complete_flight_only_journeys';
  IF v_def IS NULL THEN
    RAISE NOTICE 'mbg_complete_flight_only_journeys not found — run ADD_JOURNEY_OPTIONAL_RIDES_COMPLETION.sql first.';
  ELSIF position(v_new IN v_def) > 0 THEN
    RAISE NOTICE 'mbg_complete_flight_only_journeys already patched — left as it is.';
  ELSIF position(v_old IN v_def) = 0 THEN
    RAISE NOTICE 'mbg_complete_flight_only_journeys has changed — not patched; a dropped arrival ride will keep its journey open.';
  ELSE
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END
$patch$;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ No driver, no charge: an airport ride that still has no driver 30 minutes after it was due (journey.no_driver_refund_minutes) is refunded to whoever paid and closed; the rest of the journey carries on.';
END $$;
