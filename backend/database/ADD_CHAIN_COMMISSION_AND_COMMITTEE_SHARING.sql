-- ============================================================================
-- CHAIN COMMISSION + WORKING-COMMITTEE SHARING
-- ----------------------------------------------------------------------------
-- Replaces the flat per-level split of the platform pool with a cascade that
-- follows the geography tree (stage -> parish -> subcounty -> division -> district):
--
--   pool      = fare - rider_earning            (the commission taken off the ride)
--   stage     = pool * chain%                   (default 5%)
--   parish    = stage amount * chain%
--   subcounty = parish amount * chain%
--   division  = subcounty amount * chain%
--   district  = division amount * chain%
--
-- Every chairperson's amount is then shared with their active working-committee
-- members: each member gets member% (default 5%) of that amount, taken out of the
-- chairperson's own share, so the level total is unchanged.
-- A region may have any number of chairpersons; the level amount is split equally.
-- A vacant level's amount stays with ICANera (the callers credit the remainder).
-- A chairperson's committee is the set of active members attached to any of that
-- person's active seats.
-- ============================================================================

INSERT INTO public.mbg_platform_settings (key, value, value_type, description, category, is_public)
VALUES
  ('commission.chain_percentage', '5', 'number',
   'Each chairperson level earns this % of the level below (stage earns it from the ride commission pool). Developer-editable.', 'commission', true),
  ('commission.committee_member_percentage', '5', 'number',
   'Each active working-committee member earns this % of their chairperson''s amount, paid out of the chairperson''s share. Developer-editable.', 'commission', true)
ON CONFLICT (key) DO NOTHING;

-- Amounts at the top of the chain are fractions of a shilling: keep the precision.
ALTER TABLE public.mbg_commissions
  ALTER COLUMN commission_amount     TYPE numeric(16,6),
  ALTER COLUMN commission_percentage TYPE numeric(14,8);

UPDATE public.mbg_committee_profile_members
   SET commission_rate = public.mbg_get_setting_numeric('commission.committee_member_percentage', 5),
       updated_at = now()
 WHERE commission_rate IS DISTINCT FROM public.mbg_get_setting_numeric('commission.committee_member_percentage', 5);

