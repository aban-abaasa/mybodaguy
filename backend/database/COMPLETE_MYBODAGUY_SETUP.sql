-- ============================================
-- MY BODA GUY - COMPLETE DATABASE SETUP
-- Run this entire file in Supabase SQL Editor
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- STEP 1: CREATE CUSTOM TYPES (IF NOT EXISTS)
-- ============================================

-- User types
DO $$ BEGIN
  CREATE TYPE mbg_user_role_type AS ENUM ('developer', 'chairperson', 'rider', 'customer');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Region types
DO $$ BEGIN
  CREATE TYPE mbg_region_type AS ENUM ('district', 'division', 'subcounty', 'parish', 'stage');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Chairperson roles
DO $$ BEGIN
  CREATE TYPE mbg_chairperson_role AS ENUM (
    'district_chairperson',
    'division_chairperson',
    'subcounty_chairperson',
    'parish_chairperson',
    'stage_chairperson'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Vehicle types
DO $$ BEGIN
  CREATE TYPE mbg_vehicle_type AS ENUM ('motorcycle', 'bicycle', 'tuktuk');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Rider status
DO $$ BEGIN
  CREATE TYPE mbg_rider_status AS ENUM ('pending', 'active', 'suspended', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Ride status
DO $$ BEGIN
  CREATE TYPE mbg_ride_status AS ENUM (
    'pending',      -- Requested by customer
    'accepted',     -- Accepted by rider
    'in_progress',  -- Rider is on the way or with customer
    'completed',    -- Ride completed successfully
    'cancelled',    -- Cancelled by customer or rider
    'failed'        -- Failed for any reason
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Cancellation by
DO $$ BEGIN
  CREATE TYPE mbg_cancellation_by AS ENUM ('customer', 'rider', 'system');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Payment method
DO $$ BEGIN
  CREATE TYPE mbg_payment_method AS ENUM ('cash', 'mobile_money', 'card', 'wallet');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Payment status
DO $$ BEGIN
  CREATE TYPE mbg_payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Commission status
DO $$ BEGIN
  CREATE TYPE mbg_commission_status AS ENUM ('pending', 'paid', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- STEP 2: CREATE TABLES
-- ============================================

-- Users table
CREATE TABLE IF NOT EXISTS public.mbg_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  phone TEXT,
  role_type mbg_user_role_type NOT NULL DEFAULT 'customer',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(email)
);

-- User profiles
CREATE TABLE IF NOT EXISTS public.mbg_user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  full_name TEXT,
  avatar_url TEXT,
  date_of_birth DATE,
  gender TEXT CHECK (gender IN ('male', 'female', 'other')),
  national_id TEXT,
  address TEXT,
  city TEXT,
  country TEXT DEFAULT 'Uganda',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Districts
CREATE TABLE IF NOT EXISTS public.mbg_districts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Divisions
CREATE TABLE IF NOT EXISTS public.mbg_divisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id UUID NOT NULL REFERENCES public.mbg_districts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(district_id, name)
);

-- Subcounties
CREATE TABLE IF NOT EXISTS public.mbg_subcounties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL REFERENCES public.mbg_divisions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(division_id, name)
);

-- Parishes
CREATE TABLE IF NOT EXISTS public.mbg_parishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subcounty_id UUID NOT NULL REFERENCES public.mbg_subcounties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subcounty_id, name)
);

-- Stages
CREATE TABLE IF NOT EXISTS public.mbg_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id UUID NOT NULL REFERENCES public.mbg_parishes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  location_name TEXT,
  location_lat DECIMAL(10, 8),
  location_lng DECIMAL(11, 8),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(parish_id, name)
);

-- Committee members (Chairpersons)
CREATE TABLE IF NOT EXISTS public.mbg_committee_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  role mbg_chairperson_role NOT NULL,
  region_type mbg_region_type NOT NULL,
  region_id UUID NOT NULL,
  assigned_by UUID REFERENCES public.mbg_users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  appointed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, region_type, region_id)
);

-- Riders
CREATE TABLE IF NOT EXISTS public.mbg_riders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES public.mbg_stages(id) ON DELETE RESTRICT,
  vehicle_type mbg_vehicle_type NOT NULL DEFAULT 'motorcycle',
  plate_number TEXT NOT NULL UNIQUE,
  license_number TEXT NOT NULL,
  license_expiry DATE,
  vehicle_model TEXT,
  vehicle_year INTEGER,
  vehicle_color TEXT,
  status mbg_rider_status NOT NULL DEFAULT 'pending',
  is_available BOOLEAN NOT NULL DEFAULT false,
  rating DECIMAL(3, 2) DEFAULT 0.00 CHECK (rating >= 0 AND rating <= 5),
  total_rides INTEGER DEFAULT 0,
  completed_rides INTEGER DEFAULT 0,
  cancelled_rides INTEGER DEFAULT 0,
  approved_by UUID REFERENCES public.mbg_users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Customers
