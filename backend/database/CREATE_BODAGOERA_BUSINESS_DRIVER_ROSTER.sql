-- ============================================================================
-- Company-owned driver / escort roster.
-- ============================================================================
-- mbg_riders already has business_profile_id / ownership_mode / operator_type
-- (SHARED_CORPORATE_TRANSPORT_AND_MONTHLY_RIDERS.sql, CREATE_JOURNEY_
-- BOOKING_ENGINE.sql) but no self-service way for a business admin to add a
-- driver (or escort agent) under their own business_profile_id. This adds
-- that, plus widens operator_type to a third value: 'escort' — a
-- security-escort business's personnel, matched against ride escort
-- requests the same way 'passenger'/'cargo' riders are matched against
-- ride/delivery requests.
-- ============================================================================

ALTER TABLE public.mbg_riders DROP CONSTRAINT IF EXISTS mbg_riders_operator_type_check;
ALTER TABLE public.mbg_riders ADD CONSTRAINT mbg_riders_operator_type_check
  CHECK (operator_type IN ('passenger', 'cargo', 'escort'));

-- ============================================================================
-- Business admin adds a driver/escort. The invited person must already have
-- a BodaGoEra account (mbg_users row) — this links an mbg_riders row to the
-- business rather than provisioning a new auth account.
-- ============================================================================
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
  p_operator_home_city TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver_user_id UUID;
  v_rider_id UUID;
BEGIN
  IF NOT public.ican_business_admin(p_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a business admin can add drivers');
  END IF;
  IF p_operator_type NOT IN ('passenger', 'cargo', 'escort') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid role');
  END IF;

  SELECT id INTO v_driver_user_id FROM public.mbg_users WHERE lower(email) = lower(trim(p_driver_email));
  IF v_driver_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No BodaGoEra account found for that email — they need to sign up first');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.mbg_riders
    WHERE user_id = v_driver_user_id AND vehicle_type = p_vehicle_type::public.mbg_vehicle_type
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This person already has a driver/rider registration for that vehicle type');
  END IF;

  INSERT INTO public.mbg_riders (
    user_id, vehicle_type, plate_number, license_number, vehicle_model, vehicle_color,
    status, is_available, operator_type, operator_country, operator_home_city, service_countries,
    business_profile_id, ownership_mode, approved_by, approved_at
  ) VALUES (
    v_driver_user_id, p_vehicle_type::public.mbg_vehicle_type, COALESCE(p_plate_number, 'PENDING'), COALESCE(p_license_number, 'PENDING'),
    p_vehicle_model, p_vehicle_color,
    'active', false, p_operator_type, COALESCE(p_operator_country, 'Uganda'), p_operator_home_city, ARRAY[COALESCE(p_operator_country, 'Uganda')],
    p_business_profile_id, 'company', auth.uid(), now()
  ) RETURNING id INTO v_rider_id;

  UPDATE public.mbg_users SET role_type = 'rider', updated_at = now() WHERE id = v_driver_user_id AND role_type = 'customer';

  RETURN jsonb_build_object('success', true, 'rider_id', v_rider_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_add_driver(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

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
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, r.user_id,
    COALESCE(up.full_name, u.email) AS full_name,
    u.email,
    r.vehicle_type::TEXT, r.operator_type, r.plate_number, r.status, r.is_available,
    r.rating, r.total_rides, r.created_at
  FROM public.mbg_riders r
  JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  WHERE r.business_profile_id = p_business_profile_id
    AND public.ican_business_member(p_business_profile_id)
  ORDER BY r.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_list_drivers(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_business_set_driver_status(
  p_rider_id UUID,
  p_status TEXT DEFAULT NULL,
  p_is_available BOOLEAN DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_business_profile_id UUID;
BEGIN
  SELECT business_profile_id INTO v_business_profile_id FROM public.mbg_riders WHERE id = p_rider_id;
  IF v_business_profile_id IS NULL OR NOT public.ican_business_admin(v_business_profile_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only this driver''s business admin can change their status');
  END IF;

  UPDATE public.mbg_riders SET
    status = COALESCE(p_status, status),
    is_available = COALESCE(p_is_available, is_available),
    updated_at = now()
  WHERE id = p_rider_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_set_driver_status(UUID, TEXT, BOOLEAN) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Business driver/escort roster ready.';
END $$;
