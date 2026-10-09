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
-- VAN and TRUCK are freight, and are priced the way freight is priced:
--   · in USD from real-world yardsticks — a per-km line-haul rate plus a
--     per-tonne-km rate for the weight actually carried — converted to UGX at the
--     LIVE icaneracoin price (so the fare follows the real exchange rate and the
--     coin's inflation floor);
--   · by what is being moved: a handling class (standard / fragile /
--     refrigerated / hazardous) multiplies the fare, like freight accessorials;
--   · by quality: a developer-marked Premium truck tier, and a small premium for
--     highly rated drivers (4.5+ and 4.8+);
--   · only vehicles that can carry the declared weight are offered for it.
--   The customer enters the cargo weight and handling class when booking a van
--   or truck. The multiple-of-boda rates remain the class's minimum fare, and
--   the price for a company that sets its own rates.
--
-- Who sees what:
--   · customers  — mbg_quote_vehicle_classes() prices the SAME trip for every
--                  class side by side (with how many are online), and each
--                  rider card shows the fare for that rider's own vehicle;
--   · riders     — the rates for their class are shown on their dashboard
--                  (through mbg_quote_vehicle_classes), so they know what a trip
--                  pays before they accept;
--   · the multiples (car 2.5x, van 5x, truck 10x), the handling multipliers, the
--                  premium tier and the rating premiums are internal pricing knobs:
--                  customers and riders see the resulting prices and rates, never
--                  the multiples. The tables are locked to developers; everyone
--                  else reads only the resolved numbers through the quote function;
--   · companies  — a transport company's own base / per-km / minimum
--                  (mbg_business_pricing_settings) still win, field by field;
--                  anything it left blank falls back to the rider's CLASS
--                  rates (a company van falls back to van rates).
--
-- ONE function prices a ride — mbg_price_ride_for_rider — and every place that
-- shows or books a fare calls it, so the quote can never disagree with the
-- charge:
--   mbg_find_available_riders   (the fare on each rider card; also drops riders
--                                that can't carry the declared weight)
--   mbg_request_ride            (the fare the ride is booked at; stores the cargo)
--   mbg_request_company_ride    (passes the cargo through to mbg_request_ride)
--   mbg_apply_business_pricing  (company-pricing trigger on mbg_rides)
--   mbg_reprice_ride_on_rider_change (auto-dispatch hands a pending ride to a
--                                      different rider: it is re-priced for them)
--   mbg_sweep_auto_dispatch_cascade  (keeps the cargo weight/class when it
--                                      searches for the next rider)
--
-- NOT touched: the cargo family (cargo.* settings) — cross-border delivery,
-- ship/sea cargo and journey legs. Those are separate products with their own
-- quote + charge functions and stay on cargo.* until they are moved over
-- deliberately.
--
-- Needs the icaneracoin price engine (ican_get_price_in_currency) in the same
-- database for the live rate; without it freight falls back to the
-- freight.fallback_ugx_per_usd setting.
--
-- Run after ADD_ICANERA_UNIFIED_PLATFORM_FEE.sql (mbg_compute_ride_split),
-- FIX_MBG_FIND_AVAILABLE_RIDERS_VARCHAR_MISMATCH.sql (latest mbg_find_available_riders),
-- ADD_JOURNEY_PREPAID_LEG_FARES.sql (is_journey_prepaid + latest pricing
-- trigger), ADD_AUTO_DISPATCH_CASCADE.sql and COMPANY_WORKER_TRANSPORT_WALLET.sql.
-- Safe to re-run.
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
  -- Freight (van / truck) benchmark in USD, converted at the live icaneracoin
  -- price. NULL usd_per_km = not a freight class (boda, car): priced locally.
  usd_base_fare NUMERIC(12,4) CHECK (usd_base_fare IS NULL OR usd_base_fare >= 0),
  usd_per_km NUMERIC(12,4) CHECK (usd_per_km IS NULL OR usd_per_km >= 0),
  usd_per_ton_km NUMERIC(12,4) CHECK (usd_per_ton_km IS NULL OR usd_per_ton_km >= 0),
  usd_min_fare NUMERIC(12,4) CHECK (usd_min_fare IS NULL OR usd_min_fare >= 0),
  usd_loading_fee NUMERIC(12,4) CHECK (usd_loading_fee IS NULL OR usd_loading_fee >= 0),
  -- What this class can carry when a rider hasn't registered their own capacity.
  default_capacity_kg NUMERIC(10,2) CHECK (default_capacity_kg IS NULL OR default_capacity_kg > 0),
  sort_order INT NOT NULL DEFAULT 0,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mbg_vehicle_fare_rates_long_haul_pair
    CHECK ((long_haul_after_km IS NULL) = (long_haul_per_km_rate IS NULL))
);

-- The table may already exist from the first version of this migration.
ALTER TABLE public.mbg_vehicle_fare_rates
  ADD COLUMN IF NOT EXISTS rate_multiplier NUMERIC(6,2) NOT NULL DEFAULT 1 CHECK (rate_multiplier > 0);

-- ...and from the freight version: add its columns and seed them ONCE (the first
-- time the columns appear), so a developer who later clears a freight rate is not
-- overridden by a re-run.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mbg_vehicle_fare_rates' AND column_name = 'usd_per_km'
  ) THEN
    ALTER TABLE public.mbg_vehicle_fare_rates
      ADD COLUMN usd_base_fare NUMERIC(12,4) CHECK (usd_base_fare IS NULL OR usd_base_fare >= 0),
      ADD COLUMN usd_per_km NUMERIC(12,4) CHECK (usd_per_km IS NULL OR usd_per_km >= 0),
      ADD COLUMN usd_per_ton_km NUMERIC(12,4) CHECK (usd_per_ton_km IS NULL OR usd_per_ton_km >= 0),
      ADD COLUMN usd_min_fare NUMERIC(12,4) CHECK (usd_min_fare IS NULL OR usd_min_fare >= 0),
      ADD COLUMN usd_loading_fee NUMERIC(12,4) CHECK (usd_loading_fee IS NULL OR usd_loading_fee >= 0),
      ADD COLUMN default_capacity_kg NUMERIC(10,2) CHECK (default_capacity_kg IS NULL OR default_capacity_kg > 0);

    UPDATE public.mbg_vehicle_fare_rates SET default_capacity_kg = 30    WHERE vehicle_type = 'motorcycle';
    UPDATE public.mbg_vehicle_fare_rates SET default_capacity_kg = 15    WHERE vehicle_type = 'bicycle';
    UPDATE public.mbg_vehicle_fare_rates SET default_capacity_kg = 200   WHERE vehicle_type = 'tuktuk';
    UPDATE public.mbg_vehicle_fare_rates SET default_capacity_kg = 300   WHERE vehicle_type = 'car';
    UPDATE public.mbg_vehicle_fare_rates SET default_capacity_kg = 1500,
      usd_base_fare = 6,  usd_per_km = 0.45, usd_per_ton_km = 0.12,  usd_min_fare = 12, usd_loading_fee = 6   WHERE vehicle_type = 'van';
    UPDATE public.mbg_vehicle_fare_rates SET default_capacity_kg = 10000,
      usd_base_fare = 25, usd_per_km = 0.60, usd_per_ton_km = 0.045, usd_min_fare = 45, usd_loading_fee = 20  WHERE vehicle_type = 'truck';
  END IF;
