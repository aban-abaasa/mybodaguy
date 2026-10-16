-- Store prices already include tax, and are in the store's own currency.
--
-- 1) TAX. products.selling_price is TAX-INCLUSIVE (the digital-city-era cashier
--    portal charges it as-is and treats VAT as the portion inside it).
--    FIX_GOODS_SNAPSHOT_TAX_INCLUSIVE_PRICE.sql assumed it was pre-tax and
--    multiplied by (1 + tax_rate/100), so customers ordering through MyBodaGuy
--    paid 18% more than the price on the shelf.
--
-- 2) CURRENCY. Goods are priced in the store's currency (supermarkets.
--    price_currency), but mbg_respond_to_ride converted them to ICAN at a flat
--    5000 UGX. It now uses that currency's ICAN price (mbg_ican_price_in_currency);
--    UGX stores keep 5000, so nothing changes for them. If a currency can't be
--    priced the order is refused rather than charged at a wrong rate.
--
-- Each function is patched in place from its deployed definition (only the
-- lines below change) and fails loudly if a line can't be found.
--   mbg_respond_to_ride   - delivery goods charged to the wallet at acceptance
--   mbg_price_import_cart - international/import order pricing (already
--                           currency-aware; only the tax-on-top line changes)
-- Safe to re-run: an already-patched function is left alone.
-- Run in the Supabase SQL Editor.

DO $patch$
DECLARE
  v_sig  TEXT;
  v_def  TEXT;
  v_new  TEXT;
  v_edit RECORD;
  v_changed BOOLEAN;
BEGIN
  FOR v_sig IN
    SELECT DISTINCT sig FROM (VALUES
      ('public.mbg_respond_to_ride(uuid,boolean)'),
      ('public.mbg_price_import_cart(uuid,jsonb)')
    ) AS t(sig)
  LOOP
    v_def := pg_get_functiondef(v_sig::regprocedure);
    v_new := v_def;
    v_changed := FALSE;

    FOR v_edit IN
      SELECT * FROM (VALUES
        -- tax is already inside selling_price: charge it as-is
        ('public.mbg_respond_to_ride(uuid,boolean)', 1,
         $q$v_unit_price_incl_ugx := ROUND(v_product.selling_price * (1 + COALESCE(v_product.tax_rate, 0) / 100), 2);$q$,
         $q$v_unit_price_incl_ugx := ROUND(v_product.selling_price, 2);$q$),
        ('public.mbg_price_import_cart(uuid,jsonb)', 1,
         $q$v_unit := ROUND(v_product.selling_price * (1 + COALESCE(v_product.tax_rate, 0) / 100), 2);$q$,
         $q$v_unit := ROUND(v_product.selling_price, 2);$q$),
        -- goods currency + ICAN price of that currency
        ('public.mbg_respond_to_ride(uuid,boolean)', 2,
         $q$v_goods_ugx NUMERIC := 0;$q$,
         $q$v_goods_ugx NUMERIC := 0;
  v_goods_currency TEXT := 'UGX';
  v_goods_price NUMERIC := 5000;$q$),
        ('public.mbg_respond_to_ride(uuid,boolean)', 3,
         $q$v_goods_ican := ROUND(v_goods_ugx / ICAN_TO_UGX, 8);$q$,
         $q$SELECT COALESCE(NULLIF(upper(price_currency), ''), 'UGX') INTO v_goods_currency
          FROM public.supermarkets WHERE id = v_ride.supermarket_id;
          IF v_goods_currency <> 'UGX' THEN
            v_goods_price := public.mbg_ican_price_in_currency(v_goods_currency);
            IF v_goods_price IS NULL THEN
              RETURN jsonb_build_object('success', false, 'error', format('Prices in %s cannot be converted to ICAN right now', v_goods_currency));
            END IF;
          END IF;
          v_goods_ican := ROUND(v_goods_ugx / v_goods_price, 8);$q$),
        ('public.mbg_respond_to_ride(uuid,boolean)', 4,
         $q$v_goods_ugx, 'UGX', v_store.store_name$q$,
         $q$v_goods_ugx, v_goods_currency, v_store.store_name$q$)
      ) AS e(sig, ord, old_txt, new_txt)
      WHERE e.sig = v_sig
      ORDER BY e.ord
    LOOP
      IF position(v_edit.old_txt IN v_new) > 0 THEN
        v_new := replace(v_new, v_edit.old_txt, v_edit.new_txt);
        v_changed := TRUE;
      ELSIF position(v_edit.new_txt IN v_new) = 0 THEN
        RAISE EXCEPTION 'Line to change not found in % (edit %), nothing changed', v_sig, v_edit.ord;
      END IF;
    END LOOP;

    IF v_changed THEN
      EXECUTE v_new;
      RAISE NOTICE '% patched', v_sig;
    ELSE
      RAISE NOTICE '% already patched', v_sig;
    END IF;
  END LOOP;
END
$patch$;

NOTIFY pgrst, 'reload schema';
