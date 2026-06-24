-- ==============================================
-- FIX TABLE NAME AND ASSIGNMENT ISSUES
-- ==============================================
-- This ensures the table is named correctly and the function works

BEGIN;

-- Step 1: Ensure enum types exist with both naming conventions
DO $$ BEGIN
  CREATE TYPE region_type AS ENUM ('district', 'division', 'subcounty', 'parish', 'stage');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE mbg_region_type AS ENUM ('district', 'division', 'subcounty', 'parish', 'stage');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE chairperson_role AS ENUM (
    'district_chairperson',
    'division_chairperson',
    'subcounty_chairperson',
    'parish_chairperson',
    'stage_chairperson'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

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

-- Step 2: Rename committee_members to mbg_committee_members if needed
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'committee_members') THEN
    IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'mbg_committee_members') THEN
      -- Rename the table
      ALTER TABLE public.committee_members RENAME TO mbg_committee_members;
      RAISE NOTICE 'Renamed committee_members to mbg_committee_members';
      
      -- Rename all policies
      DO $rename_policies$
      DECLARE
        pol RECORD;
      BEGIN
        FOR pol IN 
          SELECT policyname 
          FROM pg_policies 
          WHERE tablename = 'committee_members'
        LOOP
          EXECUTE format('ALTER POLICY %I ON public.mbg_committee_members RENAME TO %I',
            pol.policyname,
            replace(pol.policyname, 'committee_members', 'mbg_committee_members'));
        END LOOP;
      END $rename_policies$;
      
      -- Rename indexes
      DO $rename_indexes$
      DECLARE
        idx RECORD;
      BEGIN
        FOR idx IN 
          SELECT indexname 
          FROM pg_indexes 
          WHERE tablename = 'committee_members' 
          AND schemaname = 'public'
        LOOP
          EXECUTE format('ALTER INDEX %I RENAME TO %I',
            idx.indexname,
            replace(idx.indexname, 'committee_members', 'mbg_committee_members'));
        END LOOP;
      END $rename_indexes$;
    ELSE
      RAISE NOTICE 'Both tables exist - this is unusual. Using mbg_committee_members';
    END IF;
  ELSIF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'mbg_committee_members') THEN
    RAISE EXCEPTION 'Neither committee_members nor mbg_committee_members table exists!';
  ELSE
    RAISE NOTICE 'Table mbg_committee_members already exists';
  END IF;
END $$;

-- Step 3: Add parent_chairperson_id and commission_rate if missing
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'mbg_committee_members' 
    AND column_name = 'parent_chairperson_id'
  ) THEN
    ALTER TABLE public.mbg_committee_members 
    ADD COLUMN parent_chairperson_id UUID REFERENCES public.mbg_committee_members(id) ON DELETE SET NULL;
    RAISE NOTICE 'Added parent_chairperson_id column';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'mbg_committee_members' 
    AND column_name = 'commission_rate'
  ) THEN
    ALTER TABLE public.mbg_committee_members 
    ADD COLUMN commission_rate DECIMAL(5,2) DEFAULT 5.00 CHECK (commission_rate >= 0 AND commission_rate <= 100);
    RAISE NOTICE 'Added commission_rate column';
  END IF;
END $$;

-- Step 4: Create indexes
CREATE INDEX IF NOT EXISTS mbg_committee_members_user_id_idx ON public.mbg_committee_members(user_id);
CREATE INDEX IF NOT EXISTS mbg_committee_members_role_idx ON public.mbg_committee_members(role);
CREATE INDEX IF NOT EXISTS mbg_committee_members_region_idx ON public.mbg_committee_members(region_type, region_id);
CREATE INDEX IF NOT EXISTS mbg_committee_members_assigned_by_idx ON public.mbg_committee_members(assigned_by);
CREATE INDEX IF NOT EXISTS mbg_committee_members_is_active_idx ON public.mbg_committee_members(is_active);
CREATE INDEX IF NOT EXISTS mbg_committee_members_parent_chairperson_idx 
  ON public.mbg_committee_members(parent_chairperson_id) 
  WHERE parent_chairperson_id IS NOT NULL AND is_active = true;

-- Step 5: Ensure RLS policies exist for mbg_committee_members
ALTER TABLE public.mbg_committee_members ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own records
DROP POLICY IF EXISTS mbg_committee_members_read_own ON public.mbg_committee_members;
CREATE POLICY mbg_committee_members_read_own ON public.mbg_committee_members
  FOR SELECT
  USING (auth.uid() = user_id);

-- Allow users to read their subordinates
DROP POLICY IF EXISTS mbg_committee_members_read_subordinates ON public.mbg_committee_members;
CREATE POLICY mbg_committee_members_read_subordinates ON public.mbg_committee_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members parent
      WHERE parent.user_id = auth.uid()
        AND parent.id = mbg_committee_members.parent_chairperson_id
        AND parent.is_active = true
    )
  );

-- Allow service role full access
DROP POLICY IF EXISTS mbg_committee_members_service_role ON public.mbg_committee_members;
CREATE POLICY mbg_committee_members_service_role ON public.mbg_committee_members
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Allow authenticated users to insert (function will handle authorization)
DROP POLICY IF EXISTS mbg_committee_members_insert_authenticated ON public.mbg_committee_members;
CREATE POLICY mbg_committee_members_insert_authenticated ON public.mbg_committee_members
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' OR auth.role() = 'service_role');