END $$;

-- The cargo a customer declares travels with the ride.
ALTER TABLE public.mbg_rides
  ADD COLUMN IF NOT EXISTS cargo_weight_kg NUMERIC(10,2) CHECK (cargo_weight_kg IS NULL OR cargo_weight_kg > 0),
  ADD COLUMN IF NOT EXISTS cargo_class TEXT;

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
-- Van / truck freight benchmark (USD), roughly:
--   van   — a cargo van: ~US$0.45/km line-haul (≈ US$0.7/mile), US$0.12 per tonne-km, US$6 base, US$6 loading
--   truck — a freight truck: ~US$0.60/km line-haul + US$0.045 per tonne-km (typical African / EU road
--           freight is US$0.04–0.10 per tonne-km), US$25 base, US$20 loading
-- Developer-editable (Commissions tab -> Fare rates by vehicle); these are starting points.
INSERT INTO public.mbg_vehicle_fare_rates
  (vehicle_type, label, rate_multiplier, base_fare, per_km_rate, min_fare, loading_fee, long_haul_after_km, long_haul_per_km_rate,
   usd_base_fare, usd_per_km, usd_per_ton_km, usd_min_fare, usd_loading_fee, default_capacity_kg, sort_order)
VALUES
  ('motorcycle', 'Boda',     1, NULL, NULL, NULL,     0, NULL, NULL, NULL, NULL,  NULL, NULL, NULL,    30, 1),
  ('bicycle',    'Bicycle',  1, NULL, NULL, NULL,     0, NULL, NULL, NULL, NULL,  NULL, NULL, NULL,    15, 2),
  ('tuktuk',     'Tuktuk',   1, NULL, NULL, NULL,     0, NULL, NULL, NULL, NULL,  NULL, NULL, NULL,   200, 3),
  ('car',        'Car',    2.5, NULL, NULL, NULL,     0,   60, 2000, NULL, NULL,  NULL, NULL, NULL,   300, 4),
  ('van',        'Van',      5, NULL, NULL, NULL,  5000,   50, 3500,    6, 0.45,  0.12,   12,    6,  1500, 5),
  ('truck',      'Truck',   10, NULL, NULL, NULL, 10000,   80, 7000,   25, 0.60, 0.045,   45,   20, 10000, 6)
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
-- 2b. Freight building blocks for the load-carrying classes (van, truck).
--
-- Real freight is not priced like a taxi. The usual industry yardsticks are a
-- per-distance line-haul rate (US truckload is quoted per mile; most of the
-- world per km), a per-tonne-km rate for what is actually carried, and
-- accessorial charges for special handling (refrigerated, hazardous, fragile).
-- Van and truck are therefore priced in USD from those yardsticks and
-- converted to UGX at the LIVE icaneracoin price (ICAN is the platform's stable
-- unit — the same live price a user sees on their wallet badge), so the UGX
-- fare follows the real exchange rate and the coin's inflation floor instead of
-- a number that goes stale. The class's local minimum fare (its multiple of the
-- boda minimum) stays as the floor under a very short or very light trip.
-- ----------------------------------------------------------------------------

-- Percentages live in the settings table so the Commissions tab edits them.
INSERT INTO public.mbg_platform_settings (key, value, value_type, description, category, is_public) VALUES
  ('freight.fallback_ugx_per_usd', '3700', 'number',
   'UGX per 1 USD used for van/truck freight pricing ONLY if the live icaneracoin price cannot be read. Normally unused.',
   'freight', false),
  ('freight.premium_tier_surcharge_pct', '15', 'number',
   'Percent added to a van/truck fare when the vehicle is marked Premium tier by a developer (newer, covered or box body, tracked).',
   'commission', false),
  ('freight.rating_premium_good_pct', '3', 'number',
   'Percent added to a van/truck fare when the driver is rated 4.5 or higher.',
   'commission', false),
  ('freight.rating_premium_top_pct', '6', 'number',
   'Percent added to a van/truck fare when the driver is rated 4.8 or higher.',
   'commission', false)
ON CONFLICT (key) DO NOTHING;

