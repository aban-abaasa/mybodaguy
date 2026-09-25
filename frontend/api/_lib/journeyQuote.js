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
export async function computeQuoteAmounts(supabaseAdmin, { pickup, offer, cargoWeightKg, userId, pickupRide = true, dropoffRide = true, partySize = partySizeOf(offer) }) {
  // One car per ride: refuse a party it can't carry rather than sending a driver who can't take them all.
  if ((pickupRide || dropoffRide) && partySize > CAR_SEATS) throw new RideCapacityError(partySize);

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
  const priced = await priceJourney(supabaseAdmin, { pickupFareUgx, dropoffFareUgx, cargoFareUgx, offer, userId });

  return { airport, pickupFareUgx, pickupKm, dropoffFareUgx, cargoFareUgx, weightKg, priced, pickupRide, dropoffRide, partySize };
}
