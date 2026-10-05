-- ============================================================================
-- CANCEL WITH A REASON + DELETE ORDERS (customers, riders, supermarket orders)
-- Run after CREATE_REAL_RIDE_MATCHING_ENGINE.sql, CREATE_JOURNEY_BOOKING_ENGINE.sql,
-- ADD_AIR_TICKET_VERIFICATION.sql, ADD_JOURNEY_SELF_DELETE.sql and
-- ADD_JOURNEY_PREPAID_LEG_FARES.sql (safe to re-run).
--
-- 1. mbg_cancel_ride now insists on a reason (the apps send one picked from a
--    list, or typed under "Other"). Everything else it did is unchanged.
-- 2. mbg_cancel_journey(journey, reason): the customer cancels a journey that
--    is not finished yet. Unfinished ground rides are cancelled and their
--    drivers freed. THE AIR TICKET IS NOT REFUNDED — airline fares are final
--    here, the flight booking is left alone and the ticket stays valid, so the
--    customer can still fly or download it. The unused GROUND legs (rides that
--    no driver has accepted yet) are refunded to whoever paid.
-- 3. mbg_verify_air_ticket: a CANCELLED journey no longer voids a ticket the
--    airline still honours (only a failed journey or a cancelled booking does).
-- 4. "Delete" an order = remove it from MY history. mbg_rides rows carry money
--    and rider earnings, so they are hidden per side (customer_hidden_at /
--    rider_hidden_at) instead of being deleted: mbg_hide_my_rides(ids) works
--    for both customers and riders, and only for finished rides.
-- ============================================================================

ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS customer_hidden_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rider_hidden_at    TIMESTAMPTZ;

