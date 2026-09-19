-- ============================================================================
-- Reward points → ICAN redemption: no 10% tithe.
-- ============================================================================
-- mbg_redeem_points_for_coins (ADD_REWARD_POINTS_LOYALTY_SYSTEM.sql) routed
-- through the shared credit_ican_earning() specifically to pay the same 10%
-- tithe as every other ICAN earning, so a customer/rider couldn't dodge the
-- tithe by laundering an earning through points first. Product call now:
-- points redemption should be tithe-free — 100 points converts to a full 1
-- ICAN, not 0.9.
--
-- credit_ican_earning() has no "skip the tithe" parameter (it's a flat 10%
-- for every caller across all three apps sharing this DB), so this instead
-- credits the wallet directly — same two effects credit_ican_earning would
-- have done (balance bump + an 'earn' ledger row), just without the second
-- 'tithe' row siphoning 10% off. This does NOT touch credit_ican_earning
-- itself — every other real earning path (rides, deliveries, cashback, etc.,
-- in this app and across ICAN/digital-city-era) keeps paying its tithe
-- exactly as before.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_redeem_points_for_coins(
  p_user_id UUID,
  p_points  NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_balance    NUMERIC;
  v_ican_gross NUMERIC;
  v_redemption_id UUID;
  v_actor_role TEXT;
BEGIN
  IF p_points <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Points must be positive');
  END IF;

  SELECT points_balance INTO v_balance FROM mbg_reward_points WHERE user_id = p_user_id FOR UPDATE;
  IF v_balance IS NULL OR v_balance < p_points THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not enough points');
  END IF;

  v_ican_gross := ROUND(p_points / 100.0, 8);

  UPDATE mbg_reward_points SET points_balance = points_balance - p_points, updated_at = now()
    WHERE user_id = p_user_id;

  INSERT INTO mbg_reward_redemptions (user_id, item_name, points_spent, status)
  VALUES (p_user_id, format('%s ICAN Coins', v_ican_gross::TEXT), p_points, 'fulfilled')
  RETURNING id INTO v_redemption_id;

  INSERT INTO mbg_reward_transactions (user_id, points, direction, source, reference_id, note)
  VALUES (p_user_id, p_points, 'redeem', 'redeem_coins', v_redemption_id::TEXT,
          format('Converted %s points to %s ICAN (no tithe)', p_points::TEXT, v_ican_gross::TEXT));

  -- Credit the wallet in full — no tithe split.
  PERFORM public.get_or_create_ican_wallet(p_user_id);
  v_actor_role := public.ican_resolve_caller_role();

  UPDATE public.ican_user_wallets
  SET ican_balance = ican_balance + v_ican_gross,
      total_earned = total_earned + v_ican_gross
  WHERE user_id = p_user_id;

  INSERT INTO public.ican_coin_transactions
    (recipient_user_id, ican_amount, transaction_type, source_app, reference_id, note, actor_role)
  VALUES
    (p_user_id, v_ican_gross, 'earn', 'mybodaguy', v_redemption_id::TEXT,
     format('Reward points redeemed: %s points -> ICAN (no tithe)', p_points::TEXT), v_actor_role);

  RETURN jsonb_build_object(
    'success', true,
    'points_spent', p_points,
    'ican_credited', v_ican_gross,
    'redemption_id', v_redemption_id
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_redeem_points_for_coins(UUID, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Reward points -> ICAN redemption is now tithe-free: 100 points = 1 full ICAN credited.';
END $$;
