-- Create function for stage chairpersons to assign riders
-- Stage chairpersons can assign riders to their stage

-- ==============================================
-- 1. CREATE ENUMS (if not exist)
-- ==============================================

DO $$ BEGIN
  CREATE TYPE mbg_vehicle_type AS ENUM ('motorcycle', 'bicycle', 'tuktuk');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE mbg_rider_status AS ENUM ('pending', 'active', 'suspended', 'inactive');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ==============================================
-- 2. CREATE/UPDATE mbg_riders TABLE
-- ==============================================

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

ALTER TABLE public.mbg_riders ENABLE ROW LEVEL SECURITY;

-- ==============================================
-- 3. RLS POLICIES FOR mbg_riders
-- ==============================================

-- Drop existing policies
DROP POLICY IF EXISTS mbg_riders_read_own ON public.mbg_riders;
DROP POLICY IF EXISTS mbg_riders_insert_own ON public.mbg_riders;
DROP POLICY IF EXISTS mbg_riders_update_own_availability ON public.mbg_riders;
DROP POLICY IF EXISTS mbg_riders_read_stage_chair ON public.mbg_riders;
DROP POLICY IF EXISTS mbg_riders_update_stage_chair ON public.mbg_riders;
DROP POLICY IF EXISTS mbg_riders_insert_stage_chair ON public.mbg_riders;
DROP POLICY IF EXISTS mbg_riders_read_developer ON public.mbg_riders;
DROP POLICY IF EXISTS mbg_riders_read_customers ON public.mbg_riders;
DROP POLICY IF EXISTS mbg_riders_service_role ON public.mbg_riders;

-- Riders can read their own record
CREATE POLICY mbg_riders_read_own ON public.mbg_riders
  FOR SELECT
  USING (auth.uid() = user_id);

-- Riders can insert their own record (self-registration)
CREATE POLICY mbg_riders_insert_own ON public.mbg_riders
  FOR INSERT
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- Riders can update their own availability
CREATE POLICY mbg_riders_update_own_availability ON public.mbg_riders
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Stage chairpersons can read riders in their stage
CREATE POLICY mbg_riders_read_stage_chair ON public.mbg_riders
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role = 'stage_chairperson'
        AND cm.region_type = 'stage'
        AND cm.region_id = mbg_riders.stage_id
        AND cm.is_active = true
    )
  );

-- Stage chairpersons can insert riders to their stage
CREATE POLICY mbg_riders_insert_stage_chair ON public.mbg_riders
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role = 'stage_chairperson'
        AND cm.region_type = 'stage'
        AND cm.region_id = mbg_riders.stage_id
        AND cm.is_active = true
    )
  );

-- Stage chairpersons can approve/suspend riders in their stage
CREATE POLICY mbg_riders_update_stage_chair ON public.mbg_riders
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role = 'stage_chairperson'
        AND cm.region_type = 'stage'
        AND cm.region_id = mbg_riders.stage_id
        AND cm.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.role = 'stage_chairperson'
        AND cm.region_type = 'stage'
        AND cm.region_id = mbg_riders.stage_id
        AND cm.is_active = true
    )
  );

-- Developers can read all riders
CREATE POLICY mbg_riders_read_developer ON public.mbg_riders
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users u
      WHERE u.id = auth.uid()
        AND u.role_type = 'developer'
        AND u.is_active = true
    )
  );

-- Customers can read active available riders
CREATE POLICY mbg_riders_read_customers ON public.mbg_riders
  FOR SELECT
  USING (
    status = 'active' 
    AND is_available = true
    AND EXISTS (
      SELECT 1 FROM public.mbg_users u
      WHERE u.id = auth.uid()
        AND u.role_type = 'customer'
    )
  );

-- Service role has full access
CREATE POLICY mbg_riders_service_role ON public.mbg_riders
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ==============================================
-- 4. CREATE INDEXES
-- ==============================================

CREATE INDEX IF NOT EXISTS mbg_riders_user_id_idx ON public.mbg_riders(user_id);
CREATE INDEX IF NOT EXISTS mbg_riders_stage_id_idx ON public.mbg_riders(stage_id);
CREATE INDEX IF NOT EXISTS mbg_riders_status_idx ON public.mbg_riders(status);
CREATE INDEX IF NOT EXISTS mbg_riders_is_available_idx ON public.mbg_riders(is_available);
CREATE INDEX IF NOT EXISTS mbg_riders_plate_number_idx ON public.mbg_riders(plate_number);
CREATE INDEX IF NOT EXISTS mbg_riders_rating_idx ON public.mbg_riders(rating);

-- ==============================================
-- 5. ASSIGN RIDER FUNCTION
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
  result JSON;
BEGIN
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

COMMENT ON FUNCTION public.mbg_assign_rider IS 'Stage chairpersons can assign riders to their stage';

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.mbg_assign_rider TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_assign_rider TO service_role;

-- ==============================================
-- 6. GET RIDERS FOR STAGE FUNCTION
-- ==============================================

CREATE OR REPLACE FUNCTION public.mbg_get_stage_riders(
  target_stage_id UUID
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  vehicle_type mbg_vehicle_type,
  plate_number TEXT,
  license_number TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  status mbg_rider_status,
  is_available BOOLEAN,
  rating DECIMAL,
  total_rides INTEGER,
  completed_rides INTEGER,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify caller is stage chairperson for this stage or developer
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_committee_members cm
    WHERE cm.user_id = auth.uid()
      AND cm.role = 'stage_chairperson'
      AND cm.region_type = 'stage'
      AND cm.region_id = target_stage_id
      AND cm.is_active = true
  ) AND NOT EXISTS (
    SELECT 1 FROM public.mbg_users u
    WHERE u.id = auth.uid()
      AND u.role_type = 'developer'
      AND u.is_active = true
  ) THEN
    RETURN; -- Return empty if not authorized
  END IF;

  RETURN QUERY
  SELECT 
    r.id AS id,
    r.user_id AS user_id,
    COALESCE(up.full_name, u.email) AS full_name,
    u.email AS email,
    up.phone AS phone,
    r.vehicle_type AS vehicle_type,
    r.plate_number AS plate_number,
    r.license_number AS license_number,
    r.vehicle_model AS vehicle_model,
    r.vehicle_color AS vehicle_color,
    r.status AS status,
    r.is_available AS is_available,
    r.rating AS rating,
    r.total_rides AS total_rides,
    r.completed_rides AS completed_rides,
    r.approved_at AS approved_at,
    r.created_at AS created_at
  FROM public.mbg_riders r
  INNER JOIN public.mbg_users u ON u.id = r.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = r.user_id
  WHERE r.stage_id = target_stage_id
  ORDER BY r.created_at DESC;
END;
$$;

COMMENT ON FUNCTION public.mbg_get_stage_riders IS 'Get all riders for a specific stage (MyBodaGuy)';

GRANT EXECUTE ON FUNCTION public.mbg_get_stage_riders(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_get_stage_riders(UUID) TO service_role;

-- ==============================================
-- VERIFICATION
-- ==============================================

DO $$
BEGIN
  RAISE NOTICE '✅ Rider Assignment Setup Complete!';
  RAISE NOTICE 'Created:';
  RAISE NOTICE '  - mbg_riders table with RLS policies';
  RAISE NOTICE '  - mbg_assign_rider() function';
  RAISE NOTICE '  - mbg_get_stage_riders() function';
  RAISE NOTICE '  - Indexes for performance';
  RAISE NOTICE '';
  RAISE NOTICE 'Stage chairpersons can now assign riders to their stages!';
END $$;
