-- ============================================================================
-- AIR TICKET QR VERIFICATION
-- Run after CREATE_JOURNEY_BOOKING_ENGINE.sql (safe to re-run).
--
-- The air ticket PDF now carries a QR code. The QR holds ONLY a link
-- (https://bodagoera.icanera.space/ticket/<code>) — no passenger data, no
-- booking reference. The proof lives here, server-side:
--   * the code is a random 128-bit value, so it cannot be guessed or forged,
--   * scanning it asks the database live, so a cancelled / failed / refunded
--     booking stops verifying and a delayed flight shows its NEW time,
--   * the answer is deliberately minimal (see mbg_verify_air_ticket) — no
--     passport data, no full booking reference, no wallet or payment details.
--
-- No new serverless function: the public check is this RPC, called from the
-- app with the anon key, exactly like icanera_verify_delivery_receipt.
-- ============================================================================

-- 1. One unguessable code per journey. The volatile default fills every
--    existing row with its own value too (no separate backfill needed).
ALTER TABLE public.mbg_journeys
  ADD COLUMN IF NOT EXISTS ticket_verify_code TEXT
  DEFAULT replace(gen_random_uuid()::text, '-', '');

-- Belt and braces for any row created before the default existed.
UPDATE public.mbg_journeys
SET ticket_verify_code = replace(gen_random_uuid()::text, '-', '')
WHERE ticket_verify_code IS NULL;

ALTER TABLE public.mbg_journeys ALTER COLUMN ticket_verify_code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mbg_journeys_ticket_verify_code_idx
  ON public.mbg_journeys(ticket_verify_code);

-- 2. The public check. SECURITY DEFINER because anon has no read access to
--    these tables; it returns only what someone checking a ticket needs.
CREATE OR REPLACE FUNCTION public.mbg_verify_air_ticket(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_journey  RECORD;
  v_booking  RECORD;
  v_pax      JSONB := '[]'::jsonb;
  v_p        JSONB;
  v_given    TEXT;
  v_family   TEXT;
  v_pnr      TEXT;
  v_state    TEXT;
BEGIN
  IF p_code IS NULL OR length(p_code) < 16 OR length(p_code) > 64 OR p_code !~ '^[A-Za-z0-9]+$' THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  SELECT j.id, j.status, j.created_at, j.ican_journey_tx_id
  INTO v_journey
  FROM public.mbg_journeys j
  WHERE j.ticket_verify_code = p_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  SELECT fb.*
  INTO v_booking
  FROM public.mbg_journey_legs l
  JOIN public.mbg_flight_bookings fb ON fb.id = l.flight_booking_id
  WHERE l.journey_id = v_journey.id AND l.leg_type = 'flight'
  LIMIT 1;

  -- A journey with no flight booking has no air ticket to vouch for.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  -- Passengers: initial + surname only. Never titles, dates of birth,
  -- passport numbers, phone numbers or email.
  FOR v_p IN SELECT * FROM jsonb_array_elements(COALESCE(v_booking.passenger_details, '[]'::jsonb))
  LOOP
    v_given  := btrim(COALESCE(v_p->>'given_name', ''));
    v_family := btrim(COALESCE(v_p->>'family_name', ''));
    IF v_family <> '' THEN
      v_pax := v_pax || jsonb_build_array(
        upper(CASE WHEN v_given <> '' THEN left(v_given, 1) || '. ' ELSE '' END || v_family)
      );
    END IF;
  END LOOP;

  -- Booking reference masked: surname + full PNR is enough to manage a
  -- booking on the airline's site, so a stranger who photographs the QR must
  -- not get it. The holder of the ticket already has it printed on the page.
  v_pnr := COALESCE(v_booking.pnr, '');
  IF length(v_pnr) > 2 THEN
    v_pnr := left(v_pnr, 2) || repeat('•', length(v_pnr) - 2);
  END IF;

  v_state := CASE
    WHEN v_journey.status IN ('cancelled', 'failed') OR v_booking.status = 'cancelled' THEN 'cancelled'
    WHEN v_booking.status = 'completed' THEN 'flown'
    WHEN v_booking.status IN ('booked', 'ticketed', 'delayed', 'rescheduled') THEN 'valid'
    ELSE 'pending'
  END;

  RETURN jsonb_build_object(
    'is_valid', v_state IN ('valid', 'flown'),
    'state', v_state,                       -- valid | flown | cancelled | pending
    'flight_status', v_booking.status,      -- booked | ticketed | delayed | rescheduled | ...
    'passengers', v_pax,
    'booking_reference_masked', v_pnr,
    'carrier', v_booking.carrier,
    'flight_number', v_booking.flight_number,
    'origin_iata', v_booking.origin_iata,
    'destination_iata', v_booking.destination_iata,
    -- current_* is the airline's latest time (delays/reschedules), falling back to the original.
    'departs_at', COALESCE(v_booking.current_departure_at, v_booking.scheduled_departure_at),
    'arrives_at', COALESCE(v_booking.current_arrival_at, v_booking.scheduled_arrival_at),
    'is_rescheduled', v_booking.status IN ('delayed', 'rescheduled'),
    'paid', v_journey.ican_journey_tx_id IS NOT NULL,
    'booked_at', v_journey.created_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_verify_air_ticket(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Air tickets now verify by QR: /ticket/<code> asks mbg_verify_air_ticket, which answers live (valid / flown / cancelled) with masked details only.';
END $$;
