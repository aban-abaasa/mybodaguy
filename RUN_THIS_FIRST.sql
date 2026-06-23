-- ==============================================
-- RUN THIS FIRST - Creates base tables if missing
-- ==============================================
-- Copy and paste this entire file into Supabase SQL Editor
-- Then run the file: 11_hierarchical_chairperson_management.sql

BEGIN;

-- Check and create mbg_users table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'mbg_users') THEN
    -- Run the complete mybodaguy schema setup
    RAISE NOTICE 'Creating base tables...';
  ELSE
    RAISE NOTICE 'Base tables already exist';
  END IF;
END $$;

-- Run all base schema files in order
-- You need to run these SQL files from backend/database/schema_mybodaguy/ in this order:

-- 1. backend/database/schema_mybodaguy/01_users.sql
-- 2. backend/database/schema_mybodaguy/02_geographic_regions.sql  
-- 3. backend/database/schema_mybodaguy/03_user_profiles.sql
-- 4. backend/database/schema_mybodaguy/04_committee_members.sql
-- 5. backend/database/schema_mybodaguy/05_riders.sql
-- 6. backend/database/schema_mybodaguy/06_customers.sql
-- 7. backend/database/schema_mybodaguy/07_rides.sql
-- 8. backend/database/schema_mybodaguy/08_payments.sql
-- 9. backend/database/schema_mybodaguy/09_commissions.sql
-- 10. backend/database/schema_mybodaguy/10_platform_settings.sql

-- After running all the above, then run:
-- 11. backend/database/schema_mybodaguy/11_hierarchical_chairperson_management.sql

COMMIT;
