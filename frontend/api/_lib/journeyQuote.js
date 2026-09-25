import { originAirportOf, priceAirportTransferUgx } from './transfer.js';
import { priceJourney } from './pricing.js';

/** Flat estimate for the ride from the arrival airport (real per-country fare models are Phase 2). */
export const DROPOFF_FARE_UGX = 20000;

/** Most travellers Duffel will book on one offer. */
export const MAX_PARTY_SIZE = 9;
/** Travellers one BodaGoEra car carries. A bike carries one, so any party travels by car. */
export const CAR_SEATS = 4;

export class RideCapacityError extends Error {
  constructor(partySize) {
    super(`A BodaGoEra car seats up to ${CAR_SEATS} travellers, so airport rides can't be booked for a party of ${partySize} — choose "My own way" for the ride(s) and we'll still book everyone's flight.`);
    this.name = 'RideCapacityError';
  }
}

/** Heaviest parcel a courier on a bike takes (mirrored in JourneyBookingFlow.tsx). */
export const PARCEL_BIKE_MAX_KG = 30;

/**
 * The parcel a "Send a parcel" journey carries, cleaned up; or the reason it can't
 * be booked. The parcel travels as checked baggage, so it needs a weight (priced
 * like any baggage), and whoever meets it on arrival needs a name and a number.
 */
export function cleanParcel(input, { dropoffRide, weightKg }) {
  const description = String(input?.description ?? '').trim().slice(0, 200);
  const recipientName = String(input?.recipientName ?? '').trim().slice(0, 100);
  const recipientPhone = String(input?.recipientPhone ?? '').trim().slice(0, 30);
  // The courier's vehicle, for both legs. A bike only carries a small parcel.
  const vehicleType = ['motorcycle', 'car'].includes(input?.vehicleType) ? input.vehicleType : null;
  let error = null;
  if (!description) error = 'Say what the parcel is so the courier knows what they are carrying.';
  else if (!(Number(weightKg) > 0)) error = "Enter the parcel's weight.";
  else if (vehicleType === 'motorcycle' && Number(weightKg) > PARCEL_BIKE_MAX_KG) {
    error = `A bike carries up to ${PARCEL_BIKE_MAX_KG} kg — choose a car for a heavier parcel.`;
  } else if (dropoffRide && (!recipientName || recipientPhone.replace(/\D/g, '').length < 7)) {
    error = "Enter the recipient's name and phone number, or turn the arrival courier off.";
  }
  return { error, parcel: { description, recipientName, recipientPhone, vehicleType } };
}

/** Why a store order can't be priced (out of stock, no payout account, price engine down...). */
export class StoreOrderError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StoreOrderError';
  }
}

/**
 * Goods bought from a registered store abroad, priced by the database at ICAN's live
 * value of the store's own currency (stock checked, tax included). The store's own
 * location becomes the pickup — never whatever the browser sent. Returns the parcel
 * description too, so a store order needs no typed description.
 */
export async function loadStoreOrder(supabaseAdmin, store) {
  const cart = (Array.isArray(store?.cart) ? store.cart : []).map((l) => ({ product_id: l?.productId, quantity: l?.quantity }));
  const { data, error } = await supabaseAdmin.rpc('mbg_quote_import_goods', { p_supermarket_id: store?.supermarketId ?? null, p_cart: cart });
  if (error) {
    console.error('mbg_quote_import_goods failed:', error.message);
    throw new StoreOrderError('Buying from a store abroad is not available yet. You have not been charged.');
  }
  if (!data?.success) throw new StoreOrderError(data?.error || 'This store order cannot be priced.');
  const lines = data.lines || [];
  return {
    supermarketId: data.store.id,
    storeName: data.store.name,
    currency: data.currency,
    goodsLocal: Number(data.goods_local),
    goodsIcan: Number(data.goods_ican),
    pricePerIcan: Number(data.price_per_ican),
    lines: lines.map((l) => ({ productId: l.product_id, name: l.product_name, quantity: Number(l.quantity), unitPrice: Number(l.unit_price), lineTotal: Number(l.line_total) })),
    cart,
    description: `Order from ${data.store.name}: ${lines.map((l) => `${l.quantity}x ${l.product_name}`).join(', ')}`.slice(0, 200),
    // The courier collects here, in the store's own country.
    pickup: {
      lat: Number(data.store.latitude), lng: Number(data.store.longitude),
      address: data.store.address || data.store.name, country: data.store.country
    }
  };
}

/** How many travellers an offer was searched for (Duffel lists one passenger id each). */
export function partySizeOf(offer) {
  const n = Array.isArray(offer?.passengers) ? offer.passengers.length : 1;
  return Math.min(MAX_PARTY_SIZE, Math.max(1, n));
}

/**
 * Every amount of a journey, worked out on the server from the offer, the pickup
 * and the baggage weight. The quote endpoint shows these to the customer and the
 * confirm endpoint recomputes them before charging, so what is debited never
 * depends on figures the browser sent.
 */
export async function computeQuoteAmounts(supabaseAdmin, { pickup, offer, cargoWeightKg, userId, pickupRide = true, dropoffRide = true, partySize = partySizeOf(offer), parcel = false, goodsIcan = 0 }) {
  // One car per ride: refuse a party it can't carry rather than sending a driver who can't take them all.
  // A parcel journey's ground legs carry goods, not the travellers, so seats don't limit them.
  if (!parcel && (pickupRide || dropoffRide) && partySize > CAR_SEATS) throw new RideCapacityError(partySize);

  // Ride to the departure airport: the normal base + per-km rate over the real
  // distance to that airport, priced once and prepaid with the journey (never
  // re-charged as a normal ride booking — see _lib/transfer.js). A customer who
  // has their own car, or a friend driving them, skips it and is not charged.
  const airport = originAirportOf(offer);
  const { fareUgx: pickupFareUgx, distanceKm: pickupKm } = pickupRide
    ? await priceAirportTransferUgx(supabaseAdmin, pickup, airport)
    : { fareUgx: 0, distanceKm: null };

  const dropoffFareUgx = dropoffRide ? DROPOFF_FARE_UGX : 0;

  // Extra baggage the party brings beyond its free allowance (each traveller has
  // their own) — a per-kg platform surcharge, not a real airline ancillary-baggage booking.
  const weightKg = Number(cargoWeightKg) || 0;
  const { data: freeAllowanceSetting } = await supabaseAdmin.rpc('mbg_get_setting_numeric', { p_key: 'journey.free_baggage_kg', p_default: 23 });
  const { data: perKgSetting } = await supabaseAdmin.rpc('mbg_get_setting_numeric', { p_key: 'journey.excess_baggage_per_kg_ugx', p_default: 5000 });
  const freeAllowanceKg = (Number(freeAllowanceSetting) || 23) * partySize;
  const perKgRate = Number(perKgSetting) || 5000;
  const cargoFareUgx = Math.round(Math.max(0, weightKg - freeAllowanceKg) * perKgRate);

  // Everything is priced in ICAN at its live value (the airline's fare from its
  // own currency) — see _lib/pricing.js. Unsupported currencies and an
  // unreachable price engine are refused rather than guessed.
  const priced = await priceJourney(supabaseAdmin, { pickupFareUgx, dropoffFareUgx, cargoFareUgx, offer, userId, goodsIcan });

  return { airport, pickupFareUgx, pickupKm, dropoffFareUgx, cargoFareUgx, weightKg, priced, pickupRide, dropoffRide, partySize, parcel };
}
