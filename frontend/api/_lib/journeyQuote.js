import { originAirportOf, priceAirportTransferUgx } from './transfer.js';
import { priceJourney } from './pricing.js';

/** Flat estimate for the ride from the arrival airport (real per-country fare models are Phase 2). */
export const DROPOFF_FARE_UGX = 20000;

/**
 * Every amount of a journey, worked out on the server from the offer, the pickup
 * and the baggage weight. The quote endpoint shows these to the customer and the
 * confirm endpoint recomputes them before charging, so what is debited never
 * depends on figures the browser sent.
 */
export async function computeQuoteAmounts(supabaseAdmin, { pickup, offer, cargoWeightKg, userId }) {
  // Ride to the departure airport: the normal base + per-km rate over the real
  // distance to that airport, priced once and prepaid with the journey (never
  // re-charged as a normal ride booking — see _lib/transfer.js).
  const airport = originAirportOf(offer);
  const { fareUgx: pickupFareUgx, distanceKm: pickupKm } = await priceAirportTransferUgx(supabaseAdmin, pickup, airport);

  const dropoffFareUgx = DROPOFF_FARE_UGX;

  // Extra baggage the passenger brings beyond a free allowance — a per-kg
  // platform surcharge, not a real airline ancillary-baggage booking.
  const weightKg = Number(cargoWeightKg) || 0;
  const { data: freeAllowanceSetting } = await supabaseAdmin.rpc('mbg_get_setting_numeric', { p_key: 'journey.free_baggage_kg', p_default: 23 });
  const { data: perKgSetting } = await supabaseAdmin.rpc('mbg_get_setting_numeric', { p_key: 'journey.excess_baggage_per_kg_ugx', p_default: 5000 });
  const freeAllowanceKg = Number(freeAllowanceSetting) || 23;
  const perKgRate = Number(perKgSetting) || 5000;
  const cargoFareUgx = Math.round(Math.max(0, weightKg - freeAllowanceKg) * perKgRate);

  // Everything is priced in ICAN at its live value (the airline's fare from its
  // own currency) — see _lib/pricing.js. Unsupported currencies and an
  // unreachable price engine are refused rather than guessed.
  const priced = await priceJourney(supabaseAdmin, { pickupFareUgx, dropoffFareUgx, cargoFareUgx, offer, userId });

  return { airport, pickupFareUgx, pickupKm, dropoffFareUgx, cargoFareUgx, weightKg, priced };
}
