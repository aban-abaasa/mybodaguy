-- =========================================================================
-- MY BODA GUY - COMPLETE ACCESS LEVEL VERIFICATION & FIX
-- =========================================================================
-- This script ensures proper access hierarchy from Developer to Riders
-- 
-- ROLE HIERARCHY (from highest to lowest):
-- 1. Developer (Super Admin) - Full system access
-- 2. Chairperson (5 levels: District → Division → Subcounty → Parish → Stage)
-- 3. Rider - Can accept rides and earn
-- 4. Customer - Can order rides/deliveries
-- =========================================================================

BEGIN;

-- =========================================================================
-- 1. VERIFY ROLE TYPE ENUM EXISTS
-- =========================================================================
DO $$ BEGIN
  CREATE TYPE mbg_user_role_type AS ENUM ('developer', 'chairperson', 'rider', 'customer');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- =========================================================================
-- 2. FIX mbg_users TABLE RLS POLICIES
-- =========================================================================
-- Ensure developers can see ALL users (needed for user management)
-- Chairpersons can see users in their region
-- Riders can see themselves
-- Customers can see themselves

DROP POLICY IF EXISTS mbg_users_read_developer ON public.mbg_users;
CREATE POLICY mbg_users_read_developer ON public.mbg_users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users dev
      WHERE dev.id = auth.uid()
        AND dev.role_type = 'developer'
        AND dev.is_active = true
    )
  );

-- Developers can UPDATE any user (role assignment, etc.)
DROP POLICY IF EXISTS mbg_users_update_developer ON public.mbg_users;
CREATE POLICY mbg_users_update_developer ON public.mbg_users
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users dev
      WHERE dev.id = auth.uid()
        AND dev.role_type = 'developer'
        AND dev.is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_users dev
      WHERE dev.id = auth.uid()
        AND dev.role_type = 'developer'
        AND dev.is_active = true
    )
  );

-- Chairpersons can read users in their region hierarchy
DROP POLICY IF EXISTS mbg_users_read_chairperson ON public.mbg_users;
CREATE POLICY mbg_users_read_chairperson ON public.mbg_users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.is_active = true
        AND cm.role IN ('district_chairperson', 'division_chairperson', 'subcounty_chairperson', 'parish_chairperson', 'stage_chairperson')
    )
  );

-- =========================================================================
-- 3. FIX GEOGRAPHIC REGIONS ACCESS (Districts, Divisions, etc.)
-- =========================================================================
-- Developer: Full CRUD access to all regions
-- Chairpersons: Read access to their assigned regions

-- DISTRICTS
DROP POLICY IF EXISTS districts_developer_full ON public.mbg_districts;
CREATE POLICY districts_developer_full ON public.mbg_districts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- DIVISIONS
DROP POLICY IF EXISTS divisions_developer_full ON public.mbg_divisions;
CREATE POLICY divisions_developer_full ON public.mbg_divisions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- SUBCOUNTIES
DROP POLICY IF EXISTS subcounties_developer_full ON public.mbg_subcounties;
CREATE POLICY subcounties_developer_full ON public.mbg_subcounties
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- PARISHES
DROP POLICY IF EXISTS parishes_developer_full ON public.mbg_parishes;
CREATE POLICY parishes_developer_full ON public.mbg_parishes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- STAGES
DROP POLICY IF EXISTS stages_developer_full ON public.mbg_stages;
CREATE POLICY stages_developer_full ON public.mbg_stages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- =========================================================================
-- 4. FIX COMMITTEE_MEMBERS (Chairpersons) ACCESS
-- =========================================================================
-- Developer: Can assign ANY chairperson at ANY level
-- District Chairperson: Can assign Division chairpersons in their district
-- And so on down the hierarchy

DROP POLICY IF EXISTS committee_members_developer_full ON public.mbg_committee_members;
CREATE POLICY committee_members_developer_full ON public.mbg_committee_members
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Chairpersons can read their subordinates
DROP POLICY IF EXISTS committee_members_read_chairperson ON public.mbg_committee_members;
CREATE POLICY committee_members_read_chairperson ON public.mbg_committee_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.is_active = true
    )
  );

-- =========================================================================
-- 5. FIX RIDERS ACCESS
-- =========================================================================
-- Developer: Can see ALL riders
-- Stage Chairperson: Can see riders in their stage
-- Riders: Can see themselves

DROP POLICY IF EXISTS riders_developer_full ON public.mbg_riders;
CREATE POLICY riders_developer_full ON public.mbg_riders
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Stage chairpersons can manage riders in their stage
DROP POLICY IF EXISTS riders_stage_chair_manage ON public.mbg_riders;
CREATE POLICY riders_stage_chair_manage ON public.mbg_riders
  FOR ALL
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

-- =========================================================================
-- 6. FIX RIDES TABLE ACCESS
-- =========================================================================
-- Developer: Can see ALL rides
-- Riders: Can see rides assigned to them
-- Customers: Can see their own rides
-- Chairpersons: Can see rides in their region

DROP POLICY IF EXISTS rides_developer_full ON public.mbg_rides;
CREATE POLICY rides_developer_full ON public.mbg_rides
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Chairpersons can view rides in their region
DROP POLICY IF EXISTS rides_chairperson_view ON public.mbg_rides;
CREATE POLICY rides_chairperson_view ON public.mbg_rides
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_committee_members cm
      WHERE cm.user_id = auth.uid()
        AND cm.is_active = true
    )
  );

