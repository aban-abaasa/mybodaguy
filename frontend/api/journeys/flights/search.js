import { searchOffers } from '../../_lib/duffel.js';
import { applyCors } from '../../_lib/cors.js';
import { fiatToIcan, getUserCurrency } from '../../_lib/pricing.js';

const CABIN_CLASSES = ['economy', 'premium_economy', 'business', 'first'];

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const { originIata, destinationIata, departureDate, passengerCount = 1, cabinClass } = req.body;
    if (!originIata || !destinationIata || !departureDate) {
      return res.status(400).json({ success: false, error: 'originIata, destinationIata and departureDate are required' });
    }
    if (String(originIata).toUpperCase() === String(destinationIata).toUpperCase()) {
      return res.status(400).json({ success: false, error: 'Departure and arrival airports must be different.' });
    }
    // Compare as plain dates, one day of slack so a customer already into
    // "tomorrow" in their timezone isn't rejected by a server still on today.
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (departureDate < yesterday) {
      return res.status(400).json({ success: false, error: 'That departure date has already passed.' });
    }
    if (cabinClass !== undefined && !CABIN_CLASSES.includes(cabinClass)) {
      return res.status(400).json({ success: false, error: `cabinClass must be one of: ${CABIN_CLASSES.join(', ')}` });
    }
    const passengers = Array.from({ length: passengerCount }, () => ({ type: 'adult' }));
    const result = await searchOffers({ originIata, destinationIata, departureDate, passengers, cabinClass });
    res.status(200).json({ success: true, ...(await priceInIcan(req, result)) });
  } catch (error) {
    console.error('Flight search error:', error.status, JSON.stringify(error.duffelResponse) || error.message);
    // Duffel rejecting the search itself (bad date, same origin/destination,
    // unknown airport…) is something the customer can fix, and its message is
    // written for humans — pass it on instead of a blanket 500. Anything else
    // (auth, rate limit, Duffel down, our own bug) stays generic.
    if (error.status === 400 || error.status === 422) {
      return res.status(422).json({ success: false, error: error.message, code: error.duffelCode });
    }
    if (error.status === 429) {
      return res.status(429).json({ success: false, error: 'Too many searches right now — please wait a moment and try again.' });
    }
    if (error.status) {
      return res.status(502).json({ success: false, error: 'The airline search service is unavailable right now — please try again shortly.', code: error.duffelCode });
    }
    res.status(500).json({ success: false, error: 'Failed to search flights' });
  }
}

/**
 * Adds each offer's price in ICAN (at the live value, from the airline's own
 * currency) and — for a signed-in customer — in the currency of the country
 * they chose. Pricing is a convenience layer: an offer whose currency the
 * price engine can't handle just goes out without ICAN figures and the page
 * falls back to the airline's own price; it never fails the search.
 */
async function priceInIcan(req, result) {
  const unpriced = {
    ...result,
    offers: result.offers.map((offer) => ({ ...offer, priceIcan: null, priceLocal: null, localCurrency: null })),
    pricing: null,
  };

  // The Supabase client is created when its module loads and throws if the
  // server's SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY aren't set. Loading it
  // here — not at the top of the file — means a misconfigured server costs the
  // customer the ICAN figures, never the whole flight search.
  let supabaseAdmin;
  let optionalUser;
  try {
    ({ supabaseAdmin } = await import('../../_lib/supabaseAdmin.js'));
    ({ optionalUser } = await import('../../_lib/auth.js'));
  } catch (err) {
    console.error('Flight search: ICAN pricing unavailable —', err.message);
    return unpriced;
  }

  try {
    let local = null;
    const user = await optionalUser(req);
    if (user) {
      try {
        local = await getUserCurrency(supabaseAdmin, user.id);
      } catch (err) {
        console.warn('Flight search: no local-currency view for this customer:', err.message);
      }
    }

    const offers = await Promise.all(result.offers.map(async (offer) => {
      try {
        const { ican } = await fiatToIcan(supabaseAdmin, offer.totalAmount, offer.totalCurrency);
        return {
          ...offer,
          priceIcan: ican,
          priceLocal: local ? Number((ican * local.pricePerIcan).toFixed(6)) : null,
          localCurrency: local ? local.currency : null,
        };
      } catch (err) {
        console.warn(`Flight search: no ICAN price for ${offer.totalCurrency}:`, err.message);
        return { ...offer, priceIcan: null, priceLocal: null, localCurrency: null };
      }
    }));

    return { ...result, offers, pricing: local ? { currency: local.currency, pricePerIcan: local.pricePerIcan } : null };
  } catch (err) {
    console.error('Flight search: ICAN pricing failed —', err.message);
    return unpriced;
  }
}
