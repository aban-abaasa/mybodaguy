-- ==============================================
-- MY BODA GUY - COMPLETE DATABASE SETUP
-- With Hierarchical Chairperson Management
-- ==============================================

-- This file sets up the complete MyBodaGuy database schema
-- Run this in Supabase SQL Editor

BEGIN;

-- ==============================================
-- 1. CLEAN UP (Optional - removes existing tables)
-- ==============================================

-- Uncomment the following section if you want to start fresh
/*
DROP TABLE IF EXISTS public.mbg_commissions CASCADE;
DROP TABLE IF EXISTS public.mbg_payments CASCADE;
DROP TABLE IF EXISTS public.mbg_rides CASCADE;
DROP TABLE IF EXISTS public.mbg_customers CASCADE;
DROP TABLE IF EXISTS public.mbg_riders CASCADE;
DROP TABLE IF EXISTS public.committee_member_details CASCADE;
DROP TABLE IF EXISTS public.committee_members CASCADE;
DROP TABLE IF EXISTS public.stages CASCADE;
DROP TABLE IF EXISTS public.parishes CASCADE;
DROP TABLE IF EXISTS public.subcounties CASCADE;
DROP TABLE IF EXISTS public.divisions CASCADE;
DROP TABLE IF EXISTS public.districts CASCADE;
DROP TABLE IF EXISTS public.mbg_user_profiles CASCADE;
DROP TABLE IF EXISTS public.mbg_users CASCADE;

DROP TYPE IF EXISTS region_type CASCADE;
DROP TYPE IF EXISTS chairperson_role CASCADE;
DROP TYPE IF EXISTS mbg_user_role_type CASCADE;
DROP TYPE IF EXISTS mbg_ride_status CASCADE;
DROP TYPE IF EXISTS mbg_payment_status CASCADE;

DROP FUNCTION IF EXISTS public.handle_new_auth_user_mbg() CASCADE;
DROP FUNCTION IF EXISTS public.can_assign_chairperson(UUID, region_type, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.assign_chairperson(UUID, chairperson_role, region_type, UUID, DECIMAL, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_subordinate_chairpersons(UUID) CASCADE;

DROP VIEW IF EXISTS public.committee_hierarchy CASCADE;
*/

-- ==============================================
-- 2. CREATE TYPES
-- ==============================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE mbg_user_role_type AS ENUM ('developer', 'chairperson', 'rider', 'customer');
CREATE TYPE region_type AS ENUM ('district', 'division', 'subcounty', 'parish', 'stage');
CREATE TYPE chairperson_role AS ENUM (
  'district_chairperson',
  'division_chairperson',
  'subcounty_chairperson',
  'parish_chairperson',
  'stage_chairperson'
);
CREATE TYPE mbg_ride_status AS ENUM ('requested', 'accepted', 'picked_up', 'in_transit', 'completed', 'cancelled');
CREATE TYPE mbg_payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded');

-- ==============================================
-- 3. USERS TABLE
-- ==============================================

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

ALTER TABLE public.mbg_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_users_read_own ON public.mbg_users;
CREATE POLICY mbg_users_read_own ON public.mbg_users FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS mbg_users_insert_own ON public.mbg_users;
CREATE POLICY mbg_users_insert_own ON public.mbg_users FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS mbg_users_update_own ON public.mbg_users;
CREATE POLICY mbg_users_update_own ON public.mbg_users FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS mbg_users_read_developer ON public.mbg_users;
CREATE POLICY mbg_users_read_developer ON public.mbg_users FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.mbg_users dev WHERE dev.id = auth.uid() AND dev.role_type = 'developer' AND dev.is_active = true)
);

DROP POLICY IF EXISTS mbg_users_service_role ON public.mbg_users;
CREATE POLICY mbg_users_service_role ON public.mbg_users FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS mbg_users_email_idx ON public.mbg_users(email);
CREATE INDEX IF NOT EXISTS mbg_users_phone_idx ON public.mbg_users(phone);
CREATE INDEX IF NOT EXISTS mbg_users_role_type_idx ON public.mbg_users(role_type);

-- ==============================================
-- 4. USER PROFILES
-- ==============================================

CREATE TABLE IF NOT EXISTS public.mbg_user_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.mbg_users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT 'User',
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE public.mbg_user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_user_profiles_read_own ON public.mbg_user_profiles;
CREATE POLICY mbg_user_profiles_read_own ON public.mbg_user_profiles FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS mbg_user_profiles_update_own ON public.mbg_user_profiles;
CREATE POLICY mbg_user_profiles_update_own ON public.mbg_user_profiles FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS mbg_user_profiles_insert_own ON public.mbg_user_profiles;
CREATE POLICY mbg_user_profiles_insert_own ON public.mbg_user_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS mbg_user_profiles_service_role ON public.mbg_user_profiles;
CREATE POLICY mbg_user_profiles_service_role ON public.mbg_user_profiles FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ==============================================
-- 5. GEOGRAPHIC REGIONS
-- ==============================================

-- Districts (Level 1)
CREATE TABLE IF NOT EXISTS public.districts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Divisions (Level 2)
CREATE TABLE IF NOT EXISTS public.divisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district_id UUID NOT NULL REFERENCES public.districts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(district_id, name)
);

-- Subcounties (Level 3)
CREATE TABLE IF NOT EXISTS public.subcounties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(division_id, name)
);

-- Parishes (Level 4)
CREATE TABLE IF NOT EXISTS public.parishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subcounty_id UUID NOT NULL REFERENCES public.subcounties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subcounty_id, name)
);

-- Stages (Level 5)
CREATE TABLE IF NOT EXISTS public.stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id UUID NOT NULL REFERENCES public.parishes(id) ON DELETE CASCADE,
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

-- Enable RLS on all region tables
ALTER TABLE public.districts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcounties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stages ENABLE ROW LEVEL SECURITY;

-- Everyone can read active regions
DROP POLICY IF EXISTS districts_read_all ON public.districts;
CREATE POLICY districts_read_all ON public.districts FOR SELECT USING (is_active = true OR auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS divisions_read_all ON public.divisions;
CREATE POLICY divisions_read_all ON public.divisions FOR SELECT USING (is_active = true OR auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS subcounties_read_all ON public.subcounties;
CREATE POLICY subcounties_read_all ON public.subcounties FOR SELECT USING (is_active = true OR auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS parishes_read_all ON public.parishes;
CREATE POLICY parishes_read_all ON public.parishes FOR SELECT USING (is_active = true OR auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS stages_read_all ON public.stages;
CREATE POLICY stages_read_all ON public.stages FOR SELECT USING (is_active = true OR auth.uid() IS NOT NULL);

-- Developers can manage regions
DROP POLICY IF EXISTS districts_manage_developer ON public.districts;
CREATE POLICY districts_manage_developer ON public.districts FOR ALL USING (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true)
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true)
);

DROP POLICY IF EXISTS divisions_manage_developer ON public.divisions;
CREATE POLICY divisions_manage_developer ON public.divisions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true)
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true)
);

DROP POLICY IF EXISTS subcounties_manage_developer ON public.subcounties;
CREATE POLICY subcounties_manage_developer ON public.subcounties FOR ALL USING (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true)
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true)
);

DROP POLICY IF EXISTS parishes_manage_developer ON public.parishes;
CREATE POLICY parishes_manage_developer ON public.parishes FOR ALL USING (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true)
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer' AND is_active = true)
);

DROP POLICY IF EXISTS stages_manage_developer ON public.stages;
CREATE POLICY stages_manage_developer ON public.stages FOR ALL USING (
