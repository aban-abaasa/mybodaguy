-- ============================================================================
-- Different fare rates for Boda, Car, Van and Truck.
-- ============================================================================
-- Until now every vehicle was priced off ONE global rate card (ride.base_fare /
-- ride.per_km_rate / ride.minimum_fare), so a truck cost exactly what a boda
-- did over the same distance. This gives every vehicle class its own rate card
-- and lets the logistics classes (van, truck) price like logistics:
--
--   · base fare, per-km rate and minimum fare per vehicle class;
--   · a flat LOADING / HANDLING FEE (a van or truck is loaded and unloaded; a
--     boda is not) — added after the time-of-day multiplier, because loading
--     a truck costs the same at 3am as at noon;
--   · a LONG-HAUL TIER: past N km the per-km rate drops to a cheaper rate, so
--     a 200 km truck run is not priced like 200 one-km hops. Trucks and vans
--     earn more per trip but the long-distance customer gets a fair price.
--
-- Each class's rates are, by default, a MULTIPLE of the boda rate: a class
-- left blank (NULL) uses the global ride.* settings times its rate_multiplier.
-- Seeded multiples: car 2.5x, van 5x, truck 10x (boda / bicycle / tuktuk 1x, so
-- they price EXACTLY as before). Because it is a multiple of the live boda rate,
-- changing ride.base_fare / ride.per_km_rate moves every class with it. A
-- developer can instead type an explicit UGX amount for any field, or change
-- the multiple, from the Developer Dashboard (Commissions tab -> "Fare rates by
-- vehicle").
--
-- Who sees what:
--   · customers  — mbg_quote_vehicle_classes() prices the SAME trip for every
--                  class side by side (with how many are online), and each
--                  rider card shows the fare for that rider's own vehicle;
--   · riders     — the rates for their class are shown on their dashboard
--                  (through mbg_quote_vehicle_classes), so they know what a trip
--                  pays before they accept;
--   · the multiples (car 2.5x, van 5x, truck 10x) are an internal pricing knob:
--                  customers and riders see the resulting prices and rates, never
--                  the multiple. The table is locked to developers; everyone else
--                  reads only the resolved numbers through the quote function;
--   · companies  — a transport company's own base / per-km / minimum
--                  (mbg_business_pricing_settings) still win, field by field;
--                  anything it left blank falls back to the rider's CLASS
--                  rates (a company van falls back to van rates).
--
-- ONE function prices a ride — mbg_price_ride_for_rider — and every place that
-- shows or books a fare calls it, so the quote can never disagree with the
-- charge:
--   mbg_find_available_riders   (the fare on each rider card)
--   mbg_request_ride            (the fare the ride is booked at)
--   mbg_apply_business_pricing  (company-pricing trigger on mbg_rides)
--   mbg_reprice_ride_on_rider_change (auto-dispatch hands a pending ride to a
--                                      different rider: it is re-priced for them)
--
-- NOT touched: the cargo family (cargo.* settings) — cross-border delivery,
-- ship/sea cargo and journey legs. Those are separate products with their own
-- quote + charge functions and stay on cargo.* until they are moved over
-- deliberately.
--
-- Run after ADD_ICANERA_UNIFIED_PLATFORM_FEE.sql (mbg_compute_ride_split),
-- FIX_MBG_FIND_AVAILABLE_RIDERS_VARCHAR_MISMATCH.sql (latest mbg_find_available_riders),
-- ADD_JOURNEY_PREPAID_LEG_FARES.sql (is_journey_prepaid + latest pricing
-- trigger) and ADD_AUTO_DISPATCH_CASCADE.sql. Safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The rate card.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mbg_vehicle_fare_rates (
  vehicle_type TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  -- How many times the boda rate this class charges. Applies to every base /
  -- per-km / minimum field left blank below (blank = ride.* setting x this).
  rate_multiplier NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (rate_multiplier > 0),
  -- NULL = the platform-wide ride.* setting times rate_multiplier.
  base_fare NUMERIC(12,2) CHECK (base_fare IS NULL OR base_fare >= 0),
  per_km_rate NUMERIC(12,2) CHECK (per_km_rate IS NULL OR per_km_rate >= 0),
  min_fare NUMERIC(12,2) CHECK (min_fare IS NULL OR min_fare >= 0),
  -- Flat handling fee for vehicles that carry loads. Not scaled by peak hours.
  loading_fee NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (loading_fee >= 0),
  -- Past this many km the per-km rate becomes long_haul_per_km_rate. Both or neither.
  long_haul_after_km NUMERIC(8,2) CHECK (long_haul_after_km IS NULL OR long_haul_after_km > 0),
  long_haul_per_km_rate NUMERIC(12,2) CHECK (long_haul_per_km_rate IS NULL OR long_haul_per_km_rate >= 0),
  sort_order INT NOT NULL DEFAULT 0,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mbg_vehicle_fare_rates_long_haul_pair
    CHECK ((long_haul_after_km IS NULL) = (long_haul_per_km_rate IS NULL))
);

-- The table may already exist from the first version of this migration.
ALTER TABLE public.mbg_vehicle_fare_rates
  ADD COLUMN IF NOT EXISTS rate_multiplier NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (rate_multiplier > 0);

ALTER TABLE public.mbg_vehicle_fare_rates ENABLE ROW LEVEL SECURITY;

-- Locked: no client reads or writes the table directly (the first version of this
-- migration let everyone SELECT it, so that is withdrawn here). Developers read
-- it through mbg_dev_get_vehicle_fare_rates and write it through
-- mbg_dev_set_vehicle_fare_rate; customers and riders get the resolved prices
-- and rates from mbg_quote_vehicle_classes. All three are SECURITY DEFINER.
DROP POLICY IF EXISTS mbg_vehicle_fare_rates_read ON public.mbg_vehicle_fare_rates;
REVOKE ALL ON public.mbg_vehicle_fare_rates FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Seed. ON CONFLICT DO NOTHING: re-running never overwrites a developer's edits.
--    Boda classes stay NULL = the existing global ride.* rates, unchanged.
-- ----------------------------------------------------------------------------
INSERT INTO public.mbg_vehicle_fare_rates
  (vehicle_type, label, rate_multiplier, base_fare, per_km_rate, min_fare, loading_fee, long_haul_after_km, long_haul_per_km_rate, sort_order)
VALUES
  ('motorcycle', 'Boda',     1, NULL, NULL, NULL,     0, NULL, NULL, 1),
  ('bicycle',    'Bicycle',  1, NULL, NULL, NULL,     0, NULL, NULL, 2),
  ('tuktuk',     'Tuktuk',   1, NULL, NULL, NULL,     0, NULL, NULL, 3),
  ('car',        'Car',    2.5, NULL, NULL, NULL,     0,   60, 2000, 4),
  ('van',        'Van',      5, NULL, NULL, NULL,  5000,   50, 3500, 5),
  ('truck',      'Truck',   10, NULL, NULL, NULL, 10000,   80, 7000, 6)
ON CONFLICT (vehicle_type) DO NOTHING;

-- The first version of this migration seeded car / van / truck with fixed UGX
-- amounts. Where a row is still EXACTLY that untouched seed, move it to the
-- multiple-of-boda model; a row a developer has since edited is left alone.
UPDATE public.mbg_vehicle_fare_rates SET rate_multiplier = 2.5, base_fare = NULL, per_km_rate = NULL, min_fare = NULL,
       loading_fee = 0, long_haul_after_km = 60, long_haul_per_km_rate = 2000, updated_at = now()
 WHERE vehicle_type = 'car' AND rate_multiplier = 1 AND base_fare = 3000 AND per_km_rate = 1500 AND min_fare = 5000
   AND loading_fee = 0 AND long_haul_after_km = 60 AND long_haul_per_km_rate = 1200;
UPDATE public.mbg_vehicle_fare_rates SET rate_multiplier = 5, base_fare = NULL, per_km_rate = NULL, min_fare = NULL,
       loading_fee = 5000, long_haul_after_km = 50, long_haul_per_km_rate = 3500, updated_at = now()
 WHERE vehicle_type = 'van' AND rate_multiplier = 1 AND base_fare = 8000 AND per_km_rate = 2500 AND min_fare = 15000
   AND loading_fee = 5000 AND long_haul_after_km = 50 AND long_haul_per_km_rate = 1800;
UPDATE public.mbg_vehicle_fare_rates SET rate_multiplier = 10, base_fare = NULL, per_km_rate = NULL, min_fare = NULL,
       loading_fee = 10000, long_haul_after_km = 80, long_haul_per_km_rate = 7000, updated_at = now()
 WHERE vehicle_type = 'truck' AND rate_multiplier = 1 AND base_fare = 15000 AND per_km_rate = 4000 AND min_fare = 30000
   AND loading_fee = 10000 AND long_haul_after_km = 80 AND long_haul_per_km_rate = 3000;

-- ----------------------------------------------------------------------------
-- 3. Resolve a class's effective rates (blank -> the global ride.* setting x the
--    class's rate_multiplier, i.e. a multiple of the boda rate).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_resolve_vehicle_rates(p_vehicle_type TEXT)
RETURNS TABLE (
  o_base_fare NUMERIC, o_per_km_rate NUMERIC, o_min_fare NUMERIC,
  o_loading_fee NUMERIC, o_long_haul_after_km NUMERIC, o_long_haul_per_km_rate NUMERIC
)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    COALESCE(v.base_fare,   public.mbg_get_setting_numeric('ride.base_fare', 1000)    * COALESCE(v.rate_multiplier, 1)),
    COALESCE(v.per_km_rate, public.mbg_get_setting_numeric('ride.per_km_rate', 1000)  * COALESCE(v.rate_multiplier, 1)),
    COALESCE(v.min_fare,    public.mbg_get_setting_numeric('ride.minimum_fare', 2000) * COALESCE(v.rate_multiplier, 1)),
    COALESCE(v.loading_fee, 0),
    v.long_haul_after_km,
    v.long_haul_per_km_rate
  FROM (SELECT 1) one
  LEFT JOIN public.mbg_vehicle_fare_rates v ON v.vehicle_type = p_vehicle_type;
$$;
REVOKE ALL ON FUNCTION public.mbg_resolve_vehicle_rates(TEXT) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 4. The pricing itself.
--
-- mbg_vehicle_fare — raw fare for a vehicle class over a distance:
--   GREATEST(min, base + distance charge) * time-of-day multiplier + loading fee
-- where the distance charge is per_km * km, or, past the long-haul threshold,
-- per_km * threshold + long_haul_rate * (km - threshold). A transport company's
-- own base / per-km / minimum replace the class's, field by field; a company
-- per-km rate is a single flat rate, so it switches the long-haul tier off.
-- The loading fee is the platform's handling charge and always applies.
-- Not rounded and no rider mode applied — see mbg_price_ride_for_rider.
-- For a class with no rate card row (or a blank one) this is exactly the old
-- GREATEST(min, base + km * per_km) * multiplier.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_vehicle_fare(
  p_vehicle_type TEXT,
  p_distance_km NUMERIC,
  p_multiplier NUMERIC DEFAULT 1,
  p_business_profile_id UUID DEFAULT NULL
)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  r RECORD;
  c public.mbg_business_pricing_settings%ROWTYPE;
  v_base NUMERIC;
  v_per_km NUMERIC;
  v_min NUMERIC;
  v_loading NUMERIC;
  v_after NUMERIC;
  v_long_rate NUMERIC;
  v_km NUMERIC := GREATEST(COALESCE(p_distance_km, 0), 0);
  v_distance_charge NUMERIC;
BEGIN
  SELECT * INTO r FROM public.mbg_resolve_vehicle_rates(p_vehicle_type);
  v_base := r.o_base_fare;
  v_per_km := r.o_per_km_rate;
  v_min := r.o_min_fare;
  v_loading := r.o_loading_fee;
  v_after := r.o_long_haul_after_km;
  v_long_rate := r.o_long_haul_per_km_rate;

  IF p_business_profile_id IS NOT NULL THEN
    SELECT * INTO c FROM public.mbg_business_pricing_settings WHERE business_profile_id = p_business_profile_id;
    IF FOUND THEN
      v_base := COALESCE(c.base_fare, v_base);
      v_min := COALESCE(c.min_fare, v_min);
      IF c.per_km_rate IS NOT NULL THEN
        v_per_km := c.per_km_rate;
        v_after := NULL;
        v_long_rate := NULL;
      END IF;
    END IF;
  END IF;

  IF v_after IS NOT NULL AND v_long_rate IS NOT NULL AND v_km > v_after THEN
    v_distance_charge := v_after * v_per_km + (v_km - v_after) * v_long_rate;
  ELSE
    v_distance_charge := v_km * v_per_km;
  END IF;

  RETURN GREATEST(v_min, v_base + v_distance_charge) * COALESCE(p_multiplier, 1) + v_loading;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_vehicle_fare(TEXT, NUMERIC, NUMERIC, UUID) FROM PUBLIC;

-- mbg_price_ride_for_rider — the number a customer pays for one specific
-- rider: the rider's vehicle class + their company's rates, then the rider's
-- own mode (vip surcharge / discount / return discount), rounded to 100 UGX.
CREATE OR REPLACE FUNCTION public.mbg_price_ride_for_rider(
  p_rider public.mbg_riders,
  p_distance_km NUMERIC,
  p_multiplier NUMERIC DEFAULT 1
)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_fare NUMERIC;
BEGIN
  v_fare := public.mbg_vehicle_fare(p_rider.vehicle_type::TEXT, p_distance_km, p_multiplier, p_rider.business_profile_id);

  IF p_rider.mode = 'vip' THEN
    v_fare := v_fare * (1 + COALESCE(p_rider.vip_surcharge_pct, 0) / 100);
  ELSIF p_rider.mode = 'discount' THEN
    v_fare := v_fare * (1 - COALESCE(p_rider.discount_pct, 0) / 100);
  ELSIF p_rider.mode = 'return' THEN
    v_fare := v_fare * (1 - COALESCE(p_rider.return_discount_pct, 0) / 100);
  END IF;

  RETURN ROUND(v_fare / 100) * 100;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_price_ride_for_rider(public.mbg_riders, NUMERIC, NUMERIC) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 5. Customer + developer facing.
--
-- mbg_quote_vehicle_classes — the same trip priced for every class, so a
-- customer can see "Boda 6,000 · Car 9,500 · Van 31,000 · Truck 52,000" and how
-- many of each are online BEFORE choosing. Base class price: no rider mode and
-- no company rates (those apply to a specific rider, shown on that rider's
-- card). Callable without signing in, like mbg_estimate_fare.
-- ----------------------------------------------------------------------------
-- (Return columns changed since the first version, so it is dropped first.)
DROP FUNCTION IF EXISTS public.mbg_quote_vehicle_classes(NUMERIC, NUMERIC, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.mbg_quote_vehicle_classes(
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC
)
RETURNS TABLE (
  vehicle_type TEXT,
  label TEXT,
  fare NUMERIC,
  distance_km NUMERIC,
  time_multiplier NUMERIC,
  base_fare NUMERIC,
  per_km_rate NUMERIC,
  min_fare NUMERIC,
  loading_fee NUMERIC,
  long_haul_after_km NUMERIC,
  long_haul_per_km_rate NUMERIC,
  available_riders INTEGER
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ctx AS (
    SELECT public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng) AS km,
           public.mbg_current_time_multiplier() AS mult
  )
  SELECT
    v.vehicle_type,
    v.label,
    ROUND(public.mbg_vehicle_fare(v.vehicle_type, ctx.km, ctx.mult) / 100) * 100,
    ctx.km,
    ctx.mult,
    rt.o_base_fare, rt.o_per_km_rate, rt.o_min_fare, rt.o_loading_fee,
    rt.o_long_haul_after_km, rt.o_long_haul_per_km_rate,
    (SELECT count(*)::INTEGER FROM public.mbg_riders mr
      WHERE mr.vehicle_type::TEXT = v.vehicle_type AND mr.status = 'active' AND mr.is_available = true)
  FROM ctx
  CROSS JOIN public.mbg_vehicle_fare_rates v
  CROSS JOIN LATERAL public.mbg_resolve_vehicle_rates(v.vehicle_type) rt
  WHERE ctx.km IS NOT NULL
  ORDER BY v.sort_order;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_quote_vehicle_classes(NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO anon, authenticated;

-- mbg_dev_get_vehicle_fare_rates — developer reads the raw rate cards (including
-- the multiples and any blank fields), which the locked table no longer allows directly.
CREATE OR REPLACE FUNCTION public.mbg_dev_get_vehicle_fare_rates()
RETURNS SETOF public.mbg_vehicle_fare_rates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_users
    WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY SELECT * FROM public.mbg_vehicle_fare_rates ORDER BY sort_order;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dev_get_vehicle_fare_rates() TO authenticated;

-- mbg_dev_set_vehicle_fare_rate — developer edits one class's rate card.
-- A blank (NULL) base / per-km / minimum is the global ride.* setting times the
-- class's multiple; a blank long-haul pair turns the long-haul tier off.
DROP FUNCTION IF EXISTS public.mbg_dev_set_vehicle_fare_rate(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.mbg_dev_set_vehicle_fare_rate(
  p_vehicle_type TEXT,
  p_rate_multiplier NUMERIC DEFAULT 1,
  p_base_fare NUMERIC DEFAULT NULL,
  p_per_km_rate NUMERIC DEFAULT NULL,
  p_min_fare NUMERIC DEFAULT NULL,
  p_loading_fee NUMERIC DEFAULT 0,
  p_long_haul_after_km NUMERIC DEFAULT NULL,
  p_long_haul_per_km_rate NUMERIC DEFAULT NULL
)
RETURNS public.mbg_vehicle_fare_rates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.mbg_vehicle_fare_rates;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_users
    WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_rate_multiplier IS NULL OR p_rate_multiplier <= 0 THEN
    RAISE EXCEPTION 'the rate multiple must be more than 0';
  END IF;
  IF COALESCE(p_base_fare, 0) < 0 OR COALESCE(p_per_km_rate, 0) < 0 OR COALESCE(p_min_fare, 0) < 0
     OR COALESCE(p_loading_fee, 0) < 0 OR COALESCE(p_long_haul_per_km_rate, 0) < 0 THEN
    RAISE EXCEPTION 'fare amounts cannot be negative';
  END IF;
  IF (p_long_haul_after_km IS NULL) <> (p_long_haul_per_km_rate IS NULL) THEN
    RAISE EXCEPTION 'set both the long-haul distance and the long-haul per-km rate, or neither';
  END IF;
  IF p_long_haul_after_km IS NOT NULL AND p_long_haul_after_km <= 0 THEN
    RAISE EXCEPTION 'the long-haul distance must be more than 0 km';
  END IF;

  UPDATE public.mbg_vehicle_fare_rates
  SET rate_multiplier = p_rate_multiplier,
      base_fare = p_base_fare,
      per_km_rate = p_per_km_rate,
      min_fare = p_min_fare,
      loading_fee = COALESCE(p_loading_fee, 0),
      long_haul_after_km = p_long_haul_after_km,
      long_haul_per_km_rate = p_long_haul_per_km_rate,
      updated_by = auth.uid(),
      updated_at = now()
  WHERE vehicle_type = p_vehicle_type
  RETURNING * INTO v_row;

  IF v_row.vehicle_type IS NULL THEN
    RAISE EXCEPTION 'unknown vehicle type: %', p_vehicle_type;
  END IF;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dev_set_vehicle_fare_rate(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated;


-- ----------------------------------------------------------------------------
-- 6. mbg_find_available_riders — same as FIX_MBG_FIND_AVAILABLE_RIDERS_VARCHAR_MISMATCH.sql
--    (same signature and columns) except each card's fare is now priced for
--    that rider's own vehicle class.
-- ----------------------------------------------------------------------------
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
BEGIN
  IF v_distance_km IS NULL THEN
    RAISE EXCEPTION 'Invalid pickup/dropoff coordinates';
  END IF;

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
    -- Priced for THIS rider's vehicle class (and company rates, if any), so
    -- the number on the card is the number the ride is booked at.
    public.mbg_price_ride_for_rider(r, v_distance_km, v_multiplier),
    v_distance_km,
    v_multiplier,
    CASE WHEN r.admin_verified_at IS NOT NULL THEN bp.business_name::TEXT ELSE NULL END,
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
  -- (column 14) and admin-verified store driver (column 19) only break ties
  -- among comparably-close riders, then rating.
  ORDER BY dist.km ASC NULLS LAST, 14 DESC, 19 DESC, r.rating DESC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_find_available_riders(
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN, UUID[], INT, TEXT[], UUID
) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. mbg_request_ride — same as ADD_ICANERA_UNIFIED_PLATFORM_FEE.sql (same
--    18-param signature) except the fare comes from mbg_price_ride_for_rider.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mbg_request_ride(
  p_service_type TEXT,
  p_delivery_mode TEXT,
  p_supermarket_id UUID,
  p_rider_id UUID,
  p_pickup_location TEXT, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_location TEXT, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_power_type_requested TEXT,
  p_umbrella_requested BOOLEAN,
  p_order_notes TEXT DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'wallet',
  p_cart JSONB DEFAULT NULL,
  p_max_delivery_hours NUMERIC DEFAULT NULL,
  p_expense_classification TEXT DEFAULT NULL,
  p_customer_business_profile_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_customer_id UUID;
  v_rider public.mbg_riders%ROWTYPE;
  v_stage_id UUID;
  v_distance_km NUMERIC;
  v_multiplier NUMERIC := public.mbg_current_time_multiplier();
  v_fare NUMERIC;
  v_is_boda BOOLEAN;
  v_platform_net NUMERIC;
  v_rider_earning NUMERIC;
  v_chair_total NUMERIC;
  v_ride_id UUID;
  v_cart_item JSONB;
  v_cart_qty NUMERIC;
  v_min_deadline_hours NUMERIC;
  v_max_deadline_hours NUMERIC;
  v_expense_classification TEXT;
  v_customer_business_profile_id UUID;
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
  IF p_payment_method NOT IN ('wallet', 'cash') THEN
    RAISE EXCEPTION 'Invalid payment_method: %', p_payment_method;
  END IF;

  v_expense_classification := CASE
    WHEN p_service_type = 'delivery' THEN COALESCE(p_expense_classification, 'personal_expense')
    ELSE NULL
  END;

  v_customer_business_profile_id := CASE
    WHEN p_service_type = 'delivery' AND v_expense_classification = 'business_expense' THEN p_customer_business_profile_id
    ELSE NULL
  END;

  IF p_delivery_mode = 'supermarket' THEN
    IF p_cart IS NULL OR jsonb_typeof(p_cart) <> 'array' OR jsonb_array_length(p_cart) = 0 THEN
      RAISE EXCEPTION 'Pick at least one item from the store to request a delivery';
    END IF;
    FOR v_cart_item IN SELECT * FROM jsonb_array_elements(p_cart) LOOP
      v_cart_qty := (v_cart_item->>'quantity')::NUMERIC;
      IF v_cart_qty IS NULL OR v_cart_qty <= 0 THEN
        RAISE EXCEPTION 'Invalid quantity for product %', v_cart_item->>'product_id';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.products p
        WHERE p.id = (v_cart_item->>'product_id')::UUID
          AND p.supermarket_id = p_supermarket_id
          AND (p.is_active IS NULL OR p.is_active = TRUE)
      ) THEN
        RAISE EXCEPTION 'Product % is not available from this store', v_cart_item->>'product_id';
      END IF;
    END LOOP;

    v_min_deadline_hours := public.mbg_get_setting_numeric('delivery.min_deadline_hours', 1);
    v_max_deadline_hours := public.mbg_get_setting_numeric('delivery.max_deadline_hours', 48);
    IF p_max_delivery_hours IS NULL THEN
      RAISE EXCEPTION 'Choose a maximum delivery time for this order';
    END IF;
    IF p_max_delivery_hours < v_min_deadline_hours OR p_max_delivery_hours > v_max_deadline_hours THEN
      RAISE EXCEPTION 'Delivery window must be between % and % hours', v_min_deadline_hours, v_max_deadline_hours;
    END IF;
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
  IF EXISTS (SELECT 1 FROM public.mbg_rides WHERE rider_id = p_rider_id AND status = 'pending') THEN
    RAISE EXCEPTION 'Selected rider already has a request awaiting their response — try again in a moment or pick another rider';
  END IF;

  v_distance_km := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  IF v_distance_km IS NULL THEN
    RAISE EXCEPTION 'Invalid pickup/dropoff coordinates';
  END IF;

  -- The fare depends on what is actually driving: a boda, car, van or truck
  -- each has its own rate card (mbg_vehicle_fare_rates), a company's own rates
  -- win over it, and the rider's mode (vip/discount/return) applies on top.
  v_fare := public.mbg_price_ride_for_rider(v_rider, v_distance_km, v_multiplier);

  v_is_boda := v_rider.vehicle_type::TEXT IN ('motorcycle', 'bicycle', 'tuktuk');

  -- rider_earning is the ONE number the rider is shown and the exact amount
  -- they keep; the chairperson share and ICANera's net are recorded for
  -- reporting. All of the arithmetic (who fronts what, personal vs company
  -- rider) lives in mbg_compute_ride_split so it can't drift between here and
  -- the company-pricing trigger.
  SELECT s.o_rider_earning, s.o_chair_total, s.o_platform_net
    INTO v_rider_earning, v_chair_total, v_platform_net
    FROM public.mbg_compute_ride_split(
      v_fare, v_is_boda, v_rider.business_profile_id IS NOT NULL, p_payment_method
    ) s;

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
    time_multiplier, rider_earning, chairperson_commission_total,
    order_notes, payment_method, cart, max_delivery_hours, expense_classification,
    customer_business_profile_id
  ) VALUES (
    v_customer_id, p_rider_id, v_stage_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(v_distance_km / 25 * 60)), v_fare,
    p_service_type, p_delivery_mode, p_supermarket_id,
    p_power_type_requested, COALESCE(p_umbrella_requested, false),
    v_multiplier, v_rider_earning, v_chair_total,
    p_order_notes, p_payment_method, p_cart, p_max_delivery_hours, v_expense_classification,
    v_customer_business_profile_id
  ) RETURNING id, fare, rider_earning INTO v_ride_id, v_fare, v_rider_earning;

  -- A company rider's own pricing (trg_mbg_apply_business_pricing) can change
  -- the fare and split as the row is written, so the fee record and the
  -- response below use what was actually stored, not the pre-insert numbers.
  SELECT s.o_platform_net INTO v_platform_net
    FROM public.mbg_compute_ride_split(
      v_fare, v_is_boda, v_rider.business_profile_id IS NOT NULL, p_payment_method
    ) s;

  -- ICANera's expected net: the whole pool minus what the chairpersons take.
  INSERT INTO public.mbg_ride_platform_fees (ride_id, platform_fee_ugx) VALUES (v_ride_id, v_platform_net);

  RETURN jsonb_build_object(
    'success', true, 'ride_id', v_ride_id, 'fare', v_fare,
    'distance_km', v_distance_km, 'rider_earning', v_rider_earning
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, JSONB, NUMERIC, TEXT, UUID
) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Company-pricing trigger function — same as ADD_JOURNEY_PREPAID_LEG_FARES.sql
--    (prepaid journey legs keep their fixed fare) except the recomputed fare
--    now falls back to the rider's vehicle-class rates, not the global ones.
--    The trigger itself already exists on mbg_rides.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_apply_business_pricing()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider public.mbg_riders%ROWTYPE;
  v_pricing public.mbg_business_pricing_settings%ROWTYPE;
  v_split RECORD;
BEGIN
  IF NEW.rider_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_rider FROM public.mbg_riders WHERE id = NEW.rider_id;
  IF v_rider.business_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_pricing FROM public.mbg_business_pricing_settings WHERE business_profile_id = v_rider.business_profile_id;
  IF FOUND
     AND NOT COALESCE(NEW.is_journey_prepaid, false)
     AND NEW.distance_km IS NOT NULL
     AND NOT (v_pricing.base_fare IS NULL AND v_pricing.per_km_rate IS NULL AND v_pricing.min_fare IS NULL) THEN
    -- The company's own rates win field by field; anything it left blank
    -- falls back to the rider's vehicle-class rate card (a company van falls
    -- back to the van rates, not the boda ones).
    NEW.fare := public.mbg_price_ride_for_rider(v_rider, NEW.distance_km, COALESCE(NEW.time_multiplier, 1));
  END IF;

  IF COALESCE(NEW.fare, 0) > 0 THEN
    SELECT * INTO v_split FROM public.mbg_compute_ride_split(
      NEW.fare,
      v_rider.vehicle_type::TEXT IN ('motorcycle', 'bicycle', 'tuktuk'),
      TRUE,
      NEW.payment_method
    );
    NEW.rider_earning := v_split.o_rider_earning;
    NEW.chairperson_commission_total := v_split.o_chair_total;
  END IF;

  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 9. Auto-dispatch ("Just Send") hands a still-pending ride to the next rider
--    by changing rider_id (mbg_sweep_auto_dispatch_cascade). With one fare for
--    every vehicle that was harmless; now the next rider may drive a different
--    class (Just Send with "Any" vehicle), so the ride is re-priced for the
--    rider who is now being offered it — fare, the rider's take-home and
--    ICANera's expected fee — before the new rider sees it. Prepaid journey
--    legs keep their fixed fare.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_reprice_ride_on_rider_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rider public.mbg_riders%ROWTYPE;
  v_split RECORD;
BEGIN
  IF NEW.rider_id IS NULL
     OR NEW.status <> 'pending'
     OR COALESCE(NEW.dispatch_mode, 'direct') <> 'auto'
     OR COALESCE(NEW.is_journey_prepaid, false)
     OR NEW.distance_km IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_rider FROM public.mbg_riders WHERE id = NEW.rider_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  NEW.fare := public.mbg_price_ride_for_rider(v_rider, NEW.distance_km, COALESCE(NEW.time_multiplier, 1));

  SELECT * INTO v_split FROM public.mbg_compute_ride_split(
    NEW.fare,
    v_rider.vehicle_type::TEXT IN ('motorcycle', 'bicycle', 'tuktuk'),
    v_rider.business_profile_id IS NOT NULL,
    NEW.payment_method
  );
  NEW.rider_earning := v_split.o_rider_earning;
  NEW.chairperson_commission_total := v_split.o_chair_total;

  UPDATE public.mbg_ride_platform_fees SET platform_fee_ugx = v_split.o_platform_net WHERE ride_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mbg_reprice_ride_on_rider_change ON public.mbg_rides;
CREATE TRIGGER trg_mbg_reprice_ride_on_rider_change
  BEFORE UPDATE OF rider_id ON public.mbg_rides
  FOR EACH ROW
  WHEN (OLD.rider_id IS DISTINCT FROM NEW.rider_id)
  EXECUTE FUNCTION public.mbg_reprice_ride_on_rider_change();

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Vehicle-class fares ready — Boda/Car/Van/Truck each price from mbg_vehicle_fare_rates (edit in Developer Dashboard > Commissions); van/truck add a loading fee and a cheaper long-haul per-km tier; boda stays on the global ride.* rates until set.';
END $$;
