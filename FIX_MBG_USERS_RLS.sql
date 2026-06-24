-- ==============================================
-- FIX MBG_USERS RLS POLICIES
-- ==============================================
-- Ensure users can read their own record without hanging

BEGIN;

-- Drop all existing policies on mbg_users
DROP POLICY IF EXISTS mbg_users_read_own ON public.mbg_users;
DROP POLICY IF EXISTS mbg_users_service_role ON public.mbg_users;
DROP POLICY IF EXISTS mbg_users_insert ON public.mbg_users;
DROP POLICY IF EXISTS mbg_users_update_own ON public.mbg_users;

-- Simple policy: Users can read their own record
CREATE POLICY mbg_users_read_own ON public.mbg_users
  FOR SELECT
  USING (id = auth.uid());

-- Service role has full access
CREATE POLICY mbg_users_service_role ON public.mbg_users
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Allow inserts for authenticated users (for signup)
CREATE POLICY mbg_users_insert ON public.mbg_users
  FOR INSERT
  WITH CHECK (auth.role() IN ('authenticated', 'service_role'));

-- Allow users to update their own record
CREATE POLICY mbg_users_update_own ON public.mbg_users
  FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

COMMIT;

SELECT 'RLS policies fixed for mbg_users!' as status;
