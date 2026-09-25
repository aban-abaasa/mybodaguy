-- ============================================================================
-- "Buy abroad": a customer in one country buys from a registered STORE in
-- another (e.g. Uganda buying from a UK store) and has it delivered to their
-- door, by AIR (a traveller carries it as baggage — the parcel journey) or by
-- SEA (the ship-cargo journey), with land transport at both ends.
--
-- What is new here is the STORE side and the goods money:
--   · supermarkets.country / price_currency — the owner's own country and the
--     currency their prices are written in (set from the store-location editor).
--     Only stores with a country are offered for import.
--   · Goods are priced at the LIVE ICAN value of the STORE's currency (a GBP
--     price is converted at ICAN's live GBP price), tax folded in, stock checked
--     under lock and deducted, then debited from the customer in ICAN.
--   · The goods are HELD, not paid out: the store's business wallet is credited
--     only when the first courier leg (store -> airport / port) is completed
--     (a trigger on mbg_journey_legs). If the booking fails afterwards the goods
--     are refunded and the stock put back (mbg_refund_import_goods).
--   · mbg_import_orders records each order, and mbg_list_store_import_orders
--     lets the store owner see what to prepare and when the courier comes.
--   · mbg_request_ship_cargo_journey gains p_supermarket_id / p_cart: with a
--     store, the pickup is the STORE's own location (never client-supplied), the
--     pickup leg is forced on, and goods + shipping are charged in one atomic
--     step (any failure rolls the whole thing back, so nothing is charged).
--     The AIR path is booked by api/journeys/confirm.js, which calls
--     mbg_charge_import_goods after taking the transport fare.
--
-- Run after ADD_JOURNEY_PARCEL_AND_SHIP_LAND_LEGS.sql. Safe to re-run.
-- (It replaces mbg_request_ship_cargo_journey again — do not re-run the earlier
-- file afterwards, which would bring back the version without a store.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Store country + currency
-- ----------------------------------------------------------------------------
ALTER TABLE public.supermarkets
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS price_currency VARCHAR(3) NOT NULL DEFAULT 'UGX';

DO $$
BEGIN
  ALTER TABLE public.supermarkets
    ADD CONSTRAINT supermarkets_price_currency_format CHECK (price_currency ~ '^[A-Z]{3}$');
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Import orders (goods held until the store's goods have left with the courier)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mbg_import_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id          UUID NOT NULL UNIQUE REFERENCES public.mbg_journeys(id) ON DELETE CASCADE,
  customer_user_id    UUID NOT NULL,
  supermarket_id      UUID NOT NULL REFERENCES public.supermarkets(id),
  business_profile_id UUID,
  transport           TEXT NOT NULL CHECK (transport IN ('air', 'sea')),
  currency            VARCHAR(3) NOT NULL,
  goods_local         NUMERIC NOT NULL,
  goods_ican          NUMERIC NOT NULL CHECK (goods_ican > 0),
  goods_snapshot      JSONB NOT NULL,
  status              TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'released', 'refunded')),
  debit_tx_id         UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at         TIMESTAMPTZ,
  refunded_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mbg_import_orders_store ON public.mbg_import_orders (supermarket_id, created_at DESC);

ALTER TABLE public.mbg_import_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mbg_import_orders_read_own ON public.mbg_import_orders;
CREATE POLICY mbg_import_orders_read_own ON public.mbg_import_orders FOR SELECT USING (customer_user_id = auth.uid());
DROP POLICY IF EXISTS mbg_import_orders_service_role ON public.mbg_import_orders;
CREATE POLICY mbg_import_orders_service_role ON public.mbg_import_orders FOR ALL USING (auth.role() = 'service_role');