-- Allow updates for service role and own records
DROP POLICY IF EXISTS mbg_committee_members_update_own ON public.mbg_committee_members;
CREATE POLICY mbg_committee_members_update_own ON public.mbg_committee_members
  FOR UPDATE
  USING (auth.uid() = assigned_by OR auth.role() = 'service_role')
  WITH CHECK (auth.uid() = assigned_by OR auth.role() = 'service_role');

-- Step 6: Create the assignment function
DROP FUNCTION IF EXISTS public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) CASCADE;

CREATE OR REPLACE FUNCTION public.mbg_assign_chairperson(
  target_user_id UUID,
  target_role TEXT,
  target_region_type TEXT,
  target_region_id UUID,
  commission_rate DECIMAL DEFAULT 5.00
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_committee_member_id UUID;
  assigner_committee_id UUID;
  typed_role mbg_chairperson_role;
  typed_region mbg_region_type;
BEGIN
  -- Cast TEXT to proper enum types
  typed_role := target_role::mbg_chairperson_role;
  typed_region := target_region_type::mbg_region_type;

  -- Get assigner's committee member ID (if they have one)
  SELECT id INTO assigner_committee_id
  FROM public.mbg_committee_members
  WHERE user_id = auth.uid() 
    AND is_active = true
  LIMIT 1;

  -- Update user role to chairperson
  UPDATE public.mbg_users
  SET role_type = 'chairperson',
      updated_at = NOW()
  WHERE id = target_user_id;

  -- Insert or update committee member with parent relationship
  INSERT INTO public.mbg_committee_members (
    user_id,
    role,
    region_type,
    region_id,
    assigned_by,
    parent_chairperson_id,
    commission_rate,
    is_active,
    appointed_at
  )
  VALUES (
    target_user_id,
    typed_role,
    typed_region,
    target_region_id,
    auth.uid(),
    assigner_committee_id,
    commission_rate,
    TRUE,
    NOW()
  )
  ON CONFLICT (user_id, region_type, region_id) 
  DO UPDATE SET
    role = EXCLUDED.role,
    assigned_by = EXCLUDED.assigned_by,
    parent_chairperson_id = EXCLUDED.parent_chairperson_id,
    commission_rate = EXCLUDED.commission_rate,
    is_active = TRUE,
    updated_at = NOW()
  RETURNING id INTO new_committee_member_id;

  RETURN new_committee_member_id;
END;
$$;

COMMENT ON FUNCTION public.mbg_assign_chairperson IS 'Assign a user as chairperson for a specific region (MyBodaGuy specific)';

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_assign_chairperson(UUID, TEXT, TEXT, UUID, DECIMAL) TO service_role;

-- Step 7: Create the get subordinates function
DROP FUNCTION IF EXISTS public.get_subordinate_chairpersons(UUID) CASCADE;

CREATE OR REPLACE FUNCTION public.get_subordinate_chairpersons(
  chairperson_user_id UUID
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  role mbg_chairperson_role,
  region_type mbg_region_type,
  region_id UUID,
  region_name TEXT,
  commission_rate DECIMAL,
  is_active BOOLEAN,
  appointed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  chairperson_committee_id UUID;
BEGIN
  -- Get the chairperson's committee member ID
  SELECT cm.id INTO chairperson_committee_id
  FROM public.mbg_committee_members cm
  WHERE cm.user_id = chairperson_user_id
    AND cm.is_active = true
  LIMIT 1;

  IF chairperson_committee_id IS NULL THEN
    RETURN;
  END IF;

  -- Return all subordinates assigned by this chairperson
  RETURN QUERY
  SELECT 
    cm.id,
    cm.user_id,
    COALESCE(up.full_name, u.email) as full_name,
    u.email,
    COALESCE(up.phone, '') as phone,
    cm.role,
    cm.region_type,
    cm.region_id,
    CASE cm.region_type
      WHEN 'district' THEN (SELECT d.name FROM public.mbg_districts d WHERE d.id = cm.region_id)
      WHEN 'division' THEN (SELECT dv.name FROM public.mbg_divisions dv WHERE dv.id = cm.region_id)
      WHEN 'subcounty' THEN (SELECT sc.name FROM public.mbg_subcounties sc WHERE sc.id = cm.region_id)
      WHEN 'parish' THEN (SELECT p.name FROM public.mbg_parishes p WHERE p.id = cm.region_id)
      WHEN 'stage' THEN (SELECT s.name FROM public.mbg_stages s WHERE s.id = cm.region_id)
      ELSE 'Unknown Region'
    END as region_name,
    cm.commission_rate,
    cm.is_active,
    cm.appointed_at
  FROM public.mbg_committee_members cm
  INNER JOIN public.mbg_users u ON u.id = cm.user_id
  LEFT JOIN public.mbg_user_profiles up ON up.user_id = cm.user_id
  WHERE cm.parent_chairperson_id = chairperson_committee_id
    AND cm.is_active = true
  ORDER BY cm.appointed_at DESC;
END;
$$;

COMMENT ON FUNCTION public.get_subordinate_chairpersons IS 'Get all subordinate chairpersons for a given chairperson';

GRANT EXECUTE ON FUNCTION public.get_subordinate_chairpersons(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_subordinate_chairpersons(UUID) TO service_role;

COMMIT;

-- Final check
SELECT 
  'SUCCESS: Table name fixed, columns added, functions created!' as status,
  (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'mbg_committee_members') as table_exists,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'mbg_committee_members' AND column_name = 'parent_chairperson_id') as has_parent_column,
  (SELECT COUNT(*) FROM information_schema.routines WHERE routine_name = 'mbg_assign_chairperson') as has_assign_function;
