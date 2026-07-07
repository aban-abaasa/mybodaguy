-- ============================================================================
-- REAL RIDE/DELIVERY MATCHING ENGINE
-- ============================================================================
-- Replaces the mocked matching in frontend/src/mybodaguy/data/mockRiders.ts
-- and the TODO-stub RiderLocationManager/RiderModeSelector components with
-- real, Supabase-backed logic:
--   - Riders register real GPS-tagged areas they know (mbg_rider_locations)
--   - Customers register real GPS-tagged areas they use (mbg_customer_areas)
--   - Riders declare real vehicle attributes: electric/fuel, rain cover
--   - Fare = (base_fare + distance_km * per_km_rate) * time-of-day multiplier,
--     adjusted by the rider's own Normal/VIP/Discount/Return mode (already
--     built in RiderModeSelector.tsx, previously never persisted)
--   - Fare splits per public.mbg_platform_settings: platform fee (hidden from
--     riders in a service_role-only table), rider's net earning (visible),
--     and tiered chairperson commissions (stage/parish/subcounty/division/
--     district) recorded in the existing public.mbg_commissions table
--
-- Depends on the schema created by COMPLETE_MYBODAGUY_SETUP.sql (mbg_users,
-- mbg_riders, mbg_customers, mbg_rides, mbg_payments, mbg_commissions,
-- mbg_platform_settings, mbg_stages/parishes/subcounties/divisions/districts,
-- mbg_committee_members) — run that first if this errors on a missing table.
-- ============================================================================

-- ============================================================================
-- 1. SCHEMA: rider vehicle attributes, mode persistence, live-ish location
-- ============================================================================
ALTER TABLE public.mbg_riders
  ADD COLUMN IF NOT EXISTS power_type          TEXT NOT NULL DEFAULT 'fuel' CHECK (power_type IN ('electric', 'fuel')),
  ADD COLUMN IF NOT EXISTS has_umbrella         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS current_lat          DECIMAL(10, 8),
  ADD COLUMN IF NOT EXISTS current_lng          DECIMAL(11, 8),
  ADD COLUMN IF NOT EXISTS location_updated_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mode                 TEXT NOT NULL DEFAULT 'normal' CHECK (mode IN ('normal', 'vip', 'discount', 'return')),
  ADD COLUMN IF NOT EXISTS vip_surcharge_pct    NUMERIC(5, 2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS discount_pct         NUMERIC(5, 2) NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS return_discount_pct  NUMERIC(5, 2) NOT NULL DEFAULT 30;

-- Riders' real registered areas ("Areas I Know Well" — was mock data)
CREATE TABLE IF NOT EXISTS public.mbg_rider_locations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_user_id   UUID NOT NULL REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  address         TEXT NOT NULL,
  latitude        DECIMAL(10, 8),
  longitude       DECIMAL(11, 8),
  is_home         BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mbg_rider_locations_rider_idx ON public.mbg_rider_locations(rider_user_id);

-- Customers' real registered areas (new — "what customers registered as their areas")
CREATE TABLE IF NOT EXISTS public.mbg_customer_areas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id UUID NOT NULL REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  address          TEXT NOT NULL,
  latitude         DECIMAL(10, 8),
  longitude        DECIMAL(11, 8),
  is_default       BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mbg_customer_areas_customer_idx ON public.mbg_customer_areas(customer_user_id);

-- Ride/delivery request extensions
ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS service_type                  TEXT NOT NULL DEFAULT 'ride' CHECK (service_type IN ('ride', 'delivery')),
  ADD COLUMN IF NOT EXISTS delivery_mode                 TEXT CHECK (delivery_mode IN ('supermarket', 'normal')),
  ADD COLUMN IF NOT EXISTS supermarket_id                UUID,
  ADD COLUMN IF NOT EXISTS power_type_requested          TEXT CHECK (power_type_requested IN ('electric', 'fuel')),
  ADD COLUMN IF NOT EXISTS umbrella_requested            BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS time_multiplier                NUMERIC(4, 2) NOT NULL DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS rider_earning                 DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS chairperson_commission_total  DECIMAL(10, 2);
CREATE INDEX IF NOT EXISTS mbg_rides_service_type_idx ON public.mbg_rides(service_type);
CREATE INDEX IF NOT EXISTS mbg_rides_status_rider_idx ON public.mbg_rides(status, rider_id);

-- Platform's own cut — deliberately isolated in its own service_role-only
-- table so it is structurally impossible for a rider (or customer) to read
-- it via their own-row access to mbg_rides/mbg_payments. What the rider
-- keeps is chairperson_commission_total is the rider's own commission cost)
CREATE TABLE IF NOT EXISTS public.mbg_ride_platform_fees (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id           UUID NOT NULL UNIQUE REFERENCES public.mbg_rides(id) ON DELETE CASCADE,
  platform_fee_ugx  DECIMAL(10, 2) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. RLS
-- ============================================================================
ALTER TABLE public.mbg_rider_locations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_customer_areas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_ride_platform_fees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_rider_locations_own ON public.mbg_rider_locations;
CREATE POLICY mbg_rider_locations_own ON public.mbg_rider_locations
  FOR ALL USING (auth.uid() = rider_user_id) WITH CHECK (auth.uid() = rider_user_id);
DROP POLICY IF EXISTS mbg_rider_locations_service_role ON public.mbg_rider_locations;
CREATE POLICY mbg_rider_locations_service_role ON public.mbg_rider_locations
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_customer_areas_own ON public.mbg_customer_areas;
CREATE POLICY mbg_customer_areas_own ON public.mbg_customer_areas
  FOR ALL USING (auth.uid() = customer_user_id) WITH CHECK (auth.uid() = customer_user_id);
DROP POLICY IF EXISTS mbg_customer_areas_service_role ON public.mbg_customer_areas;
CREATE POLICY mbg_customer_areas_service_role ON public.mbg_customer_areas
  FOR ALL USING (auth.role() = 'service_role');

-- Platform fee: service_role + the platform's own developer account only.
-- No policy at all for ordinary authenticated users == not readable by them.
DROP POLICY IF EXISTS mbg_ride_platform_fees_service_role ON public.mbg_ride_platform_fees;
CREATE POLICY mbg_ride_platform_fees_service_role ON public.mbg_ride_platform_fees
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS mbg_ride_platform_fees_read_developer ON public.mbg_ride_platform_fees;
CREATE POLICY mbg_ride_platform_fees_read_developer ON public.mbg_ride_platform_fees
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true)
  );

