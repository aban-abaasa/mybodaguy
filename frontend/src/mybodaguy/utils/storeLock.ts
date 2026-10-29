/**
 * The "one store per delivery" rule for the store-delivery shop, kept free of
 * React and Supabase so it can be unit-tested (tests/storeLock.test.js).
 *
 * A delivery picks up from exactly one store (mbg_request_ride takes a single
 * supermarket_id). So the moment the basket holds a product, the shop narrows to
 * that store, and any attempt to add from another store is stopped on the spot
 * instead of failing later at checkout.
 */

export interface StoreProductRef {
  id: string;
  supermarket_id: string;
}

export type AddDecision =
  /** Nothing in the basket yet and no store open: add it, then open only this product's store. */
  | { kind: 'lock'; storeId: string }
  /** Same store as the basket (or the store already open): just add it. */
  | { kind: 'add' }
  /** The basket belongs to another store: refuse, and tell the customer straight away. */
  | { kind: 'conflict'; cartStoreId: string; productStoreId: string };

/** The store the basket is from: the store of its first product with a quantity, or null when it is empty. */
export function cartStoreId(
  qtyById: Record<string, number>,
  productsById: Record<string, StoreProductRef | undefined>,
): string | null {
  for (const id of Object.keys(qtyById)) {
    if ((qtyById[id] || 0) > 0 && productsById[id]) return productsById[id]!.supermarket_id;
  }
  return null;
}

/**
 * What to do when the customer taps "+ Add" on a product.
 * `openStoreId` is the store the shop is already narrowed to ('' / null = every store).
 */
export function decideAdd(
  product: StoreProductRef,
  cartStore: string | null,
  openStoreId?: string | null,
): AddDecision {
  if (cartStore && cartStore !== product.supermarket_id) {
    return { kind: 'conflict', cartStoreId: cartStore, productStoreId: product.supermarket_id };
  }
  if (!cartStore && !openStoreId) return { kind: 'lock', storeId: product.supermarket_id };
  return { kind: 'add' };
}

/** Whether tapping `targetStoreId` in the store strip needs a "switch store?" confirmation. */
export function switchNeedsConfirm(cartStore: string | null, targetStoreId: string): boolean {
  return !!cartStore && cartStore !== targetStoreId;
}

export interface RankableStore {
  id: string;
  distanceKm: number | null;
  abroad: boolean;
}

/**
 * Nearest first. Stores in the customer's country come before stores abroad; a
 * store with no measurable distance sorts after the ones with one, never hidden.
 * The store the basket is locked to (if any) is NOT moved — it stays where its
 * distance puts it, so the strip does not jump around while the customer shops.
 */
export function rankStores<T extends RankableStore>(stores: T[]): T[] {
  return [...stores].sort((a, b) => {
    if (a.abroad !== b.abroad) return a.abroad ? 1 : -1;
    if (a.distanceKm == null && b.distanceKm == null) return 0;
    if (a.distanceKm == null) return 1;
    if (b.distanceKm == null) return -1;
    return a.distanceKm - b.distanceKm;
  });
}

export function formatDistance(km: number | null | undefined): string | null {
  if (km == null) return null;
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}