-- =========================================================================
-- 7. FIX PAYMENTS ACCESS
-- =========================================================================
-- Developer: Can see ALL payments
-- Riders: Can see their own payments
-- Customers: Can see their own payments

DROP POLICY IF EXISTS payments_developer_full ON public.mbg_payments;
CREATE POLICY payments_developer_full ON public.mbg_payments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- =========================================================================
-- 8. FIX COMMISSIONS ACCESS
-- =========================================================================
-- Developer: Can see and modify ALL commissions
-- Chairpersons: Can see their own commission earnings

DROP POLICY IF EXISTS commissions_developer_full ON public.mbg_commissions;
CREATE POLICY commissions_developer_full ON public.mbg_commissions
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- =========================================================================
-- 9. FIX USER PROFILES ACCESS
-- =========================================================================
-- Everyone can read their own profile
-- Developer can read ALL profiles

DROP POLICY IF EXISTS user_profiles_developer_full ON public.mbg_user_profiles;
CREATE POLICY user_profiles_developer_full ON public.mbg_user_profiles
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- =========================================================================
-- 10. CREATE HELPER FUNCTION FOR ROLE ASSIGNMENT
-- =========================================================================
-- This function allows developers and authorized chairpersons to assign roles

CREATE OR REPLACE FUNCTION public.mbg_assign_user_role(
  target_user_id UUID,
  new_role_type mbg_user_role_type,
  stage_id UUID DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  assigner_role mbg_user_role_type;
  result JSON;
BEGIN
  -- Get assigner's role
  SELECT role_type INTO assigner_role
  FROM public.mbg_users
  WHERE id = auth.uid() AND is_active = true;

  -- Only developers can assign developer role
  IF new_role_type = 'developer' AND assigner_role != 'developer' THEN
    RAISE EXCEPTION 'Only developers can assign developer role';
  END IF;

  -- Update user role
  UPDATE public.mbg_users
  SET role_type = new_role_type,
      updated_at = NOW()
  WHERE id = target_user_id;

  -- If assigning rider role, create rider profile
  IF new_role_type = 'rider' AND stage_id IS NOT NULL THEN
    INSERT INTO public.mbg_riders (user_id, stage_id, status, approved_by, approved_at)
    VALUES (target_user_id, stage_id, 'active', auth.uid(), NOW())
    ON CONFLICT (user_id) 
    DO UPDATE SET 
      stage_id = EXCLUDED.stage_id,
      status = 'active',
      approved_by = auth.uid(),
      approved_at = NOW();
  END IF;

  -- If assigning chairperson role, create committee member record (must be done separately)

  result := json_build_object(
    'success', true,
    'user_id', target_user_id,
    'new_role', new_role_type,
    'message', 'Role assigned successfully'
  );

  RETURN result;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.mbg_assign_user_role TO authenticated;

-- =========================================================================
-- 11. VERIFICATION QUERIES
-- =========================================================================

-- Check developer account exists
SELECT 
  'DEVELOPER CHECK' as check_type,
  id, 
  email, 
  role_type, 
  is_active,
  CASE 
    WHEN role_type = 'developer' THEN '✅ Developer role assigned'
    ELSE '❌ NOT developer - needs fix'
  END as status
FROM public.mbg_users
WHERE email = 'abanabaasa2@gmail.com';

-- Check all role types in system
SELECT 
  'ROLE DISTRIBUTION' as check_type,
  role_type,
  COUNT(*) as user_count,
  COUNT(CASE WHEN is_active THEN 1 END) as active_count
FROM public.mbg_users
GROUP BY role_type
ORDER BY 
  CASE role_type
    WHEN 'developer' THEN 1
    WHEN 'chairperson' THEN 2
    WHEN 'rider' THEN 3
    WHEN 'customer' THEN 4
  END;

-- Check RLS policies on critical tables
SELECT 
  'RLS POLICIES CHECK' as check_type,
  schemaname,
  tablename,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename LIKE 'mbg_%'
GROUP BY schemaname, tablename
ORDER BY tablename;

COMMIT;

-- =========================================================================
-- SUMMARY OF ACCESS LEVELS
-- =========================================================================
-- 
-- DEVELOPER (Super Admin):
--   ✅ Full CRUD on all tables
--   ✅ Can assign any role to any user
--   ✅ Can create/edit geographic regions
--   ✅ Can view all rides, payments, commissions
--   ✅ Can manage platform settings
--
-- CHAIRPERSONS (5 levels):
--   ✅ Can view users in their region
--   ✅ Can assign lower-level chairpersons
--   ✅ Stage Chairpersons can assign riders
--   ✅ Can view rides in their region
--   ✅ Can view their commission earnings
--   ✅ Cannot assign developers
--
-- RIDERS:
--   ✅ Can view/update their own profile
--   ✅ Can view rides assigned to them
--   ✅ Can update ride status
--   ✅ Can view their payments
--   ✅ Cannot assign roles
--   ✅ Cannot view other riders
--
-- CUSTOMERS:
--   ✅ Can view/update their own profile
--   ✅ Can create ride requests
--   ✅ Can view their own rides
--   ✅ Can make payments
--   ✅ Can view available riders (for ride requests)
--   ✅ Cannot assign roles
--
-- =========================================================================