-- mbg_riders previously had ONLY a service_role policy (every client write
-- from riderService.ts was silently failing). Add real self-access, but
-- guard the columns a rider must never be able to self-grant (see trigger
-- below) so this can't be used to self-approve or fake a rating.
DROP POLICY IF EXISTS mbg_riders_read_own ON public.mbg_riders;
CREATE POLICY mbg_riders_read_own ON public.mbg_riders FOR SELECT USING (auth.uid() = user_id);
DROP POLICY IF EXISTS mbg_riders_update_own ON public.mbg_riders;
CREATE POLICY mbg_riders_update_own ON public.mbg_riders
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS mbg_riders_read_matching ON public.mbg_riders;
CREATE POLICY mbg_riders_read_matching ON public.mbg_riders
  FOR SELECT USING (status = 'active' AND is_available = true);

-- NOTE: auth.role() reflects the ORIGINAL caller's JWT role even inside a
-- SECURITY DEFINER function — it does NOT become 'service_role' just
-- because the function runs with elevated privileges. mbg_complete_ride /
-- mbg_cancel_ride are called directly by an authenticated rider and need to
-- legitimately update total_rides/completed_rides/cancelled_rides, so they
-- set this session-local flag right before doing so; the trigger trusts it.
CREATE OR REPLACE FUNCTION public.mbg_riders_protect_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF auth.role() <> 'service_role' AND COALESCE(current_setting('mbg.trusted_write', true), '') <> 'true' THEN
    NEW.status           := OLD.status;
    NEW.rating           := OLD.rating;
    NEW.total_rides      := OLD.total_rides;
    NEW.completed_rides  := OLD.completed_rides;
    NEW.cancelled_rides  := OLD.cancelled_rides;
    NEW.approved_by      := OLD.approved_by;
    NEW.approved_at      := OLD.approved_at;
    NEW.user_id          := OLD.user_id;
    NEW.stage_id         := OLD.stage_id;
    NEW.plate_number     := OLD.plate_number;
    NEW.license_number    := OLD.license_number;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS mbg_riders_protect_columns_trg ON public.mbg_riders;
