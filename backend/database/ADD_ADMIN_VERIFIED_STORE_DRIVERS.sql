-- ============================================================================
-- Admin-verified store drivers.
-- ============================================================================
-- mbg_business_add_driver (CREATE_BODAGOERA_BUSINESS_DRIVER_ROSTER.sql) lets
-- a business admin add anyone as a driver under their own business_profile_id
-- — approved_by/approved_at on that row just record which business admin
-- added them, which is self-attestation, not an independent check. A
-- customer booking a supermarket delivery currently has no way to tell "this
-- business really vets its drivers" from "anyone typed an email in".
--
-- This adds a genuinely separate admin_verified_at/admin_verified_by pair,
-- settable only by a platform developer (same role_type='developer' gate
-- mbg_review_operator_application already uses), and surfaces it through
-- mbg_find_available_riders as a real trust signal a customer can see when
-- picking a rider for a store delivery — "Verified <Store> driver" — instead
-- of a generic rider profile.
-- ============================================================================

ALTER TABLE public.mbg_riders
  ADD COLUMN IF NOT EXISTS admin_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_verified_by UUID REFERENCES public.mbg_users(id);

-- ============================================================================
-- Developer-only: list every business-linked driver, so a platform admin can
-- review and confirm (or revoke) that they genuinely work for that store.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_admin_list_business_drivers()
RETURNS TABLE (
  rider_id UUID,
  user_id UUID,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  vehicle_type TEXT,
  operator_type TEXT,
  plate_number TEXT,
  status TEXT,
  business_profile_id UUID,
  business_name TEXT,
  business_logo_url TEXT,
  added_by UUID,
  added_at TIMESTAMPTZ,
  admin_verified_at TIMESTAMPTZ,
  admin_verified_by UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, r.user_id,
    COALESCE(up.full_name, u.email),
    u.email,
    COALESCE(NULLIF(up.phone, ''), NULLIF(u.phone, '')),
    r.vehicle_type::TEXT, r.operator_type, r.plate_number, r.status,
    r.business_profile_id, bp.business_name, bp.avatar_url,
    r.approved_by, r.approved_at,
    r.admin_verified_at, r.admin_verified_by,
    r.created_at
  FROM public.mbg_riders r
  JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  LEFT JOIN public.business_profiles bp ON bp.id = r.business_profile_id
  WHERE r.business_profile_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true)
  ORDER BY (r.admin_verified_at IS NULL) DESC, r.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_admin_list_business_drivers() TO authenticated;

-- ============================================================================
-- Developer-only: confirm or revoke that a business-linked driver genuinely
-- works for the store they're listed under.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_admin_verify_business_driver(
  p_rider_id UUID,
  p_verified BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a developer can verify store drivers');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mbg_riders WHERE id = p_rider_id AND business_profile_id IS NOT NULL) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not a business-linked driver');
  END IF;

  UPDATE public.mbg_riders SET
    admin_verified_at = CASE WHEN p_verified THEN now() ELSE NULL END,
    admin_verified_by = CASE WHEN p_verified THEN auth.uid() ELSE NULL END,
    updated_at = now()
  WHERE id = p_rider_id;

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_admin_verify_business_driver(UUID, BOOLEAN) TO authenticated;

-- Businesses can already see their own roster (mbg_business_list_drivers) —
-- widen it so they can also see whether the platform has verified each
-- driver, not just their own self-added status. Adding a column changes the
-- return row type, which CREATE OR REPLACE can't do on its own — drop first.
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
  admin_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id, r.user_id,
    COALESCE(up.full_name, u.email) AS full_name,
    u.email,
    r.vehicle_type::TEXT, r.operator_type, r.plate_number, r.status, r.is_available,
    r.rating, r.total_rides, r.admin_verified_at, r.created_at
  FROM public.mbg_riders r
  JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  WHERE r.business_profile_id = p_business_profile_id
    AND public.ican_business_member(p_business_profile_id)
  ORDER BY r.created_at DESC;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_business_list_drivers(UUID) TO authenticated;

-- ============================================================================
-- Surface the trust signal where a customer actually picks a rider: which
-- store this driver is verified for, if any. Return type is widened (two new
-- columns), so the function must be dropped first — CREATE OR REPLACE alone
-- can't change a RETURNS TABLE shape.
-- ============================================================================
DROP FUNCTION IF EXISTS public.mbg_find_available_riders(
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN, UUID[], INT, TEXT[], UUID
);

