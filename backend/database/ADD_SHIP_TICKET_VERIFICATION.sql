-- ============================================================================
-- SHIP TICKET (WAYBILL) THAT PROVES IT WAS REALLY PAID — verified by QR
-- Run after ADD_AIR_TICKET_VERIFICATION.sql (it adds mbg_journeys.ticket_verify_code),
-- ADD_SHIP_CARGO_JOURNEY.sql and ADD_JOURNEY_COMPANY_PAYMENT.sql (safe to re-run).
--
-- The printed ship waybill carries a QR to /ticket/<code>. Scanning it asks this
-- function, which answers LIVE from the database:
--   * PAID only when the payment transaction the journey points at really exists
--     (the customer's wallet debit for the full fare, or the company wallet's), and
--     the journey was not refunded — a typed-in or edited ticket cannot fake it;
--   * the carrier of each road/sea leg — the registered operator company and its
--     vessel / vehicle — once one has accepted that leg ("being assigned" until then);
--   * the state: booked / in_transit / delivered / cancelled / unpaid.
-- It returns masked details only: no customer name, phone, email or wallet ids,
-- just the last 8 characters of the payment reference.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_verify_ship_ticket(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_j        RECORD;
  v_has_sea  BOOLEAN;
  v_paid     BOOLEAN := false;
  v_paid_via TEXT;
  v_legs     JSONB;
  v_state    TEXT;
  v_carrier  BOOLEAN;
  v_j_json   JSONB;
BEGIN
  IF p_code IS NULL OR length(p_code) < 16 OR length(p_code) > 64 OR p_code !~ '^[A-Za-z0-9]+$' THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  SELECT j.* INTO v_j FROM public.mbg_journeys j WHERE j.ticket_verify_code = p_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.mbg_journey_legs l WHERE l.journey_id = v_j.id AND l.leg_type = 'sea_leg') INTO v_has_sea;
  IF NOT v_has_sea THEN
    RETURN jsonb_build_object('is_valid', false);
  END IF;

  v_j_json := to_jsonb(v_j);

  -- Paid = the payment row really exists and completed; a journey that was refunded is not paid.
  IF v_j.ican_journey_tx_id IS NOT NULL AND (v_j_json->>'refunded_at') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.ican_coin_transactions t
      WHERE t.id = v_j.ican_journey_tx_id AND t.transaction_type = 'journey_payment'
        -- mbg_debit_journey_fare never moves the row off the column default ('pending'); what
        -- proves payment is the debit row itself: not failed/cancelled, from this customer, for the full fare.
        AND t.status IN ('pending', 'completed')
        AND t.ican_amount >= COALESCE(v_j.total_fare_ican, 0) - 0.00000001
        AND t.sender_user_id = (SELECT c.user_id FROM public.mbg_customers c WHERE c.id = v_j.customer_id)
    ) THEN
      v_paid := true; v_paid_via := 'wallet';
    ELSIF EXISTS (
      SELECT 1 FROM public.ican_business_wallet_transactions t
      WHERE t.id = v_j.ican_journey_tx_id AND t.direction = 'out' AND t.status = 'completed'
    ) THEN
      v_paid := true; v_paid_via := 'company';
    END IF;
  END IF;

  -- The road/sea legs with whoever carries them.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'type', x.leg_type,
           'status', x.status,
           'from', x.origin_city,
           'to', x.destination_city,
           'carrier', x.carrier_name,
           'carrier_registration', x.carrier_reg,
           'vessel', x.vessel
         ) ORDER BY x.leg_order), '[]'::jsonb),
         COALESCE(bool_or(x.carrier_name IS NOT NULL OR x.vessel IS NOT NULL), false)
  INTO v_legs, v_carrier
  FROM (
    SELECT l.leg_order, l.leg_type, l.status, l.origin_city, l.destination_city,
           bp.business_name AS carrier_name,
           bp.registration_number AS carrier_reg,
           NULLIF(btrim(concat_ws(' ', rd.vehicle_model, CASE WHEN rd.plate_number IS NOT NULL THEN '(' || rd.plate_number || ')' END)), '') AS vessel
    FROM public.mbg_journey_legs l
    LEFT JOIN public.mbg_rides r ON r.id = l.ride_id
    LEFT JOIN public.mbg_riders rd ON rd.id = r.rider_id
    LEFT JOIN public.business_profiles bp ON bp.id = rd.business_profile_id
    WHERE l.journey_id = v_j.id AND l.leg_type IN ('road_leg', 'sea_leg')
  ) x;

  v_state := CASE
    WHEN v_j.status IN ('cancelled', 'failed') OR (v_j_json->>'refunded_at') IS NOT NULL THEN 'cancelled'
    WHEN NOT v_paid THEN 'unpaid'
    WHEN v_j.status = 'completed' THEN 'delivered'
    WHEN v_j.status = 'in_progress' THEN 'in_transit'
    ELSE 'booked'
  END;

  RETURN jsonb_build_object(
    'is_valid', v_state IN ('booked', 'in_transit', 'delivered'),
    'is_ship', true,
    'state', v_state,
    'paid', v_paid,
    'paid_via', v_paid_via,
    'paid_ican', CASE WHEN v_paid THEN v_j.total_fare_ican END,
    -- Last 8 characters only: enough to quote to support, not enough to look the payment up elsewhere.
    'payment_reference', CASE WHEN v_paid THEN upper(right(v_j.ican_journey_tx_id::text, 8)) END,
    'waybill_no', upper(left(v_j.id::text, 8)),
    'origin_country', v_j.origin_country,
    'destination_country', v_j.destination_country,
    'cargo_description', v_j.cargo_description,
    'cargo_weight_kg', v_j.cargo_weight_kg,
    'legs', v_legs,
    'carrier_assigned', v_carrier,
    'booked_at', v_j.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mbg_verify_ship_ticket(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_verify_ship_ticket(TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Ship waybills now verify by QR: /ticket/<code> asks mbg_verify_ship_ticket (paid / carrier / state), answered live with masked details only.';
END $$;