CREATE OR REPLACE FUNCTION public.mbg_distribute_chair_commissions(
  p_ride_id uuid,
  p_payment_id uuid,
  p_stage_id uuid,
  p_fare numeric,
  p_pool_ugx numeric,
  p_note text DEFAULT 'chairperson commission',
  p_require_eligible boolean DEFAULT false
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  ICAN_TO_UGX CONSTANT numeric := 5000;
  v_levels constant text[] := ARRAY['stage','parish','subcounty','division','district'];
  v_chain_pct  numeric := public.mbg_get_setting_numeric('commission.chain_percentage', 5);
  v_member_pct numeric := public.mbg_get_setting_numeric('commission.committee_member_percentage', 5);
  v_type text;
  v_rid uuid;
  v_amt numeric;
  v_seats uuid[];
  v_seat record;
  v_member uuid;
  v_members uuid[];
  v_share numeric;
  v_each numeric;
  v_chair_net numeric;
  v_paid numeric := 0;
  i int;
BEGIN
  IF p_stage_id IS NULL OR COALESCE(p_pool_ugx, 0) <= 0 THEN
    RETURN 0;
  END IF;

  FOR i IN 1..5 LOOP
    v_type := v_levels[i];
    IF i = 1 THEN
      v_rid := p_stage_id;
      v_amt := p_pool_ugx * v_chain_pct / 100;
    ELSE
      SELECT rp.parent_id INTO v_rid FROM public.mbg_region_parent(v_levels[i - 1], v_rid) rp;
      v_amt := v_amt * v_chain_pct / 100;
    END IF;
    EXIT WHEN v_rid IS NULL;

    SELECT array_agg(cm.id ORDER BY cm.appointed_at) INTO v_seats
      FROM public.mbg_committee_members cm
     WHERE cm.region_type::text = v_type AND cm.region_id = v_rid AND cm.is_active = true
       AND (NOT p_require_eligible OR public.mbg_chairperson_commission_eligible(cm.user_id));
    CONTINUE WHEN v_seats IS NULL;

    v_share := v_amt / cardinality(v_seats);

    FOR v_seat IN
      SELECT cm.id, cm.user_id FROM public.mbg_committee_members cm WHERE cm.id = ANY (v_seats)
    LOOP
      SELECT array_agg(DISTINCT pm.user_id) INTO v_members
        FROM public.mbg_committee_profile_members pm
        JOIN public.mbg_committee_members own ON own.id = pm.committee_member_id
       WHERE own.user_id = v_seat.user_id AND own.is_active = true
         AND pm.is_active = true AND pm.user_id <> v_seat.user_id;

      v_each := CASE WHEN v_members IS NULL THEN 0
                     ELSE LEAST(v_share * v_member_pct / 100, v_share / cardinality(v_members)) END;
      v_chair_net := v_share - v_each * COALESCE(cardinality(v_members), 0);

      IF ROUND(v_chair_net / ICAN_TO_UGX, 8) > 0 THEN
        PERFORM public.mbg_credit_ride_earning(v_seat.user_id, ROUND(v_chair_net / ICAN_TO_UGX, 8),
          'mybodaguy', p_ride_id::text, v_type || ' ' || p_note);
        IF p_payment_id IS NOT NULL AND p_fare > 0 THEN
          INSERT INTO public.mbg_commissions (
            ride_id, payment_id, recipient_id, recipient_role, region_type, region_id,
            ride_fare, commission_percentage, commission_amount, status, paid_at
          ) VALUES (
            p_ride_id, p_payment_id, v_seat.user_id, v_type || '_chairperson', v_type::mbg_region_type, v_rid,
            p_fare, ROUND(v_chair_net / p_fare * 100, 8), ROUND(v_chair_net, 6), 'paid', now()
          );
        END IF;
        v_paid := v_paid + v_chair_net;
      END IF;

      IF v_members IS NOT NULL AND ROUND(v_each / ICAN_TO_UGX, 8) > 0 THEN
        FOREACH v_member IN ARRAY v_members LOOP
          PERFORM public.mbg_credit_ride_earning(v_member, ROUND(v_each / ICAN_TO_UGX, 8),
            'mybodaguy', p_ride_id::text, v_type || ' committee member share');
          IF p_payment_id IS NOT NULL AND p_fare > 0 THEN
            INSERT INTO public.mbg_commissions (
              ride_id, payment_id, recipient_id, recipient_role, region_type, region_id,
              ride_fare, commission_percentage, commission_amount, status, paid_at
            ) VALUES (
              p_ride_id, p_payment_id, v_member, 'committee_member', v_type::mbg_region_type, v_rid,
              p_fare, ROUND(v_each / p_fare * 100, 8), ROUND(v_each, 6), 'paid', now()
            );
          END IF;
          v_paid := v_paid + v_each;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_paid;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.mbg_distribute_chair_commissions(uuid, uuid, uuid, numeric, numeric, text, boolean)
  FROM PUBLIC, anon, authenticated;

-- Point the three payout paths at the shared helper (replaces their flat per-level loops).
DO $patch$
DECLARE
  v_loop CONSTANT text := 'FOR v_level IN.*?END LOOP;';
  v_def text;
  v_new text;
BEGIN
  -- wallet-paid ride: rider is paid, chairs paid from the pool (fare - rider_earning)
  v_def := pg_get_functiondef('public.mbg_pay_rider_for_ride(uuid)'::regprocedure);
  IF v_def NOT LIKE '%mbg_distribute_chair_commissions%' THEN
    v_new := regexp_replace(v_def, v_loop,
      'v_chairs_paid_ican := ROUND(public.mbg_distribute_chair_commissions(p_ride_id, v_payment_id, v_ride.stage_id, v_ride.fare, v_ride.fare - v_ride.rider_earning, ''chairperson commission'', false) / ICAN_TO_UGX, 8);');
    IF v_new = v_def THEN RAISE EXCEPTION 'mbg_pay_rider_for_ride: loop not found'; END IF;
    EXECUTE v_new;
  END IF;

  -- cash ride completed by the rider
  v_def := pg_get_functiondef('public.mbg_complete_ride(uuid,text)'::regprocedure);
  IF v_def NOT LIKE '%mbg_distribute_chair_commissions%' THEN
    v_new := regexp_replace(v_def, v_loop,
      'v_chairs_paid_ugx := v_chairs_paid_ugx + public.mbg_distribute_chair_commissions(p_ride_id, v_payment_id, v_ride.stage_id, v_ride.fare, v_commission_due_ugx, ''chairperson commission (cash settlement)'', false);');
    IF v_new = v_def THEN RAISE EXCEPTION 'mbg_complete_ride: loop not found'; END IF;
    EXECUTE v_new;
  END IF;

  -- cash received confirmation (keeps its commission-eligibility check)
  v_def := pg_get_functiondef('public.mbg_confirm_cash_received(uuid)'::regprocedure);
  IF v_def NOT LIKE '%mbg_distribute_chair_commissions%' THEN
    v_new := regexp_replace(v_def, v_loop,
      'PERFORM public.mbg_distribute_chair_commissions(p_ride_id, v_payment_id, v_ride.stage_id, v_ride.fare, v_commission_ugx, ''chairperson commission (cash settlement)'', true);');
    IF v_new = v_def THEN RAISE EXCEPTION 'mbg_confirm_cash_received: loop not found'; END IF;
    EXECUTE v_new;
  END IF;
END
$patch$;
