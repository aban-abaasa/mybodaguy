-- ==============================================
-- ENSURE USER PROFILES TABLE IS COMPLETE
-- ==============================================
-- Adds any missing columns to mbg_user_profiles

BEGIN;

-- Add missing columns if they don't exist
ALTER TABLE public.mbg_user_profiles 
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS date_of_birth DATE,
ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male', 'female', 'other')),
ADD COLUMN IF NOT EXISTS national_id TEXT,
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS city TEXT,
ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Uganda',
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Ensure RLS is enabled
ALTER TABLE public.mbg_user_profiles ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS user_profiles_read_own ON public.mbg_user_profiles;
DROP POLICY IF EXISTS user_profiles_insert_own ON public.mbg_user_profiles;
DROP POLICY IF EXISTS user_profiles_update_own ON public.mbg_user_profiles;
DROP POLICY IF EXISTS user_profiles_read_developer ON public.mbg_user_profiles;
DROP POLICY IF EXISTS user_profiles_service_role ON public.mbg_user_profiles;

-- Users can read their own profile
CREATE POLICY user_profiles_read_own ON public.mbg_user_profiles
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own profile
CREATE POLICY user_profiles_insert_own ON public.mbg_user_profiles
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own profile
CREATE POLICY user_profiles_update_own ON public.mbg_user_profiles
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Developers can read all profiles
CREATE POLICY user_profiles_read_developer ON public.mbg_user_profiles
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
CREATE POLICY user_profiles_service_role ON public.mbg_user_profiles
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS user_profiles_user_id_idx ON public.mbg_user_profiles(user_id);
CREATE INDEX IF NOT EXISTS user_profiles_full_name_idx ON public.mbg_user_profiles(full_name);
CREATE INDEX IF NOT EXISTS user_profiles_city_idx ON public.mbg_user_profiles(city);

COMMIT;

-- Verify structure
SELECT 
  'User Profiles Table Structure' as info,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'mbg_user_profiles'
ORDER BY ordinal_position;
