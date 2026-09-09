-- ============================================================================
-- Security escort add-on for rides/deliveries.
-- ============================================================================
-- A customer can request a security escort alongside a ride or delivery
-- they've already booked. Escorts are ordinary mbg_riders rows with
-- operator_type = 'escort' (CREATE_BODAGOERA_BUSINESS_DRIVER_ROSTER.sql),
-- owned personally or by a 'security_escort' business. Matching/response
-- mirrors the existing direct-offer ride flow (mbg_request_ride /
-- mbg_respond_to_ride in CREATE_REAL_RIDE_MATCHING_ENGINE.sql) but on its
-- own table, since mbg_rides has no spare column for a second assignee.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mbg_ride_escort_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id           UUID NOT NULL REFERENCES public.mbg_rides(id) ON DELETE CASCADE,
  escort_rider_id   UUID REFERENCES public.mbg_riders(id) ON DELETE SET NULL,
  business_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'completed', 'cancelled')),
  fee               NUMERIC(12,2) NOT NULL DEFAULT 0,
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  UNIQUE (ride_id)
);
CREATE INDEX IF NOT EXISTS mbg_ride_escort_requests_escort_idx ON public.mbg_ride_escort_requests(escort_rider_id, status);

ALTER TABLE public.mbg_ride_escort_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_ride_escort_customer_read ON public.mbg_ride_escort_requests;
CREATE POLICY mbg_ride_escort_customer_read ON public.mbg_ride_escort_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_rides r JOIN public.mbg_customers c ON c.id = r.customer_id
      WHERE r.id = ride_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS mbg_ride_escort_escort_access ON public.mbg_ride_escort_requests;
CREATE POLICY mbg_ride_escort_escort_access ON public.mbg_ride_escort_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.mbg_riders r WHERE r.id = escort_rider_id AND r.user_id = auth.uid())
    OR (business_profile_id IS NOT NULL AND public.ican_business_member(business_profile_id))
  );

DROP POLICY IF EXISTS mbg_ride_escort_service_role ON public.mbg_ride_escort_requests;
CREATE POLICY mbg_ride_escort_service_role ON public.mbg_ride_escort_requests
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================================================
-- Fee preview before booking — the business's own escort_flat_fee if it can
-- be resolved for the country, otherwise a global platform default.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_estimate_escort_fee(p_country TEXT DEFAULT 'Uganda')
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (
      SELECT AVG(ps.escort_flat_fee)
      FROM public.mbg_business_pricing_settings ps
      JOIN public.mbg_riders r ON r.business_profile_id = ps.business_profile_id
      WHERE r.operator_type = 'escort' AND r.status = 'active' AND r.is_available = true
        AND r.operator_country = COALESCE(p_country, 'Uganda')
        AND ps.escort_flat_fee IS NOT NULL
    ),
    public.mbg_get_setting_numeric('pricing.escort_default_fee_ugx', 15000)
  );
$$;
GRANT EXECUTE ON FUNCTION public.mbg_estimate_escort_fee(TEXT) TO authenticated;

-- ============================================================================
-- Customer requests an escort for an already-booked ride. Direct-offer
-- match against one available escort (same country if possible, else any).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_request_ride_escort(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_escort public.mbg_riders%ROWTYPE;
  v_fee NUMERIC;
  v_request_id UUID;
BEGIN
  SELECT r.* INTO v_ride FROM public.mbg_rides r
    JOIN public.mbg_customers c ON c.id = r.customer_id
    WHERE r.id = p_ride_id AND c.user_id = auth.uid();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ride not found');
  END IF;
  IF EXISTS (SELECT 1 FROM public.mbg_ride_escort_requests WHERE ride_id = p_ride_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'An escort has already been requested for this ride');
  END IF;

  SELECT * INTO v_escort FROM public.mbg_riders
  WHERE operator_type = 'escort' AND status = 'active' AND is_available = true
    AND operator_country = COALESCE(v_ride.country, 'Uganda')
  ORDER BY rating DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT * INTO v_escort FROM public.mbg_riders
    WHERE operator_type = 'escort' AND status = 'active' AND is_available = true
    ORDER BY rating DESC NULLS LAST
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'No security escort is available right now');
  END IF;

  v_fee := COALESCE(
    (SELECT escort_flat_fee FROM public.mbg_business_pricing_settings WHERE business_profile_id = v_escort.business_profile_id),
    public.mbg_estimate_escort_fee(v_ride.country)
  );

  INSERT INTO public.mbg_ride_escort_requests (ride_id, escort_rider_id, business_profile_id, fee)
  VALUES (p_ride_id, v_escort.id, v_escort.business_profile_id, v_fee)
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'fee', v_fee);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride_escort(UUID) TO authenticated;

-- ============================================================================
-- Escort accepts/declines, mirroring mbg_respond_to_ride.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_respond_to_escort_request(p_request_id UUID, p_accept BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_request public.mbg_ride_escort_requests%ROWTYPE;
  v_rider_id UUID;
BEGIN
  SELECT id INTO v_rider_id FROM public.mbg_riders WHERE user_id = auth.uid() AND operator_type = 'escort';
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
    UPDATE public.mbg_ride_escort_requests SET status = 'accepted', responded_at = now() WHERE id = p_request_id;
    RETURN jsonb_build_object('success', true, 'status', 'accepted');
  ELSE
    UPDATE public.mbg_ride_escort_requests SET status = 'declined', responded_at = now() WHERE id = p_request_id;
    RETURN jsonb_build_object('success', true, 'status', 'declined');
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_respond_to_escort_request(UUID, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_complete_escort_request(p_request_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider_id UUID;
BEGIN
  SELECT id INTO v_rider_id FROM public.mbg_riders WHERE user_id = auth.uid() AND operator_type = 'escort';
  UPDATE public.mbg_ride_escort_requests
  SET status = 'completed', completed_at = now()
  WHERE id = p_request_id AND escort_rider_id = v_rider_id AND status = 'accepted';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found or not in progress');
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_complete_escort_request(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Security escort add-on ready.';
END $$;