CREATE OR REPLACE FUNCTION public.mbg_find_available_riders(
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_dropoff_area TEXT DEFAULT NULL,
  p_power_type TEXT DEFAULT NULL,
  p_require_umbrella BOOLEAN DEFAULT false,
  p_exclude_rider_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 10,
  p_vehicle_types TEXT[] DEFAULT NULL,
  p_business_profile_id UUID DEFAULT NULL
)
RETURNS TABLE (
  rider_id UUID,
  full_name TEXT,
  phone TEXT,
  rating NUMERIC,
  total_rides INTEGER,
  vehicle_type TEXT,
  power_type TEXT,
  has_umbrella BOOLEAN,
  plate_number TEXT,
  vehicle_color TEXT,
  mode TEXT,
  distance_to_pickup_km NUMERIC,
  estimated_arrival_min INTEGER,
  knows_destination BOOLEAN,
  fare NUMERIC,
  distance_km NUMERIC,
  time_multiplier NUMERIC,
  verified_business_name TEXT,
  is_admin_verified_store_driver BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_distance_km NUMERIC := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  v_multiplier NUMERIC := public.mbg_current_time_multiplier();
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('ride.base_fare', 1000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('ride.per_km_rate', 1000);
  v_min_fare  NUMERIC := public.mbg_get_setting_numeric('ride.minimum_fare', 2000);
  v_raw_fare NUMERIC;
BEGIN
  IF v_distance_km IS NULL THEN
    RAISE EXCEPTION 'Invalid pickup/dropoff coordinates';
  END IF;
  v_raw_fare := GREATEST(v_min_fare, v_base_fare + v_distance_km * v_per_km) * v_multiplier;

  RETURN QUERY
  SELECT
    r.id,
    COALESCE(up.full_name, 'Rider'),
    COALESCE(NULLIF(up.phone, ''), NULLIF(u.phone, '')),
    r.rating,
    r.total_rides,
    r.vehicle_type::TEXT,
    r.power_type,
    r.has_umbrella,
    r.plate_number,
    r.vehicle_color,
    r.mode,
    dist.km,
    GREATEST(2, ROUND(COALESCE(dist.km, 5) / 20 * 60))::INTEGER,
    EXISTS (
      SELECT 1 FROM public.mbg_rider_locations kl
      WHERE kl.rider_user_id = r.user_id
        AND (
          (p_dropoff_area IS NOT NULL AND kl.name ILIKE '%' || p_dropoff_area || '%')
          OR public.mbg_haversine_km(kl.latitude, kl.longitude, p_dropoff_lat, p_dropoff_lng) <= 3
        )
    ),
    ROUND((CASE
      WHEN r.mode = 'vip' THEN v_raw_fare * (1 + r.vip_surcharge_pct / 100)
      WHEN r.mode = 'discount' THEN v_raw_fare * (1 - r.discount_pct / 100)
      WHEN r.mode = 'return' THEN v_raw_fare * (1 - r.return_discount_pct / 100)
      ELSE v_raw_fare
    END) / 100) * 100,
    v_distance_km,
    v_multiplier,
    CASE WHEN r.admin_verified_at IS NOT NULL THEN bp.business_name ELSE NULL END,
    r.admin_verified_at IS NOT NULL
  FROM public.mbg_riders r
  JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  LEFT JOIN public.mbg_rider_locations home ON home.rider_user_id = r.user_id AND home.is_home = true
  LEFT JOIN public.business_profiles bp ON bp.id = r.business_profile_id
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      public.mbg_haversine_km(r.current_lat, r.current_lng, p_pickup_lat, p_pickup_lng),
      public.mbg_haversine_km(home.latitude, home.longitude, p_pickup_lat, p_pickup_lng)
    ) AS km
  ) dist
  WHERE r.status = 'active'
    AND r.is_available = true
    AND NOT (r.id = ANY(p_exclude_rider_ids))
    AND (p_power_type IS NULL OR r.power_type = p_power_type)
    AND (NOT p_require_umbrella OR r.has_umbrella = true)
    AND (p_vehicle_types IS NULL OR r.vehicle_type::TEXT = ANY(p_vehicle_types))
    AND (p_business_profile_id IS NULL OR r.business_profile_id = p_business_profile_id)
  -- Nearest rider first (real GPS/home distance); "knows this destination"
  -- and admin-verified store driver only break ties among comparably-close
  -- riders, then rating.
  ORDER BY dist.km ASC NULLS LAST, 13 DESC, 18 DESC, r.rating DESC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_find_available_riders(
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN, UUID[], INT, TEXT[], UUID
) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Admin-verified store drivers ready — developer can review via mbg_admin_list_business_drivers/mbg_admin_verify_business_driver, customers see it via mbg_find_available_riders.verified_business_name.';
END $$;
