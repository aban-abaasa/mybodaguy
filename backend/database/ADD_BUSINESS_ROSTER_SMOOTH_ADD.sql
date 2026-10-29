-- ============================================================================
-- Smooth "add driver / escort" for Transport Company and Security Escort
-- businesses. Run ONCE in the Supabase SQL editor. Safe to run twice.
-- ============================================================================
-- Fixes found by checking the live project:
--
--  1. mbg_riders.plate_number is NOT NULL and UNIQUE, but mbg_business_add_driver
--     filled a missing plate with the literal 'PENDING'. Only ONE driver or
--     escort could ever be added without a plate (an escort on foot never has
--     one), the second failed with a raw "duplicate key" error. Now each gets a
--     unique placeholder (PENDING-XXXXXXXX), and a real plate that is already
--     taken gets a clear message.
--  2. mbg_business_list_drivers lost escort_has_own_transport (two migrations
--     each redefined it without the other's column), so the "own vehicle /
--     escort only" badge and toggle could not work. It now returns both
--     escort_has_own_transport and admin_verified_at.
--  3. Adds mbg_business_lookup_driver (is there an account for this email?)
--     so the form can say so BEFORE submitting, and mbg_business_remove_driver
--     so a mistaken add can be undone (or a driver let go without losing history).
--
-- Depends on ADD_BUSINESS_REGISTRATION_AND_ACCESS.sql (the approval gate still
-- applies: nobody can be added until the business is approved).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Add a driver / escort
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_business_add_driver(
  p_business_profile_id UUID,
  p_driver_email TEXT,
  p_operator_type TEXT,
  p_vehicle_type TEXT DEFAULT 'motorcycle',
  p_plate_number TEXT DEFAULT NULL,
  p_license_number TEXT DEFAULT NULL,
  p_vehicle_model TEXT DEFAULT NULL,
  p_vehicle_color TEXT DEFAULT NULL,
  p_operator_country TEXT DEFAULT 'Uganda',
  p_operator_home_city TEXT DEFAULT NULL,
  p_escort_has_own_transport BOOLEAN DEFAULT false
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email TEXT := lower(btrim(COALESCE(p_driver_email, '')));
  v_plate TEXT := NULLIF(upper(btrim(COALESCE(p_plate_number, ''))), '');
  v_license TEXT := NULLIF(btrim(COALESCE(p_license_number, '')), '');
  v_driver_user_id UUID;
  v_rider_id UUID;
  v_existing public.mbg_riders%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.ican_business_admin(p_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a business admin can add drivers or escorts');
  END IF;
  IF p_operator_type NOT IN ('passenger', 'cargo', 'escort') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid role');
  END IF;
  IF v_email = '' OR v_email !~ '^\S+@\S+\.\S+$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Enter a valid email address');
  END IF;

  SELECT id INTO v_driver_user_id FROM public.mbg_users WHERE lower(email) = v_email;
  IF v_driver_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No BodaGoEra account uses that email yet. Ask them to sign up, then add them.');
  END IF;

  SELECT * INTO v_existing FROM public.mbg_riders
  WHERE user_id = v_driver_user_id AND vehicle_type = p_vehicle_type::public.mbg_vehicle_type;
  IF FOUND THEN
    IF v_existing.business_profile_id = p_business_profile_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'They are already on your team');
    END IF;
    RETURN jsonb_build_object('success', false, 'error',
      'They already have a ' || p_vehicle_type || ' registration elsewhere. Choose a different vehicle type.');
  END IF;

  IF v_plate IS NOT NULL AND EXISTS (SELECT 1 FROM public.mbg_riders WHERE plate_number = v_plate) THEN
    RETURN jsonb_build_object('success', false, 'error', 'That plate number is already registered to another driver');
  END IF;

  INSERT INTO public.mbg_riders (
    user_id, vehicle_type, plate_number, license_number, vehicle_model, vehicle_color,
    status, is_available, operator_type, operator_country, operator_home_city, service_countries,
    business_profile_id, ownership_mode, approved_by, approved_at, escort_has_own_transport
  ) VALUES (
    v_driver_user_id, p_vehicle_type::public.mbg_vehicle_type,
    COALESCE(v_plate, 'PENDING-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
    COALESCE(v_license, 'PENDING'),
    NULLIF(btrim(COALESCE(p_vehicle_model, '')), ''), NULLIF(btrim(COALESCE(p_vehicle_color, '')), ''),
    'active', false, p_operator_type, COALESCE(p_operator_country, 'Uganda'), p_operator_home_city,
    ARRAY[COALESCE(p_operator_country, 'Uganda')],
    p_business_profile_id, 'company', auth.uid(), now(),
    p_operator_type = 'escort' AND COALESCE(p_escort_has_own_transport, false)
  ) RETURNING id INTO v_rider_id;

  UPDATE public.mbg_users SET role_type = 'rider', updated_at = now()
  WHERE id = v_driver_user_id AND role_type = 'customer';

  RETURN jsonb_build_object('success', true, 'rider_id', v_rider_id);
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'That plate number or registration is already in use');
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown vehicle type');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_add_driver(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN
) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Roster list: both the escort flag and the platform-verified stamp
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mbg_business_list_drivers(UUID);