CREATE TABLE IF NOT EXISTS public.mbg_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  default_pickup_location TEXT,
  default_pickup_lat DECIMAL(10, 8),
  default_pickup_lng DECIMAL(11, 8),
  rating DECIMAL(3, 2) DEFAULT 5.00 CHECK (rating >= 0 AND rating <= 5),
  total_rides INTEGER DEFAULT 0,
  completed_rides INTEGER DEFAULT 0,
  cancelled_rides INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rides
CREATE TABLE IF NOT EXISTS public.mbg_rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.mbg_customers(id) ON DELETE RESTRICT,
  rider_id UUID REFERENCES public.mbg_riders(id) ON DELETE RESTRICT,
  stage_id UUID NOT NULL REFERENCES public.mbg_stages(id) ON DELETE RESTRICT,
  
  pickup_location TEXT NOT NULL,
  pickup_lat DECIMAL(10, 8) NOT NULL,
  pickup_lng DECIMAL(11, 8) NOT NULL,
  dropoff_location TEXT NOT NULL,
  dropoff_lat DECIMAL(10, 8) NOT NULL,
  dropoff_lng DECIMAL(11, 8) NOT NULL,
  
  status mbg_ride_status NOT NULL DEFAULT 'pending',
  distance_km DECIMAL(10, 2),
  duration_minutes INTEGER,
  fare DECIMAL(10, 2) NOT NULL,
  
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  
  cancelled_by mbg_cancellation_by,
  cancellation_reason TEXT,
  
  customer_rating DECIMAL(3, 2) CHECK (customer_rating >= 0 AND customer_rating <= 5),
  rider_rating DECIMAL(3, 2) CHECK (rider_rating >= 0 AND rider_rating <= 5),
  customer_review TEXT,
  rider_review TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payments
