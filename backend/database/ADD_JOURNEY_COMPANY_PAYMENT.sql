-- ============================================================================
-- Complete journeys paid by a BUSINESS, chosen per booking (Personal / Business),
-- the same way a normal ride can be paid by the company (COMPANY_WORKER_TRANSPORT_WALLET.sql).
--
-- Who may pay a journey from a company wallet: an employee the company has given
-- transport to (mbg_company_transport_allocations) AND allowed to pay for journeys.
-- A ride allocation on its own does NOT let someone spend company money on flights
-- or cargo, so two new settings sit on the allocation:
--   · allow_journeys      — the company switched journey payment on for this person
--   · journey_limit_ican  — optional cap on ONE journey (fare + any goods together)
-- The daily hours / weekdays of a ride allocation are not applied: a journey is
-- booked ahead, so only the allocation's own start/end dates and status count.
--
-- How it is paid: the company's business wallet is debited AT BOOKING, in full, for
-- both billing modes (a flight and a sea freight are paid up-front — there is nothing
-- to accrue to month end). If the booking then fails, the same amount goes back to the
-- business wallet (never the employee's). For "Buy abroad" the goods are paid by the
-- company too; they stay held and are released to the store when the courier collects
-- them, exactly as before. The employee's own ICAN wallet is not touched.
--
-- Server-side only: the payer is worked out from the signed-in user's allocation —
-- the browser never names a business. api/journeys/confirm.js (flights) calls the
-- functions below; the ship / buy-abroad RPC calls them itself.
--
-- Run after ADD_JOURNEY_STORE_IMPORT.sql and COMPANY_WORKER_TRANSPORT_WALLET.sql.
-- Safe to re-run. (It replaces mbg_refund_journey_fare, mbg_charge_import_goods,
-- mbg_refund_import_goods and mbg_request_ship_cargo_journey — do not re-run
-- ADD_JOURNEY_STORE_IMPORT.sql or ICAN's ADD_JOURNEY_AUTO_REFUND.sql afterwards.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema
-- ----------------------------------------------------------------------------
ALTER TABLE public.mbg_company_transport_allocations
  ADD COLUMN IF NOT EXISTS allow_journeys BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS journey_limit_ican NUMERIC(18,8);

DO $$
BEGIN
  ALTER TABLE public.mbg_company_transport_allocations
    ADD CONSTRAINT mbg_company_allocations_journey_limit_positive
    CHECK (journey_limit_ican IS NULL OR journey_limit_ican > 0);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

ALTER TABLE public.mbg_journeys
  ADD COLUMN IF NOT EXISTS company_profile_id UUID REFERENCES public.business_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_allocation_id UUID,
  ADD COLUMN IF NOT EXISTS company_paid_ican NUMERIC(18,8) NOT NULL DEFAULT 0;

ALTER TABLE public.mbg_import_orders
  ADD COLUMN IF NOT EXISTS paid_by_company BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 2. The company benefit a person has for journeys
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_company_journey_benefit_for(p_user_id UUID)
RETURNS TABLE (allocation_id UUID, business_profile_id UUID, business_name TEXT, journey_limit_ican NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.business_profile_id, bp.business_name::TEXT, a.journey_limit_ican
  FROM public.mbg_company_transport_allocations a
  JOIN public.business_profiles bp ON bp.id = a.business_profile_id
  WHERE a.employee_user_id = p_user_id
    AND a.status = 'active'
    AND a.allow_journeys
    AND now() >= a.starts_at
    AND (a.ends_at IS NULL OR now() <= a.ends_at)
  ORDER BY a.starts_at DESC
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.mbg_company_journey_benefit_for(UUID) FROM PUBLIC, anon, authenticated;

-- What the booking screen asks: may I offer "Business" and under which name?
-- Deliberately shows no wallet balance to the employee.
CREATE OR REPLACE FUNCTION public.mbg_get_company_journey_benefit()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('eligible', false);
  END IF;
  SELECT * INTO v_row FROM public.mbg_company_journey_benefit_for(auth.uid());
  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false);
  END IF;
  RETURN jsonb_build_object(
    'eligible', true,
    'business_name', v_row.business_name,
    'limit_ican', v_row.journey_limit_ican
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_get_company_journey_benefit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mbg_get_company_journey_benefit() TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Can the company pay this amount? Changes nothing. p_journey_id lets the limit
--    count what an earlier part of the SAME journey (the fare) already took.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_company_journey_check(
  p_user_id UUID, p_amount_ican NUMERIC, p_journey_id UUID DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_benefit RECORD;
  v_already NUMERIC := 0;
  v_balance NUMERIC;
BEGIN
  IF p_amount_ican IS NULL OR p_amount_ican <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
  END IF;
  SELECT * INTO v_benefit FROM public.mbg_company_journey_benefit_for(p_user_id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Your company has not allowed you to pay for journeys. Pay from your own wallet instead.');
  END IF;
  IF p_journey_id IS NOT NULL THEN
    SELECT COALESCE(company_paid_ican, 0) INTO v_already FROM public.mbg_journeys WHERE id = p_journey_id;
  END IF;
  IF v_benefit.journey_limit_ican IS NOT NULL AND v_already + p_amount_ican > v_benefit.journey_limit_ican THEN
    RETURN jsonb_build_object('success', false, 'error',
      format('This journey is over the %s ICAN limit your company set for one journey.', CASE WHEN v_benefit.journey_limit_ican::TEXT LIKE '%.%'
           THEN rtrim(rtrim(v_benefit.journey_limit_ican::TEXT, '0'), '.')
           ELSE v_benefit.journey_limit_ican::TEXT END));
  END IF;
  SELECT ican_balance INTO v_balance FROM public.ican_business_wallets
   WHERE business_profile_id = v_benefit.business_profile_id AND status = 'active';
  IF v_balance IS NULL OR v_balance < p_amount_ican THEN
    RETURN jsonb_build_object('success', false, 'error', 'The company wallet cannot cover this journey right now. Ask your company to top it up, or pay from your own wallet.');
  END IF;
  RETURN jsonb_build_object(
    'success', true, 'business_profile_id', v_benefit.business_profile_id,
    'allocation_id', v_benefit.allocation_id, 'business_name', v_benefit.business_name
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_company_journey_check(UUID, NUMERIC, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_company_journey_check(UUID, NUMERIC, UUID) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. Take one part of a journey (the fare, or the goods from a store) from the
--    company wallet. All checks first; an error returned means nothing changed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_charge_company_journey(
  p_journey_id UUID, p_user_id UUID, p_amount_ican NUMERIC, p_part TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_journey public.mbg_journeys%ROWTYPE;
  v_check JSONB;
  v_business UUID;
  v_tx UUID;
BEGIN
  IF p_part NOT IN ('fare', 'goods') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown journey part');
  END IF;

  SELECT j.* INTO v_journey
  FROM public.mbg_journeys j JOIN public.mbg_customers c ON c.id = j.customer_id
  WHERE j.id = p_journey_id AND c.user_id = p_user_id
  FOR UPDATE OF j;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found for this customer');
  END IF;

  v_check := public.mbg_company_journey_check(p_user_id, p_amount_ican, p_journey_id);
  IF NOT COALESCE((v_check ->> 'success')::BOOLEAN, false) THEN
    RETURN v_check;
  END IF;
  v_business := (v_check ->> 'business_profile_id')::UUID;
  IF v_journey.company_profile_id IS NOT NULL AND v_journey.company_profile_id <> v_business THEN
    RETURN jsonb_build_object('success', false, 'error', 'This journey is already paid by a different company');
  END IF;

  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance - p_amount_ican,
         total_spent = total_spent + p_amount_ican,
         updated_at = now()
   WHERE business_profile_id = v_business AND status = 'active' AND ican_balance >= p_amount_ican;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'The company wallet cannot cover this journey right now. Ask your company to top it up, or pay from your own wallet.');
  END IF;

  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id, initiated_by, recipient_user_id, amount_ican, note, reference_id,
     status, executed_at, direction, source_app, operation_type, metadata)
  VALUES
    (v_business, p_user_id, NULL, p_amount_ican,
     CASE p_part WHEN 'fare' THEN 'Company-paid journey' ELSE 'Company-paid goods from a store abroad' END,
     'mbg-journey:' || p_journey_id::TEXT || ':' || p_part, 'completed', now(), 'out', 'mybodaguy',
     CASE p_part WHEN 'fare' THEN 'transport_journey' ELSE 'import_goods' END,
     jsonb_build_object('journey_id', p_journey_id, 'part', p_part, 'employee_user_id', p_user_id))
  RETURNING id INTO v_tx;

  UPDATE public.mbg_journeys
     SET company_profile_id = v_business,
         company_allocation_id = (v_check ->> 'allocation_id')::UUID,
         company_paid_ican = COALESCE(company_paid_ican, 0) + p_amount_ican,
         -- The fare's payment id lives where a personal payment's id does, so every
         -- "was this journey paid?" check (refund, ticket, tracker) works unchanged.
         ican_journey_tx_id = CASE WHEN p_part = 'fare' THEN v_tx ELSE ican_journey_tx_id END
   WHERE id = p_journey_id;

  RETURN jsonb_build_object('success', true, 'tx_id', v_tx, 'business_profile_id', v_business);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_charge_company_journey(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_charge_company_journey(UUID, UUID, NUMERIC, TEXT) TO service_role;

-- Put money back into the company wallet. Idempotent per reference.
CREATE OR REPLACE FUNCTION public.mbg_refund_company_wallet(
  p_business_profile_id UUID, p_amount_ican NUMERIC, p_reference TEXT, p_note TEXT, p_user_id UUID
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ican_business_wallet_transactions
    WHERE business_profile_id = p_business_profile_id AND reference_id = p_reference AND direction = 'in'
  ) THEN
    RETURN;
  END IF;
  UPDATE public.ican_business_wallets
     SET ican_balance = ican_balance + p_amount_ican,
         total_spent = GREATEST(total_spent - p_amount_ican, 0),
         updated_at = now()
   WHERE business_profile_id = p_business_profile_id;
  INSERT INTO public.ican_business_wallet_transactions
    (business_profile_id, initiated_by, amount_ican, note, reference_id,
     status, executed_at, direction, source_app, operation_type, metadata)
  VALUES
    (p_business_profile_id, p_user_id, p_amount_ican, p_note, p_reference,
     'completed', now(), 'in', 'mybodaguy', 'journey_refund', '{}'::JSONB);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_refund_company_wallet(UUID, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Refund a failed journey's fare: to the company wallet when the company paid
--    it, otherwise to the customer exactly as before (ICAN's ADD_JOURNEY_AUTO_REFUND.sql
--    plus the company branch).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_refund_journey_fare(p_journey_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_journey public.mbg_journeys%ROWTYPE;
  v_debit RECORD;
  v_company_amount NUMERIC;
  v_customer_user UUID;
  v_ref TEXT := 'journey-refund:' || p_journey_id::TEXT;
BEGIN
  SELECT * INTO v_journey FROM public.mbg_journeys WHERE id = p_journey_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found');
  END IF;
  IF v_journey.status <> 'failed' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only a failed journey can be refunded');
  END IF;
  IF v_journey.ican_journey_tx_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No payment was taken for this journey');
  END IF;

  IF v_journey.company_profile_id IS NOT NULL THEN
    IF v_journey.refunded_at IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'already_refunded', true);
    END IF;
    SELECT amount_ican INTO v_company_amount FROM public.ican_business_wallet_transactions
    WHERE id = v_journey.ican_journey_tx_id AND business_profile_id = v_journey.company_profile_id AND direction = 'out';
    IF v_company_amount IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Original payment not found');
    END IF;
    SELECT user_id INTO v_customer_user FROM public.mbg_customers WHERE id = v_journey.customer_id;
    PERFORM public.mbg_refund_company_wallet(
      v_journey.company_profile_id, v_company_amount, v_ref,
      format('Company-paid journey refunded: %s', COALESCE(p_reason, 'the booking could not be completed')), v_customer_user);
    UPDATE public.mbg_journeys SET refunded_at = now(), updated_at = now() WHERE id = p_journey_id;
    RETURN jsonb_build_object('success', true, 'refunded_ican', v_company_amount, 'to_company', true);
  END IF;

  IF v_journey.refunded_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM public.ican_coin_transactions WHERE transaction_type = 'refund' AND reference_id = v_ref
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_refunded', true);
  END IF;

  SELECT sender_user_id, ican_amount INTO v_debit
  FROM public.ican_coin_transactions
  WHERE id = v_journey.ican_journey_tx_id AND transaction_type = 'journey_payment';
  IF v_debit.sender_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Original payment not found');
  END IF;

  -- Reverse the debit in full — not credit_ican_earning(), which would apply a
  -- tithe to money the customer never actually earned.
  UPDATE public.ican_user_wallets
  SET ican_balance = ican_balance + v_debit.ican_amount,
      total_spent  = GREATEST(total_spent - v_debit.ican_amount, 0)
  WHERE user_id = v_debit.sender_user_id;

  INSERT INTO public.ican_coin_transactions
    (recipient_user_id, ican_amount, transaction_type, source_app, reference_id, note, status)
  VALUES
    (v_debit.sender_user_id, v_debit.ican_amount, 'refund', 'mybodaguy', v_ref,
     format('Journey booking failed, refunded: %s', COALESCE(p_reason, 'airline could not confirm the booking')),
     'completed');

  UPDATE public.mbg_journeys SET refunded_at = now(), updated_at = now() WHERE id = p_journey_id;

  RETURN jsonb_build_object('success', true, 'refunded_ican', v_debit.ican_amount);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_refund_journey_fare(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_refund_journey_fare(UUID, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 6. Goods from a store abroad: same as ADD_JOURNEY_STORE_IMPORT.sql, plus
--    p_pay_with_company. The company charge comes BEFORE any stock is touched, so
--    an error returned means nothing changed.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mbg_charge_import_goods(UUID, UUID, UUID, JSONB, TEXT);

CREATE OR REPLACE FUNCTION public.mbg_charge_import_goods(
  p_journey_id UUID, p_customer_user_id UUID, p_supermarket_id UUID, p_cart JSONB, p_transport TEXT,
  p_pay_with_company BOOLEAN DEFAULT false
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_priced JSONB;
  v_item JSONB;
  v_qty NUMERIC;
  v_balance NUMERIC;
  v_goods_ican NUMERIC;
  v_goods_local NUMERIC;
  v_tx_id UUID;
  v_store_name TEXT;
  v_business UUID;
  v_company JSONB;
BEGIN
  IF p_transport NOT IN ('air', 'sea') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Unknown transport');
  END IF;
  IF EXISTS (SELECT 1 FROM public.mbg_import_orders WHERE journey_id = p_journey_id) THEN
    RETURN jsonb_build_object('success', true, 'already_charged', true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.mbg_journeys j JOIN public.mbg_customers c ON c.id = j.customer_id
    WHERE j.id = p_journey_id AND c.user_id = p_customer_user_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Journey not found for this customer');
  END IF;

  v_priced := public.mbg_price_import_cart(p_supermarket_id, p_cart);
  IF NOT COALESCE((v_priced ->> 'success')::BOOLEAN, false) THEN
    RETURN v_priced;
  END IF;
  v_goods_ican := (v_priced ->> 'goods_ican')::NUMERIC;
  v_goods_local := (v_priced ->> 'goods_local')::NUMERIC;
  v_store_name := v_priced -> 'store' ->> 'name';
  v_business := (v_priced ->> 'business_profile_id')::UUID;
  IF v_goods_ican <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'The order has no value');
  END IF;

  -- Lock every stock line and re-check it: the pricing above did not lock.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart) LOOP
    v_qty := (v_item ->> 'quantity')::NUMERIC;
    PERFORM 1 FROM public.inventory inv
    WHERE inv.product_id = (v_item ->> 'product_id')::UUID AND inv.supermarket_id = p_supermarket_id
      AND GREATEST(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0) >= v_qty
    FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'An item just went out of stock — please review your order');
    END IF;
  END LOOP;

  IF p_pay_with_company THEN
    v_company := public.mbg_charge_company_journey(p_journey_id, p_customer_user_id, v_goods_ican, 'goods');
    IF NOT COALESCE((v_company ->> 'success')::BOOLEAN, false) THEN
      RETURN v_company;
    END IF;
    v_tx_id := (v_company ->> 'tx_id')::UUID;
  ELSE
    SELECT ican_balance INTO v_balance FROM public.ican_user_wallets WHERE user_id = p_customer_user_id FOR UPDATE;
    IF v_balance IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
    END IF;
    IF v_balance < v_goods_ican THEN
      RETURN jsonb_build_object('success', false, 'error', 'Insufficient ICAN balance for the goods');
    END IF;
  END IF;

  -- Everything checked: now change things.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart) LOOP
    UPDATE public.inventory
    SET current_stock = current_stock - (v_item ->> 'quantity')::NUMERIC, updated_at = now()
    WHERE product_id = (v_item ->> 'product_id')::UUID AND supermarket_id = p_supermarket_id;
  END LOOP;

  IF NOT p_pay_with_company THEN
    UPDATE public.ican_user_wallets
    SET ican_balance = ican_balance - v_goods_ican, total_spent = total_spent + v_goods_ican
    WHERE user_id = p_customer_user_id;

    INSERT INTO public.ican_coin_transactions
      (sender_user_id, ican_amount, type, transaction_type, status, local_amount, local_currency,
       merchant_name, counterparty_type, expense_classification, source_app, reference_id, note, business_profile_id)
    VALUES
      (p_customer_user_id, v_goods_ican, 'transfer_out', 'transfer_out', 'completed', v_goods_local, v_priced ->> 'currency',
       v_store_name, 'business', 'personal_expense', 'mybodaguy', 'MBGIMPORT_' || p_journey_id::TEXT || '_GOODS',
       format('Import order from %s (held until the courier has collected it)', v_store_name), v_business)
    RETURNING id INTO v_tx_id;
  END IF;

  INSERT INTO public.mbg_import_orders
    (journey_id, customer_user_id, supermarket_id, business_profile_id, transport, currency,
     goods_local, goods_ican, goods_snapshot, debit_tx_id, paid_by_company)
  VALUES
    (p_journey_id, p_customer_user_id, p_supermarket_id, v_business, p_transport, v_priced ->> 'currency',
     v_goods_local, v_goods_ican, v_priced -> 'lines', v_tx_id, COALESCE(p_pay_with_company, false));

  RETURN jsonb_build_object('success', true, 'goods_ican', v_goods_ican, 'goods_local', v_goods_local, 'tx_id', v_tx_id);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_charge_import_goods(UUID, UUID, UUID, JSONB, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_charge_import_goods(UUID, UUID, UUID, JSONB, TEXT, BOOLEAN) TO service_role;

-- The goods refund goes back to whoever paid them.
CREATE OR REPLACE FUNCTION public.mbg_refund_import_goods(p_journey_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.mbg_import_orders%ROWTYPE;
  v_line JSONB;
  v_company UUID;
BEGIN
  SELECT * INTO v_order FROM public.mbg_import_orders WHERE journey_id = p_journey_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'no_goods', true);
  END IF;
  IF v_order.status <> 'held' THEN
    RETURN jsonb_build_object('success', true, 'already', v_order.status);
  END IF;

  IF v_order.paid_by_company THEN
    SELECT company_profile_id INTO v_company FROM public.mbg_journeys WHERE id = p_journey_id;
    IF v_company IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'The company that paid for these goods could not be found');
    END IF;
    PERFORM public.mbg_refund_company_wallet(
      v_company, v_order.goods_ican, 'import-refund:' || p_journey_id::TEXT,
      format('Company-paid import order refunded: %s', COALESCE(p_reason, 'the booking could not be completed')), v_order.customer_user_id);
  ELSE
    UPDATE public.ican_user_wallets
    SET ican_balance = ican_balance + v_order.goods_ican, total_spent = GREATEST(total_spent - v_order.goods_ican, 0)
    WHERE user_id = v_order.customer_user_id;

    INSERT INTO public.ican_coin_transactions
      (recipient_user_id, ican_amount, transaction_type, source_app, reference_id, note, status)
    VALUES
      (v_order.customer_user_id, v_order.goods_ican, 'refund', 'mybodaguy', 'import-refund:' || p_journey_id::TEXT,
       format('Import order refunded: %s', COALESCE(p_reason, 'the booking could not be completed')), 'completed');
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_order.goods_snapshot) LOOP
    UPDATE public.inventory
    SET current_stock = current_stock + (v_line ->> 'quantity')::NUMERIC, updated_at = now()
    WHERE product_id = (v_line ->> 'product_id')::UUID AND supermarket_id = v_order.supermarket_id;
  END LOOP;

  UPDATE public.mbg_import_orders SET status = 'refunded', refunded_at = now() WHERE id = v_order.id;
  RETURN jsonb_build_object('success', true, 'refunded_ican', v_order.goods_ican);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_refund_import_goods(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_refund_import_goods(UUID, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Ship cargo (and Buy abroad by sea): same as ADD_JOURNEY_STORE_IMPORT.sql plus
--    p_pay_with_company. The company's ability to cover fare + goods is checked
--    up front and returned as an ordinary error; the charges themselves run in the
--    same transaction, so any failure after that rolls the whole booking back.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mbg_request_ship_cargo_journey(TEXT, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN, BOOLEAN, TEXT, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.mbg_request_ship_cargo_journey(
  p_pickup_location TEXT, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_pickup_country TEXT,
  p_dropoff_location TEXT, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC, p_dropoff_country TEXT,
  p_cargo_description TEXT DEFAULT NULL,
  p_cargo_weight_kg NUMERIC DEFAULT NULL,
  p_pickup_leg BOOLEAN DEFAULT true,
  p_dropoff_leg BOOLEAN DEFAULT true,
  p_land_vehicle_type TEXT DEFAULT NULL,
  p_supermarket_id UUID DEFAULT NULL,
  p_cart JSONB DEFAULT NULL,
  p_pay_with_company BOOLEAN DEFAULT false
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan JSONB;
  v_priced JSONB;
  v_charge JSONB;
  v_check JSONB;
  v_company_fare JSONB;
  v_pay_company BOOLEAN := COALESCE(p_pay_with_company, false);
  v_pickup_location TEXT := p_pickup_location;
  v_pickup_lat NUMERIC := p_pickup_lat;
  v_pickup_lng NUMERIC := p_pickup_lng;
  v_pickup_country TEXT := p_pickup_country;
  v_description TEXT := p_cargo_description;
  v_pickup_leg BOOLEAN := COALESCE(p_pickup_leg, true);
  v_dropoff_leg BOOLEAN := COALESCE(p_dropoff_leg, true);
  v_customer_id UUID;
  v_journey_id UUID;
  v_first_leg_id UUID;
  v_debit JSONB;
  v_order INT := 0;
  v_fare_ugx NUMERIC;
  v_fare_ican NUMERIC;
  v_op JSONB;
  v_dp JSONB;
  v_dest_address TEXT;
  v_dest_lat NUMERIC;
  v_dest_lng NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Buying from a store: the pickup is the store, whatever the browser sent.
  IF p_supermarket_id IS NOT NULL THEN
    v_priced := public.mbg_price_import_cart(p_supermarket_id, p_cart);
    IF NOT COALESCE((v_priced ->> 'success')::BOOLEAN, false) THEN
      RETURN v_priced;
    END IF;
    v_pickup_leg := true;
    v_pickup_location := COALESCE(v_priced -> 'store' ->> 'address', v_priced -> 'store' ->> 'name');
    v_pickup_lat := (v_priced -> 'store' ->> 'latitude')::NUMERIC;
    v_pickup_lng := (v_priced -> 'store' ->> 'longitude')::NUMERIC;
    v_pickup_country := v_priced -> 'store' ->> 'country';
    v_description := COALESCE(NULLIF(trim(p_cargo_description), ''), (
      SELECT format('Order from %s: ', v_priced -> 'store' ->> 'name') || string_agg((l ->> 'quantity') || 'x ' || (l ->> 'product_name'), ', ')
      FROM jsonb_array_elements(v_priced -> 'lines') l
    ));
  END IF;

  v_plan := public.mbg_plan_ship_cargo_journey(
    v_pickup_lat, v_pickup_lng, v_pickup_country, p_dropoff_lat, p_dropoff_lng, p_dropoff_country,
    v_pickup_leg, v_dropoff_leg, p_land_vehicle_type, p_cargo_weight_kg
  );
  IF NOT COALESCE((v_plan ->> 'success')::BOOLEAN, false) THEN
    RETURN v_plan;
  END IF;
  v_op := v_plan -> 'origin_port';
  v_dp := v_plan -> 'dest_port';
  v_fare_ugx := (v_plan ->> 'total_ugx')::NUMERIC;
  v_fare_ican := (v_plan ->> 'total_ican')::NUMERIC;

  -- Company pays: is it allowed, within its per-journey limit, and funded for the
  -- fare plus any goods? Answered before anything is created.
  IF v_pay_company THEN
    v_check := public.mbg_company_journey_check(
      auth.uid(),
      v_fare_ican + COALESCE((v_priced ->> 'goods_ican')::NUMERIC, 0)
    );
    IF NOT COALESCE((v_check ->> 'success')::BOOLEAN, false) THEN
      RETURN v_check;
    END IF;
  END IF;

  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();
  IF v_customer_id IS NULL THEN
    INSERT INTO public.mbg_customers (user_id) VALUES (auth.uid()) RETURNING id INTO v_customer_id;
  END IF;

  -- Charge first — fail fast rather than create a shipment nobody paid for. (A
  -- company payment is taken just after the journey row exists, in this same
  -- transaction, because its ledger entry names the journey.)
  IF NOT v_pay_company THEN
    v_debit := public.mbg_debit_journey_fare(auth.uid(), v_fare_ican, 'mybodaguy', NULL);
    IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
      RETURN jsonb_build_object('success', false, 'error', COALESCE(v_debit ->> 'error', 'Payment failed'));
    END IF;
  END IF;

  -- With no delivery leg the cargo is collected at the arrival port, so that is
  -- the journey's destination.
  IF v_dropoff_leg THEN
    v_dest_address := p_dropoff_location; v_dest_lat := p_dropoff_lat; v_dest_lng := p_dropoff_lng;
  ELSE
    v_dest_address := (v_dp ->> 'name') || ', ' || (v_dp ->> 'city');
    v_dest_lat := (v_dp ->> 'lat')::NUMERIC; v_dest_lng := (v_dp ->> 'lng')::NUMERIC;
  END IF;

  INSERT INTO public.mbg_journeys (
    customer_id, journey_kind, status, origin_country, destination_country,
    destination_address, destination_lat, destination_lng, cargo_description, cargo_weight_kg,
    total_fare_ugx, total_fare_ican, ican_journey_tx_id
  ) VALUES (
    v_customer_id, 'cargo', 'confirmed', v_pickup_country, p_dropoff_country,
    v_dest_address, v_dest_lat, v_dest_lng, v_description, p_cargo_weight_kg,
    v_fare_ugx, v_fare_ican, CASE WHEN v_pay_company THEN NULL ELSE (v_debit ->> 'tx_id')::UUID END
  ) RETURNING id INTO v_journey_id;

  IF v_pay_company THEN
    -- Sets the journey's payment id and payer itself.
    v_company_fare := public.mbg_charge_company_journey(v_journey_id, auth.uid(), v_fare_ican, 'fare');
    IF NOT COALESCE((v_company_fare ->> 'success')::BOOLEAN, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_company_fare ->> 'error', 'The company could not pay for this journey');
    END IF;
  ELSE
    UPDATE ican_coin_transactions SET reference_id = v_journey_id::TEXT WHERE id = (v_debit ->> 'tx_id')::UUID;
  END IF;

  -- The goods, in the same transaction: if they cannot be charged (stock went, or
  -- the balance can't cover them) everything above is rolled back, nothing is charged.
  IF p_supermarket_id IS NOT NULL THEN
    v_charge := public.mbg_charge_import_goods(v_journey_id, auth.uid(), p_supermarket_id, p_cart, 'sea', v_pay_company);
    IF NOT COALESCE((v_charge ->> 'success')::BOOLEAN, false) THEN
      RAISE EXCEPTION '%', COALESCE(v_charge ->> 'error', 'The goods could not be charged');
    END IF;
  END IF;

  -- Legs are numbered 1..n over whichever ones are kept, so "advance to the next
  -- leg" (mbg_advance_cargo_journey_leg) needs no special case. The first leg is
  -- the one dispatched now.
  IF v_pickup_leg THEN
    v_order := v_order + 1;
    INSERT INTO public.mbg_journey_legs (
      journey_id, leg_order, leg_type, status,
      origin_country, origin_city, origin_lat, origin_lng,
      destination_country, destination_city, destination_lat, destination_lng,
      dispatch_after, fare_ugx, preferred_vehicle_type
    ) VALUES (
      v_journey_id, v_order, 'road_leg', 'ready_to_dispatch',
      v_pickup_country, v_pickup_location, v_pickup_lat, v_pickup_lng,
      v_op ->> 'country', v_op ->> 'city', (v_op ->> 'lat')::NUMERIC, (v_op ->> 'lng')::NUMERIC,
      now(), (v_plan ->> 'pickup_fare_ugx')::NUMERIC, p_land_vehicle_type
    );
  END IF;

  v_order := v_order + 1;
  INSERT INTO public.mbg_journey_legs (
    journey_id, leg_order, leg_type, status,
    origin_country, origin_city, origin_lat, origin_lng,
    destination_country, destination_city, destination_lat, destination_lng,
    dispatch_after, fare_ugx
  ) VALUES (
    v_journey_id, v_order, 'sea_leg', CASE WHEN v_order = 1 THEN 'ready_to_dispatch' ELSE 'pending' END,
    v_op ->> 'country', v_op ->> 'city', (v_op ->> 'lat')::NUMERIC, (v_op ->> 'lng')::NUMERIC,
    v_dp ->> 'country', v_dp ->> 'city', (v_dp ->> 'lat')::NUMERIC, (v_dp ->> 'lng')::NUMERIC,
    CASE WHEN v_order = 1 THEN now() ELSE NULL END, (v_plan ->> 'sea_fare_ugx')::NUMERIC
  );

  IF v_dropoff_leg THEN
    v_order := v_order + 1;
    INSERT INTO public.mbg_journey_legs (
      journey_id, leg_order, leg_type, status,
      origin_country, origin_city, origin_lat, origin_lng,
      destination_country, destination_city, destination_lat, destination_lng,
      dispatch_after, fare_ugx, preferred_vehicle_type
    ) VALUES (
      v_journey_id, v_order, 'road_leg', 'pending',
      v_dp ->> 'country', v_dp ->> 'city', (v_dp ->> 'lat')::NUMERIC, (v_dp ->> 'lng')::NUMERIC,
      p_dropoff_country, p_dropoff_location, p_dropoff_lat, p_dropoff_lng,
      NULL, (v_plan ->> 'dropoff_fare_ugx')::NUMERIC, p_land_vehicle_type
    );
  END IF;

  SELECT id INTO v_first_leg_id FROM public.mbg_journey_legs WHERE journey_id = v_journey_id AND leg_order = 1;
  PERFORM public.mbg_dispatch_cargo_leg(v_first_leg_id);

  RETURN jsonb_build_object(
    'success', true, 'journey_id', v_journey_id, 'via_sea', true,
    'fare_ugx', v_fare_ugx, 'fare_ican', v_fare_ican,
    'goods_ican', CASE WHEN v_charge IS NULL THEN 0 ELSE (v_charge ->> 'goods_ican')::NUMERIC END,
    'paid_by_company', v_pay_company
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ship_cargo_journey TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Let the company allow journey payment when it assigns (or later changes) a
--    worker's transport. The old 7-argument version is dropped so a call resolves
--    to exactly one function; existing callers (which pass those 7 by name) keep
--    working and simply leave journey payment off.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mbg_allocate_company_transport_worker(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TIME, TIME);

CREATE OR REPLACE FUNCTION public.mbg_allocate_company_transport_worker(
  p_business_profile_id UUID, p_employee_email TEXT, p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ DEFAULT NULL, p_billing_mode TEXT DEFAULT 'per_ride',
  p_daily_start_time TIME DEFAULT '06:00', p_daily_end_time TIME DEFAULT '18:00',
  p_allow_journeys BOOLEAN DEFAULT false, p_journey_limit_ican NUMERIC DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_employee UUID; v_allocation UUID;
BEGIN
  IF NOT public.ican_business_admin(p_business_profile_id) THEN
    RAISE EXCEPTION 'Business administrator access required';
  END IF;
  SELECT id INTO v_employee FROM auth.users WHERE lower(email) = lower(trim(p_employee_email)) LIMIT 1;
  IF v_employee IS NULL THEN RAISE EXCEPTION 'No signed-in account matches this Gmail address'; END IF;
  IF p_billing_mode NOT IN ('per_ride','monthly') THEN RAISE EXCEPTION 'Invalid billing mode'; END IF;
  IF p_daily_start_time IS NULL OR p_daily_end_time IS NULL THEN RAISE EXCEPTION 'Daily start and end times are required'; END IF;
  IF p_journey_limit_ican IS NOT NULL AND p_journey_limit_ican <= 0 THEN RAISE EXCEPTION 'The journey limit must be more than zero'; END IF;
  INSERT INTO public.mbg_company_transport_allocations
    (business_profile_id,employee_user_id,starts_at,ends_at,daily_start_time,daily_end_time,billing_mode,assigned_by,
     allow_journeys,journey_limit_ican)
  VALUES
    (p_business_profile_id,v_employee,p_starts_at,p_ends_at,p_daily_start_time,p_daily_end_time,p_billing_mode,auth.uid(),
     COALESCE(p_allow_journeys,false),p_journey_limit_ican)
  RETURNING id INTO v_allocation;
  RETURN jsonb_build_object('success',true,'allocation_id',v_allocation,'employee_user_id',v_employee);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_allocate_company_transport_worker(UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TIME,TIME,BOOLEAN,NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_allocate_company_transport_worker(UUID,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TIME,TIME,BOOLEAN,NUMERIC) TO authenticated;

-- Switch journey payment on/off (and set the per-journey cap) for an existing allocation.
CREATE OR REPLACE FUNCTION public.mbg_set_company_journey_payment(
  p_allocation_id UUID, p_allow BOOLEAN, p_limit_ican NUMERIC DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_business UUID;
BEGIN
  SELECT business_profile_id INTO v_business FROM public.mbg_company_transport_allocations WHERE id = p_allocation_id;
  IF v_business IS NULL THEN RAISE EXCEPTION 'Allocation not found'; END IF;
  IF NOT public.ican_business_admin(v_business) THEN
    RAISE EXCEPTION 'Business administrator access required';
  END IF;
  IF p_limit_ican IS NOT NULL AND p_limit_ican <= 0 THEN RAISE EXCEPTION 'The journey limit must be more than zero'; END IF;
  UPDATE public.mbg_company_transport_allocations
     SET allow_journeys = COALESCE(p_allow, false),
         journey_limit_ican = CASE WHEN COALESCE(p_allow, false) THEN p_limit_ican ELSE NULL END,
         updated_at = now()
   WHERE id = p_allocation_id;
  RETURN jsonb_build_object('success', true);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_set_company_journey_payment(UUID, BOOLEAN, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mbg_set_company_journey_payment(UUID, BOOLEAN, NUMERIC) TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Journeys can be paid by the company: employees a company allowed (allocation.allow_journeys) see Business at booking; the company wallet is charged up front and refunded to the company if booking fails. Use mbg_set_company_journey_payment(allocation_id, true, limit) to switch a worker on.';
END $$;
