-- ============================================================================
-- Fix: security escort add-on said "successful" but moved zero real money.
-- ============================================================================
-- mbg_request_ride_escort (CREATE_RIDE_SECURITY_ESCORT.sql, later touched by
-- ADD_COMPANY_CHOICE_TO_RIDE_AND_ESCORT_REQUESTS.sql / FIX_ESCORT_HOURLY_
-- RATE_FALLBACK.sql) only ever computed a `fee` number and inserted it into
-- mbg_ride_escort_requests. mbg_respond_to_escort_request just flipped
-- status to 'accepted', and mbg_complete_escort_request just flipped it to
-- 'completed' — at no point in that whole lifecycle does any function debit
-- the customer's ICAN wallet or credit the escort. The customer sees
-- "+UGX X" in the app and a success response, but X never actually leaves
-- their wallet and the escort/security company never actually receives it.
--
-- This is unlike the ride/delivery side of the SAME "just send security"
-- flow (mbg_request_security's escort_plus_driver mode): the driver's fare
-- goes through mbg_request_ride, which IS correctly wired to real money via
-- mbg_debit_journey_fare / fn_credit_platform_fee_to_business
-- (ADD_ICANERA_UNIFIED_PLATFORM_FEE.sql). Only the escort's own add-on fee
-- was left as a bookkeeping number nobody ever charged.
--
-- Fix: mbg_respond_to_escort_request now actually moves the money at
-- acceptance — same "guaranteed payment before the service begins" rule
-- mbg_respond_to_ride already applies to store deliveries. Debits the
-- customer's ICAN wallet the escort's fee (converted UGX -> ICAN at the same
-- 5000 rate used everywhere else in mybodaguy) and credits the escort
-- personally for the full amount — no ICANera platform cut is taken here,
-- since none was ever defined for escort bookings (only for rides/
-- deliveries); that's a separate policy decision, not assumed here. If the
-- debit fails (e.g. insufficient balance), the accept itself now fails
-- instead of silently succeeding with no money behind it.
--
-- Same (UUID, BOOLEAN) signature as CREATE_RIDE_SECURITY_ESCORT.sql — plain
-- CREATE OR REPLACE, no DROP needed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_respond_to_escort_request(p_request_id UUID, p_accept BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.mbg_ride_escort_requests%ROWTYPE;
  v_rider_id UUID;
  v_escort_user_id UUID;
  v_customer_user_id UUID;
  v_fee_ican NUMERIC;
  v_debit JSONB;
  ICAN_TO_UGX CONSTANT NUMERIC := 5000;
BEGIN
  SELECT id, user_id INTO v_rider_id, v_escort_user_id
  FROM public.mbg_riders WHERE user_id = auth.uid() AND operator_type = 'escort';
  IF v_rider_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No escort profile for current user');
  END IF;

  SELECT * INTO v_request FROM public.mbg_ride_escort_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;
  IF v_request.escort_rider_id IS DISTINCT FROM v_rider_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'This request was not offered to you');
  END IF;
  IF v_request.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'error', 'This offer is no longer pending');
  END IF;

  IF p_accept THEN
    SELECT c.user_id INTO v_customer_user_id
    FROM public.mbg_rides r JOIN public.mbg_customers c ON c.id = r.customer_id
    WHERE r.id = v_request.ride_id;
    IF v_customer_user_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Customer wallet not found');
    END IF;

    IF v_request.fee > 0 THEN
      v_fee_ican := ROUND(v_request.fee / ICAN_TO_UGX, 8);

      v_debit := public.mbg_debit_journey_fare(
        v_customer_user_id, v_fee_ican, 'mybodaguy', p_request_id::TEXT, 'personal_expense'
      );
      IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
        RETURN jsonb_build_object('success', false, 'error', COALESCE(v_debit ->> 'error', 'Wallet payment failed'));
      END IF;

      -- Whole fee to the escort, exactly the number the customer was shown
      -- — no platform cut invented here (see file header).
      PERFORM public.mbg_credit_ride_earning(
        v_escort_user_id, v_fee_ican, 'mybodaguy', p_request_id::TEXT, 'Security escort fee'
      );
    END IF;

    UPDATE public.mbg_ride_escort_requests SET status = 'accepted', responded_at = now() WHERE id = p_request_id;
    RETURN jsonb_build_object('success', true, 'status', 'accepted');
  ELSE
    UPDATE public.mbg_ride_escort_requests SET status = 'declined', responded_at = now() WHERE id = p_request_id;
    RETURN jsonb_build_object('success', true, 'status', 'declined');
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_respond_to_escort_request(UUID, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_respond_to_escort_request now actually debits the customer''s ICAN wallet and credits the escort when an escort accepts — the fee was previously just a number in the row, never real money.';
END $$;
