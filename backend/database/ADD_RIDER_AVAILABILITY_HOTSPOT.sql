-- ═══════════════════════════════════════════════════════════════════════════
-- Live "availability" signals for the Overview greeting's insight slider:
-- where riders are plentiful, and which store is best stocked right now.
-- ═══════════════════════════════════════════════════════════════════════════

-- "Where are riders plentiful right now?" — points customers toward the
-- stage with the most online riders (more supply generally means a faster
-- match and, since riders there are competing for the same jobs, often a
-- cheaper one too).
--
-- A plain customer has no SELECT policy on mbg_riders (see
-- schema_mybodaguy/05_riders.sql — only the rider themselves and their stage
-- chairperson can read rider rows), so this has to be a SECURITY DEFINER
-- function that returns only the aggregate, never raw rider rows.
CREATE OR REPLACE FUNCTION mbg_get_busiest_rider_stage()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object('stage_name', s.name, 'available_riders', t.cnt)
  FROM (
    SELECT stage_id, COUNT(*) AS cnt
    FROM mbg_riders
    WHERE is_available = true
    GROUP BY stage_id
    ORDER BY cnt DESC
    LIMIT 1
  ) t
  JOIN mbg_stages s ON s.id = t.stage_id;
$$;

GRANT EXECUTE ON FUNCTION mbg_get_busiest_rider_stage() TO authenticated;

-- "Which store has the most stock right now?" — public.products /
-- public.inventory / public.supermarkets are the shared Supermartkera
-- catalog (digital-city-era); customers already query them directly for
-- shopping (see productService.ts), so this is SECURITY DEFINER purely for
-- symmetry and efficiency (one aggregate row instead of pulling every
-- product's stock to the client), not because RLS would otherwise block it.
CREATE OR REPLACE FUNCTION mbg_get_best_stocked_store()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'store_name', s.name,
    'location', s.location,
    'available_stock', t.total_stock
  )
  FROM (
    SELECT p.supermarket_id, SUM(GREATEST(COALESCE(i.current_stock, 0) - COALESCE(i.reserved_stock, 0), 0)) AS total_stock
    FROM products p
    JOIN inventory i ON i.product_id = p.id
    WHERE p.is_active = true
    GROUP BY p.supermarket_id
    HAVING SUM(GREATEST(COALESCE(i.current_stock, 0) - COALESCE(i.reserved_stock, 0), 0)) > 0
    ORDER BY total_stock DESC
    LIMIT 1
  ) t
  JOIN supermarkets s ON s.id = t.supermarket_id;
$$;

GRANT EXECUTE ON FUNCTION mbg_get_best_stocked_store() TO authenticated;

NOTIFY pgrst, 'reload schema';
