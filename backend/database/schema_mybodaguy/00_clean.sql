-- Clean all My Boda Guy tables for fresh initialization
-- WARNING: This will delete all data. Use only in development!
-- Note: Using mbg_ prefix to avoid conflicts with other apps in same Supabase

-- Drop all tables in reverse order of dependencies
DROP TABLE IF EXISTS public.mbg_commissions CASCADE;
DROP TABLE IF EXISTS public.mbg_payments CASCADE;
DROP TABLE IF EXISTS public.mbg_rides CASCADE;
DROP TABLE IF EXISTS public.mbg_customers CASCADE;
DROP TABLE IF EXISTS public.mbg_riders CASCADE;
DROP TABLE IF EXISTS public.mbg_committee_members CASCADE;
DROP TABLE IF EXISTS public.mbg_stages CASCADE;
DROP TABLE IF EXISTS public.mbg_parishes CASCADE;
DROP TABLE IF EXISTS public.mbg_subcounties CASCADE;
DROP TABLE IF EXISTS public.mbg_divisions CASCADE;
DROP TABLE IF EXISTS public.mbg_districts CASCADE;
DROP TABLE IF EXISTS public.mbg_platform_settings CASCADE;
DROP TABLE IF EXISTS public.mbg_user_profiles CASCADE;
DROP TABLE IF EXISTS public.mbg_users CASCADE;

-- Drop custom types
DROP TYPE IF EXISTS mbg_commission_status CASCADE;
DROP TYPE IF EXISTS mbg_payment_status CASCADE;
DROP TYPE IF EXISTS mbg_payment_method CASCADE;
DROP TYPE IF EXISTS mbg_cancellation_by CASCADE;
DROP TYPE IF EXISTS mbg_ride_status CASCADE;
DROP TYPE IF EXISTS mbg_rider_status CASCADE;
DROP TYPE IF EXISTS mbg_vehicle_type CASCADE;
DROP TYPE IF EXISTS mbg_chairperson_role CASCADE;
DROP TYPE IF EXISTS mbg_region_type CASCADE;
DROP TYPE IF EXISTS mbg_user_role_type CASCADE;

-- Drop functions and triggers
DROP TRIGGER IF EXISTS on_auth_user_created_mbg ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_auth_user_mbg CASCADE;

COMMIT;