-- What the customer is moving. Each handling class multiplies the van/truck fare.
CREATE TABLE IF NOT EXISTS public.mbg_cargo_classes (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  description TEXT,
  price_multiplier NUMERIC(5,2) NOT NULL DEFAULT 1 CHECK (price_multiplier > 0),
  sort_order INT NOT NULL DEFAULT 0,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mbg_cargo_classes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mbg_cargo_classes FROM PUBLIC, anon, authenticated;

INSERT INTO public.mbg_cargo_classes (code, label, description, price_multiplier, sort_order) VALUES
  ('standard',     'Standard',     'Boxed or palletised goods, no special care',            1.00, 1),
  ('fragile',      'Fragile',      'Glass, electronics, furniture — careful handling',      1.20, 2),
  ('refrigerated', 'Refrigerated', 'Perishable or temperature-controlled goods',            1.35, 3),
  ('hazardous',    'Hazardous',    'Fuel, chemicals, gas — dangerous-goods handling',       1.60, 4)
ON CONFLICT (code) DO NOTHING;

-- Truck quality tier: marked by a developer, never by the driver themself (a
-- driver can edit their own mbg_riders row, so the tier lives in its own locked table).
CREATE TABLE IF NOT EXISTS public.mbg_vehicle_tiers (
  rider_id UUID PRIMARY KEY REFERENCES public.mbg_riders(id) ON DELETE CASCADE,
  tier TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('standard', 'premium')),
  set_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  set_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.mbg_vehicle_tiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mbg_vehicle_tiers FROM PUBLIC, anon, authenticated;

-- How much a rider can carry: their own registered capacity if they gave one,
-- otherwise the class default (so a van that never filled in a capacity is not
-- excluded from every weighted search, and a boda is not offered a 5 tonne load).
CREATE OR REPLACE FUNCTION public.mbg_effective_capacity_kg(p_rider public.mbg_riders)
RETURNS NUMERIC LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT COALESCE(
    p_rider.cargo_capacity_kg,
    (SELECT f.default_capacity_kg FROM public.mbg_vehicle_fare_rates f WHERE f.vehicle_type = p_rider.vehicle_type::TEXT)
  );
$$;
REVOKE ALL ON FUNCTION public.mbg_effective_capacity_kg(public.mbg_riders) FROM PUBLIC;

-- UGX per 1 USD at the LIVE icaneracoin price: the coin's UGX price divided by
-- its USD price. That UGX price already carries the coin's inflation floor, so
-- freight priced in USD keeps its real value in UGX. Falls back to a setting
-- only if the price engine can't be read, so a ride can still be booked.
CREATE OR REPLACE FUNCTION public.mbg_usd_to_ugx_rate()
RETURNS NUMERIC LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ugx NUMERIC;
  v_usd NUMERIC;
BEGIN
  BEGIN
    SELECT p.price_local, p.price_usd INTO v_ugx, v_usd
    FROM public.ican_get_price_in_currency('UGX') p LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_ugx := NULL;
    v_usd := NULL;
  END;

  IF COALESCE(v_ugx, 0) > 0 AND COALESCE(v_usd, 0) > 0 THEN
    RETURN v_ugx / v_usd;
  END IF;
  RETURN public.mbg_get_setting_numeric('freight.fallback_ugx_per_usd', 3700);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_usd_to_ugx_rate() FROM PUBLIC;

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
-- mbg_vehicle_fare — raw fare for a vehicle class over a distance. Two models:
--
--   LOCAL (boda, car — and the class's own minimum fare for van/truck):
--     GREATEST(min, base + distance charge) * time-of-day multiplier + loading fee
--     where the distance charge is per_km * km, or, past the long-haul threshold,
--     per_km * threshold + long_haul_rate * (km - threshold). A transport
--     company's own base / per-km / minimum replace the class's, field by field.
--     For boda this is exactly the old GREATEST(min, base + km * per_km) * multiplier.
--
--   FREIGHT (van, truck — classes with a USD per-km rate):
--     USD line-haul = GREATEST(usd_min, usd_base + effective_km * (usd_per_km + tonnes * usd_per_ton_km))
--       effective_km counts distance past the long-haul threshold at the long-haul
--       discount (long-haul per-km rate / per-km rate), as freight rates do
--     UGX = (line-haul * live UGX-per-USD * time multiplier) + loading fee in UGX
--     fare = GREATEST(the class's minimum fare, FREIGHT fare)
--            * handling class (standard / fragile / refrigerated / hazardous)
--            * premium-tier surcharge * driver-rating premium
--     UGX-per-USD is the live icaneracoin price (mbg_usd_to_ugx_rate).
--     A company that set its own rates replaces the benchmark (and weight): its
--     LOCAL fare is used, with only the handling class applied on top.
--
-- Not rounded and no rider mode applied — see mbg_price_ride_for_rider.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mbg_vehicle_fare(TEXT, NUMERIC, NUMERIC, UUID);

CREATE OR REPLACE FUNCTION public.mbg_vehicle_fare(
  p_vehicle_type TEXT,
  p_distance_km NUMERIC,
  p_multiplier NUMERIC DEFAULT 1,
  p_business_profile_id UUID DEFAULT NULL,
  p_cargo_weight_kg NUMERIC DEFAULT NULL,
  p_cargo_class TEXT DEFAULT NULL,
  p_rating NUMERIC DEFAULT NULL,
  p_tier TEXT DEFAULT 'standard',
  p_ugx_per_usd NUMERIC DEFAULT NULL
)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  r RECORD;
  c public.mbg_business_pricing_settings%ROWTYPE;
  f public.mbg_vehicle_fare_rates%ROWTYPE;
  v_base NUMERIC;
  v_per_km NUMERIC;
  v_min NUMERIC;
  v_loading NUMERIC;
  v_after NUMERIC;
  v_long_rate NUMERIC;
  v_km NUMERIC := GREATEST(COALESCE(p_distance_km, 0), 0);
  v_distance_charge NUMERIC;
  v_local NUMERIC;
  v_company_priced BOOLEAN := false;
  v_class_mult NUMERIC;
  v_tons NUMERIC := GREATEST(COALESCE(p_cargo_weight_kg, 0), 0) / 1000;
  v_ratio NUMERIC := 1;
  v_effective_km NUMERIC;
  v_usd_line NUMERIC;
  v_rate NUMERIC;
  v_freight NUMERIC;
  v_tier_mult NUMERIC := 1;
  v_rating_pct NUMERIC := 0;
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
      v_company_priced := (c.base_fare IS NOT NULL OR c.per_km_rate IS NOT NULL OR c.min_fare IS NOT NULL);
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
  v_local := GREATEST(v_min, v_base + v_distance_charge) * COALESCE(p_multiplier, 1) + v_loading;

  -- Boda, car, and any class without USD freight rates: the local fare.
  SELECT * INTO f FROM public.mbg_vehicle_fare_rates WHERE vehicle_type = p_vehicle_type;
  IF NOT FOUND OR f.usd_per_km IS NULL THEN
    RETURN v_local;
  END IF;

  v_class_mult := COALESCE(
    (SELECT m.price_multiplier FROM public.mbg_cargo_classes m WHERE m.code = COALESCE(p_cargo_class, 'standard')), 1);

  -- A company that set its own rates prices its own freight.
  IF v_company_priced THEN
    RETURN v_local * v_class_mult;
  END IF;

  IF v_after IS NOT NULL AND v_long_rate IS NOT NULL AND v_per_km > 0 THEN
    v_ratio := LEAST(1, v_long_rate / v_per_km);
  END IF;
  v_effective_km := LEAST(v_km, COALESCE(v_after, v_km)) + GREATEST(v_km - COALESCE(v_after, v_km), 0) * v_ratio;

  v_usd_line := GREATEST(
    COALESCE(f.usd_min_fare, 0),
    COALESCE(f.usd_base_fare, 0) + v_effective_km * (f.usd_per_km + v_tons * COALESCE(f.usd_per_ton_km, 0))
  );
  v_rate := COALESCE(p_ugx_per_usd, public.mbg_usd_to_ugx_rate());
  v_freight := v_usd_line * v_rate * COALESCE(p_multiplier, 1) + COALESCE(f.usd_loading_fee, 0) * v_rate;

  IF p_tier = 'premium' THEN
    v_tier_mult := 1 + public.mbg_get_setting_numeric('freight.premium_tier_surcharge_pct', 15) / 100;
  END IF;
  IF COALESCE(p_rating, 0) >= 4.8 THEN
    v_rating_pct := public.mbg_get_setting_numeric('freight.rating_premium_top_pct', 6);
  ELSIF COALESCE(p_rating, 0) >= 4.5 THEN
    v_rating_pct := public.mbg_get_setting_numeric('freight.rating_premium_good_pct', 3);
  END IF;

  RETURN GREATEST(v_min, v_freight) * v_class_mult * v_tier_mult * (1 + v_rating_pct / 100);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_vehicle_fare(TEXT, NUMERIC, NUMERIC, UUID, NUMERIC, TEXT, NUMERIC, TEXT, NUMERIC) FROM PUBLIC;

-- mbg_price_ride_for_rider — the number a customer pays for one specific
-- rider: the rider's vehicle class, company rates, tier and rating, the cargo
-- being moved, then the rider's own mode (vip surcharge / discount / return
-- discount), rounded to 100 UGX. p_ugx_per_usd lets a search that prices many
-- riders read the live coin price once instead of once per rider.
DROP FUNCTION IF EXISTS public.mbg_price_ride_for_rider(public.mbg_riders, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.mbg_price_ride_for_rider(
  p_rider public.mbg_riders,
  p_distance_km NUMERIC,
  p_multiplier NUMERIC DEFAULT 1,
  p_cargo_weight_kg NUMERIC DEFAULT NULL,
  p_cargo_class TEXT DEFAULT NULL,
  p_ugx_per_usd NUMERIC DEFAULT NULL
)
RETURNS NUMERIC LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_fare NUMERIC;
  v_tier TEXT;
BEGIN
  SELECT t.tier INTO v_tier FROM public.mbg_vehicle_tiers t WHERE t.rider_id = p_rider.id;

  v_fare := public.mbg_vehicle_fare(
    p_rider.vehicle_type::TEXT, p_distance_km, p_multiplier, p_rider.business_profile_id,
    p_cargo_weight_kg, p_cargo_class, p_rider.rating, COALESCE(v_tier, 'standard'), p_ugx_per_usd
  );

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
REVOKE ALL ON FUNCTION public.mbg_price_ride_for_rider(public.mbg_riders, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 5. Customer + developer facing.
--
-- mbg_quote_vehicle_classes — the same trip (and the same cargo, if any)
-- priced for every class, so a customer can compare "Boda · Car · Van · Truck"
-- and see how many of each are online and able to carry the load BEFORE
-- choosing. Base class price: no rider mode, company rates, tier or rating
-- (those apply to a specific rider, shown on that rider's card). For van/truck
-- it also returns the live UGX-equivalent freight rates so a rate line can be
-- shown. Callable without signing in, like mbg_estimate_fare.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mbg_quote_vehicle_classes(NUMERIC, NUMERIC, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.mbg_quote_vehicle_classes(
  p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_cargo_weight_kg NUMERIC DEFAULT NULL,
  p_cargo_class TEXT DEFAULT NULL
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
  available_riders INTEGER,
  freight_priced BOOLEAN,
  freight_base_ugx NUMERIC,
  freight_per_km_ugx NUMERIC,
  freight_per_ton_km_ugx NUMERIC,
  freight_min_ugx NUMERIC,
  freight_loading_ugx NUMERIC,
  can_carry BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ctx AS (
    SELECT public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng) AS km,
           public.mbg_current_time_multiplier() AS mult,
           public.mbg_usd_to_ugx_rate() AS rate
  )
  SELECT
    v.vehicle_type,
    v.label,
    ROUND(public.mbg_vehicle_fare(
      v.vehicle_type, ctx.km, ctx.mult, NULL, p_cargo_weight_kg, p_cargo_class, NULL, 'standard', ctx.rate
    ) / 100) * 100,
    ctx.km,
    ctx.mult,
    rt.o_base_fare, rt.o_per_km_rate, rt.o_min_fare, rt.o_loading_fee,
    rt.o_long_haul_after_km, rt.o_long_haul_per_km_rate,
    (SELECT count(*)::INTEGER FROM public.mbg_riders mr
      WHERE mr.vehicle_type::TEXT = v.vehicle_type AND mr.status = 'active' AND mr.is_available = true
        AND (COALESCE(p_cargo_weight_kg, 0) <= 0 OR public.mbg_effective_capacity_kg(mr) >= p_cargo_weight_kg)),
    v.usd_per_km IS NOT NULL,
    ROUND(v.usd_base_fare * ctx.rate),
    ROUND(v.usd_per_km * ctx.rate),
    ROUND(v.usd_per_ton_km * ctx.rate),
    ROUND(v.usd_min_fare * ctx.rate),
    ROUND(v.usd_loading_fee * ctx.rate),
    (COALESCE(p_cargo_weight_kg, 0) <= 0
      OR COALESCE(v.default_capacity_kg, 0) >= p_cargo_weight_kg
      OR EXISTS (SELECT 1 FROM public.mbg_riders mr
                  WHERE mr.vehicle_type::TEXT = v.vehicle_type AND mr.status = 'active' AND mr.is_available = true
                    AND public.mbg_effective_capacity_kg(mr) >= p_cargo_weight_kg))
  FROM ctx
  CROSS JOIN public.mbg_vehicle_fare_rates v
  CROSS JOIN LATERAL public.mbg_resolve_vehicle_rates(v.vehicle_type) rt
  WHERE ctx.km IS NOT NULL
  ORDER BY v.sort_order;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_quote_vehicle_classes(NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT) TO anon, authenticated;

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
-- class's multiple; a blank long-haul pair turns the long-haul tier off. A
-- blank USD per-km rate means the class is priced locally (no freight model).
DROP FUNCTION IF EXISTS public.mbg_dev_set_vehicle_fare_rate(TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION public.mbg_dev_set_vehicle_fare_rate(
  p_vehicle_type TEXT,
  p_rate_multiplier NUMERIC DEFAULT 1,
  p_base_fare NUMERIC DEFAULT NULL,
  p_per_km_rate NUMERIC DEFAULT NULL,
  p_min_fare NUMERIC DEFAULT NULL,
  p_loading_fee NUMERIC DEFAULT 0,
  p_long_haul_after_km NUMERIC DEFAULT NULL,
  p_long_haul_per_km_rate NUMERIC DEFAULT NULL,
  p_usd_base_fare NUMERIC DEFAULT NULL,
  p_usd_per_km NUMERIC DEFAULT NULL,
  p_usd_per_ton_km NUMERIC DEFAULT NULL,
  p_usd_min_fare NUMERIC DEFAULT NULL,
  p_usd_loading_fee NUMERIC DEFAULT NULL,
  p_default_capacity_kg NUMERIC DEFAULT NULL
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
     OR COALESCE(p_loading_fee, 0) < 0 OR COALESCE(p_long_haul_per_km_rate, 0) < 0
     OR COALESCE(p_usd_base_fare, 0) < 0 OR COALESCE(p_usd_per_km, 0) < 0 OR COALESCE(p_usd_per_ton_km, 0) < 0
     OR COALESCE(p_usd_min_fare, 0) < 0 OR COALESCE(p_usd_loading_fee, 0) < 0 THEN
    RAISE EXCEPTION 'fare amounts cannot be negative';
  END IF;
  IF (p_long_haul_after_km IS NULL) <> (p_long_haul_per_km_rate IS NULL) THEN
    RAISE EXCEPTION 'set both the long-haul distance and the long-haul per-km rate, or neither';
  END IF;
  IF p_long_haul_after_km IS NOT NULL AND p_long_haul_after_km <= 0 THEN
    RAISE EXCEPTION 'the long-haul distance must be more than 0 km';
  END IF;
  IF p_default_capacity_kg IS NOT NULL AND p_default_capacity_kg <= 0 THEN
    RAISE EXCEPTION 'the default capacity must be more than 0 kg';
  END IF;

  UPDATE public.mbg_vehicle_fare_rates
  SET rate_multiplier = p_rate_multiplier,
      base_fare = p_base_fare,
      per_km_rate = p_per_km_rate,
      min_fare = p_min_fare,
      loading_fee = COALESCE(p_loading_fee, 0),
      long_haul_after_km = p_long_haul_after_km,
      long_haul_per_km_rate = p_long_haul_per_km_rate,
      usd_base_fare = CASE WHEN p_usd_per_km IS NULL THEN NULL ELSE p_usd_base_fare END,
      usd_per_km = p_usd_per_km,
      usd_per_ton_km = CASE WHEN p_usd_per_km IS NULL THEN NULL ELSE p_usd_per_ton_km END,
      usd_min_fare = CASE WHEN p_usd_per_km IS NULL THEN NULL ELSE p_usd_min_fare END,
      usd_loading_fee = CASE WHEN p_usd_per_km IS NULL THEN NULL ELSE p_usd_loading_fee END,
      default_capacity_kg = p_default_capacity_kg,
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
GRANT EXECUTE ON FUNCTION public.mbg_dev_set_vehicle_fare_rate(
  TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC
) TO authenticated;

-- Handling classes (the multipliers are developer-only, like the vehicle multiples).
CREATE OR REPLACE FUNCTION public.mbg_dev_get_cargo_classes()
RETURNS SETOF public.mbg_cargo_classes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_users
    WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY SELECT * FROM public.mbg_cargo_classes ORDER BY sort_order;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dev_get_cargo_classes() TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_dev_set_cargo_class(p_code TEXT, p_price_multiplier NUMERIC)
RETURNS public.mbg_cargo_classes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.mbg_cargo_classes;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_users
    WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_price_multiplier IS NULL OR p_price_multiplier < 1 OR p_price_multiplier > 5 THEN
    RAISE EXCEPTION 'a handling multiple must be between 1 and 5';
  END IF;
  IF p_code = 'standard' AND p_price_multiplier <> 1 THEN
    RAISE EXCEPTION 'standard cargo is the baseline and stays at 1';
  END IF;

  UPDATE public.mbg_cargo_classes
  SET price_multiplier = p_price_multiplier, updated_by = auth.uid(), updated_at = now()
  WHERE code = p_code
  RETURNING * INTO v_row;

  IF v_row.code IS NULL THEN
    RAISE EXCEPTION 'unknown cargo class: %', p_code;
  END IF;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dev_set_cargo_class(TEXT, NUMERIC) TO authenticated;

-- Truck / van quality tier: a developer lists the freight drivers and marks the
-- premium vehicles. (Every column cast to the declared type — the real columns
-- are varchar and a RETURN QUERY does not coerce them.)
CREATE OR REPLACE FUNCTION public.mbg_dev_list_freight_riders()
RETURNS TABLE (
  rider_id UUID,
  full_name TEXT,
  vehicle_type TEXT,
  plate_number TEXT,
  rating NUMERIC,
  capacity_kg NUMERIC,
  business_name TEXT,
  tier TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_users
    WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    COALESCE(up.full_name, u.email, 'Driver')::TEXT,
    r.vehicle_type::TEXT,
    r.plate_number::TEXT,
    r.rating::NUMERIC,
    public.mbg_effective_capacity_kg(r)::NUMERIC,
    bp.business_name::TEXT,
    COALESCE(t.tier, 'standard')::TEXT
  FROM public.mbg_riders r
  JOIN public.mbg_vehicle_fare_rates f ON f.vehicle_type = r.vehicle_type::TEXT AND f.usd_per_km IS NOT NULL
  JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  LEFT JOIN public.business_profiles bp ON bp.id = r.business_profile_id
  LEFT JOIN public.mbg_vehicle_tiers t ON t.rider_id = r.id
  WHERE r.status = 'active'
  ORDER BY (COALESCE(t.tier, 'standard') = 'premium') DESC, r.vehicle_type::TEXT, COALESCE(up.full_name, u.email);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dev_list_freight_riders() TO authenticated;

CREATE OR REPLACE FUNCTION public.mbg_dev_set_rider_tier(p_rider_id UUID, p_tier TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_users
    WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  IF p_tier NOT IN ('standard', 'premium') THEN
    RAISE EXCEPTION 'tier must be standard or premium';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mbg_riders WHERE id = p_rider_id) THEN
    RAISE EXCEPTION 'rider not found';
  END IF;

  INSERT INTO public.mbg_vehicle_tiers (rider_id, tier, set_by, set_at)
  VALUES (p_rider_id, p_tier, auth.uid(), now())
  ON CONFLICT (rider_id) DO UPDATE SET tier = EXCLUDED.tier, set_by = auth.uid(), set_at = now();

  RETURN jsonb_build_object('success', true, 'rider_id', p_rider_id, 'tier', p_tier);
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_dev_set_rider_tier(UUID, TEXT) TO authenticated;


-- ----------------------------------------------------------------------------
-- 6. mbg_find_available_riders — same as FIX_MBG_FIND_AVAILABLE_RIDERS_VARCHAR_MISMATCH.sql
--    except each card's fare is priced for that rider's own vehicle class, tier,
--    rating and the declared cargo, and riders that cannot carry the load are left out.
-- ----------------------------------------------------------------------------
-- The cargo parameters change the signature, so the previous one is dropped first
-- (two overloads would make the call ambiguous for the app).
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
  p_business_profile_id UUID DEFAULT NULL,
  p_cargo_weight_kg NUMERIC DEFAULT NULL,
  p_cargo_class TEXT DEFAULT NULL
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
  -- The live icaneracoin price is read once here (not once per rider), and only
  -- when a freight class (van / truck) could be among the results.
  v_ugx_per_usd NUMERIC := CASE
    WHEN p_vehicle_types IS NULL OR p_vehicle_types && ARRAY['van', 'truck'] THEN public.mbg_usd_to_ugx_rate()
  END;
BEGIN
  IF v_distance_km IS NULL THEN
    RAISE EXCEPTION 'Invalid pickup/dropoff coordinates';
  END IF;
  IF COALESCE(p_cargo_weight_kg, 0) < 0 THEN
    RAISE EXCEPTION 'Cargo weight cannot be negative';
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
    -- Priced for THIS rider's vehicle class, tier, rating, company rates and the
    -- cargo, so the number on the card is the number the ride is booked at.
    public.mbg_price_ride_for_rider(r, v_distance_km, v_multiplier, p_cargo_weight_kg, p_cargo_class, v_ugx_per_usd),
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
    -- Only vehicles that can actually carry the declared load.
    AND (COALESCE(p_cargo_weight_kg, 0) <= 0 OR public.mbg_effective_capacity_kg(r) >= p_cargo_weight_kg)
  -- Nearest rider first (real GPS/home distance); "knows this destination"
  -- (column 14) and admin-verified store driver (column 19) only break ties
  -- among comparably-close riders, then rating.
  ORDER BY dist.km ASC NULLS LAST, 14 DESC, 19 DESC, r.rating DESC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_find_available_riders(
  NUMERIC, NUMERIC, NUMERIC, NUMERIC, TEXT, TEXT, BOOLEAN, UUID[], INT, TEXT[], UUID, NUMERIC, TEXT
) TO authenticated;
-- ----------------------------------------------------------------------------
-- 7. mbg_request_ride — same as ADD_ICANERA_UNIFIED_PLATFORM_FEE.sql
--    except it takes the cargo (weight + handling class), checks the vehicle can
--    carry it, stores it on the ride, and prices through mbg_price_ride_for_rider.
-- ----------------------------------------------------------------------------

-- The cargo parameters change the signature, so the previous one is dropped first.
-- (Its callers — the company-ride wrapper below, the escort flows — call it by
-- position with at most 14 arguments and keep working through the new defaults.)
DROP FUNCTION IF EXISTS public.mbg_request_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, JSONB, NUMERIC, TEXT, UUID
);

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
  p_customer_business_profile_id UUID DEFAULT NULL,
  p_cargo_weight_kg NUMERIC DEFAULT NULL,
  p_cargo_class TEXT DEFAULT NULL
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

  -- Cargo declared for a van / truck booking: a known handling class, and a
  -- load this vehicle can actually carry.
  IF COALESCE(p_cargo_weight_kg, 0) < 0 THEN
    RAISE EXCEPTION 'Cargo weight cannot be negative';
  END IF;
  IF p_cargo_class IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.mbg_cargo_classes WHERE code = p_cargo_class) THEN
    RAISE EXCEPTION 'Unknown cargo type: %', p_cargo_class;
  END IF;
  IF COALESCE(p_cargo_weight_kg, 0) > 0 AND public.mbg_effective_capacity_kg(v_rider) < p_cargo_weight_kg THEN
    RAISE EXCEPTION 'This vehicle cannot carry % kg — choose a larger vehicle', ROUND(p_cargo_weight_kg);
  END IF;

  v_distance_km := public.mbg_haversine_km(p_pickup_lat, p_pickup_lng, p_dropoff_lat, p_dropoff_lng);
  IF v_distance_km IS NULL THEN
    RAISE EXCEPTION 'Invalid pickup/dropoff coordinates';
  END IF;

  -- The fare depends on what is actually driving and what it is carrying: a
  -- boda, car, van and truck each have their own rates, van/truck add the cargo
  -- weight and handling class at the live icaneracoin price, a company's own
  -- rates win over the class rates, and the rider's mode applies on top.
  v_fare := public.mbg_price_ride_for_rider(v_rider, v_distance_km, v_multiplier, p_cargo_weight_kg, p_cargo_class);

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
    customer_business_profile_id, cargo_weight_kg, cargo_class
  ) VALUES (
    v_customer_id, p_rider_id, v_stage_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    'pending', v_distance_km, GREATEST(2, ROUND(v_distance_km / 25 * 60)), v_fare,
    p_service_type, p_delivery_mode, p_supermarket_id,
    p_power_type_requested, COALESCE(p_umbrella_requested, false),
    v_multiplier, v_rider_earning, v_chair_total,
    p_order_notes, p_payment_method, p_cart, p_max_delivery_hours, v_expense_classification,
    v_customer_business_profile_id, NULLIF(p_cargo_weight_kg, 0), COALESCE(p_cargo_class, 'standard')
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
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT, TEXT, JSONB, NUMERIC, TEXT, UUID,
  NUMERIC, TEXT
) TO authenticated;
-- ----------------------------------------------------------------------------
-- 7b. mbg_request_company_ride — same as COMPANY_WORKER_TRANSPORT_WALLET.sql
--    except it passes the cargo through to mbg_request_ride.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.mbg_request_company_ride(
  TEXT, TEXT, UUID, UUID, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, TEXT, BOOLEAN, TEXT
);

CREATE OR REPLACE FUNCTION public.mbg_request_company_ride(
  p_service_type TEXT, p_delivery_mode TEXT, p_supermarket_id UUID, p_rider_id UUID,
  p_pickup_location TEXT, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC,
  p_dropoff_location TEXT, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC,
  p_power_type_requested TEXT, p_umbrella_requested BOOLEAN,
  p_order_notes TEXT DEFAULT NULL,
  p_cargo_weight_kg NUMERIC DEFAULT NULL,
  p_cargo_class TEXT DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_benefit JSONB; v_result JSONB; v_ride_id UUID;
BEGIN
  v_benefit := public.mbg_get_company_transport_benefit();
  IF COALESCE((v_benefit->>'eligible')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'This Gmail account has no active company transport allocation';
  END IF;
  v_result := public.mbg_request_ride(
    p_service_type, p_delivery_mode, p_supermarket_id, p_rider_id,
    p_pickup_location, p_pickup_lat, p_pickup_lng,
    p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
    p_power_type_requested, p_umbrella_requested, p_order_notes, 'wallet',
    p_cargo_weight_kg => p_cargo_weight_kg, p_cargo_class => p_cargo_class
  );
  v_ride_id := NULLIF(v_result->>'ride_id','')::UUID;
  UPDATE public.mbg_rides
     SET payment_method = 'company',
         company_profile_id = NULLIF(v_benefit->>'business_profile_id','')::UUID,
         company_employee_user_id = auth.uid(),
         company_transport_allocation_id = NULLIF(v_benefit->>'allocation_id','')::UUID,
         company_billing_mode = COALESCE(v_benefit->>'billing_mode','per_ride')
   WHERE id = v_ride_id AND customer_id IN (
     SELECT id FROM public.mbg_customers WHERE user_id = auth.uid()
   );
  RETURN v_result || jsonb_build_object(
    'payment_method','company',
    'company_profile_id',v_benefit->>'business_profile_id',
    'billing_mode',v_benefit->>'billing_mode'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_request_company_ride(TEXT,TEXT,UUID,UUID,TEXT,NUMERIC,NUMERIC,TEXT,NUMERIC,NUMERIC,TEXT,BOOLEAN,TEXT,NUMERIC,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_request_company_ride(TEXT,TEXT,UUID,UUID,TEXT,NUMERIC,NUMERIC,TEXT,NUMERIC,NUMERIC,TEXT,BOOLEAN,TEXT,NUMERIC,TEXT) TO authenticated;
-- ----------------------------------------------------------------------------
-- 8. Company-pricing trigger function — same as ADD_JOURNEY_PREPAID_LEG_FARES.sql
--    (prepaid journey legs keep their fixed fare) except the recomputed fare now
--    falls back to the rider's vehicle-class rates and keeps the ride's cargo.
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
    NEW.fare := public.mbg_price_ride_for_rider(
      v_rider, NEW.distance_km, COALESCE(NEW.time_multiplier, 1), NEW.cargo_weight_kg, NEW.cargo_class
    );
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
-- 9. Auto-dispatch sweep — same as ADD_AUTO_DISPATCH_CASCADE.sql
--    except the search for the next rider carries the ride's cargo weight/class, so a
--    heavy load is never offered to a vehicle that cannot carry it. Its cron schedule
--    is unchanged.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE PROCEDURE public.mbg_sweep_auto_dispatch_cascade()
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tick INT;
  v_ride RECORD;
  v_next_rider UUID;
  v_new_declined UUID[];
  v_search_exclude UUID[];
  v_total INT := 0;
BEGIN
  FOR v_tick IN 1..6 LOOP
    FOR v_ride IN
      SELECT * FROM public.mbg_rides
      WHERE status = 'pending'
        AND dispatch_mode = 'auto'
        AND rider_id IS NOT NULL
        AND offer_sent_at IS NOT NULL
        AND offer_sent_at < now() - interval '10 seconds'
      FOR UPDATE SKIP LOCKED
    LOOP
      v_new_declined := array_append(v_ride.declined_rider_ids, v_ride.rider_id);

      -- Also skip (for THIS search only — not persisted into
      -- declined_rider_ids, since it's a transient state that can clear up
      -- moments later) anyone who currently holds a DIFFERENT unanswered
      -- pending offer — mirrors mbg_request_ride's own stacking guard
      -- (FIX_PREVENT_STALE_PENDING_RIDE_OFFERS.sql). mbg_find_available_riders
      -- alone doesn't know this (is_available only flips on accept, not
      -- while an offer sits unanswered), so without this a reassignment
      -- here could stack a second pending row onto a rider who's already
      -- mid-decision on an unrelated request.
      v_search_exclude := v_new_declined || COALESCE(
        (SELECT array_agg(DISTINCT r2.rider_id) FROM public.mbg_rides r2
         WHERE r2.status = 'pending' AND r2.rider_id IS NOT NULL AND r2.id <> v_ride.id),
        ARRAY[]::UUID[]
      );

      -- Hard cap so a rider-dense area can't ring dozens of people for one
      -- request forever — after 15 tries, stop offering it around.
      IF v_ride.dispatch_attempts >= 15 THEN
        UPDATE public.mbg_rides
        SET status = 'cancelled', rider_id = NULL, updated_at = now()
        WHERE id = v_ride.id;
        v_total := v_total + 1;
        CONTINUE;
      END IF;

      SELECT far.rider_id INTO v_next_rider
      FROM public.mbg_find_available_riders(
        v_ride.pickup_lat, v_ride.pickup_lng, v_ride.dropoff_lat, v_ride.dropoff_lng,
        NULL, v_ride.power_type_requested, COALESCE(v_ride.umbrella_requested, false),
        v_search_exclude, 1, v_ride.dispatch_vehicle_types, NULL,
        v_ride.cargo_weight_kg, v_ride.cargo_class
      ) AS far
      LIMIT 1;

      IF v_next_rider IS NOT NULL THEN
        UPDATE public.mbg_rides
        SET rider_id = v_next_rider,
            offer_sent_at = now(),
            declined_rider_ids = v_new_declined,
            dispatch_attempts = dispatch_attempts + 1,
            updated_at = now()
        WHERE id = v_ride.id;
      ELSIF EXISTS (
        -- Nobody free RIGHT NOW — but before giving up, check against just
        -- the permanent exclusion list (no transiently-busy riders skipped)
        -- whether anyone still qualifies at all. If so, they're only busy
        -- with something else for the moment — leave offer_sent_at as-is so
        -- this ride is picked up again (still stale) next tick instead of
        -- being cancelled out from under a rider who'll likely free up soon.
        SELECT 1 FROM public.mbg_find_available_riders(
          v_ride.pickup_lat, v_ride.pickup_lng, v_ride.dropoff_lat, v_ride.dropoff_lng,
          NULL, v_ride.power_type_requested, COALESCE(v_ride.umbrella_requested, false),
          v_new_declined, 1, v_ride.dispatch_vehicle_types, NULL,
          v_ride.cargo_weight_kg, v_ride.cargo_class
        )
      ) THEN
        NULL;
      ELSE
        -- Truly no one left to try.
        UPDATE public.mbg_rides
        SET status = 'cancelled', rider_id = NULL, updated_at = now()
        WHERE id = v_ride.id;
      END IF;

      v_total := v_total + 1;
    END LOOP;

    -- Release this tick's row locks now, before sleeping, instead of
    -- holding them for the rest of this ~60s call (see comment above).
    COMMIT;

    IF v_tick < 6 THEN
      PERFORM pg_sleep(10);
    END IF;
  END LOOP;

  -- Housekeeping: keep every mbg-* cron job's run history bounded regardless
  -- of how often each fires — this project is watching Supabase Free Plan
  -- storage growth.
  DELETE FROM cron.job_run_details
  WHERE end_time < now() - interval '2 days'
    AND jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'mbg-%');
  COMMIT;

  RAISE NOTICE 'mbg_sweep_auto_dispatch_cascade: % ride(s) reassigned or cancelled this run', v_total;
END;
$$;
GRANT EXECUTE ON PROCEDURE public.mbg_sweep_auto_dispatch_cascade TO service_role;

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

  NEW.fare := public.mbg_price_ride_for_rider(
    v_rider, NEW.distance_km, COALESCE(NEW.time_multiplier, 1), NEW.cargo_weight_kg, NEW.cargo_class
  );

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