CREATE TABLE IF NOT EXISTS public.mbg_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.mbg_rides(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES public.mbg_customers(id) ON DELETE RESTRICT,
  rider_id UUID NOT NULL REFERENCES public.mbg_riders(id) ON DELETE RESTRICT,
  
  amount DECIMAL(10, 2) NOT NULL,
  payment_method mbg_payment_method NOT NULL DEFAULT 'cash',
  status mbg_payment_status NOT NULL DEFAULT 'pending',
  
  transaction_id TEXT,
  payment_provider TEXT,
  provider_reference TEXT,
  phone_number TEXT,
  
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  
  failure_reason TEXT,
  refund_reason TEXT,
  refund_amount DECIMAL(10, 2),
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Commissions
CREATE TABLE IF NOT EXISTS public.mbg_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES public.mbg_rides(id) ON DELETE RESTRICT,
  payment_id UUID NOT NULL REFERENCES public.mbg_payments(id) ON DELETE RESTRICT,
  
  recipient_id UUID NOT NULL REFERENCES public.mbg_users(id) ON DELETE RESTRICT,
  recipient_role TEXT NOT NULL,
  region_type mbg_region_type NOT NULL,
  region_id UUID NOT NULL,
  
  ride_fare DECIMAL(10, 2) NOT NULL,
  commission_percentage DECIMAL(5, 2) NOT NULL,
  commission_amount DECIMAL(10, 2) NOT NULL,
  
  status mbg_commission_status NOT NULL DEFAULT 'pending',
  
  paid_at TIMESTAMPTZ,
  payment_method mbg_payment_method,
  payment_reference TEXT,
  
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Platform settings
CREATE TABLE IF NOT EXISTS public.mbg_platform_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string' CHECK (value_type IN ('string', 'number', 'boolean', 'json')),
  description TEXT,
  category TEXT,
  is_public BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- STEP 3: INSERT DEFAULT PLATFORM SETTINGS
-- ============================================

INSERT INTO public.mbg_platform_settings (key, value, value_type, description, category, is_public) VALUES
  ('commission.platform_fee_percentage', '5.00', 'number', 'Platform fee percentage', 'commission', true),
  ('commission.rider_percentage', '70.00', 'number', 'Rider earnings percentage', 'commission', true),
  ('commission.stage_chair_percentage', '10.00', 'number', 'Stage chairperson commission percentage', 'commission', true),
  ('commission.parish_chair_percentage', '6.00', 'number', 'Parish chairperson commission percentage', 'commission', true),
  ('commission.subcounty_chair_percentage', '4.00', 'number', 'Subcounty chairperson commission percentage', 'commission', true),
  ('commission.division_chair_percentage', '3.00', 'number', 'Division chairperson commission percentage', 'commission', true),
  ('commission.district_chair_percentage', '2.00', 'number', 'District chairperson commission percentage', 'commission', true),
  ('ride.minimum_fare', '2000', 'number', 'Minimum ride fare in UGX', 'ride', true),
  ('ride.per_km_rate', '1500', 'number', 'Rate per kilometer in UGX', 'ride', true),
  ('ride.base_fare', '1000', 'number', 'Base fare for all rides in UGX', 'ride', true),
  ('withdrawal.minimum_amount', '10000', 'number', 'Minimum withdrawal amount in UGX', 'withdrawal', true),
  ('app.name', 'My Boda Guy', 'string', 'Application name', 'app', true),
  ('app.tagline', 'Your Trusted Ride Partner', 'string', 'Application tagline', 'app', true),
  ('app.support_phone', '+256-XXX-XXXXXX', 'string', 'Support phone number', 'app', true),
  ('app.support_email', 'support@mybodaguy.com', 'string', 'Support email', 'app', true)
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- STEP 4: CREATE TRIGGER FUNCTION
-- ============================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user_mbg()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_role mbg_user_role_type;
BEGIN
  -- Check if this is the hardcoded developer account
  IF NEW.email = 'abanabaasa2@gmail.com' THEN
    user_role := 'developer';
  ELSE
    -- Everyone else starts as customer
    user_role := 'customer';
  END IF;

  -- Create user record
  INSERT INTO public.mbg_users (id, email, role_type)
  VALUES (NEW.id, COALESCE(NEW.email, ''), user_role)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        role_type = user_role,
        updated_at = NOW();

  -- Create user profile
  INSERT INTO public.mbg_user_profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'))
  ON CONFLICT (user_id) DO NOTHING;

  -- Create customer profile automatically for non-developer users
  IF user_role = 'customer' THEN
    INSERT INTO public.mbg_customers (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger
DROP TRIGGER IF EXISTS on_auth_user_created_mbg ON auth.users;
CREATE TRIGGER on_auth_user_created_mbg
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user_mbg();

-- ============================================
-- STEP 5: ENABLE ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE public.mbg_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_districts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_subcounties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_parishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_committee_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_riders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mbg_platform_settings ENABLE ROW LEVEL SECURITY;

-- ============================================
-- STEP 6: CREATE RLS POLICIES
-- ============================================

-- Users policies
DROP POLICY IF EXISTS mbg_users_read_own ON public.mbg_users;
CREATE POLICY mbg_users_read_own ON public.mbg_users FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS mbg_users_service_role ON public.mbg_users;
CREATE POLICY mbg_users_service_role ON public.mbg_users FOR ALL USING (auth.role() = 'service_role');

-- User profiles policies
DROP POLICY IF EXISTS mbg_user_profiles_read_own ON public.mbg_user_profiles;
CREATE POLICY mbg_user_profiles_read_own ON public.mbg_user_profiles FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS mbg_user_profiles_insert_own ON public.mbg_user_profiles;
CREATE POLICY mbg_user_profiles_insert_own ON public.mbg_user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS mbg_user_profiles_update_own ON public.mbg_user_profiles;
CREATE POLICY mbg_user_profiles_update_own ON public.mbg_user_profiles FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS mbg_user_profiles_service_role ON public.mbg_user_profiles;
CREATE POLICY mbg_user_profiles_service_role ON public.mbg_user_profiles FOR ALL USING (auth.role() = 'service_role');

-- Geographic regions - everyone can read active regions
DROP POLICY IF EXISTS mbg_districts_read_all ON public.mbg_districts;
CREATE POLICY mbg_districts_read_all ON public.mbg_districts FOR SELECT USING (true);

DROP POLICY IF EXISTS mbg_divisions_read_all ON public.mbg_divisions;
CREATE POLICY mbg_divisions_read_all ON public.mbg_divisions FOR SELECT USING (true);

DROP POLICY IF EXISTS mbg_subcounties_read_all ON public.mbg_subcounties;
CREATE POLICY mbg_subcounties_read_all ON public.mbg_subcounties FOR SELECT USING (true);

DROP POLICY IF EXISTS mbg_parishes_read_all ON public.mbg_parishes;
CREATE POLICY mbg_parishes_read_all ON public.mbg_parishes FOR SELECT USING (true);

DROP POLICY IF EXISTS mbg_stages_read_all ON public.mbg_stages;
CREATE POLICY mbg_stages_read_all ON public.mbg_stages FOR SELECT USING (true);

-- Service role can manage everything
DROP POLICY IF EXISTS mbg_districts_service_role ON public.mbg_districts;
CREATE POLICY mbg_districts_service_role ON public.mbg_districts FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_divisions_service_role ON public.mbg_divisions;
CREATE POLICY mbg_divisions_service_role ON public.mbg_divisions FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_subcounties_service_role ON public.mbg_subcounties;
CREATE POLICY mbg_subcounties_service_role ON public.mbg_subcounties FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_parishes_service_role ON public.mbg_parishes;
CREATE POLICY mbg_parishes_service_role ON public.mbg_parishes FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_stages_service_role ON public.mbg_stages;
CREATE POLICY mbg_stages_service_role ON public.mbg_stages FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_committee_members_service_role ON public.mbg_committee_members;
CREATE POLICY mbg_committee_members_service_role ON public.mbg_committee_members FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_riders_service_role ON public.mbg_riders;
CREATE POLICY mbg_riders_service_role ON public.mbg_riders FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_customers_service_role ON public.mbg_customers;
CREATE POLICY mbg_customers_service_role ON public.mbg_customers FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_rides_service_role ON public.mbg_rides;
CREATE POLICY mbg_rides_service_role ON public.mbg_rides FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_payments_service_role ON public.mbg_payments;
CREATE POLICY mbg_payments_service_role ON public.mbg_payments FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_commissions_service_role ON public.mbg_commissions;
CREATE POLICY mbg_commissions_service_role ON public.mbg_commissions FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS mbg_platform_settings_service_role ON public.mbg_platform_settings;
CREATE POLICY mbg_platform_settings_service_role ON public.mbg_platform_settings FOR ALL USING (auth.role() = 'service_role');

-- Customers policies
DROP POLICY IF EXISTS mbg_customers_read_own ON public.mbg_customers;
CREATE POLICY mbg_customers_read_own ON public.mbg_customers FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND id = mbg_customers.user_id)
);