ALTER TABLE public.mbg_journeys
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 1. Cancel a ride — a reason is now required.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_cancel_ride(p_ride_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_customer_id UUID;
  v_rider_id UUID;
  v_by public.mbg_cancellation_by;
  v_reason TEXT := btrim(COALESCE(p_reason, ''));
BEGIN
  IF length(v_reason) < 3 THEN
    RAISE EXCEPTION 'Please tell us why you are cancelling';
  END IF;
  v_reason := left(v_reason, 300);

  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();

  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.status IN ('completed', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'Ride cannot be cancelled from its current status';
  END IF;

  -- A person can hold several rider rows (one per vehicle), so match on any of them.
  SELECT id INTO v_rider_id FROM public.mbg_riders WHERE user_id = auth.uid() AND id = v_ride.rider_id;

  IF v_customer_id IS NOT NULL AND v_ride.customer_id = v_customer_id THEN
    v_by := 'customer';
  ELSIF v_rider_id IS NOT NULL THEN
    v_by := 'rider';
  ELSE
    RAISE EXCEPTION 'You are not part of this ride';
  END IF;

  UPDATE public.mbg_rides
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_by, cancellation_reason = v_reason, updated_at = now()
  WHERE id = p_ride_id;

  IF v_ride.rider_id IS NOT NULL THEN
    PERFORM set_config('mbg.trusted_write', 'true', true);
    UPDATE public.mbg_riders SET is_available = true, cancelled_rides = cancelled_rides + 1, updated_at = now()
    WHERE id = v_ride.rider_id;
  END IF;
  IF v_ride.customer_id IS NOT NULL THEN
    UPDATE public.mbg_customers SET cancelled_rides = cancelled_rides + 1, updated_at = now() WHERE id = v_ride.customer_id;
  END IF;

  UPDATE public.mbg_payments SET status = 'refunded', refunded_at = now(), refund_reason = v_reason, updated_at = now()
  WHERE ride_id = p_ride_id AND status = 'pending';

  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_cancel_ride(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_cancel_ride(UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Cancel a journey (customer).
--    * Air tickets are NOT refunded: the flight booking is left alone.
--    * The prepaid GROUND legs (ride to the airport, ride on arrival, cargo
--      road/sea legs) are refunded in coins, exactly what each was priced at,
--      as long as no driver has accepted that leg yet. A leg whose driver is
--      already committed is cancelled but not refunded, and a ride that is
--      underway has to be finished (or cancelled by the driver) first.
--    * The refund goes back to whoever paid: the company wallet for a
--      company-paid journey, otherwise the customer's own wallet.
-- ----------------------------------------------------------------------------
ALTER TABLE public.mbg_journey_legs ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;
-- What a ground leg cost in COINS. Global journeys are priced in ICAN, so a refund
-- hands back the same coins that were paid, whatever the coin is worth today.
-- (Legs booked before this column existed are refunded pro rata from fare_ugx.)
ALTER TABLE public.mbg_journey_legs ADD COLUMN IF NOT EXISTS fare_ican NUMERIC;

CREATE OR REPLACE FUNCTION public.mbg_cancel_journey(p_journey_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_customer   UUID;
  v_journey    public.mbg_journeys%ROWTYPE;
  v_reason     TEXT := btrim(COALESCE(p_reason, ''));
  v_leg        RECORD;
  v_has_flight BOOLEAN;
  v_refund_ugx NUMERIC := 0;   -- legs without a coin amount (booked before fare_ican existed)
  v_refund_ican NUMERIC := 0;
  v_company    UUID;
  v_debit      RECORD;
  v_ref        TEXT := 'journey-cancel-refund:' || p_journey_id::TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.');
  END IF;
  IF length(v_reason) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please tell us why you are cancelling.');
  END IF;
  v_reason := left(v_reason, 300);

  SELECT id INTO v_customer FROM public.mbg_customers WHERE user_id = v_uid;
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No customer account found.');
  END IF;

  SELECT * INTO v_journey FROM public.mbg_journeys
  WHERE id = p_journey_id AND customer_id = v_customer FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found.');
  END IF;
  IF v_journey.status IN ('completed', 'cancelled', 'failed') THEN
    RETURN jsonb_build_object('success', false, 'error', 'This journey is already finished.');
  END IF;

  -- A ride that is already underway cannot be cancelled from here.
  IF EXISTS (
    SELECT 1 FROM public.mbg_journey_legs l
    WHERE l.journey_id = p_journey_id AND l.leg_type <> 'flight' AND l.status = 'in_progress'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'A ride on this journey is under way — it can be cancelled once that ride has finished.');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.mbg_journey_legs l
    JOIN public.mbg_flight_bookings fb ON fb.id = l.flight_booking_id
    WHERE l.journey_id = p_journey_id AND fb.status <> 'cancelled'
  ) INTO v_has_flight;

  FOR v_leg IN
    SELECT l.id, l.ride_id, l.leg_type, l.fare_ugx, l.fare_ican, l.refunded_at, r.status AS ride_status
    FROM public.mbg_journey_legs l
    LEFT JOIN public.mbg_rides r ON r.id = l.ride_id
    WHERE l.journey_id = p_journey_id AND l.status NOT IN ('completed', 'cancelled', 'failed')
    FOR UPDATE OF l
  LOOP
    -- The flight booking itself is left alone: the airline ticket is not refunded.
    IF v_leg.leg_type = 'flight' AND v_has_flight THEN
      CONTINUE;
    END IF;

    -- Refundable only while no driver has accepted this leg.
    IF v_leg.leg_type <> 'flight'
       AND (COALESCE(v_leg.fare_ican, 0) > 0 OR COALESCE(v_leg.fare_ugx, 0) > 0)
       AND v_leg.refunded_at IS NULL
       AND (v_leg.ride_status IS NULL OR v_leg.ride_status = 'pending') THEN
      IF COALESCE(v_leg.fare_ican, 0) > 0 THEN
        v_refund_ican := v_refund_ican + v_leg.fare_ican;
      ELSE
        v_refund_ugx := v_refund_ugx + v_leg.fare_ugx;
      END IF;
      UPDATE public.mbg_journey_legs SET refunded_at = now() WHERE id = v_leg.id;
    END IF;

    -- Close the leg and detach its ride FIRST: mbg_sync_journey_leg_with_ride_trg
    -- re-queues a dispatched leg whose ride is cancelled (the driver-declined
    -- case) and would otherwise send a new driver to a journey that is over.
    UPDATE public.mbg_journey_legs SET status = 'cancelled', ride_id = NULL, updated_at = now() WHERE id = v_leg.id;
    IF v_leg.ride_id IS NOT NULL THEN
      PERFORM public.mbg_cancel_journey_ride(v_leg.ride_id, v_reason);
    END IF;
  END LOOP;

  UPDATE public.mbg_journeys
  SET status = 'cancelled', cancellation_reason = v_reason, cancelled_at = now(), updated_at = now()
  WHERE id = p_journey_id;

  -- Refund the unused ground legs, in coins. A leg that has its own coin amount returns
  -- exactly that; an older leg priced only in UGX is converted at the journey's own
  -- ICAN-per-UGX ratio (the journey was paid in ICAN at one rate).
  IF v_refund_ugx > 0 AND COALESCE(v_journey.total_fare_ugx, 0) > 0 AND COALESCE(v_journey.total_fare_ican, 0) > 0 THEN
    v_refund_ican := v_refund_ican + v_refund_ugx * v_journey.total_fare_ican / v_journey.total_fare_ugx;
  END IF;
  v_refund_ican := LEAST(round(v_refund_ican, 8), COALESCE(v_journey.total_fare_ican, 0));

  IF v_refund_ican > 0 AND v_journey.ican_journey_tx_id IS NOT NULL THEN
    -- company_profile_id only exists once ADD_JOURNEY_COMPANY_PAYMENT.sql has been run.
    v_company := NULLIF(to_jsonb(v_journey)->>'company_profile_id', '')::UUID;

    IF v_company IS NOT NULL THEN
      PERFORM public.mbg_refund_company_wallet(
        v_company, v_refund_ican, v_ref,
        format('Company-paid journey cancelled — unused rides refunded: %s', v_reason), v_uid);
    ELSIF NOT EXISTS (SELECT 1 FROM public.ican_coin_transactions WHERE transaction_type = 'refund' AND reference_id = v_ref) THEN
      SELECT sender_user_id INTO v_debit
      FROM public.ican_coin_transactions
      WHERE id = v_journey.ican_journey_tx_id AND transaction_type = 'journey_payment';
      IF v_debit.sender_user_id IS NOT NULL THEN
        -- Reverse part of the debit in full — not credit_ican_earning(), which would tithe money the customer never earned.
        UPDATE public.ican_user_wallets
        SET ican_balance = ican_balance + v_refund_ican,
            total_spent  = GREATEST(total_spent - v_refund_ican, 0)
        WHERE user_id = v_debit.sender_user_id;
        INSERT INTO public.ican_coin_transactions
          (recipient_user_id, ican_amount, transaction_type, source_app, reference_id, note, status)
        VALUES
          (v_debit.sender_user_id, v_refund_ican, 'refund', 'mybodaguy', v_ref,
           format('Journey cancelled — unused rides refunded: %s', v_reason), 'completed');
      ELSE
        v_refund_ican := 0;
      END IF;
    END IF;
  ELSE
    v_refund_ican := 0;  -- nothing was paid through the wallet, so nothing to give back
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'air_ticket_refunded', false,
    'has_air_ticket', v_has_flight,
    'refunded_ican', v_refund_ican
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_cancel_journey(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_cancel_journey(UUID, TEXT) TO authenticated;

-- Internal: cancel a journey leg's ride on the customer's behalf (the caller has
-- already been checked as the journey's owner), freeing the driver.
CREATE OR REPLACE FUNCTION public.mbg_cancel_journey_ride(p_ride_id UUID, p_reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
BEGIN
  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR v_ride.status IN ('completed', 'cancelled', 'failed') THEN
    RETURN;
  END IF;

  UPDATE public.mbg_rides
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'customer', cancellation_reason = p_reason, updated_at = now()
  WHERE id = p_ride_id;

  IF v_ride.rider_id IS NOT NULL THEN
    PERFORM set_config('mbg.trusted_write', 'true', true);
    UPDATE public.mbg_riders SET is_available = true, cancelled_rides = cancelled_rides + 1, updated_at = now()
    WHERE id = v_ride.rider_id;
  END IF;
  IF v_ride.customer_id IS NOT NULL THEN
    UPDATE public.mbg_customers SET cancelled_rides = cancelled_rides + 1, updated_at = now() WHERE id = v_ride.customer_id;
  END IF;
  UPDATE public.mbg_payments SET status = 'refunded', refunded_at = now(), refund_reason = p_reason, updated_at = now()
  WHERE ride_id = p_ride_id AND status = 'pending';
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_cancel_journey_ride(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. A cancelled journey no longer voids an airline ticket that is still live.
--    Patches ONE line of the deployed mbg_verify_air_ticket (so anything else a
--    later migration changed in it is kept): only a failed journey or a cancelled
--    airline booking voids the ticket. Safe to re-run — once patched it is a no-op.
-- ----------------------------------------------------------------------------
DO $patch$
DECLARE
  v_def TEXT;
  v_old CONSTANT TEXT := $$v_journey.status IN ('cancelled', 'failed') OR v_booking.status = 'cancelled'$$;
  v_new CONSTANT TEXT := $$v_journey.status = 'failed' OR v_booking.status = 'cancelled'$$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'mbg_verify_air_ticket';
  IF v_def IS NULL THEN
    RAISE NOTICE 'mbg_verify_air_ticket not found — run ADD_AIR_TICKET_VERIFICATION.sql first.';
  ELSIF position(v_old IN v_def) = 0 THEN
    RAISE NOTICE 'mbg_verify_air_ticket already patched (or changed) — left as it is.';
  ELSE
    EXECUTE replace(v_def, v_old, v_new);
  END IF;
END
$patch$;

-- ----------------------------------------------------------------------------
-- 4. Delete orders from MY history (customer side or rider side).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_hide_my_rides(p_ride_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_customer  UUID;
  v_hidden    UUID[] := '{}';
  v_skipped   JSONB  := '[]'::jsonb;
  v_r         RECORD;
  v_is_cust   BOOLEAN;
  v_is_rider  BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.');
  END IF;
  IF p_ride_ids IS NULL OR cardinality(p_ride_ids) = 0 THEN
    RETURN jsonb_build_object('success', true, 'hidden_ids', '[]'::jsonb, 'skipped', '[]'::jsonb);
  END IF;

  SELECT id INTO v_customer FROM public.mbg_customers WHERE user_id = v_uid;

  -- Only rides this person is actually part of are even looked at.
  FOR v_r IN
    SELECT r.id, r.status, r.customer_id, r.rider_id
    FROM public.mbg_rides r
    WHERE r.id = ANY(p_ride_ids)
      AND (
        (v_customer IS NOT NULL AND r.customer_id = v_customer)
        OR EXISTS (SELECT 1 FROM public.mbg_riders rd WHERE rd.id = r.rider_id AND rd.user_id = v_uid)
      )
    FOR UPDATE
  LOOP
    IF v_r.status NOT IN ('completed', 'cancelled', 'failed') THEN
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', v_r.id, 'reason', 'This order is still running — cancel it first.'));
      CONTINUE;
    END IF;

    v_is_cust  := v_customer IS NOT NULL AND v_r.customer_id = v_customer;
    v_is_rider := EXISTS (SELECT 1 FROM public.mbg_riders rd WHERE rd.id = v_r.rider_id AND rd.user_id = v_uid);

    UPDATE public.mbg_rides
    SET customer_hidden_at = CASE WHEN v_is_cust  THEN COALESCE(customer_hidden_at, now()) ELSE customer_hidden_at END,
        rider_hidden_at    = CASE WHEN v_is_rider THEN COALESCE(rider_hidden_at, now())    ELSE rider_hidden_at END
    WHERE id = v_r.id;
    v_hidden := v_hidden || v_r.id;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'hidden_ids', to_jsonb(v_hidden), 'skipped', v_skipped);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_hide_my_rides(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_hide_my_rides(UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Cancel with a reason (mbg_cancel_ride, mbg_cancel_journey) and delete orders (mbg_hide_my_rides) are ready. Air tickets are not refunded on cancel.';
END $$;
