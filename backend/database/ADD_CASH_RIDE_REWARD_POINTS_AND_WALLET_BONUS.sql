-- ============================================================================
-- Reward points: pay off, not off wallet — every completed ride/delivery now
-- earns points, cash included. Wallet-settled rides earn 10% more.
-- ============================================================================
-- ADD_REWARD_POINTS_LOYALTY_SYSTEM.sql deliberately hooked
-- ican_coin_transactions (not mbg_rides) so a cash ride — which never moves
-- real ICAN — earned nobody any points. Product call now: every completed
-- ride/delivery should earn points regardless of payment method, with wallet
-- kept more attractive via a 10% bonus over the cash rate, not by being the
-- only way to earn at all.
--
-- Both sides' points are now computed straight from the ride's own fare
-- figures at completion (fare -> ICAN-equivalent at the platform's fixed
-- 5000 UGX = 1 ICAN rate — same constant mbg_complete_ride itself uses),
-- instead of the actual ican_coin_transactions amount. That actual wallet
-- debit already carries the wallet surcharge on top of the fare, which would
-- make a wallet/cash points comparison apples-to-oranges; keying both off
-- the same nominal fare is what makes "wallet earns 10% more" literally true
-- for two rides with the same fare.
--
--   Customer: 5 pts per 1 ICAN-equivalent of the fare  (x1.10 if wallet)
--   Rider:    10 pts per 1 ICAN-equivalent of their own rider_earning (x1.10 if wallet)
--
-- Replaces the ican_coin_transactions trigger with one on mbg_rides itself,
-- firing once per ride the moment it flips to 'completed' — cash and wallet
-- both go through this single path now, so there's no risk of a wallet ride
-- double-earning from two triggers.
-- ============================================================================

DROP TRIGGER IF EXISTS mbg_reward_points_on_ican_tx ON public.ican_coin_transactions;
DROP FUNCTION IF EXISTS public.mbg_award_reward_points_from_ican_tx() CASCADE;

CREATE OR REPLACE FUNCTION public.mbg_award_ride_reward_points_on_complete() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ICAN_TO_UGX CONSTANT NUMERIC := 5000;
  v_wallet_bonus NUMERIC;
  v_customer_user_id UUID;
  v_rider_user_id UUID;
  v_customer_points NUMERIC;
  v_rider_points NUMERIC;
  v_customer_ican_equiv NUMERIC;
  v_rider_ican_equiv NUMERIC;
BEGIN
  v_wallet_bonus := CASE WHEN NEW.payment_method = 'wallet' THEN 1.10 ELSE 1.0 END;

  v_customer_ican_equiv := ROUND(COALESCE(NEW.fare, 0) / ICAN_TO_UGX, 8);
  v_customer_points := FLOOR(v_customer_ican_equiv * 5 * v_wallet_bonus);
  IF v_customer_points > 0 THEN
    SELECT user_id INTO v_customer_user_id FROM public.mbg_customers WHERE id = NEW.customer_id;
    IF v_customer_user_id IS NOT NULL THEN
      PERFORM public.mbg_earn_reward_points(
        v_customer_user_id, v_customer_points, 'customer', 'ride', NEW.id::TEXT,
        format('%s pts for a %s-paid ride/delivery (UGX %s fare)', v_customer_points::TEXT, NEW.payment_method, NEW.fare::TEXT)
      );
    END IF;
  END IF;

  v_rider_ican_equiv := ROUND(COALESCE(NEW.rider_earning, 0) / ICAN_TO_UGX, 8);
  v_rider_points := FLOOR(v_rider_ican_equiv * 10 * v_wallet_bonus);
  IF v_rider_points > 0 THEN
    SELECT user_id INTO v_rider_user_id FROM public.mbg_riders WHERE id = NEW.rider_id;
    IF v_rider_user_id IS NOT NULL THEN
      PERFORM public.mbg_earn_reward_points(
        v_rider_user_id, v_rider_points, 'rider', 'ride', NEW.id::TEXT,
        format('%s pts for a %s-settled ride/delivery (UGX %s earned)', v_rider_points::TEXT, NEW.payment_method, NEW.rider_earning::TEXT)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mbg_reward_points_on_ride_complete_v2 ON public.mbg_rides;
CREATE TRIGGER mbg_reward_points_on_ride_complete_v2
  AFTER UPDATE ON public.mbg_rides
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.mbg_award_ride_reward_points_on_complete();

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Reward points now award on every completed ride/delivery (cash included) — wallet-settled ones earn 10%% more.';
END $$;
