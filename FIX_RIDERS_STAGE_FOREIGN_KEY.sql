-- Fix foreign key constraint issue for mbg_riders.stage_id
-- Ensures mbg_stages table exists and validates stage_id before inserting riders

-- ==============================================
-- 1. CREATE mbg_stages TABLE (if not exists)
-- ==============================================

CREATE TABLE IF NOT EXISTS public.mbg_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parish_id UUID NOT NULL REFERENCES public.mbg_parishes(id) ON DELETE CASCADE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, parish_id)
);

-- Add location column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'mbg_stages' 
    AND column_name = 'location'
  ) THEN
    ALTER TABLE public.mbg_stages ADD COLUMN location TEXT;
    RAISE NOTICE 'Added location column to mbg_stages';
  END IF;
END $$;

ALTER TABLE public.mbg_stages ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS mbg_stages_read_all ON public.mbg_stages;
DROP POLICY IF EXISTS mbg_stages_write_developer ON public.mbg_stages;
DROP POLICY IF EXISTS mbg_stages_service_role ON public.mbg_stages;

-- Everyone can read stages
CREATE POLICY mbg_stages_read_all ON public.mbg_stages
  FOR SELECT
  USING (true);

-- Developers can insert/update/delete
CREATE POLICY mbg_stages_write_developer ON public.mbg_stages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users u
      WHERE u.id = auth.uid()
        AND u.role_type = 'developer'
        AND u.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_users u
      WHERE u.id = auth.uid()
        AND u.role_type = 'developer'
        AND u.is_active = true
    )
  );

-- Service role has full access
CREATE POLICY mbg_stages_service_role ON public.mbg_stages
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS mbg_stages_parish_id_idx ON public.mbg_stages(parish_id);
CREATE INDEX IF NOT EXISTS mbg_stages_name_idx ON public.mbg_stages(name);

-- ==============================================
-- 2. CREATE OTHER REGION TABLES (if not exist)
-- ==============================================

-- Districts
CREATE TABLE IF NOT EXISTS public.mbg_districts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.mbg_districts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_districts_read_all ON public.mbg_districts;
CREATE POLICY mbg_districts_read_all ON public.mbg_districts FOR SELECT USING (true);

DROP POLICY IF EXISTS mbg_districts_service_role ON public.mbg_districts;
CREATE POLICY mbg_districts_service_role ON public.mbg_districts
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Divisions
CREATE TABLE IF NOT EXISTS public.mbg_divisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  district_id UUID NOT NULL REFERENCES public.mbg_districts(id) ON DELETE CASCADE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, district_id)
);

ALTER TABLE public.mbg_divisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_divisions_read_all ON public.mbg_divisions;
CREATE POLICY mbg_divisions_read_all ON public.mbg_divisions FOR SELECT USING (true);

DROP POLICY IF EXISTS mbg_divisions_service_role ON public.mbg_divisions;
CREATE POLICY mbg_divisions_service_role ON public.mbg_divisions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS mbg_divisions_district_id_idx ON public.mbg_divisions(district_id);

-- Subcounties
CREATE TABLE IF NOT EXISTS public.mbg_subcounties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  division_id UUID NOT NULL REFERENCES public.mbg_divisions(id) ON DELETE CASCADE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, division_id)
);

ALTER TABLE public.mbg_subcounties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_subcounties_read_all ON public.mbg_subcounties;
CREATE POLICY mbg_subcounties_read_all ON public.mbg_subcounties FOR SELECT USING (true);

DROP POLICY IF EXISTS mbg_subcounties_service_role ON public.mbg_subcounties;
CREATE POLICY mbg_subcounties_service_role ON public.mbg_subcounties
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS mbg_subcounties_division_id_idx ON public.mbg_subcounties(division_id);

-- Parishes
CREATE TABLE IF NOT EXISTS public.mbg_parishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subcounty_id UUID NOT NULL REFERENCES public.mbg_subcounties(id) ON DELETE CASCADE,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, subcounty_id)
);

ALTER TABLE public.mbg_parishes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mbg_parishes_read_all ON public.mbg_parishes;
CREATE POLICY mbg_parishes_read_all ON public.mbg_parishes FOR SELECT USING (true);

DROP POLICY IF EXISTS mbg_parishes_service_role ON public.mbg_parishes;
CREATE POLICY mbg_parishes_service_role ON public.mbg_parishes
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS mbg_parishes_subcounty_id_idx ON public.mbg_parishes(subcounty_id);

-- ==============================================
-- 3. UPDATE mbg_assign_rider FUNCTION WITH VALIDATION
-- ==============================================