CREATE TRIGGER mbg_riders_protect_columns_trg
  BEFORE UPDATE ON public.mbg_riders
  FOR EACH ROW EXECUTE FUNCTION public.mbg_riders_protect_columns();

-- mbg_rides / mbg_payments previously had ONLY a service_role policy.
-- Add real self-access for the two parties involved, plus riders being able
-- to see ride offers sent specifically to them.
DROP POLICY IF EXISTS mbg_rides_read_own_customer ON public.mbg_rides;
CREATE POLICY mbg_rides_read_own_customer ON public.mbg_rides FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.mbg_customers c WHERE c.id = mbg_rides.customer_id AND c.user_id = auth.uid())
);
DROP POLICY IF EXISTS mbg_rides_read_own_rider ON public.mbg_rides;
CREATE POLICY mbg_rides_read_own_rider ON public.mbg_rides FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.mbg_riders r WHERE r.id = mbg_rides.rider_id AND r.user_id = auth.uid())
);

DROP POLICY IF EXISTS mbg_payments_read_own_customer ON public.mbg_payments;
CREATE POLICY mbg_payments_read_own_customer ON public.mbg_payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.mbg_customers c WHERE c.id = mbg_payments.customer_id AND c.user_id = auth.uid())
);
DROP POLICY IF EXISTS mbg_payments_read_own_rider ON public.mbg_payments;
CREATE POLICY mbg_payments_read_own_rider ON public.mbg_payments FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.mbg_riders r WHERE r.id = mbg_payments.rider_id AND r.user_id = auth.uid())
);

-- ============================================================================
-- 3. HELPERS: distance, settings lookup, time-of-day multiplier
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_haversine_km(lat1 NUMERIC, lng1 NUMERIC, lat2 NUMERIC, lng2 NUMERIC)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT 6371 * 2 * ASIN(SQRT(
    POWER(SIN(RADIANS(lat2 - lat1) / 2), 2) +
    COS(RADIANS(lat1)) * COS(RADIANS(lat2)) * POWER(SIN(RADIANS(lng2 - lng1) / 2), 2)
  ));
$$;

CREATE OR REPLACE FUNCTION public.mbg_get_setting_numeric(p_key TEXT, p_default NUMERIC)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT value::NUMERIC FROM public.mbg_platform_settings WHERE key = p_key), p_default);
$$;

-- Peak commute hours cost more, late night carries a small safety premium.
CREATE OR REPLACE FUNCTION public.mbg_current_time_multiplier()
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXTRACT(HOUR FROM (now() AT TIME ZONE 'Africa/Kampala')) IN (7, 8, 17, 18, 19) THEN 1.3
    WHEN EXTRACT(HOUR FROM (now() AT TIME ZONE 'Africa/Kampala')) >= 22
      OR EXTRACT(HOUR FROM (now() AT TIME ZONE 'Africa/Kampala')) < 5 THEN 1.2
    ELSE 1.0
  END;
$$;

-- 1,000 UGX/km per the explicit product spec (overrides the old 1,500 seed).
INSERT INTO public.mbg_platform_settings (key, value, value_type, description, category, is_public)
VALUES ('ride.per_km_rate', '1000', 'number', 'Rate per kilometer in UGX', 'ride', true)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

