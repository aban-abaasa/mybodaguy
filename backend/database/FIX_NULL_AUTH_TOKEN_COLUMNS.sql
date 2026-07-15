-- ============================================================================
-- FIX NULL TOKEN COLUMNS ON MANUALLY-INSERTED auth.users ROWS
--
-- CREATE_BODAGO_DEV_USER.sql (and possibly other scripts in this repo that
-- INSERT INTO auth.users directly instead of going through Supabase's
-- signup API) only set confirmation_token/recovery_token to '' and left
-- every other *_token/*_change column to its default, which is NULL.
--
-- Supabase's Go auth server (GoTrue) scans these columns as non-nullable
-- strings. Any row with one of them NULL makes GoTrue fail on read with:
--   "unable to fetch records: sql: Scan error on column index N,
--    name '<col>': converting NULL to string is unsupported"
-- — which breaks login/session lookups entirely for that specific user,
-- e.g. bodagoera@gmail.com.
--
-- This backfills '' into every affected column, project-wide, so it also
-- protects any other manually-created account with the same problem
-- (e.g. from FIX_EXISTING_USER.sql / SIMPLE_FIX.sql-style scripts).
-- Safe to run repeatedly.
-- ============================================================================

UPDATE auth.users SET
  confirmation_token          = COALESCE(confirmation_token, ''),
  recovery_token               = COALESCE(recovery_token, ''),
  email_change                 = COALESCE(email_change, ''),
  email_change_token_new       = COALESCE(email_change_token_new, ''),
  email_change_token_current   = COALESCE(email_change_token_current, ''),
  phone_change                 = COALESCE(phone_change, ''),
  phone_change_token           = COALESCE(phone_change_token, ''),
  reauthentication_token       = COALESCE(reauthentication_token, '')
WHERE
  confirmation_token IS NULL OR
  recovery_token IS NULL OR
  email_change IS NULL OR
  email_change_token_new IS NULL OR
  email_change_token_current IS NULL OR
  phone_change IS NULL OR
  phone_change_token IS NULL OR
  reauthentication_token IS NULL;

DO $$
BEGIN
  RAISE NOTICE '✅ Backfilled NULL auth.users token/change columns with '''' — affected accounts (bodagoera@gmail.com included) should be readable by GoTrue again.';
END $$;