CREATE OR REPLACE FUNCTION public.mbg_assign_rider(
  target_user_email TEXT,
  target_stage_id UUID,
  vehicle_type mbg_vehicle_type,
  plate_number TEXT,
  license_number TEXT,
  license_expiry DATE DEFAULT NULL,
  vehicle_model TEXT DEFAULT NULL,
  vehicle_year INTEGER DEFAULT NULL,
  vehicle_color TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_user_id UUID;
  stage_chairperson_id UUID;
  new_rider_id UUID;
  stage_exists BOOLEAN;
  result JSON;
BEGIN
  -- Validate stage_id exists
  SELECT EXISTS(SELECT 1 FROM public.mbg_stages WHERE id = target_stage_id) INTO stage_exists;
  
  IF NOT stage_exists THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Invalid stage_id: Stage does not exist. Please contact administrator to create stages.'
    );
  END IF;

  -- Get the stage chairperson's committee member record
  SELECT cm.id INTO stage_chairperson_id
  FROM public.mbg_committee_members cm
  WHERE cm.user_id = auth.uid()
    AND cm.role = 'stage_chairperson'
    AND cm.region_type = 'stage'
    AND cm.region_id = target_stage_id
    AND cm.is_active = true
  LIMIT 1;

  -- Verify the caller is a stage chairperson for this stage
  IF stage_chairperson_id IS NULL THEN
    -- Check if developer (developers can assign to any stage)
    IF NOT EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    ) THEN
      RETURN json_build_object(
        'success', false,
        'error', 'You are not authorized to assign riders to this stage'
      );
    END IF;
  END IF;

  -- Get or create user from auth by email
  SELECT u.id INTO target_user_id
  FROM public.mbg_users u
  WHERE u.email = target_user_email
  LIMIT 1;

  IF target_user_id IS NULL THEN
    -- Try to sync from auth.users
    SELECT au.id INTO target_user_id
    FROM auth.users au
    WHERE au.email = target_user_email
    LIMIT 1;

    IF target_user_id IS NULL THEN
      RETURN json_build_object(
        'success', false,
        'error', 'User not found with email: ' || target_user_email
      );
    END IF;

    -- Sync user to mbg_users
    INSERT INTO public.mbg_users (id, email, role_type, is_active)
    VALUES (target_user_id, target_user_email, 'rider', true)
    ON CONFLICT (id) DO UPDATE SET
      role_type = 'rider',
      updated_at = NOW();
  ELSE
    -- Update existing user to rider role
    UPDATE public.mbg_users
    SET role_type = 'rider',
        updated_at = NOW()
    WHERE id = target_user_id;
  END IF;

  -- Check if plate number already exists
  IF EXISTS (SELECT 1 FROM public.mbg_riders WHERE mbg_riders.plate_number = mbg_assign_rider.plate_number) THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Plate number already registered: ' || plate_number
    );
  END IF;

  -- Insert or update rider record
  INSERT INTO public.mbg_riders (
    user_id,
    stage_id,
    vehicle_type,
    plate_number,
    license_number,
    license_expiry,
    vehicle_model,
    vehicle_year,
    vehicle_color,
    status,
    approved_by,
    approved_at
  )
  VALUES (
    target_user_id,
    target_stage_id,
    vehicle_type,
    plate_number,
    license_number,
    license_expiry,
    vehicle_model,
    vehicle_year,
    vehicle_color,
    'active', -- Auto-approve when assigned by chairperson
    auth.uid(),
    NOW()
  )
  ON CONFLICT (user_id) 
  DO UPDATE SET
    stage_id = EXCLUDED.stage_id,
    vehicle_type = EXCLUDED.vehicle_type,
    plate_number = EXCLUDED.plate_number,
    license_number = EXCLUDED.license_number,
    license_expiry = EXCLUDED.license_expiry,
    vehicle_model = EXCLUDED.vehicle_model,
    vehicle_year = EXCLUDED.vehicle_year,
    vehicle_color = EXCLUDED.vehicle_color,
    status = 'active',
    approved_by = auth.uid(),
    approved_at = NOW(),
    updated_at = NOW()
  RETURNING id INTO new_rider_id;

  RETURN json_build_object(
    'success', true,
    'rider_id', new_rider_id,
    'message', 'Rider assigned successfully'
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN json_build_object(
      'success', false,
      'error', SQLERRM
    );
END;
$$;

COMMENT ON FUNCTION public.mbg_assign_rider IS 'Stage chairpersons can assign riders to their stage (with validation)';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.mbg_assign_rider TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_assign_rider TO service_role;

-- ==============================================
-- 4. HELPER FUNCTION TO CHECK CHAIRPERSON'S STAGE
-- ==============================================

CREATE OR REPLACE FUNCTION public.mbg_get_my_stage_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  my_stage_id UUID;
BEGIN
  SELECT cm.region_id INTO my_stage_id
  FROM public.mbg_committee_members cm
  WHERE cm.user_id = auth.uid()
    AND cm.role = 'stage_chairperson'
    AND cm.region_type = 'stage'
    AND cm.is_active = true
  LIMIT 1;

  RETURN my_stage_id;
END;
$$;

COMMENT ON FUNCTION public.mbg_get_my_stage_id IS 'Get the stage_id for the current stage chairperson';

GRANT EXECUTE ON FUNCTION public.mbg_get_my_stage_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_get_my_stage_id() TO service_role;

-- ==============================================
-- 5. INSERT SAMPLE STAGE DATA (for testing)
-- ==============================================

-- Note: This creates sample data. Comment out if you have your own data.

DO $$
DECLARE
  sample_district_id UUID;
  sample_division_id UUID;
  sample_subcounty_id UUID;
  sample_parish_id UUID;
  sample_stage_id UUID;
  has_location_column BOOLEAN;
BEGIN
  -- Check if any stages exist
  IF NOT EXISTS (SELECT 1 FROM public.mbg_stages LIMIT 1) THEN
    RAISE NOTICE 'No stages found. Creating sample data...';
    
    -- Check if location column exists
    SELECT EXISTS(
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'mbg_stages' 
      AND column_name = 'location'
    ) INTO has_location_column;
    
    -- Create sample district
    INSERT INTO public.mbg_districts (name, description)
    VALUES ('Kampala District', 'Capital district')
    ON CONFLICT (name) DO NOTHING
    RETURNING id INTO sample_district_id;
    
    -- If district already existed, get its ID
    IF sample_district_id IS NULL THEN
      SELECT id INTO sample_district_id FROM public.mbg_districts WHERE name = 'Kampala District';
    END IF;
    
    -- Create sample division
    INSERT INTO public.mbg_divisions (name, district_id, description)
    VALUES ('Kawempe Division', sample_district_id, 'Northern Kampala')
    ON CONFLICT (name, district_id) DO NOTHING
    RETURNING id INTO sample_division_id;
    
    IF sample_division_id IS NULL THEN
      SELECT id INTO sample_division_id FROM public.mbg_divisions WHERE name = 'Kawempe Division' AND district_id = sample_district_id;
    END IF;
    
    -- Create sample subcounty
    INSERT INTO public.mbg_subcounties (name, division_id, description)
    VALUES ('Kawempe Subcounty', sample_division_id, 'Main subcounty')
    ON CONFLICT (name, division_id) DO NOTHING
    RETURNING id INTO sample_subcounty_id;
    
    IF sample_subcounty_id IS NULL THEN
      SELECT id INTO sample_subcounty_id FROM public.mbg_subcounties WHERE name = 'Kawempe Subcounty' AND division_id = sample_division_id;
    END IF;
    
    -- Create sample parish
    INSERT INTO public.mbg_parishes (name, subcounty_id, description)
    VALUES ('Kazo Parish', sample_subcounty_id, 'Central parish')
    ON CONFLICT (name, subcounty_id) DO NOTHING
    RETURNING id INTO sample_parish_id;
    
    IF sample_parish_id IS NULL THEN
      SELECT id INTO sample_parish_id FROM public.mbg_parishes WHERE name = 'Kazo Parish' AND subcounty_id = sample_subcounty_id;
    END IF;
    
    -- Create sample stage (with or without location based on column existence)
    IF has_location_column THEN
      INSERT INTO public.mbg_stages (name, parish_id, description, location)
      VALUES ('Old Taxi Park Stage', sample_parish_id, 'Main boda stage', 'Near Old Taxi Park')
      ON CONFLICT (name, parish_id) DO NOTHING
      RETURNING id INTO sample_stage_id;
    ELSE
      INSERT INTO public.mbg_stages (name, parish_id, description)
      VALUES ('Old Taxi Park Stage', sample_parish_id, 'Main boda stage')
      ON CONFLICT (name, parish_id) DO NOTHING
      RETURNING id INTO sample_stage_id;
    END IF;
    
    IF sample_stage_id IS NULL THEN
      SELECT id INTO sample_stage_id FROM public.mbg_stages WHERE name = 'Old Taxi Park Stage' AND parish_id = sample_parish_id;
    END IF;
    
    RAISE NOTICE '✅ Sample stage created/found with ID: %', sample_stage_id;
    RAISE NOTICE 'You can now assign riders to this stage!';
  ELSE
    RAISE NOTICE '✅ Stages already exist. No sample data created.';
  END IF;
END $$;

-- ==============================================
-- VERIFICATION
-- ==============================================

DO $$
DECLARE
  stage_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO stage_count FROM public.mbg_stages;
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ Fix Complete!';
  RAISE NOTICE 'Created/Updated:';
  RAISE NOTICE '  - Region tables (districts, divisions, subcounties, parishes, stages)';
  RAISE NOTICE '  - mbg_assign_rider() function with validation';
  RAISE NOTICE '  - mbg_get_my_stage_id() helper function';
  RAISE NOTICE '';
  RAISE NOTICE 'Total stages in database: %', stage_count;
  
  IF stage_count = 0 THEN
    RAISE WARNING 'No stages found! You need to create stages before assigning riders.';
    RAISE WARNING 'Contact your administrator to create stages in your parishes.';
  END IF;
END $$;

-- Show existing stages
SELECT 
  s.id,
  s.name AS stage_name,
  p.name AS parish_name,
  sc.name AS subcounty_name,
  d.name AS division_name,
  dist.name AS district_name
FROM public.mbg_stages s
LEFT JOIN public.mbg_parishes p ON p.id = s.parish_id
LEFT JOIN public.mbg_subcounties sc ON sc.id = p.subcounty_id
LEFT JOIN public.mbg_divisions d ON d.id = sc.division_id
LEFT JOIN public.mbg_districts dist ON dist.id = d.district_id
ORDER BY s.name;