-- ----------------------------------------------------------------------------
-- 3. Live ICAN price in a currency (NULL when the price engine has none)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_ican_price_in_currency(p_currency TEXT)
RETURNS NUMERIC LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_price NUMERIC;
BEGIN
  SELECT price_local INTO v_price FROM public.ican_get_price_in_currency(upper(p_currency)::VARCHAR) LIMIT 1;
  RETURN CASE WHEN v_price > 0 THEN v_price ELSE NULL END;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_ican_price_in_currency(TEXT) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Price a cart from one store. Internal: it also returns the store's payout
--    ids, so it is not granted to any client role (see the quote wrapper below).
--    Cart = [{ "product_id": uuid, "quantity": n }, ...], one line per product.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_price_import_cart(p_supermarket_id UUID, p_cart JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_store RECORD;
  v_item JSONB;
  v_product RECORD;
  v_qty NUMERIC;
  v_unit NUMERIC;
  v_line NUMERIC;
  v_total NUMERIC := 0;
  v_lines JSONB := '[]'::JSONB;
  v_seen UUID[] := ARRAY[]::UUID[];
  v_product_id UUID;
  v_price NUMERIC;
BEGIN
  SELECT s.id, COALESCE(NULLIF(s.name, ''), NULLIF(s.location, ''), 'Store') AS store_name, s.address,
         s.latitude, s.longitude, s.country, s.price_currency, s.owner_user_id, s.pichin_business_profile_id
    INTO v_store FROM public.supermarkets s WHERE s.id = p_supermarket_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Store not found');
  END IF;
  IF v_store.country IS NULL OR v_store.latitude IS NULL OR v_store.longitude IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This store is not set up for international orders yet');
  END IF;
  IF v_store.owner_user_id IS NULL OR v_store.pichin_business_profile_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'This store has no payment account configured');
  END IF;
  IF p_cart IS NULL OR jsonb_typeof(p_cart) <> 'array' OR jsonb_array_length(p_cart) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Choose at least one item');
  END IF;
  IF jsonb_array_length(p_cart) > 50 THEN
    RETURN jsonb_build_object('success', false, 'error', 'An order can hold up to 50 different items');
  END IF;

  v_price := public.mbg_ican_price_in_currency(v_store.price_currency);
  IF v_price IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', format('Prices in %s cannot be converted to ICAN right now', v_store.price_currency));
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart) LOOP
    IF COALESCE(v_item ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR COALESCE(v_item ->> 'quantity', '') !~ '^[0-9]+(\.[0-9]+)?$' THEN
      RETURN jsonb_build_object('success', false, 'error', 'The order has an invalid item');
    END IF;
    v_product_id := (v_item ->> 'product_id')::UUID;
    v_qty := (v_item ->> 'quantity')::NUMERIC;
    IF v_qty <= 0 OR v_qty > 1000 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Item quantities must be between 1 and 1000');
    END IF;
    IF v_product_id = ANY (v_seen) THEN
      RETURN jsonb_build_object('success', false, 'error', 'The same item is listed twice');
    END IF;
    v_seen := v_seen || v_product_id;

    SELECT p.name, p.selling_price, p.tax_rate, p.is_active INTO v_product
      FROM public.products p WHERE p.id = v_product_id AND p.supermarket_id = p_supermarket_id;
    IF NOT FOUND OR v_product.is_active IS FALSE THEN
      RETURN jsonb_build_object('success', false, 'error', format('%s is no longer available at this store', COALESCE(v_product.name, 'An item')));
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.inventory inv
      WHERE inv.product_id = v_product_id AND inv.supermarket_id = p_supermarket_id
        AND GREATEST(inv.current_stock - COALESCE(inv.reserved_stock, 0), 0) >= v_qty
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', format('%s is out of stock', v_product.name));
    END IF;

    -- Tax is folded into the price the customer sees, never added afterwards.
    v_unit := ROUND(v_product.selling_price * (1 + COALESCE(v_product.tax_rate, 0) / 100), 2);
    v_line := ROUND(v_unit * v_qty, 2);
    v_total := v_total + v_line;
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product_id, 'product_name', v_product.name,
      'quantity', v_qty, 'unit_price', v_unit, 'line_total', v_line
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'store', jsonb_build_object(
      'id', v_store.id, 'name', v_store.store_name, 'address', v_store.address,
      'latitude', v_store.latitude, 'longitude', v_store.longitude,
      'country', v_store.country, 'currency', v_store.price_currency
    ),
    'owner_user_id', v_store.owner_user_id,
    'business_profile_id', v_store.pichin_business_profile_id,
    'currency', v_store.price_currency,
    'lines', v_lines,
    'goods_local', v_total,
    'price_per_ican', v_price,
    'goods_ican', ROUND(v_total / v_price, 8)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_price_import_cart(UUID, JSONB) FROM PUBLIC, anon, authenticated;

-- What the customer (and the API) sees before paying.
CREATE OR REPLACE FUNCTION public.mbg_quote_import_goods(p_supermarket_id UUID, p_cart JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_priced JSONB;
BEGIN
  IF auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;
  v_priced := public.mbg_price_import_cart(p_supermarket_id, p_cart);
  IF NOT COALESCE((v_priced ->> 'success')::BOOLEAN, false) THEN
    RETURN v_priced;
  END IF;
  RETURN v_priced - 'owner_user_id' - 'business_profile_id';
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_quote_import_goods(UUID, JSONB) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Stores a customer can buy from abroad: registered, located, with a payout
--    account, in a country OTHER than their own.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_list_import_stores(p_home_country TEXT)
RETURNS TABLE (
  id UUID, name TEXT, business_type TEXT, address TEXT,
  latitude NUMERIC, longitude NUMERIC, country TEXT, price_currency TEXT,
  product_count BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id,
         COALESCE(NULLIF(s.name, ''), NULLIF(s.location, ''), 'Store')::TEXT,
         s.business_type::TEXT, s.address::TEXT,
         s.latitude::NUMERIC, s.longitude::NUMERIC, s.country::TEXT, s.price_currency::TEXT,
         (SELECT COUNT(*) FROM public.products p WHERE p.supermarket_id = s.id AND p.is_active IS NOT FALSE)
  FROM public.supermarkets s
  WHERE auth.uid() IS NOT NULL
    AND s.country IS NOT NULL
    AND s.country <> COALESCE(p_home_country, '')
    AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL
    AND s.owner_user_id IS NOT NULL AND s.pichin_business_profile_id IS NOT NULL
  ORDER BY s.country, 2;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_list_import_stores(TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Take the money for the goods: check stock under lock, deduct it, debit the
--    customer's ICAN wallet and record the held order. All checks happen before
--    anything is changed, so a returned error means nothing was touched.
--    Server-side only (the ship RPC below, and api/journeys/confirm.js).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_charge_import_goods(
  p_journey_id UUID, p_customer_user_id UUID, p_supermarket_id UUID, p_cart JSONB, p_transport TEXT
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

  SELECT ican_balance INTO v_balance FROM public.ican_user_wallets WHERE user_id = p_customer_user_id FOR UPDATE;
  IF v_balance IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wallet not found');
  END IF;
  IF v_balance < v_goods_ican THEN
    RETURN jsonb_build_object('success', false, 'error', 'Insufficient ICAN balance for the goods');
  END IF;

  -- Everything checked: now change things.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_cart) LOOP
    UPDATE public.inventory
    SET current_stock = current_stock - (v_item ->> 'quantity')::NUMERIC, updated_at = now()
    WHERE product_id = (v_item ->> 'product_id')::UUID AND supermarket_id = p_supermarket_id;
  END LOOP;

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

  INSERT INTO public.mbg_import_orders
    (journey_id, customer_user_id, supermarket_id, business_profile_id, transport, currency,
     goods_local, goods_ican, goods_snapshot, debit_tx_id)
  VALUES
    (p_journey_id, p_customer_user_id, p_supermarket_id, v_business, p_transport, v_priced ->> 'currency',
     v_goods_local, v_goods_ican, v_priced -> 'lines', v_tx_id);

  RETURN jsonb_build_object('success', true, 'goods_ican', v_goods_ican, 'goods_local', v_goods_local, 'tx_id', v_tx_id);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_charge_import_goods(UUID, UUID, UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_charge_import_goods(UUID, UUID, UUID, JSONB, TEXT) TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Put the goods money back and the stock back (booking failed after payment).
--    Idempotent; only an order still 'held' is refunded.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_refund_import_goods(p_journey_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.mbg_import_orders%ROWTYPE;
  v_line JSONB;
BEGIN
  SELECT * INTO v_order FROM public.mbg_import_orders WHERE journey_id = p_journey_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'no_goods', true);
  END IF;
  IF v_order.status <> 'held' THEN
    RETURN jsonb_build_object('success', true, 'already', v_order.status);
  END IF;

  UPDATE public.ican_user_wallets
  SET ican_balance = ican_balance + v_order.goods_ican, total_spent = GREATEST(total_spent - v_order.goods_ican, 0)
  WHERE user_id = v_order.customer_user_id;

  INSERT INTO public.ican_coin_transactions
    (recipient_user_id, ican_amount, transaction_type, source_app, reference_id, note, status)
  VALUES
    (v_order.customer_user_id, v_order.goods_ican, 'refund', 'mybodaguy', 'import-refund:' || p_journey_id::TEXT,
     format('Import order refunded: %s', COALESCE(p_reason, 'the booking could not be completed')), 'completed');

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
-- 8. Pay the store once the first courier leg (store -> airport / port) is done.
--    Never lets a settlement problem block the courier's completion: on failure
--    the order stays 'held' and is retried the next time any leg completes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_release_import_goods(p_journey_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.mbg_import_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.mbg_import_orders WHERE journey_id = p_journey_id AND status = 'held' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', true, 'nothing_to_release', true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.mbg_journey_legs WHERE journey_id = p_journey_id AND leg_order = 1 AND status = 'completed') THEN
    RETURN jsonb_build_object('success', true, 'not_yet', true);
  END IF;

  PERFORM public.ican_settle_business_wallet_income(
    v_order.business_profile_id, v_order.goods_ican, 'mybodaguy', 'mbg-import:' || p_journey_id::TEXT, 'pos_sale',
    'Import order collected by the courier',
    jsonb_build_object('journey_id', p_journey_id, 'transport', v_order.transport, 'currency', v_order.currency, 'goods_local', v_order.goods_local)
  );
  UPDATE public.mbg_import_orders SET status = 'released', released_at = now() WHERE id = v_order.id;
  RETURN jsonb_build_object('success', true, 'released_ican', v_order.goods_ican);
END;
$$;
REVOKE ALL ON FUNCTION public.mbg_release_import_goods(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mbg_release_import_goods(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.mbg_release_import_goods_on_leg_done()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.mbg_release_import_goods(NEW.journey_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'mbg_release_import_goods(%) failed, will retry: %', NEW.journey_id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mbg_release_import_goods_trg ON public.mbg_journey_legs;
CREATE TRIGGER mbg_release_import_goods_trg
  AFTER UPDATE OF status ON public.mbg_journey_legs
  FOR EACH ROW WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
  EXECUTE FUNCTION public.mbg_release_import_goods_on_leg_done();

-- ----------------------------------------------------------------------------
-- 9. The store owner's view: what to prepare, and where the courier is.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mbg_list_store_import_orders(p_supermarket_id UUID)
RETURNS TABLE (
  journey_id UUID, created_at TIMESTAMPTZ, transport TEXT, order_status TEXT,
  currency TEXT, goods_local NUMERIC, goods_snapshot JSONB,
  destination_country TEXT, courier_status TEXT, courier_due TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.journey_id, o.created_at, o.transport, o.status, o.currency::TEXT, o.goods_local, o.goods_snapshot,
         j.destination_country::TEXT, l.status::TEXT, l.dispatch_after
  FROM public.mbg_import_orders o
  JOIN public.supermarkets s ON s.id = o.supermarket_id
  JOIN public.mbg_journeys j ON j.id = o.journey_id
  LEFT JOIN public.mbg_journey_legs l ON l.journey_id = o.journey_id AND l.leg_order = 1
  WHERE o.supermarket_id = p_supermarket_id AND s.owner_user_id = auth.uid()
  ORDER BY o.created_at DESC
  LIMIT 50;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_list_store_import_orders(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 10. Ship cargo with an optional STORE. Same as ADD_JOURNEY_PARCEL_AND_SHIP_LAND_LEGS.sql
--     plus p_supermarket_id / p_cart. With a store: the pickup is the store's own
--     location, the pickup leg is on, and goods + shipping are charged together —
--     a failed goods charge raises, which rolls back the shipping debit too.
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.mbg_request_ship_cargo_journey(TEXT, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, TEXT, NUMERIC, BOOLEAN, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION public.mbg_request_ship_cargo_journey(
  p_pickup_location TEXT, p_pickup_lat NUMERIC, p_pickup_lng NUMERIC, p_pickup_country TEXT,
  p_dropoff_location TEXT, p_dropoff_lat NUMERIC, p_dropoff_lng NUMERIC, p_dropoff_country TEXT,
  p_cargo_description TEXT DEFAULT NULL,
  p_cargo_weight_kg NUMERIC DEFAULT NULL,
  p_pickup_leg BOOLEAN DEFAULT true,
  p_dropoff_leg BOOLEAN DEFAULT true,
  p_land_vehicle_type TEXT DEFAULT NULL,
  p_supermarket_id UUID DEFAULT NULL,
  p_cart JSONB DEFAULT NULL
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan JSONB;
  v_priced JSONB;
  v_charge JSONB;
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

  SELECT id INTO v_customer_id FROM public.mbg_customers WHERE user_id = auth.uid();
  IF v_customer_id IS NULL THEN
    INSERT INTO public.mbg_customers (user_id) VALUES (auth.uid()) RETURNING id INTO v_customer_id;
  END IF;

  -- Charge first — fail fast rather than create a shipment nobody paid for.
  v_debit := public.mbg_debit_journey_fare(auth.uid(), v_fare_ican, 'mybodaguy', NULL);
  IF NOT COALESCE((v_debit ->> 'success')::BOOLEAN, false) THEN
    RETURN jsonb_build_object('success', false, 'error', COALESCE(v_debit ->> 'error', 'Payment failed'));
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
    v_fare_ugx, v_fare_ican, (v_debit ->> 'tx_id')::UUID
  ) RETURNING id INTO v_journey_id;

  UPDATE ican_coin_transactions SET reference_id = v_journey_id::TEXT WHERE id = (v_debit ->> 'tx_id')::UUID;

  -- The goods, in the same transaction: if they cannot be charged (stock went, or
  -- the balance can't cover them) everything above is rolled back, nothing is charged.
  IF p_supermarket_id IS NOT NULL THEN
    v_charge := public.mbg_charge_import_goods(v_journey_id, auth.uid(), p_supermarket_id, p_cart, 'sea');
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
    'goods_ican', CASE WHEN v_charge IS NULL THEN 0 ELSE (v_charge ->> 'goods_ican')::NUMERIC END
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.mbg_request_ship_cargo_journey TO authenticated;

NOTIFY pgrst, 'reload schema';

DO $$
BEGIN
  RAISE NOTICE '✅ Buy abroad ready: stores get a country + price currency, goods are priced at ICAN''s live value, held until the courier collects them, refundable, and the store owner can list its import orders.';
END $$;
