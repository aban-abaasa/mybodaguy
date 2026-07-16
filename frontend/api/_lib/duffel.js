// Duffel client using native fetch (Vercel's Node runtime has it built in)
// so this stays dependency-free — no axios needed just for this.
const DUFFEL_API_BASE = process.env.DUFFEL_API_BASE || 'https://api.duffel.com';
// Strip a leading BOM (seen elsewhere in this project's config, e.g.
// vercel.json) and surrounding whitespace — an env var pasted from a
// BOM-prefixed source would otherwise silently break the Bearer header and
// every Duffel call would 401.
const DUFFEL_ACCESS_TOKEN = process.env.DUFFEL_ACCESS_TOKEN?.replace(/^\uFEFF/, '').trim();

async function duffelRequest(path, options = {}) {
  const res = await fetch(`${DUFFEL_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${DUFFEL_ACCESS_TOKEN}`,
      'Duffel-Version': 'v2',
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.headers
    }
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.errors?.[0]?.message || `Duffel request failed: ${res.status}`);
    err.duffelResponse = data;
    throw err;
  }
  return data;
}

/**
 * Search one-way flight offers for a route/date.
 * passengers: [{ type: 'adult' }, ...]
 */
export async function searchOffers({ originIata, destinationIata, departureDate, passengers, cabinClass = 'economy' }) {
  const data = await duffelRequest('/air/offer_requests?return_offers=true', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        slices: [{ origin: originIata, destination: destinationIata, departure_date: departureDate }],
        passengers,
        cabin_class: cabinClass
      }
    })
  });

  return {
    offerRequestId: data.data.id,
    offers: (data.data.offers || []).map((offer) => ({
      offerId: offer.id,
      carrier: offer.owner?.name,
      totalAmount: offer.total_amount,
      totalCurrency: offer.total_currency,
      slices: offer.slices,
      expiresAt: offer.expires_at,
      // Order creation must reference these exact passenger ids from the
      // offer — Duffel rejects an order whose passengers don't match.
      passengers: offer.passengers
    }))
  };
}

/**
 * Book a previously-searched offer. type: 'balance' draws from the
 * platform's own prefunded Duffel balance — no per-customer card charge, no
 * synchronous ICAN->fiat conversion.
 */
export async function createOrder({ offerId, passengers, paymentAmount, paymentCurrency }) {
  const data = await duffelRequest('/air/orders', {
    method: 'POST',
    body: JSON.stringify({
      data: {
        type: 'instant',
        selected_offers: [offerId],
        passengers,
        payments: [{ type: 'balance', amount: paymentAmount, currency: paymentCurrency }]
      }
    })
  });

  const order = data.data;
  const firstSlice = order.slices?.[0];
  const firstSegment = firstSlice?.segments?.[0];

  return {
    orderId: order.id,
    pnr: order.booking_reference,
    originIata: firstSegment?.origin?.iata_code,
    destinationIata: firstSlice?.segments?.[firstSlice.segments.length - 1]?.destination?.iata_code,
    carrier: firstSegment?.marketing_carrier?.name,
    flightNumber: firstSegment ? `${firstSegment.marketing_carrier?.iata_code}${firstSegment.marketing_carrier_flight_number}` : null,
    departureAt: firstSegment?.departing_at,
    arrivalAt: firstSlice?.segments?.[firstSlice.segments.length - 1]?.arriving_at,
    raw: order
  };
}

/**
 * Resolve a city/country name to real airports — Duffel's Places API
 * (confirmed live: GET /places/suggestions, same auth as everything else
 * here) so a customer never has to know/type a raw IATA code.
 */
export async function searchPlaceSuggestions({ query }) {
  return duffelRequest(`/places/suggestions?query=${encodeURIComponent(query)}`, { method: 'GET' });
}

/** Fetch current state of a booked order — used by the poll-flights job. */
export async function getOrder(orderId) {
  const data = await duffelRequest(`/air/orders/${orderId}`, { method: 'GET' });
  const order = data.data;
  const firstSlice = order.slices?.[0];

  return {
    orderId: order.id,
    departureAt: firstSlice?.segments?.[0]?.departing_at,
    arrivalAt: firstSlice?.segments?.[firstSlice.segments.length - 1]?.arriving_at,
    raw: order
  };
}
