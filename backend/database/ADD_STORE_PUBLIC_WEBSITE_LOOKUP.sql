-- ============================================================================
-- STORE -> PUBLIC BUSINESS WEBSITE LOOKUP
-- Safe to re-run. Shared IcanEra database (same one icanera.space uses).
--
-- Scan & checkout (and the receipts) need to send a customer to a store's public
-- business website (icanera.space/notices/<company id>) -- e.g. to pay with Mobile
-- Money / card / bank / cash when they are not paying from their IcanEra wallet.
--
-- The app used to find that website by reading cmms_company_profiles directly, by a
-- column that does not exist (pichin_business_profile_id lives on supermarkets), and
-- customers cannot read that table anyway (it is limited to the company's own
-- admins). So it always came back empty. This function answers the one question the
-- app needs -- "which public website belongs to this store / business?" -- and
-- returns only the company's id, which is already public in its website link.
--
-- A business owns a store when business_profiles.supermarket_id points at it or
-- supermarkets.pichin_business_profile_id points back at the business. A store that
-- merely shares an owner with another business is not matched. NULL = no website.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_store_public_website(
  p_supermarket_id UUID DEFAULT NULL,
  p_business_profile_id UUID DEFAULT NULL
) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT cp.id
  FROM public.business_profiles bp
  JOIN public.cmms_company_profiles cp ON cp.business_profile_id = bp.id
  WHERE (p_business_profile_id IS NOT NULL AND bp.id = p_business_profile_id)
     OR (p_supermarket_id IS NOT NULL AND (
          bp.supermarket_id = p_supermarket_id
          OR EXISTS (SELECT 1 FROM public.supermarkets s
                     WHERE s.id = p_supermarket_id AND s.pichin_business_profile_id = bp.id)))
  ORDER BY (p_business_profile_id IS NOT NULL AND bp.id = p_business_profile_id) DESC,
           cp.updated_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_store_public_website(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_store_public_website(UUID, UUID) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT 'get_store_public_website ready' AS status;
