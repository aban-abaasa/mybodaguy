-- ==============================================
-- QUICK SETUP - Run this single file to set everything up!
-- ==============================================

BEGIN;

-- Step 1: Create geographic regions tables
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

-- Stages (Level 5 - Boda stations)
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

-- Enable RLS
ALTER TABLE public.districts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcounties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stages ENABLE ROW LEVEL SECURITY;

-- Everyone can read regions
DROP POLICY IF EXISTS districts_read_all ON public.districts;
CREATE POLICY districts_read_all ON public.districts FOR SELECT USING (true);

DROP POLICY IF EXISTS divisions_read_all ON public.divisions;
CREATE POLICY divisions_read_all ON public.divisions FOR SELECT USING (true);

DROP POLICY IF EXISTS subcounties_read_all ON public.subcounties;
CREATE POLICY subcounties_read_all ON public.subcounties FOR SELECT USING (true);

DROP POLICY IF EXISTS parishes_read_all ON public.parishes;
CREATE POLICY parishes_read_all ON public.parishes FOR SELECT USING (true);

DROP POLICY IF EXISTS stages_read_all ON public.stages;
CREATE POLICY stages_read_all ON public.stages FOR SELECT USING (true);

-- Developers can manage regions
DROP POLICY IF EXISTS districts_manage_dev ON public.districts;
CREATE POLICY districts_manage_dev ON public.districts FOR ALL USING (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer')
);

DROP POLICY IF EXISTS divisions_manage_dev ON public.divisions;
CREATE POLICY divisions_manage_dev ON public.divisions FOR ALL USING (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer')
);

DROP POLICY IF EXISTS subcounties_manage_dev ON public.subcounties;
CREATE POLICY subcounties_manage_dev ON public.subcounties FOR ALL USING (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer')
);

DROP POLICY IF EXISTS parishes_manage_dev ON public.parishes;
CREATE POLICY parishes_manage_dev ON public.parishes FOR ALL USING (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer')
);

DROP POLICY IF EXISTS stages_manage_dev ON public.stages;
CREATE POLICY stages_manage_dev ON public.stages FOR ALL USING (
  EXISTS (SELECT 1 FROM public.mbg_users WHERE id = auth.uid() AND role_type = 'developer')
);

-- Indexes
CREATE INDEX IF NOT EXISTS divisions_district_id_idx ON public.divisions(district_id);
CREATE INDEX IF NOT EXISTS subcounties_division_id_idx ON public.subcounties(division_id);
CREATE INDEX IF NOT EXISTS parishes_subcounty_id_idx ON public.parishes(subcounty_id);
CREATE INDEX IF NOT EXISTS stages_parish_id_idx ON public.stages(parish_id);

COMMIT;

-- Show success message
SELECT 'Geographic regions tables created successfully! You can now use the Regions tab.' as message;
