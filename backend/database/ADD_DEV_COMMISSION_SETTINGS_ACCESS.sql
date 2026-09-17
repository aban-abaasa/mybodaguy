-- Let a developer edit the hierarchy commission percentages (stored in
-- mbg_platform_settings, category = 'commission') from the Developer
-- Dashboard's Commissions tab. RLS on mbg_platform_settings only lets
-- service_role write and only lets everyone else SELECT is_public rows,
-- so both reading and writing here go through SECURITY DEFINER RPCs that
-- re-check developer status themselves rather than relying on RLS.

CREATE OR REPLACE FUNCTION public.mbg_dev_get_commission_settings()
RETURNS SETOF public.mbg_platform_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_users
    WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT * FROM public.mbg_platform_settings
  WHERE category = 'commission'
  ORDER BY key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_dev_get_commission_settings() TO authenticated;


CREATE OR REPLACE FUNCTION public.mbg_dev_update_commission_setting(p_key TEXT, p_value NUMERIC)
RETURNS public.mbg_platform_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.mbg_platform_settings;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_users
    WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_value IS NULL OR p_value < 0 OR p_value > 100 THEN
    RAISE EXCEPTION 'commission percentage must be between 0 and 100';
  END IF;

  UPDATE public.mbg_platform_settings
  SET value = p_value::TEXT, updated_at = NOW()
  WHERE key = p_key AND category = 'commission'
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'unknown commission setting: %', p_key;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_dev_update_commission_setting(TEXT, NUMERIC) TO authenticated;
