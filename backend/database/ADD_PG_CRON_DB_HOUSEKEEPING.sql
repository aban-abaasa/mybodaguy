-- ============================================================================
-- PG_CRON DB HOUSEKEEPING — Run ONCE in the Supabase SQL Editor
-- ============================================================================
-- This is a DB-wide fix, not app-specific: ICAN, digital-city-era and
-- mybodaguy all share the one Supabase project/database, so this only needs
-- to be applied once regardless of which repo you're looking at it from.
--
-- pg_cron logs one row per run into cron.job_run_details for every scheduled
-- job in this project (journey dispatch every 2 min, cargo dispatch retry
-- every 5 min, flight-status poll every 15 min — see ADD_PG_CRON_DISPATCH.sql
-- — plus this job itself). Supabase never prunes that table for you, so it
-- grows forever; it was flagged at 11.63 MB (>10% of the Free Plan's 500 MB
-- database-size cap) purely from run-history rows nobody reads after a few
-- days. This adds a daily job that deletes anything older than 7 days, so
-- the table stays small permanently instead of needing a one-off DELETE
-- every time it's noticed again.
--
-- Safe to run more than once.
-- ============================================================================

DO $$
BEGIN
  PERFORM cron.unschedule('db-housekeeping-prune-cron-logs');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'db-housekeeping-prune-cron-logs',
  '0 3 * * *', -- daily at 03:00 UTC
  $$ DELETE FROM cron.job_run_details WHERE end_time < now() - interval '7 days'; $$
);

DO $$
BEGIN
  RAISE NOTICE '✅ cron.job_run_details now auto-prunes rows older than 7 days, daily at 03:00 UTC.';
END $$;
