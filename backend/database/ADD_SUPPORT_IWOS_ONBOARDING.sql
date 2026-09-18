-- ============================================================================
-- ADD_SUPPORT_IWOS_ONBOARDING.sql — Run ONCE, AFTER ADD_SUPPORT_CONSOLE.sql
-- and ICAN/backend/ROUTE_PLATFORM_FEES_TO_IWOS_BUSINESS.sql (defines the
-- shared fn_get_platform_fee_business_id(), business_account_members,
-- business_compensation_profiles this depends on — one Supabase project
-- shared by ICAN/digital-city-era/mybodaguy/FARM-AGENT).
-- ============================================================================
-- mybodaguy's equivalent of ICAN's "Onboard as IWOS contractor" (SUPPORT_
-- CONSOLE.sql's ican_dev_onboard_iwos_support_staff /
-- ican_dev_get_iwos_overview): pays a real account out of IWOS's wallet —
-- the SAME business every app's platform fee already flows into
-- (fn_credit_platform_fee_to_business, see
-- backend/database/ADD_ICANERA_UNIFIED_PLATFORM_FEE.sql's rider/customer
-- surcharge crediting) — looked up by their real account email.
--
-- Independent of Support Links: a support-link visitor has no real
-- identity to pay (see ADD_SUPPORT_CONSOLE.sql/ADD_SUPPORT_CONSOLE_ANY_TAB
-- .sql's notes on this same point). Onboarding someone here means giving
-- them a REAL mybodaguy account first, then paying that account — separate
-- admin action, main-developer-only.
--
-- Safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_dev_onboard_iwos_support_staff(
  p_target_email TEXT,
  p_base_pay_amount NUMERIC,
  p_currency TEXT DEFAULT 'UGX',
  p_pay_frequency TEXT DEFAULT 'contract',
  p_job_title TEXT DEFAULT 'Support Agent'
) RETURNS JSONB SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_iwos_id UUID;
  v_user_id UUID;
BEGIN
  IF NOT public.is_main_mbg_developer() THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF p_base_pay_amount IS NULL OR p_base_pay_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a pay amount greater than zero.');
  END IF;
  IF p_pay_frequency NOT IN ('hourly', 'daily', 'weekly', 'monthly', 'contract') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid pay frequency.');
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(trim(p_target_email)) LIMIT 1;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No account found for that email.');
  END IF;

  v_iwos_id := public.fn_get_platform_fee_business_id();
  IF v_iwos_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'IWOS business is not configured (fn_get_platform_fee_business_id() returned NULL).');
  END IF;

  INSERT INTO public.business_account_members
    (business_profile_id, auth_user_id, employment_status, job_title, permissions, invited_by, joined_at)
  VALUES
    (v_iwos_id, v_user_id, 'active', p_job_title, '{}'::jsonb, NULL, now())
  ON CONFLICT (business_profile_id, auth_user_id) DO UPDATE SET
    employment_status = 'active',
    job_title = EXCLUDED.job_title;

  INSERT INTO public.business_compensation_profiles
    (business_profile_id, employee_user_id, pay_type, base_salary, currency, pay_frequency, effective_from, payroll_status)
  VALUES
    (v_iwos_id, v_user_id,
     CASE WHEN p_pay_frequency = 'hourly' THEN 'hourly' ELSE 'monthly' END,
     p_base_pay_amount, upper(trim(p_currency)), p_pay_frequency, CURRENT_DATE, 'on_pay')
  ON CONFLICT (business_profile_id, employee_user_id, effective_from) DO UPDATE SET
    base_salary = EXCLUDED.base_salary,
    currency = EXCLUDED.currency,
    pay_frequency = EXCLUDED.pay_frequency,
    payroll_status = 'on_pay';

  RETURN jsonb_build_object('success', true, 'business_profile_id', v_iwos_id, 'user_id', v_user_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dev_onboard_iwos_support_staff(TEXT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_dev_get_iwos_overview()
RETURNS JSONB SECURITY DEFINER SET search_path = public LANGUAGE plpgsql AS $$
DECLARE
  v_iwos_id UUID;
  v_members JSONB;
  v_compensation JSONB;
BEGIN
  IF NOT public.is_main_mbg_developer() THEN RAISE EXCEPTION 'unauthorized'; END IF;

  v_iwos_id := public.fn_get_platform_fee_business_id();

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC), '[]'::jsonb) INTO v_members
  FROM public.business_account_members m
  WHERE m.business_profile_id = v_iwos_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.effective_from DESC), '[]'::jsonb) INTO v_compensation
  FROM public.business_compensation_profiles c
  WHERE c.business_profile_id = v_iwos_id;

  RETURN jsonb_build_object(
    'business_profile_id', v_iwos_id,
    'members', v_members,
    'compensation', v_compensation
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dev_get_iwos_overview() TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'mybodaguy IWOS onboarding installed' AS status;
-- ============================================================================
-- VERIFY
-- ============================================================================
-- As the main developer:
--   SELECT mbg_dev_onboard_iwos_support_staff('someone@realemail.com', 50000, 'UGX', 'monthly', 'Support Agent');
--   SELECT mbg_dev_get_iwos_overview();
-- ============================================================================
