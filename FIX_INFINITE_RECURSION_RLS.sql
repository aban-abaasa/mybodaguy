-- ==============================================
-- FIX INFINITE RECURSION IN RLS POLICY
-- ==============================================
-- Replace the recursive policy with simple, non-recursive ones

BEGIN;

-- Drop the problematic recursive policy
DROP POLICY IF EXISTS mbg_committee_members_read_subordinates ON public.mbg_committee_members;

-- Simple policy 1: Read your own records
DROP POLICY IF EXISTS mbg_committee_members_read_own ON public.mbg_committee_members;
CREATE POLICY mbg_committee_members_read_own ON public.mbg_committee_members
  FOR SELECT
  USING (user_id = auth.uid());

-- Simple policy 2: Read records where you are the assigner
DROP POLICY IF EXISTS mbg_committee_members_read_assigned ON public.mbg_committee_members;
CREATE POLICY mbg_committee_members_read_assigned ON public.mbg_committee_members
  FOR SELECT
  USING (assigned_by = auth.uid());

-- Policy 3: Service role has full access
DROP POLICY IF EXISTS mbg_committee_members_service_role ON public.mbg_committee_members;
CREATE POLICY mbg_committee_members_service_role ON public.mbg_committee_members
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Policy 4: Allow inserts for authenticated users (function handles authorization)
DROP POLICY IF EXISTS mbg_committee_members_insert ON public.mbg_committee_members;
CREATE POLICY mbg_committee_members_insert ON public.mbg_committee_members
  FOR INSERT
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- Policy 5: Allow updates for records you assigned
DROP POLICY IF EXISTS mbg_committee_members_update ON public.mbg_committee_members;
CREATE POLICY mbg_committee_members_update ON public.mbg_committee_members
  FOR UPDATE
  USING (assigned_by = auth.uid() OR auth.role() = 'service_role')
  WITH CHECK (assigned_by = auth.uid() OR auth.role() = 'service_role');

COMMIT;

SELECT 
  'SUCCESS: RLS policies fixed!' as status,
  'No more infinite recursion' as message,
  'You can now read records you assigned' as note;
