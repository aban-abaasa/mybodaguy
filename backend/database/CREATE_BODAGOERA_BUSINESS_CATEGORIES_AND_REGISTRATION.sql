-- ============================================================================
-- Transport Company / Security Escort business registration.
-- ============================================================================
-- BodaGoEra shares its Supabase project with ICAN (icanera.space), which
-- already owns the real business-management ("CMMS") stack: business_profiles,
-- business_category_templates, business_departments, business_roles, etc,
-- all created through one RPC — create_business_profile_from_category
-- (ICAN\backend\UNIFIED_BUSINESS_MANAGEMENT_AND_SUPPLIER_MARKETPLACE.sql).
-- 'bodagoera' is already a recognized app_key on that shared schema
-- (business_app_links.app_key check constraint).
--
-- Rather than rebuild business management inside BodaGoEra, this just:
--  1. Registers two new category templates ICAN's own system doesn't have
--     yet — 'transport_company' and 'security_escort'.
--  2. Adds a thin BodaGoEra-side wrapper (mbg_register_business) around the
--     existing creation RPC, and a lister (mbg_my_businesses) scoped to
--     these two categories.
-- The rest of business management (departments, roles, payroll, co-owners,
-- wallet) is used as-is from the existing shared system — no admin review
-- gate is added here, matching how ICAN's own business creation already
-- works (self-service, confirmed with product owner).
-- ============================================================================

INSERT INTO public.business_category_templates
  (category_key, display_name, operating_mode, default_modules, default_departments, default_roles, required_documents)
VALUES
  ('transport_company', 'Transport Company', 'operational',
   '{"fleet":true,"transport":true,"assets":true,"maintenance":true,"reports":true,"requisitions":true,"payroll":true}',
   '["Operations","Fleet","Finance"]',
   '["business_admin","fleet_manager","dispatcher"]',
   '["registration","operating_license"]'),
  ('security_escort', 'Security Escort Service', 'operational',
   '{"transport":true,"assets":true,"reports":true,"requisitions":true,"payroll":true}',
   '["Operations","Personnel","Finance"]',
   '["business_admin","operations_manager","escort_agent"]',
   '["registration","security_license"]')
ON CONFLICT (category_key) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  operating_mode = EXCLUDED.operating_mode,
  default_modules = EXCLUDED.default_modules,
  default_departments = EXCLUDED.default_departments,
  default_roles = EXCLUDED.default_roles,
  required_documents = EXCLUDED.required_documents,
  updated_at = now();

-- ============================================================================
-- Self-service registration. Wraps the shared create_business_profile_from_
-- category RPC so BodaGoEra only has to collect a name/description/logo/city
-- instead of re-implementing business creation.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_register_business(
  p_category_key TEXT,
  p_business_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_logo_url TEXT DEFAULT NULL,
  p_home_city TEXT DEFAULT NULL,
  p_home_country TEXT DEFAULT 'Uganda'
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_profile_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  IF p_category_key NOT IN ('transport_company', 'security_escort') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid business category');
  END IF;
  IF NULLIF(trim(COALESCE(p_business_name, '')), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Business name is required');
  END IF;

  v_business_profile_id := public.create_business_profile_from_category(
    p_business_name := trim(p_business_name),
    p_category_key := p_category_key,
    p_business_type := NULL,
    p_source_app := 'bodagoera',
    p_metadata := jsonb_build_object(
      'description', p_description,
      'home_city', p_home_city,
      'home_country', COALESCE(p_home_country, 'Uganda')
    )
  );

  -- NOTE: ICAN's own UI treats business_profiles.avatar_url as an
  -- 'r2://<key>' reference resolved to a signed URL at read time
  -- (ADD_BUSINESS_AVATAR_URL.sql). We store a plain public Supabase Storage
  -- URL here instead — BodaGoEra's own UI reads/renders it directly and
  -- doesn't go through that resolver, so this is safe for BodaGoEra; it may
  -- just not render inside ICAN's own business views.
  IF p_logo_url IS NOT NULL THEN
    UPDATE public.business_profiles SET avatar_url = p_logo_url, updated_at = now()
    WHERE id = v_business_profile_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'business_profile_id', v_business_profile_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_register_business(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ============================================================================
-- Lists the caller's own transport-company / security-escort businesses.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_my_businesses()
RETURNS TABLE (
  id UUID,
  business_name TEXT,
  category_key TEXT,
  description TEXT,
  avatar_url TEXT,
  status TEXT,
  verification_status TEXT,
  home_city TEXT,
  home_country TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    bp.id,
    bp.business_name,
    bp.metadata->>'category_key',
    COALESCE(bp.metadata->>'description', bp.description),
    bp.avatar_url,
    bp.status,
    bp.verification_status,
    bp.metadata->>'home_city',
    bp.metadata->>'home_country',
    bp.created_at
  FROM public.business_profiles bp
  WHERE bp.metadata->>'category_key' IN ('transport_company', 'security_escort')
    AND bp.metadata->>'source' = 'bodagoera'
    AND public.ican_business_member(bp.id)
  ORDER BY bp.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_my_businesses() TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Transport Company / Security Escort business registration ready.';
END $$;
