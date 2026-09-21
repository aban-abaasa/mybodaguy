// Journey pricing helpers. ICAN (icaneracoin) is the platform's stable unit, so
// every price is expressed in ICAN first and only then shown in a currency:
//
//   airline fare (GBP, KES, …)  ->  ICAN   at the LIVE ICAN price in that currency
//   ICAN                        ->  the customer's own currency, at the LIVE
//                                   ICAN price in THAT currency
//
// The live price comes from the platform's own price engine through
// ican_get_price_in_currency(currency) — the same number a user sees on their
// wallet badge ("1 icaneracoin = KES 228.10"). It moves with FX, the local
// inflation floor and network usage, and is never below the launch floor, so
// nothing here hardcodes a rate. A currency the engine has no price for is
// refused rather than guessed; if the engine can't be reached the quote fails
// closed (a wrong price on a real flight booking is worse than a retry).
//
// The customer's currency is the one implied by the country they chose at
// sign-up: user_accounts.country_code -> ican_country_currency_map, with the
// same USD fallback the wallet display uses.

/** Launch floor: no live ICAN price is ever below this many UGX. */
export const ICAN_UGX_FLOOR = 5000;

// Prices move slowly (usage, FX refresh is daily) but every quote/search would
// otherwise cost a round-trip on a Free-plan database — so reuse for 30s.
const PRICE_TTL_MS = 30_000;
const priceCache = new Map();

export class UnsupportedCurrencyError extends Error {
  constructor(currency) {
    super(`Fares in ${currency || 'this currency'} can't be priced in ICAN yet`);
    this.name = 'UnsupportedCurrencyError';
    this.currency = currency;
  }
}

export class PriceUnavailableError extends Error {
  constructor() {
    super("The live ICAN price isn't available right now — please try again in a moment.");
    this.name = 'PriceUnavailableError';
  }
}

export function clearPriceCache() {
  priceCache.clear();
}

export const round8 = (n) => Number(Number(n).toFixed(8));

/**
 * Live price of 1 ICAN in `currency`, straight from the platform price engine.
 * `db` is a Supabase client (service role) — passed in so this stays testable.
 */
export async function getIcanPrice(db, currency) {
  const code = String(currency || '').trim().toUpperCase();
  if (!code) throw new UnsupportedCurrencyError(code);

  // Cache the lookup itself (not just its result) so a search with dozens of
  // offers in one currency makes a single request, not one per offer.
  const hit = priceCache.get(code);
  if (hit && Date.now() - hit.at < PRICE_TTL_MS) return hit.promise;

  const promise = (async () => {
    const { data, error } = await db.rpc('ican_get_price_in_currency', { p_currency_code: code });
    if (error) {
      console.error(`[pricing] ican_get_price_in_currency(${code}) failed:`, error.message);
      throw new PriceUnavailableError();
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new UnsupportedCurrencyError(code);

    const pricePerIcan = Number(row.price_local);
    if (!Number.isFinite(pricePerIcan) || pricePerIcan <= 0) throw new PriceUnavailableError();
    return { currency: code, pricePerIcan };
  })();

  priceCache.set(code, { at: Date.now(), promise });
  // A failed lookup must not be remembered — the next request should retry.
  promise.catch(() => {
    if (priceCache.get(code)?.promise === promise) priceCache.delete(code);
  });
  return promise;
}

/** A fiat amount in ICAN at that currency's live price, and the price used. */
export async function fiatToIcan(db, amount, currency) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) throw new Error('Invalid fare amount');
  const { pricePerIcan } = await getIcanPrice(db, currency);
  return { ican: round8(value / pricePerIcan), pricePerIcan };
}

/**
 * The customer's own currency and the live ICAN price in it, or throws if it
 * can't be worked out (callers treat that as "show ICAN only").
 */
export async function getUserCurrency(db, userId) {
  let countryCode = 'UG';
  const { data: account } = await db.from('user_accounts').select('country_code').eq('user_id', userId).maybeSingle();
  if (account?.country_code) countryCode = String(account.country_code).toUpperCase();

  const { data: mapped } = await db.from('ican_country_currency_map').select('currency_code').eq('country_code', countryCode).maybeSingle();
  // Same fallback chain as ican_get_user_wallet_display: their currency, else USD.
  const candidates = [...new Set([mapped?.currency_code, 'USD', 'UGX'].filter(Boolean))];
  for (const code of candidates) {
    try {
      const { currency, pricePerIcan } = await getIcanPrice(db, code);
      return { countryCode, currency, pricePerIcan };
    } catch (err) {
      if (!(err instanceof UnsupportedCurrencyError)) throw err;
    }
  }
  throw new UnsupportedCurrencyError(mapped?.currency_code);
}

/**
 * Prices a whole journey in ICAN at the live value, plus the same amounts in
 * the customer's own currency.
 *
 * The platform-set legs (airport ride, arrival driver, excess baggage) are
 * defined in UGX, so they go UGX -> ICAN at the live UGX price; the airline fare
 * goes from its own currency -> ICAN at that currency's live price. The total is
 * the sum of the rounded per-line ICAN amounts so the lines always add up. The
 * `*Ugx` figures are the ICAN amounts valued at the live UGX price — kept for
 * the journey records, which are UGX-denominated.
 */
export async function priceJourney(db, { pickupFareUgx, dropoffFareUgx, cargoFareUgx, offer, userId }) {
  const [ugxPrice, flight] = await Promise.all([
    getIcanPrice(db, 'UGX'),
    fiatToIcan(db, offer.totalAmount, offer.totalCurrency),
  ]);
  const icanPriceUgx = ugxPrice.pricePerIcan;
  const ugxToIcan = (ugx) => round8(Number(ugx) / icanPriceUgx);

  const pickupIcan = ugxToIcan(pickupFareUgx);
  const cargoIcan = ugxToIcan(cargoFareUgx);
  const dropoffIcan = ugxToIcan(dropoffFareUgx);
  const flightIcan = flight.ican;
  const totalIcan = round8(pickupIcan + flightIcan + cargoIcan + dropoffIcan);

  const flightFareUgx = Math.round(flightIcan * icanPriceUgx);
  const totalUgx = pickupFareUgx + flightFareUgx + cargoFareUgx + dropoffFareUgx;

  // The customer's own currency is a courtesy view of an ICAN price that's
  // already final — if it can't be worked out, they still get the ICAN price.
  let local = null;
  try {
    const { currency, countryCode, pricePerIcan } = await getUserCurrency(db, userId);
    const at = (ican) => Number((ican * pricePerIcan).toFixed(6));
    local = {
      currency, countryCode, pricePerIcan,
      pickup: at(pickupIcan), flight: at(flightIcan), cargo: at(cargoIcan), dropoff: at(dropoffIcan), total: at(totalIcan),
    };
  } catch (err) {
    console.warn('[pricing] no local-currency view for this customer:', err.message);
  }

  return {
    pickupIcan, flightIcan, cargoIcan, dropoffIcan, totalIcan,
    flightFareUgx, totalUgx,
    icanPriceUgx,
    local,
  };
}
