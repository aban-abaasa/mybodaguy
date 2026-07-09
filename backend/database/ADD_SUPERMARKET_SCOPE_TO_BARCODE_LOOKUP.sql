-- Scans in the Shop tab's self-checkout need to be scoped to the store the
-- customer says they're in — otherwise a barcode/SKU could match a product
-- from an unrelated supermarket (or, worse, ring up the wrong store's price).
-- Adds an optional trailing p_supermarket_id so existing 1-arg callers keep
-- working, while CustomerSelfCheckout now always passes the customer's
-- chosen store.
--
-- Adding a trailing param (even with a DEFAULT) changes the function's
-- identity in Postgres — CREATE OR REPLACE would create a second overload
-- rather than replacing the original, leaving both the old 1-arg and new
-- 2-arg versions live and ambiguous for any call that omits p_supermarket_id.
-- Drop the old signature explicitly first.
DROP FUNCTION IF EXISTS public.lookup_product_by_barcode(TEXT);

CREATE OR REPLACE FUNCTION public.lookup_product_by_barcode(
  p_scan TEXT,
  p_supermarket_id UUID DEFAULT NULL
)
RETURNS TABLE (
  product_id      UUID,
  name            TEXT,
  sku             TEXT,
  barcode         TEXT,
  selling_price   DECIMAL,
  tax_rate        DECIMAL,
  category_name   TEXT,
  brand           TEXT,
  images          JSONB,
  current_stock   DECIMAL,
  available_stock DECIMAL,
  in_stock        BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.name::TEXT,
    p.sku::TEXT,
    p.barcode::TEXT,
    p.selling_price,
    COALESCE(p.tax_rate, 18)                                          AS tax_rate,
    c.name::TEXT                                                      AS category_name,
    p.brand::TEXT,
    p.images,
    COALESCE(inv.current_stock, 0)                                    AS current_stock,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) AS available_stock,
    GREATEST(COALESCE(inv.current_stock - inv.reserved_stock, 0), 0) > 0 AS in_stock
  FROM public.products p
  LEFT JOIN public.categories c   ON c.id = p.category_id
  LEFT JOIN public.inventory  inv ON inv.product_id = p.id
  WHERE (p.is_active IS NULL OR p.is_active = TRUE)
    AND (p.barcode = p_scan OR p.sku = p_scan OR p.id::TEXT = p_scan)
    AND (p_supermarket_id IS NULL OR p.supermarket_id = p_supermarket_id)
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_product_by_barcode(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_product_by_barcode(TEXT, UUID) TO anon;

DO $$
BEGIN
  RAISE NOTICE '✅ lookup_product_by_barcode now scopes matches to a chosen supermarket when p_supermarket_id is passed.';
END $$;
