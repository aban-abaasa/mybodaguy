// Duffel client using native fetch (Vercel's Node runtime has it built in)
// so this stays dependency-free — no axios needed just for this.
const DUFFEL_API_BASE = process.env.DUFFEL_API_BASE || 'https://api.duffel.com';
// Strip a leading BOM (seen elsewhere in this project's config, e.g.
// vercel.json) and surrounding whitespace — an env var pasted from a
// BOM-prefixed source would otherwise silently break the Bearer header and
// every Duffel call would 401.
const DUFFEL_ACCESS_TOKEN = process.env.DUFFEL_ACCESS_TOKEN?.replace(/^\uFEFF/, '').trim();

/** True while running on a Duffel TEST token — safe to show the airline's raw error text to the person booking. */
export const DUFFEL_TEST_MODE = !!DUFFEL_ACCESS_TOKEN && DUFFEL_ACCESS_TOKEN.startsWith('duffel_test');

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
  // A gateway/HTML error page isn't JSON — don't let the parse failure hide
  // the real HTTP status.
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.errors?.[0]?.message || `Duffel request failed: ${res.status}`);
    err.duffelResponse = data;
    err.status = res.status;
    err.duffelCode = data.errors?.[0]?.code;
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
      carrierIata: offer.owner?.iata_code ?? null,
      carrierLogoUrl: offer.owner?.logo_symbol_url ?? null,
      // null when the airline doesn't publish refund conditions for this fare.
      refundable: offer.conditions?.refund_before_departure ? !!offer.conditions.refund_before_departure.allowed : null,
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

/**
 * The booked order as a customer-facing air ticket (itinerary). Read live from
 * Duffel so it always shows the airline's own confirmed details — including the
 * e-ticket numbers, which the airline issues shortly after the booking and so
 * can be missing right after checkout (`eTickets` is then empty and the ticket
 * says the number is still being issued).
 */
export async function getOrderTicket(orderId) {
  const data = await duffelRequest(`/air/orders/${orderId}`, { method: 'GET' });
  const order = data.data;

  const passengers = (order.passengers || []).map((p) => ({
    id: p.id,
    title: p.title || null,
    givenName: p.given_name,
    familyName: p.family_name,
    type: p.type || 'adult'
  }));

  const segments = [];
  (order.slices || []).forEach((slice) => {
    (slice.segments || []).forEach((seg) => {
      const paxInfo = seg.passengers?.[0];
      segments.push({
        carrier: seg.marketing_carrier?.name || null,
        carrierIata: seg.marketing_carrier?.iata_code || null,
        flightNumber: seg.marketing_carrier
          ? `${seg.marketing_carrier.iata_code}${seg.marketing_carrier_flight_number}`
          : null,
        operatedBy: seg.operating_carrier?.name && seg.operating_carrier.name !== seg.marketing_carrier?.name
          ? seg.operating_carrier.name
          : null,
        aircraft: seg.aircraft?.name || null,
        origin: {
          iata: seg.origin?.iata_code || null,
          name: seg.origin?.name || null,
          city: seg.origin?.city_name || null,
          terminal: seg.origin_terminal || null
        },
        destination: {
          iata: seg.destination?.iata_code || null,
          name: seg.destination?.name || null,
          city: seg.destination?.city_name || null,
          terminal: seg.destination_terminal || null
        },
        departingAt: seg.departing_at || null,
        arrivingAt: seg.arriving_at || null,
        cabin: paxInfo?.cabin_class_marketing_name || paxInfo?.cabin_class || null,
        baggages: (paxInfo?.baggages || []).map((b) => ({ type: b.type, quantity: b.quantity }))
      });
    });
  });

  return {
    orderId: order.id,
    bookingReference: order.booking_reference,
    airline: order.owner?.name || segments[0]?.carrier || null,
    passengers,
    segments,
    eTickets: (order.documents || [])
      .filter((d) => d.type === 'electronic_ticket')
      .map((d) => d.unique_identifier),
    totalAmount: order.total_amount,
    totalCurrency: order.total_currency,
    bookedAt: order.created_at || null
  };
}

/**
 * The offer as the airline currently holds it — used just before charging the
 * customer, to be sure it can still be booked at the quoted price. Returns
 * { available: false } for an offer the airline no longer has.
 */
export async function getOfferStatus(offerId) {
  try {
    const data = await duffelRequest(`/air/offers/${offerId}`, { method: 'GET' });
    const offer = data.data;
    return {
      available: !offer.expires_at || new Date(offer.expires_at).getTime() > Date.now(),
      totalAmount: offer.total_amount,
      totalCurrency: offer.total_currency
    };
  } catch (err) {
    if (err.status === 404 || err.status === 410) return { available: false };
    throw err;
  }
}