DROP POLICY IF EXISTS mbg_customers_insert_own ON public.mbg_customers;
CREATE POLICY mbg_customers_insert_own ON public.mbg_customers FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS mbg_customers_update_own ON public.mbg_customers;
CREATE POLICY mbg_customers_update_own ON public.mbg_customers FOR UPDATE USING (auth.uid() = user_id);

-- Platform settings - public settings readable by all
DROP POLICY IF EXISTS mbg_platform_settings_read_public ON public.mbg_platform_settings;
CREATE POLICY mbg_platform_settings_read_public ON public.mbg_platform_settings FOR SELECT USING (is_public = true);

-- ============================================
-- STEP 7: CREATE INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS mbg_users_email_idx ON public.mbg_users(email);
CREATE INDEX IF NOT EXISTS mbg_users_role_type_idx ON public.mbg_users(role_type);
CREATE INDEX IF NOT EXISTS mbg_user_profiles_user_id_idx ON public.mbg_user_profiles(user_id);
CREATE INDEX IF NOT EXISTS mbg_divisions_district_id_idx ON public.mbg_divisions(district_id);
CREATE INDEX IF NOT EXISTS mbg_subcounties_division_id_idx ON public.mbg_subcounties(division_id);
CREATE INDEX IF NOT EXISTS mbg_parishes_subcounty_id_idx ON public.mbg_parishes(subcounty_id);
CREATE INDEX IF NOT EXISTS mbg_stages_parish_id_idx ON public.mbg_stages(parish_id);
CREATE INDEX IF NOT EXISTS mbg_committee_members_user_id_idx ON public.mbg_committee_members(user_id);
CREATE INDEX IF NOT EXISTS mbg_riders_user_id_idx ON public.mbg_riders(user_id);
CREATE INDEX IF NOT EXISTS mbg_riders_stage_id_idx ON public.mbg_riders(stage_id);
CREATE INDEX IF NOT EXISTS mbg_customers_user_id_idx ON public.mbg_customers(user_id);
CREATE INDEX IF NOT EXISTS mbg_rides_customer_id_idx ON public.mbg_rides(customer_id);
CREATE INDEX IF NOT EXISTS mbg_rides_rider_id_idx ON public.mbg_rides(rider_id);
CREATE INDEX IF NOT EXISTS mbg_payments_ride_id_idx ON public.mbg_payments(ride_id);
CREATE INDEX IF NOT EXISTS mbg_commissions_ride_id_idx ON public.mbg_commissions(ride_id);

-- ============================================
-- ✅ SETUP COMPLETE!
-- ============================================
-- All My Boda Guy tables, types, and policies created
-- Developer account: abanabaasa2@gmail.com
-- All other users start as customers
-- ============================================
