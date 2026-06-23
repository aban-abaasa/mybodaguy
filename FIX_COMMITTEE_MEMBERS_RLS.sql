-- ==============================================
-- FIX COMMITTEE MEMBERS RLS POLICIES
-- ==============================================
-- Ensures chairpersons can read their own records without recursion

BEGIN;

-- Drop existing policies
DROP POLICY IF EXISTS committee_members_read_own ON public.mbg_committee_members;
DROP POLICY IF EXISTS committee_members_read_subordinates ON public.mbg_committee_members;
DROP POLICY IF EXISTS committee_members_read_developer ON public.mbg_committee_members;
DROP POLICY IF EXISTS committee_members_service_role ON public.mbg_committee_members;

-- Allow users to read their own committee member record (SIMPLE - NO RECURSION)
CREATE POLICY committee_members_read_own ON public.mbg_committee_members
  FOR SELECT
  USING (auth.uid() = user_id);

-- Developers can read all
CREATE POLICY committee_members_read_developer ON public.mbg_committee_members
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Service role has full access
CREATE POLICY committee_members_service_role ON public.mbg_committee_members
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Allow authorized inserts
DROP POLICY IF EXISTS committee_members_insert_authorized ON public.mbg_committee_members;
CREATE POLICY committee_members_insert_authorized ON public.mbg_committee_members
  FOR INSERT
  WITH CHECK (
    -- Service role can always insert
    auth.role() = 'service_role'
    OR
    -- Developers can assign anyone
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
  );

-- Allow updates
DROP POLICY IF EXISTS committee_members_update_authorized ON public.mbg_committee_members;
CREATE POLICY committee_members_update_authorized ON public.mbg_committee_members
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
    OR
    assigned_by = auth.uid()
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR
    EXISTS (
      SELECT 1 FROM public.mbg_users
      WHERE id = auth.uid()
        AND role_type = 'developer'
        AND is_active = true
    )
    OR
    assigned_by = auth.uid()
  );

COMMIT;

-- Test: Check if current user can see their record
SELECT 
  'Can I see my committee record?' as test,
  COUNT(*) as record_count,
  CASE WHEN COUNT(*) > 0 THEN '✅ YES' ELSE '❌ NO' END as result
FROM public.mbg_committee_members
WHERE user_id = auth.uid();

-- Show all committee members (if you're a developer)
SELECT 
  'All Committee Members' as info,
  u.email,
  cm.role,
  cm.region_type,
  cm.is_active
FROM public.mbg_committee_members cm
JOIN public.mbg_users u ON u.id = cm.user_id
ORDER BY u.email;
