-- ============================================================================
-- CUSTOMER CAN DELETE HIS OWN FINISHED JOURNEYS (My Journeys)
-- Run after CREATE_JOURNEY_BOOKING_ENGINE.sql (safe to re-run).
--
-- The My Journeys list now lets a customer remove a finished journey, and after
-- a journey has been finished for more than a week the app asks him whether to
-- clear it from our servers (offering to save a copy on his phone first — the
-- ticket PDF and a summary are saved by the app BEFORE this function is called).
--
-- Customers have no DELETE policy on these tables, so removal goes through this
-- SECURITY DEFINER function, which only ever removes the caller's own journeys
-- and only once they are really over:
--   * status completed / cancelled / failed (never one still running),
--   * a failed booking that was PAID and not refunded is refused — the customer
--     still needs its reference to ask support for the refund,
--   * a flight that has not landed yet is refused.
--
-- What goes: the journey, its legs and its flight booking (ON DELETE CASCADE).
-- What stays: the rides themselves (mbg_rides.ride_id is ON DELETE SET NULL on
-- the leg, so the rider's earnings and the wallet history are untouched).
-- Side effect the app tells the customer about: the QR on a saved air ticket
-- stops verifying once its journey is gone (mbg_verify_air_ticket finds nothing).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_delete_my_journeys(p_journey_ids UUID[])
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_customer  UUID;
  v_j         RECORD;
  v_deleted   UUID[] := '{}';
  v_skipped   JSONB  := '[]'::jsonb;
  v_reason    TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Please sign in again.');
  END IF;

  SELECT id INTO v_customer FROM public.mbg_customers WHERE user_id = v_uid;
  IF v_customer IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No customer account found.');
  END IF;

  IF p_journey_ids IS NULL OR cardinality(p_journey_ids) = 0 THEN
    RETURN jsonb_build_object('success', true, 'deleted_ids', '[]'::jsonb, 'skipped', '[]'::jsonb);
  END IF;

  -- Only the caller's own rows are even looked at; ids that are not his are
  -- silently absent (no way to probe for other customers' journeys).
  FOR v_j IN
    SELECT j.*, to_jsonb(j) AS j_json
    FROM public.mbg_journeys j
    WHERE j.customer_id = v_customer AND j.id = ANY(p_journey_ids)
    FOR UPDATE
  LOOP
    v_reason := NULL;

    IF v_j.status NOT IN ('completed', 'cancelled', 'failed') THEN
      v_reason := 'This journey is not finished yet.';
    -- refunded_at may not exist on older databases, hence the jsonb read.
    ELSIF v_j.status = 'failed' AND v_j.ican_journey_tx_id IS NOT NULL AND (v_j.j_json->>'refunded_at') IS NULL THEN
      v_reason := 'This booking was paid but not refunded yet — keep it until support has refunded you.';
    ELSIF EXISTS (
      SELECT 1
      FROM public.mbg_journey_legs l
      JOIN public.mbg_flight_bookings fb ON fb.id = l.flight_booking_id
      WHERE l.journey_id = v_j.id
        AND fb.status <> 'cancelled'
        AND COALESCE(fb.current_arrival_at, fb.scheduled_arrival_at) > now()
    ) THEN
      v_reason := 'The flight has not landed yet.';
    END IF;

    IF v_reason IS NULL THEN
      DELETE FROM public.mbg_journeys WHERE id = v_j.id;
      v_deleted := v_deleted || v_j.id;
    ELSE
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('id', v_j.id, 'reason', v_reason));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'deleted_ids', to_jsonb(v_deleted), 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.mbg_delete_my_journeys(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_delete_my_journeys(UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Customers can now delete their own finished journeys via mbg_delete_my_journeys(ids) — rides and wallet history are kept.';
END $$;
