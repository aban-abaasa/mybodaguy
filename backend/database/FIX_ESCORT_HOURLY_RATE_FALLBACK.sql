-- ============================================================================
-- escort_hourly_rate was a dead field: BusinessPricingSettings.tsx lets a
-- security company save it and mbg_set_business_pricing (CREATE_BODAGOERA_
-- BUSINESS_PRICING.sql) persists it, but every escort-fee/matching function
-- (mbg_estimate_escort_fee, mbg_request_ride_escort, both from ADD_COMPANY_
-- CHOICE_TO_RIDE_AND_ESCORT_REQUESTS.sql) only ever looked at escort_flat_fee
-- — so a company that set ONLY an hourly rate showed up everywhere as "no
-- escort pricing set up yet" and had zero available escorts, even though
-- they'd genuinely configured a price.
--
-- There's no duration/hours concept anywhere in the escort booking flow (no
-- input for it in EnhancedRideRequest.tsx, CREATE_SECURITY_ONLY_ESCORT_
-- BOOKING.sql's mbg_request_security), so proper rate × hours billing isn't
-- possible today. Fix: wherever escort_flat_fee was read as "this company's
-- escort price" (or checked for "has this company set a price"), fall back
-- to escort_hourly_rate instead of treating it as a second, unrelated field
-- — one flat charge per booking either way. Both functions keep their
-- existing signatures, so plain CREATE OR REPLACE, no DROP needed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_estimate_escort_fee(
  p_country TEXT DEFAULT 'Uganda',
  p_business_profile_id UUID DEFAULT NULL
)
RETURNS NUMERIC LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_business_profile_id IS NOT NULL THEN
      (SELECT COALESCE(escort_flat_fee, escort_hourly_rate) FROM public.mbg_business_pricing_settings WHERE business_profile_id = p_business_profile_id)
    ELSE (
      SELECT AVG(COALESCE(ps.escort_flat_fee, ps.escort_hourly_rate))
      FROM public.mbg_business_pricing_settings ps
      JOIN public.mbg_riders r ON r.business_profile_id = ps.business_profile_id
      WHERE r.operator_type = 'escort' AND r.status = 'active' AND r.is_available = true
        AND r.operator_country = COALESCE(p_country, 'Uganda')
        AND COALESCE(ps.escort_flat_fee, ps.escort_hourly_rate) IS NOT NULL
    )
  END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_estimate_escort_fee(TEXT, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_request_ride_escort(
  p_ride_id UUID,
  p_business_profile_id UUID DEFAULT NULL
)
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

  -- Every escort belongs to a security company (there's no "personal"
  -- escort path — see CREATE_SECURITY_ONLY_ESCORT_BOOKING.sql). The fee is
  -- always that company's own price — flat fee if they set one, else their
  -- hourly rate used as a flat per-booking charge — never a generic
  -- platform guess, so only escorts whose company has actually configured
  -- one of the two are candidates at all.
  IF p_business_profile_id IS NOT NULL THEN
    -- Customer picked a specific company — stay with that company's own
    -- escorts rather than silently substituting a different one (same rule
    -- mbg_request_security already applies to the standalone escort flow).
    SELECT r.* INTO v_escort FROM public.mbg_riders r
    JOIN public.mbg_business_pricing_settings ps ON ps.business_profile_id = r.business_profile_id
    WHERE r.operator_type = 'escort' AND r.status = 'active' AND r.is_available = true
      AND r.business_profile_id = p_business_profile_id
      AND COALESCE(ps.escort_flat_fee, ps.escort_hourly_rate) IS NOT NULL
    ORDER BY r.rating DESC NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'This security company has no available escort right now, or hasn''t set its escort pricing yet');
    END IF;
  ELSE
    SELECT r.* INTO v_escort FROM public.mbg_riders r
    JOIN public.mbg_business_pricing_settings ps ON ps.business_profile_id = r.business_profile_id
    WHERE r.operator_type = 'escort' AND r.status = 'active' AND r.is_available = true
      AND COALESCE(ps.escort_flat_fee, ps.escort_hourly_rate) IS NOT NULL
      AND r.operator_country = COALESCE(v_ride.country, 'Uganda')
    ORDER BY r.rating DESC NULLS LAST
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT r.* INTO v_escort FROM public.mbg_riders r
      JOIN public.mbg_business_pricing_settings ps ON ps.business_profile_id = r.business_profile_id
      WHERE r.operator_type = 'escort' AND r.status = 'active' AND r.is_available = true
        AND COALESCE(ps.escort_flat_fee, ps.escort_hourly_rate) IS NOT NULL
      ORDER BY r.rating DESC NULLS LAST
      LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'No security escort with pricing set up is available right now');
    END IF;
  END IF;

  -- Guaranteed NOT NULL by the COALESCE(...) IS NOT NULL filter above —
  -- always this escort's own company price, never a fallback estimate.
  SELECT COALESCE(escort_flat_fee, escort_hourly_rate) INTO v_fee FROM public.mbg_business_pricing_settings
  WHERE business_profile_id = v_escort.business_profile_id;

  INSERT INTO public.mbg_ride_escort_requests (ride_id, escort_rider_id, business_profile_id, fee)
  VALUES (p_ride_id, v_escort.id, v_escort.business_profile_id, v_fee)
  RETURNING id INTO v_request_id;

  RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'fee', v_fee);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride_escort(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_estimate_escort_fee and mbg_request_ride_escort now fall back to a company''s escort_hourly_rate when it has no escort_flat_fee, instead of treating an hourly-only company as having no pricing at all.';
END $$;
