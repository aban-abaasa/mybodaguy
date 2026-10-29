/**
 * The rider's Markets: how a business type reads, and which markets are NEW to a rider.
 * Kept free of React and Supabase so it can be unit-tested (tests/markets.test.js).
 *
 * "New" is decided per rider from the set of market ids they have already been told about
 * (kept in localStorage). The very first check only records what exists, so a rider who
 * opens the app for the first time is not buzzed about every market already on the platform.
 */

export interface MarketRef {
  id: string;
  name: string;
  location?: string | null;
  business_type?: string | null;
}

export const BUSINESS_TYPE_EMOJI: Record<string, string> = {
  supermarket: '🏪', hotel: '🏨', boutique: '👗', restaurant_cafe: '🍽️',
};

const BUSINESS_TYPE_LABEL: Record<string, string> = {
  supermarket: 'Supermarket', hotel: 'Hotel', boutique: 'Boutique', restaurant_cafe: 'Restaurant & Café',
};

// Known types get a proper label; anything new falls back to a readable
// version of its raw value ("pharmacy_shop" -> "Pharmacy shop").
export const businessTypeLabel = (type: string | null | undefined): string => {
  const t = type || 'supermarket';
  return BUSINESS_TYPE_LABEL[t] || t.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
};

/**
 * Compares today's markets with the ids this rider already knows about.
 * `known === null` is the first check ever: nothing is new, everything is recorded.
 * The returned `known` is always the union, so a market is announced exactly once.
 */
export function findNewMarkets<T extends MarketRef>(
  known: ReadonlySet<string> | null,
  current: readonly T[],
): { fresh: T[]; known: Set<string> } {
  const next = new Set<string>(known ?? []);
  const fresh: T[] = [];
  for (const m of current) {
    if (known && !known.has(m.id)) fresh.push(m);
    next.add(m.id);
  }
  return { fresh, known: next };
}

/** The words for a notification about one or several new markets. */
export function describeNewMarkets(fresh: readonly MarketRef[]): { title: string; body: string } {
  if (fresh.length === 1) {
    const m = fresh[0];
    return {
      title: `New market: ${m.name}`,
      body: [businessTypeLabel(m.business_type), m.location].filter(Boolean).join(' · '),
    };
  }
  const names = fresh.slice(0, 3).map(m => m.name).join(', ');
  const more = fresh.length - 3;
  return { title: `${fresh.length} new markets`, body: more > 0 ? `${names} +${more} more` : names };
}

const storageKey = (riderId: string) => `mbg_markets_known_${riderId}`;

export function loadKnownMarkets(riderId: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(storageKey(riderId));
    if (!raw) return null;
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? new Set<string>(ids.filter((x): x is string => typeof x === 'string')) : null;
  } catch {
    return null;
  }
}

export function saveKnownMarkets(riderId: string, known: ReadonlySet<string>): void {
  try {
    localStorage.setItem(storageKey(riderId), JSON.stringify([...known]));
  } catch {
    /* private mode / quota: the worst case is being told about a market twice */
  }
}
