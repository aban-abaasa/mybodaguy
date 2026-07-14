-- ============================================================================
-- Lets the CUSTOMER change their payment method (wallet <-> cash) any time
-- before the ride is settled — e.g. they picked wallet at request time but
-- decide at the destination they'd rather pay cash, or vice versa. Only
-- allowed while the ride is still 'accepted' or 'in_progress' — once
-- mbg_complete_ride has run, the fare has already been settled one way or
-- the other (real ICAN moved for wallet, or the rider is already mid
-- cash-confirmation flow for cash), so changing it after that would leave
-- the ledger inconsistent with what actually happened.
--
-- Run after ADD_RIDE_PAYMENT_METHOD_AND_COMMISSION.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_update_ride_payment_method(
  p_ride_id UUID,
  p_payment_method TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_customer_id UUID;
BEGIN
  IF p_payment_method NOT IN ('wallet', 'cash') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid payment method');
  END IF;

  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();
  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No customer profile for current user');
  END IF;

  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id AND customer_id = v_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ride not found or not yours');
  END IF;

  IF v_ride.status NOT IN ('accepted', 'in_progress') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Payment method can only be changed before the trip is completed');
  END IF;

  UPDATE public.mbg_rides SET payment_method = p_payment_method, updated_at = now() WHERE id = p_ride_id;

  RETURN jsonb_build_object('success', true, 'payment_method', p_payment_method);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_update_ride_payment_method TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Customers can now switch a ride''s payment method (wallet/cash) any time before it completes.';
END $$;