CREATE OR REPLACE FUNCTION public.mbg_business_list_drivers(p_business_profile_id UUID)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  full_name TEXT,
  email TEXT,
  vehicle_type TEXT,
  operator_type TEXT,
  plate_number TEXT,
  status TEXT,
  is_available BOOLEAN,
  rating NUMERIC,
  total_rides INTEGER,
  escort_has_own_transport BOOLEAN,
  admin_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, r.user_id,
    COALESCE(up.full_name, u.email) AS full_name,
    u.email,
    r.vehicle_type::TEXT, r.operator_type, r.plate_number, r.status::TEXT, r.is_available,
    r.rating, r.total_rides, r.escort_has_own_transport,
    (to_jsonb(r)->>'admin_verified_at')::TIMESTAMPTZ,
    r.created_at
  FROM public.mbg_riders r
  JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  WHERE r.business_profile_id = p_business_profile_id
    AND public.ican_business_member(p_business_profile_id)
  ORDER BY r.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_list_drivers(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Look up an email before adding (shows a masked name, never contact data)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_business_lookup_driver(p_business_profile_id UUID, p_email TEXT)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_email TEXT := lower(btrim(COALESCE(p_email, '')));
  v_user UUID;
  v_name TEXT;
  v_parts TEXT[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.ican_business_admin(p_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a business admin can look people up');
  END IF;
  IF v_email = '' OR v_email !~ '^\S+@\S+\.\S+$' THEN
    RETURN jsonb_build_object('success', true, 'found', false, 'valid', false);
  END IF;

  SELECT u.id, up.full_name INTO v_user, v_name
  FROM public.mbg_users u
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = u.id
  WHERE lower(u.email) = v_email;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('success', true, 'found', false, 'valid', true);
  END IF;

  -- "Dan D." rather than the full name
  v_parts := regexp_split_to_array(btrim(COALESCE(v_name, '')), '\s+');
  RETURN jsonb_build_object(
    'success', true, 'found', true, 'valid', true,
    'display_name', CASE WHEN v_parts[1] IS NULL OR v_parts[1] = '' THEN 'Account found'
                         WHEN array_length(v_parts, 1) > 1 THEN v_parts[1] || ' ' || left(v_parts[array_length(v_parts, 1)], 1) || '.'
                         ELSE v_parts[1] END,
    'on_team', EXISTS (SELECT 1 FROM public.mbg_riders r WHERE r.user_id = v_user AND r.business_profile_id = p_business_profile_id),
    'vehicle_types', COALESCE((SELECT jsonb_agg(r.vehicle_type::TEXT) FROM public.mbg_riders r WHERE r.user_id = v_user), '[]'::jsonb)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_lookup_driver(UUID, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Remove someone from the team.
--    * No records at all (added by mistake): the registration is deleted.
--    * Any ride, payment or rider-card history: deleting would cascade into
--      payments/cards and orphan rides, so they are RELEASED instead — taken off
--      the business, set offline, and kept as an independent rider with every
--      record intact. (status/plate cannot be changed from here: the
--      mbg_riders_protect_columns trigger reverts those for non-service roles.)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_business_remove_driver(p_rider_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business UUID;
  v_user UUID;
  v_has_history BOOLEAN := false;
BEGIN
  SELECT business_profile_id, user_id INTO v_business, v_user FROM public.mbg_riders WHERE id = p_rider_id;
  IF v_business IS NULL OR NOT public.ican_business_admin(v_business) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only this team''s business admin can remove them');
  END IF;

  IF EXISTS (SELECT 1 FROM public.mbg_rides WHERE rider_id = p_rider_id) THEN
    v_has_history := true;
  END IF;
  IF NOT v_has_history AND to_regclass('public.mbg_payments') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.mbg_payments WHERE rider_id = p_rider_id) THEN v_has_history := true; END IF;
  END IF;
  IF NOT v_has_history AND to_regclass('public.mbg_rider_cards') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.mbg_rider_cards WHERE rider_id = p_rider_id) THEN v_has_history := true; END IF;
  END IF;

  IF v_has_history THEN
    UPDATE public.mbg_riders
    SET business_profile_id = NULL, ownership_mode = 'personal', is_available = false, updated_at = now()
    WHERE id = p_rider_id;
    RETURN jsonb_build_object('success', true, 'released', true);
  END IF;

  DELETE FROM public.mbg_riders WHERE id = p_rider_id;

  -- Back to a plain customer only if they have no other rider row.
  UPDATE public.mbg_users SET role_type = 'customer', updated_at = now()
  WHERE id = v_user AND role_type = 'rider'
    AND NOT EXISTS (SELECT 1 FROM public.mbg_riders WHERE user_id = v_user);

  RETURN jsonb_build_object('success', true, 'released', false);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_remove_driver(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Smooth add driver / escort ready (unique placeholder plates, escort flag restored, lookup, remove).';
END $$;
