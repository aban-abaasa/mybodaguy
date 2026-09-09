-- ============================================================================
-- Per-business ride pricing.
-- ============================================================================
-- Today fare is always computed from global commission.* / ride.* settings
-- (CREATE_REAL_RIDE_MATCHING_ENGINE.sql: fare = GREATEST(min_fare,
-- base_fare + distance_km*per_km) * time_multiplier, then rider mode
-- adjustment, rounded to 100). A transport company should be able to set
-- its own rates for rides its own drivers fulfil.
--
-- Rather than editing every ride-creation RPC (mbg_request_ride,
-- mbg_request_company_ride, mbg_request_cross_border_delivery, journey-leg
-- dispatch, ...) and risking missing one, this adds a single BEFORE INSERT
-- trigger on mbg_rides: if the assigned rider belongs to a business with a
-- pricing_settings row, the trigger recomputes fare (and the rider_earning /
-- chairperson_commission_total split, using the same global commission
-- percentages as everywhere else) from that business's own base_fare /
-- per_km_rate / min_fare before the row is written. Every existing
-- ride-creation path gets this automatically, and personal (non-company)
-- riders are entirely unaffected since they have no pricing_settings row.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.mbg_business_pricing_settings (
  business_profile_id UUID PRIMARY KEY REFERENCES public.business_profiles(id) ON DELETE CASCADE,
  base_fare NUMERIC(12,2),
  per_km_rate NUMERIC(12,2),
  min_fare NUMERIC(12,2),
  currency TEXT NOT NULL DEFAULT 'UGX',
  escort_flat_fee NUMERIC(12,2),
  escort_hourly_rate NUMERIC(12,2),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.mbg_business_pricing_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_business_pricing_admin_access ON public.mbg_business_pricing_settings;
CREATE POLICY mbg_business_pricing_admin_access ON public.mbg_business_pricing_settings
  FOR ALL TO authenticated
  USING (public.ican_business_member(business_profile_id))
  WITH CHECK (public.ican_business_admin(business_profile_id));

CREATE OR REPLACE FUNCTION public.mbg_set_business_pricing(
  p_business_profile_id UUID,
  p_base_fare NUMERIC DEFAULT NULL,
  p_per_km_rate NUMERIC DEFAULT NULL,
  p_min_fare NUMERIC DEFAULT NULL,
  p_escort_flat_fee NUMERIC DEFAULT NULL,
  p_escort_hourly_rate NUMERIC DEFAULT NULL,
  p_currency TEXT DEFAULT 'UGX'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.ican_business_admin(p_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a business admin can set pricing');
  END IF;

  INSERT INTO public.mbg_business_pricing_settings (
    business_profile_id, base_fare, per_km_rate, min_fare, escort_flat_fee, escort_hourly_rate, currency, updated_by, updated_at
  ) VALUES (
    p_business_profile_id, p_base_fare, p_per_km_rate, p_min_fare, p_escort_flat_fee, p_escort_hourly_rate, COALESCE(p_currency, 'UGX'), auth.uid(), now()
  )
  ON CONFLICT (business_profile_id) DO UPDATE SET
    base_fare = EXCLUDED.base_fare,
    per_km_rate = EXCLUDED.per_km_rate,
    min_fare = EXCLUDED.min_fare,
    escort_flat_fee = EXCLUDED.escort_flat_fee,
    escort_hourly_rate = EXCLUDED.escort_hourly_rate,
    currency = EXCLUDED.currency,
    updated_by = auth.uid(),
    updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_set_business_pricing(UUID, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_get_business_pricing(p_business_profile_id UUID)
RETURNS public.mbg_business_pricing_settings
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.mbg_business_pricing_settings
  WHERE business_profile_id = p_business_profile_id AND public.ican_business_member(p_business_profile_id);
$$;
GRANT EXECUTE ON FUNCTION public.mbg_get_business_pricing(UUID) TO authenticated;

-- ============================================================================
-- Fare override trigger.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_apply_business_pricing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider public.mbg_riders%ROWTYPE;
  v_pricing public.mbg_business_pricing_settings%ROWTYPE;
  v_fare NUMERIC;
  v_platform_pct NUMERIC;
  v_rider_pct NUMERIC;
  v_platform_fee NUMERIC;
BEGIN
  IF NEW.rider_id IS NULL OR NEW.distance_km IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_rider FROM public.mbg_riders WHERE id = NEW.rider_id;
  IF v_rider.business_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_pricing FROM public.mbg_business_pricing_settings WHERE business_profile_id = v_rider.business_profile_id;
  IF NOT FOUND OR (v_pricing.base_fare IS NULL AND v_pricing.per_km_rate IS NULL AND v_pricing.min_fare IS NULL) THEN
    RETURN NEW;
  END IF;

  v_fare := GREATEST(
    COALESCE(v_pricing.min_fare, public.mbg_get_setting_numeric('ride.minimum_fare', 2000)),
    COALESCE(v_pricing.base_fare, public.mbg_get_setting_numeric('ride.base_fare', 1000))
      + NEW.distance_km * COALESCE(v_pricing.per_km_rate, public.mbg_get_setting_numeric('ride.per_km_rate', 1000))
  ) * COALESCE(NEW.time_multiplier, 1);

  IF v_rider.mode = 'vip' THEN
    v_fare := v_fare * (1 + COALESCE(v_rider.vip_surcharge_pct, 0) / 100);
  ELSIF v_rider.mode = 'discount' THEN
    v_fare := v_fare * (1 - COALESCE(v_rider.discount_pct, 0) / 100);
  ELSIF v_rider.mode = 'return' THEN
    v_fare := v_fare * (1 - COALESCE(v_rider.return_discount_pct, 0) / 100);
  END IF;
  v_fare := ROUND(v_fare / 100) * 100;

  v_platform_pct := public.mbg_get_setting_numeric('commission.platform_fee_percentage', 5);
  v_rider_pct := public.mbg_get_setting_numeric('commission.rider_percentage', 70);
  v_platform_fee := ROUND(v_fare * v_platform_pct / 100);

  NEW.fare := v_fare;
  NEW.rider_earning := ROUND(v_fare * v_rider_pct / 100);
  NEW.chairperson_commission_total := v_fare - v_platform_fee - NEW.rider_earning;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mbg_apply_business_pricing ON public.mbg_rides;
CREATE TRIGGER trg_mbg_apply_business_pricing
  BEFORE INSERT ON public.mbg_rides
  FOR EACH ROW EXECUTE FUNCTION public.mbg_apply_business_pricing();

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Business pricing ready — company-owned drivers now bill at their business''s own rates when set.';
END $$;
