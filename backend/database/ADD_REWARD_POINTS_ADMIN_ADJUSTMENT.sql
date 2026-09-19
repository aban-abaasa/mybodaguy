-- ============================================================================
-- Reward points: manual admin adjustment (developer panel).
-- ============================================================================
-- Every existing way to change mbg_reward_points.points_balance is automatic —
-- the ride-completion trigger, or a member's own redemption. There was no path
-- for a developer to correct a mistake, claw back abuse, or hand out a
-- goodwill bonus by hand. This adds exactly one RPC for that, gated the same
-- way mbg_update_redemption_status already gates admin-only actions (checked
-- inside the function itself, not RLS, since mbg_reward_points has no admin
-- UPDATE policy).
--
-- One signed p_points_delta covers both directions:
--   positive -> routed through the existing mbg_earn_reward_points (so it
--               bumps lifetime_points/tier too, same as any other earn, and
--               gets a fresh reference_id per call so two grants never dedupe
--               into one).
--   negative -> mirrors mbg_redeem_points_for_coins/_for_item: only
--               points_balance moves. lifetime_points (and therefore tier)
--               is a record of points ever earned and is deliberately left
--               alone, exactly like a normal redemption — a manual deduction
--               reads as "spent/removed", not "never earned".
-- Either way lands a row in mbg_reward_transactions (source
-- 'admin_adjustment') so every manual change has the same audit trail as
-- everything else in the ledger.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mbg_admin_adjust_reward_points(
  p_user_id      UUID,
  p_points_delta NUMERIC,
  p_note         TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_balance      NUMERIC;
  v_existing_role TEXT;
  v_reference_id TEXT;
  v_earn_result  JSONB;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mbg_users mu WHERE mu.id = auth.uid() AND mu.role_type = 'developer' AND mu.is_active = TRUE) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Requires developer role');
  END IF;

  IF p_user_id IS NULL OR p_points_delta = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Adjustment must target a user with a non-zero amount');
  END IF;

  v_reference_id := gen_random_uuid()::TEXT;

  IF p_points_delta > 0 THEN
    SELECT role INTO v_existing_role FROM public.mbg_reward_points WHERE user_id = p_user_id;

    v_earn_result := public.mbg_earn_reward_points(
      p_user_id, p_points_delta, COALESCE(v_existing_role, 'customer'),
      'admin_adjustment', v_reference_id,
      COALESCE(p_note, format('Developer adjustment: +%s points', p_points_delta::TEXT))
    );
    RETURN v_earn_result;
  END IF;

  -- Deduction: balance only, never below zero.
  SELECT points_balance INTO v_balance FROM public.mbg_reward_points WHERE user_id = p_user_id FOR UPDATE;
  IF v_balance IS NULL OR v_balance < ABS(p_points_delta) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Member does not have that many points to deduct');
  END IF;

  UPDATE public.mbg_reward_points
    SET points_balance = points_balance - ABS(p_points_delta), updated_at = now()
    WHERE user_id = p_user_id
    RETURNING points_balance INTO v_balance;

  INSERT INTO public.mbg_reward_transactions (user_id, points, direction, source, reference_id, note)
  VALUES (p_user_id, ABS(p_points_delta), 'redeem', 'admin_adjustment', v_reference_id,
          COALESCE(p_note, format('Developer adjustment: -%s points', ABS(p_points_delta)::TEXT)));

  RETURN jsonb_build_object('success', true, 'points_balance', v_balance, 'adjustment', p_points_delta);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mbg_admin_adjust_reward_points(UUID, NUMERIC, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ mbg_admin_adjust_reward_points ready — developers can now grant or deduct reward points by hand.';
END $$;
