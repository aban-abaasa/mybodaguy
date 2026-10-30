/**
 * How a service is priced for a customer: one price, a range ("from X to Y") or on request.
 * `price_ugx` is always the lowest price; `price_max` is the optional top of a range
 * (products.price_max). A top that is not above the lowest price is not a range.
 */
export interface ServicePriced {
  price_ugx: number;
  price_max?: number | null;
}

export type ServicePriceKind = 'fixed' | 'range' | 'quote';

export function servicePriceKind(s: ServicePriced): ServicePriceKind {
  const from = Number(s.price_ugx) || 0;
  const to = Number(s.price_max) || 0;
  if (from > 0 && to > from) return 'range';
  return from > 0 ? 'fixed' : 'quote';
}

/** "UGX 20,000", "UGX 20,000 - 50,000" or "Ask for a quote". `money` formats one amount with its currency. */
export function servicePriceText(s: ServicePriced, money: (n: number) => string): string {
  const kind = servicePriceKind(s);
  if (kind === 'quote') return 'Ask for a quote';
  if (kind === 'fixed') return money(Number(s.price_ugx));
  // "UGX 20,000" + "UGX 50,000" -> "UGX 20,000 - 50,000"
  return `${money(Number(s.price_ugx))} - ${money(Number(s.price_max)).replace(/^[A-Za-z]{3}\s+/, '')}`;
}
