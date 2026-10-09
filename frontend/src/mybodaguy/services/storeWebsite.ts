/**
 * A store's public business website (icanera.space/notices/<company id>).
 *
 * That page lives on the IcanEra site, not on this app's own domain, and it is
 * where a customer pays with anything other than their IcanEra wallet (Mobile
 * Money, card, bank, cash). The company id comes from get_store_public_website
 * (backend/database/ADD_STORE_PUBLIC_WEBSITE_LOOKUP.sql) because customers cannot
 * read cmms_company_profiles themselves. Resolves to null when the store or
 * business has no website, or the lookup fails; it never throws.
 */
import { supabase } from '../../services/supabaseClient';

const SITE_ORIGIN =
  ((import.meta.env.VITE_ICANERA_SITE_URL as string | undefined) || 'https://icanera.space').replace(/\/+$/, '');

export async function getStoreWebsiteUrl(
  { supermarketId, businessProfileId }: { supermarketId?: string | null; businessProfileId?: string | null },
): Promise<string | null> {
  if (!supermarketId && !businessProfileId) return null;
  try {
    const { data, error } = await supabase.rpc('get_store_public_website', {
      p_supermarket_id: supermarketId ?? null,
      p_business_profile_id: businessProfileId ?? null,
    });
    if (error || !data) return null;
    return `${SITE_ORIGIN}/notices/${data}`;
  } catch {
    return null;
  }
}

/**
 * A store always has a website: its business website when one exists, otherwise its
 * storefront on icanera.space (the Market of whichever business owns the store).
 * `viaStorefront` is true for the fallback, which has no Pay tab to deep-link into.
 */
export async function getStoreSiteForCustomer(
  { supermarketId, businessProfileId }: { supermarketId?: string | null; businessProfileId?: string | null },
): Promise<{ url: string; viaStorefront: boolean } | null> {
  const site = await getStoreWebsiteUrl({ supermarketId, businessProfileId });
  if (site) return { url: site, viaStorefront: false };
  try {
    let businessId = businessProfileId ?? null;
    if (!businessId && supermarketId) {
      const { data: store } = await supabase.from('supermarkets')
        .select('pichin_business_profile_id').eq('id', supermarketId).maybeSingle();
      businessId = store?.pichin_business_profile_id ?? null;
      if (!businessId) {
        const { data: owner } = await supabase.from('business_profiles')
          .select('id').eq('supermarket_id', supermarketId).limit(1).maybeSingle();
        businessId = owner?.id ?? null;
      }
    }
    return businessId ? { url: `${SITE_ORIGIN}/store/${businessId}`, viaStorefront: true } : null;
  } catch {
    return null;
  }
}