-- Public fare quote — no auth required, used to show a price before requesting.
CREATE OR REPLACE FUNCTION public.mbg_estimate_fare(
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_rider_mode TEXT DEFAULT 'normal',
  p_vip_surcharge_pct NUMERIC DEFAULT 10,
  p_discount_pct NUMERIC DEFAULT 10,
  p_return_discount_pct NUMERIC DEFAULT 30
)
RETURNS JSONB LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_distance_km NUMERIC;
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('ride.base_fare', 1000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('ride.per_km_rate', 1000);
  v_min_fare  NUMERIC := public.mbg_get_setting_numeric('ride.minimum_fare', 2000);
  v_multiplier NUMERIC := public.mbg_current_time_multiplier();
  v_fare NUMERIC;
BEGIN
  v_distance_km := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  IF v_distance_km IS NULL THEN
    RAISE EXCEPTION 'Invalid pickup/dropoff coordinates';
  END IF;

  v_fare := GREATEST(v_min_fare, v_base_fare + v_distance_km * v_per_km) * v_multiplier;

  IF p_rider_mode = 'vip' THEN
    v_fare := v_fare * (1 + p_vip_surcharge_pct / 100);
  ELSIF p_rider_mode = 'discount' THEN
    v_fare := v_fare * (1 - p_discount_pct / 100);
  ELSIF p_rider_mode = 'return' THEN
    v_fare := v_fare * (1 - p_return_discount_pct / 100);
  END IF;

  v_fare := ROUND(v_fare / 100) * 100;

  RETURN jsonb_build_object(
    'distance_km', ROUND(v_distance_km, 2),
    'time_multiplier', v_multiplier,
    'fare', v_fare,
    'estimated_minutes', GREATEST(2, ROUND(v_distance_km / 25 * 60))
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_estimate_fare TO authenticated, anon;

-- ============================================================================
-- 4. MATCHING: real riders, real registered areas, real vehicle attributes
-- ============================================================================
CREATE OR REPLACE FUNCTION public.mbg_find_available_riders(
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_dropoff_area TEXT DEFAULT NULL,
  p_power_type TEXT DEFAULT NULL,
  p_require_umbrella BOOLEAN DEFAULT false,
  p_exclude_rider_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_limit INT DEFAULT 10
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
  time_multiplier NUMERIC
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
    v_multiplier
  FROM public.mbg_riders r
  JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  LEFT JOIN public.mbg_rider_locations home ON home.rider_user_id = r.user_id AND home.is_home = true
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
  -- Nearest rider first (real GPS/home distance), "knows this destination"
  -- only breaks ties among comparably-close riders, then rating.
  ORDER BY dist.km ASC NULLS LAST, 13 DESC, r.rating DESC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_find_available_riders TO authenticated;

-- ============================================================================
-- 5. RIDE/DELIVERY LIFECYCLE
-- ============================================================================

-- Customer requests a ride/delivery from ONE chosen rider (from the results
-- of mbg_find_available_riders). Fare and the earning/commission split are
-- computed here, server-side, from that rider's real mode/vehicle — a
-- client can't spoof either.
CREATE OR REPLACE FUNCTION public.mbg_request_ride(
  p_service_type TEXT,
  p_delivery_mode TEXT,
  p_supermarket_id UUID,
  p_rider_id UUID,
  p_pickup_location TEXT, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_location TEXT, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_power_type_requested TEXT,
  p_umbrella_requested BOOLEAN
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id UUID;
  v_rider public.mbg_riders%ROWTYPE;
  v_stage_id UUID;
  v_distance_km NUMERIC;
  v_multiplier NUMERIC := public.mbg_current_time_multiplier();
  v_base_fare NUMERIC := public.mbg_get_setting_numeric('ride.base_fare', 1000);
  v_per_km    NUMERIC := public.mbg_get_setting_numeric('ride.per_km_rate', 1000);
  v_min_fare  NUMERIC := public.mbg_get_setting_numeric('ride.minimum_fare', 2000);
  v_fare NUMERIC;
  v_platform_pct NUMERIC := public.mbg_get_setting_numeric('commission.platform_fee_percentage', 5);
  v_rider_pct    NUMERIC := public.mbg_get_setting_numeric('commission.rider_percentage', 70);
  v_platform_fee NUMERIC;
  v_rider_earning NUMERIC;
  v_chair_total NUMERIC;
  v_ride_id UUID;
BEGIN
  IF p_service_type NOT IN ('ride', 'delivery') THEN
    RAISE EXCEPTION 'Invalid service_type: %', p_service_type;
  END IF;
  IF p_service_type = 'delivery' AND (p_delivery_mode IS NULL OR p_delivery_mode NOT IN ('supermarket', 'normal')) THEN
    RAISE EXCEPTION 'delivery_mode (supermarket|normal) is required for deliveries';
  END IF;
  IF p_delivery_mode = 'supermarket' AND p_supermarket_id IS NULL THEN
    RAISE EXCEPTION 'supermarket_id is required for supermarket deliveries';
  END IF;

  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();
  IF v_customer_id IS NULL THEN
    INSERT INTO public.mbg_customers (user_id) VALUES (auth.uid()) RETURNING id INTO v_customer_id;
  END IF;

  SELECT * INTO v_rider FROM public.mbg_riders WHERE id = p_rider_id AND status = 'active' AND is_available = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected rider is no longer available';
  END IF;
  IF p_power_type_requested IS NOT NULL AND v_rider.power_type <> p_power_type_requested THEN
    RAISE EXCEPTION 'Selected rider does not match the requested vehicle power type';
  END IF;
  IF p_umbrella_requested AND NOT v_rider.has_umbrella THEN
    RAISE EXCEPTION 'Selected rider does not offer rain cover';
  END IF;

  v_distance_km := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  IF v_distance_km IS NULL THEN
    RAISE EXCEPTION 'Invalid pickup/dropoff coordinates';
  END IF;

  v_fare := GREATEST(v_min_fare, v_base_fare + v_distance_km * v_per_km) * v_multiplier;
  IF v_rider.mode = 'vip' THEN
    v_fare := v_fare * (1 + v_rider.vip_surcharge_pct / 100);
  ELSIF v_rider.mode = 'discount' THEN
    v_fare := v_fare * (1 - v_rider.discount_pct / 100);
  ELSIF v_rider.mode = 'return' THEN
    v_fare := v_fare * (1 - v_rider.return_discount_pct / 100);
  END IF;
  v_fare := ROUND(v_fare / 100) * 100;

  v_platform_fee  := ROUND(v_fare * v_platform_pct / 100);
  v_rider_earning := ROUND(v_fare * v_rider_pct / 100);
  v_chair_total   := v_fare - v_platform_fee - v_rider_earning;

  SELECT id INTO v_stage_id FROM public.mbg_stages
  WHERE is_active = true AND location_lat IS NOT NULL AND location_lng IS NOT NULL
  ORDER BY public.mbg_haversine_km(location_lat, location_lng, p_pickup_lat, p_pickup_lng) ASC
  LIMIT 1;
  IF v_stage_id IS NULL THEN
    SELECT id INTO v_stage_id FROM public.mbg_stages WHERE is_active = true LIMIT 1;
  END IF;
  IF v_stage_id IS NULL THEN
    RAISE EXCEPTION 'No active stage is configured yet to route this request through';
  END IF;

  INSERT INTO public.mbg_rides (
    customer_id, rider_id, stage_id,
    pickup_location, pickup_lat, pickup_lng,
    dropoff_location, dropoff_lat, dropoff_lng,
    status, distance_km, duration_minutes, fare,
    service_type, delivery_mode, supermarket_id,
    power_type_requested, umbrella_requested,
    time_multiplier, rider_earning, chairperson_commission_total
  ) VALUES (
    v_customer_id, p_rider_id, v_stage_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(v_distance_km / 25 * 60)), v_fare,
    p_service_type, p_delivery_mode, p_supermarket_id,
    p_power_type_requested, COALESCE(p_umbrella_requested, false),
    v_multiplier, v_rider_earning, v_chair_total
  ) RETURNING id INTO v_ride_id;

  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx) VALUES (v_ride_id, v_platform_fee);

  RETURN jsonb_build_object(
    'success', true, 'ride_id', v_ride_id, 'fare', v_fare,
    'distance_km', v_distance_km, 'rider_earning', v_rider_earning
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride TO authenticated;

-- Rider accepts or declines an offer sent to them (mbg_rides.rider_id already
-- points at them, status = 'pending'). Decline clears rider_id so the
-- customer's client can immediately offer the next candidate from its list.
CREATE OR REPLACE FUNCTION public.mbg_respond_to_ride(p_ride_id UUID, p_accept BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_rider_id UUID;
BEGIN
  SELECT id INTO v_rider_id FROM public.mbg_riders WHERE user_id = auth.uid();
  IF v_rider_id IS NULL THEN
    RAISE EXCEPTION 'No rider profile for current user';
  END IF;

  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.rider_id IS DISTINCT FROM v_rider_id THEN
    RAISE EXCEPTION 'This ride was not offered to you';
  END IF;
  IF v_ride.status <> 'pending' THEN
    RAISE EXCEPTION 'This offer is no longer pending';
  END IF;

  IF p_accept THEN
    UPDATE public.mbg_rides SET status = 'accepted', accepted_at = now(), updated_at = now() WHERE id = p_ride_id;

    INSERT INTO public.mbg_payments (ride_id, customer_id, rider_id, amount, status)
    VALUES (p_ride_id, v_ride.customer_id, v_rider_id, v_ride.fare, 'pending');

    UPDATE public.mbg_riders SET is_available = false, updated_at = now() WHERE id = v_rider_id;

    RETURN jsonb_build_object('success', true, 'status', 'accepted');
  ELSE
    UPDATE public.mbg_rides SET rider_id = NULL, updated_at = now() WHERE id = p_ride_id;
    RETURN jsonb_build_object('success', true, 'status', 'declined');
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_respond_to_ride TO authenticated;

-- Customer-side: give up waiting on the current offer (30s timeout in the
-- UI) so the next candidate can be offered the ride.
CREATE OR REPLACE FUNCTION public.mbg_withdraw_ride_offer(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_customer_id UUID;
BEGIN
  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();
  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND OR v_ride.customer_id IS DISTINCT FROM v_customer_id THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.status <> 'pending' THEN
    RAISE EXCEPTION 'Ride is no longer pending';
  END IF;
  UPDATE public.mbg_rides SET rider_id = NULL, updated_at = now() WHERE id = p_ride_id;
  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_withdraw_ride_offer TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_start_ride(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider_id UUID;
  v_updated UUID;
BEGIN
  SELECT id INTO v_rider_id FROM public.mbg_riders WHERE user_id = auth.uid();
  UPDATE public.mbg_rides SET status = 'in_progress', started_at = now(), updated_at = now()
  WHERE id = p_ride_id AND rider_id = v_rider_id AND status = 'accepted'
  RETURNING id INTO v_updated;
  IF v_updated IS NULL THEN
    RAISE EXCEPTION 'Ride cannot be started (not found, not yours, or not accepted yet)';
  END IF;
  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_start_ride TO authenticated;

-- Completes the ride and distributes the tiered chairperson commission up
-- the region hierarchy for the ride's stage. Any level with no active
-- chairperson simply doesn't get a commission row for that ride.
CREATE OR REPLACE FUNCTION public.mbg_complete_ride(p_ride_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_rider_id UUID;
  v_payment_id UUID;
  v_region RECORD;
  v_level RECORD;
  v_chair_user_id UUID;
  v_pct NUMERIC;
  v_amount NUMERIC;
BEGIN
  SELECT id INTO v_rider_id FROM public.mbg_riders WHERE user_id = auth.uid();
  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id AND rider_id = v_rider_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found or not yours';
  END IF;
  IF v_ride.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Ride must be in progress to complete';
  END IF;

  UPDATE public.mbg_rides SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = p_ride_id;

  UPDATE public.mbg_payments SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE ride_id = p_ride_id RETURNING id INTO v_payment_id;

  PERFORM set_config('mbg.trusted_write', 'true', true);
  UPDATE public.mbg_riders SET
    is_available = true, total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
  WHERE id = v_rider_id;

  UPDATE public.mbg_customers SET
    total_rides = total_rides + 1, completed_rides = completed_rides + 1, updated_at = now()
  WHERE id = v_ride.customer_id;

  SELECT s.parish_id AS parish_id, p.subcounty_id AS subcounty_id, sc.division_id AS division_id, dv.district_id AS district_id
  INTO v_region
  FROM public.mbg_stages s
  JOIN public.mbg_parishes p ON p.id = s.parish_id
  JOIN public.mbg_subcounties sc ON sc.id = p.subcounty_id
  JOIN public.mbg_divisions dv ON dv.id = sc.division_id
  WHERE s.id = v_ride.stage_id;

  IF FOUND AND v_payment_id IS NOT NULL THEN
    FOR v_level IN
      SELECT * FROM (VALUES
        ('stage'::public.mbg_region_type,     v_ride.stage_id,        'commission.stage_chair_percentage'),
        ('parish'::public.mbg_region_type,    v_region.parish_id,     'commission.parish_chair_percentage'),
        ('subcounty'::public.mbg_region_type, v_region.subcounty_id,  'commission.subcounty_chair_percentage'),
        ('division'::public.mbg_region_type,  v_region.division_id,  'commission.division_chair_percentage'),
        ('district'::public.mbg_region_type,  v_region.district_id,  'commission.district_chair_percentage')
      ) AS t(region_type, region_id, setting_key)
    LOOP
      v_pct := public.mbg_get_setting_numeric(v_level.setting_key, 0);
      v_amount := ROUND(v_ride.fare * v_pct / 100);

      SELECT cm.user_id INTO v_chair_user_id
      FROM public.mbg_committee_members cm
      WHERE cm.region_type = v_level.region_type
        AND cm.region_id = v_level.region_id
        AND cm.is_active = true
      ORDER BY cm.appointed_at ASC
      LIMIT 1;

      IF v_chair_user_id IS NOT NULL AND v_amount > 0 THEN
        INSERT INTO public.mbg_commissions (
          ride_id, payment_id, recipient_id, recipient_role, region_type, region_id,
          ride_fare, commission_percentage, commission_amount, status
        ) VALUES (
          p_ride_id, v_payment_id, v_chair_user_id, v_level.region_type::TEXT || '_chairperson',
          v_level.region_type, v_level.region_id,
          v_ride.fare, v_pct, v_amount, 'pending'
        );
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', true, 'rider_earning', v_ride.rider_earning);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_complete_ride TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_cancel_ride(p_ride_id UUID, p_reason TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ride public.mbg_rides%ROWTYPE;
  v_customer_id UUID;
  v_rider_id UUID;
  v_by public.mbg_cancellation_by;
BEGIN
  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();
  SELECT id INTO v_rider_id FROM public.mbg_riders WHERE user_id = auth.uid();

  SELECT * INTO v_ride FROM public.mbg_rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ride not found';
  END IF;
  IF v_ride.status IN ('completed', 'cancelled', 'failed') THEN
    RAISE EXCEPTION 'Ride cannot be cancelled from its current status';
  END IF;

  IF v_customer_id IS NOT NULL AND v_ride.customer_id = v_customer_id THEN
    v_by := 'customer';
  ELSIF v_rider_id IS NOT NULL AND v_ride.rider_id = v_rider_id THEN
    v_by := 'rider';
  ELSE
    RAISE EXCEPTION 'You are not part of this ride';
  END IF;

  UPDATE public.mbg_rides
  SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_by, cancellation_reason = p_reason, updated_at = now()
  WHERE id = p_ride_id;

  IF v_ride.rider_id IS NOT NULL THEN
    PERFORM set_config('mbg.trusted_write', 'true', true);
    UPDATE public.mbg_riders SET is_available = true, cancelled_rides = cancelled_rides + 1, updated_at = now()
    WHERE id = v_ride.rider_id;
  END IF;
  UPDATE public.mbg_customers SET cancelled_rides = cancelled_rides + 1, updated_at = now() WHERE id = v_ride.customer_id;

  UPDATE public.mbg_payments SET status = 'refunded', refunded_at = now(), refund_reason = p_reason, updated_at = now()
  WHERE ride_id = p_ride_id AND status = 'pending';

  RETURN jsonb_build_object('success', true);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_cancel_ride TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Real ride/delivery matching engine ready: haversine distance, 1000 UGX/km fare, mode-aware pricing, tiered chairperson commissions, platform fee hidden from riders.';
END $$;
