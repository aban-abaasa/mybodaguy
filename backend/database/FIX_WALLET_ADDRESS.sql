-- ================================================================
-- FIX: wallet_address NOT NULL violation in get_or_create_ican_wallet
-- ================================================================
-- Root cause: the function inserts only (user_id), but wallet_address
-- either lacks a DEFAULT or the DEFAULT isn't firing properly.
-- Fix: update both the column DEFAULT and the function.
-- ================================================================

BEGIN;

-- Step 1: Ensure the column has a DEFAULT so plain INSERT (user_id) works.
ALTER TABLE public.ican_user_wallets
  ALTER COLUMN wallet_address
  SET DEFAULT 'ICA-' || upper(substr(md5(gen_random_uuid()::text), 1, 16));

-- Step 2: Replace the function to explicitly generate the address,
-- removing dependency on the DEFAULT being present.
CREATE OR REPLACE FUNCTION public.get_or_create_ican_wallet(p_user_id UUID)
RETURNS public.ican_user_wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.ican_user_wallets;
  v_address TEXT;
BEGIN
  -- Guard: do nothing if called with NULL (e.g. from SQL Editor where auth.uid() = NULL)
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_wallet FROM public.ican_user_wallets WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    v_address := 'ICA-' || upper(substr(md5(gen_random_uuid()::text), 1, 16));

    INSERT INTO public.ican_user_wallets (user_id, wallet_address)
    VALUES (p_user_id, v_address)
    ON CONFLICT (user_id) DO NOTHING
    RETURNING * INTO v_wallet;

    -- Handle race condition: another session inserted first.
    IF v_wallet IS NULL THEN
      SELECT * INTO v_wallet FROM public.ican_user_wallets WHERE user_id = p_user_id;
    END IF;
  END IF;

  RETURN v_wallet;
END;
$$;

COMMIT;

-- Verify: check the function exists and the column has a default.
SELECT
  column_name, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'ican_user_wallets' AND column_name = 'wallet_address';
