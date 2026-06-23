-- My Boda Guy - Geographic Regions
-- Hierarchical structure: District → Division → Subcounty → Parish → Stage

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

-- Stages (Level 5 - Physical boda boda stations)
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

-- Enable RLS on all tables
ALTER TABLE public.districts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcounties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stages ENABLE ROW LEVEL SECURITY;

-- Everyone can read active regions (for selection dropdowns)
DROP POLICY IF EXISTS districts_read_all ON public.districts;
CREATE POLICY districts_read_all ON public.districts
  FOR SELECT
  USING (is_active = true OR auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS divisions_read_all ON public.divisions;
CREATE POLICY divisions_read_all ON public.divisions
  FOR SELECT
  USING (is_active = true OR auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS subcounties_read_all ON public.subcounties;
CREATE POLICY subcounties_read_all ON public.subcounties
  FOR SELECT
  USING (is_active = true OR auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS parishes_read_all ON public.parishes;
CREATE POLICY parishes_read_all ON public.parishes
  FOR SELECT
  USING (is_active = true OR auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS stages_read_all ON public.stages;
CREATE POLICY stages_read_all ON public.stages
  FOR SELECT
  USING (is_active = true OR auth.uid() IS NOT NULL);

-- Only developers can manage regions
DROP POLICY IF EXISTS districts_manage_developer ON public.districts;
CREATE POLICY districts_manage_developer ON public.districts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

DROP POLICY IF EXISTS divisions_manage_developer ON public.divisions;
CREATE POLICY divisions_manage_developer ON public.divisions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

DROP POLICY IF EXISTS subcounties_manage_developer ON public.subcounties;
CREATE POLICY subcounties_manage_developer ON public.subcounties
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

DROP POLICY IF EXISTS parishes_manage_developer ON public.parishes;
CREATE POLICY parishes_manage_developer ON public.parishes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

DROP POLICY IF EXISTS stages_manage_developer ON public.stages;
CREATE POLICY stages_manage_developer ON public.stages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Service role has full access
DROP POLICY IF EXISTS districts_service_role ON public.districts;
CREATE POLICY districts_service_role ON public.districts
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS divisions_service_role ON public.divisions;
CREATE POLICY divisions_service_role ON public.divisions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS subcounties_service_role ON public.subcounties;
CREATE POLICY subcounties_service_role ON public.subcounties
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS parishes_service_role ON public.parishes;
CREATE POLICY parishes_service_role ON public.parishes
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS stages_service_role ON public.stages;
CREATE POLICY stages_service_role ON public.stages
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Indexes for performance
CREATE INDEX IF NOT EXISTS divisions_district_id_idx ON public.divisions(district_id);
CREATE INDEX IF NOT EXISTS subcounties_division_id_idx ON public.subcounties(division_id);
CREATE INDEX IF NOT EXISTS parishes_subcounty_id_idx ON public.parishes(subcounty_id);
CREATE INDEX IF NOT EXISTS stages_parish_id_idx ON public.stages(parish_id);
CREATE INDEX IF NOT EXISTS stages_location_idx ON public.stages(location_lat, location_lng);

COMMIT;
