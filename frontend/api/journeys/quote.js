import { supabaseAdmin } from '../_lib/supabaseAdmin.js';
import { applyCors } from '../_lib/cors.js';
import { requireUser, requireMatchingUser } from '../_lib/auth.js';
import { priceJourney, UnsupportedCurrencyError, PriceUnavailableError } from '../_lib/pricing.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const { customerUserId, pickup, offer, destination, cargoWeightKg } = req.body;
    if (!requireMatchingUser(user, customerUserId, res)) return;

    const { data: customer } = await supabaseAdmin
      .from('mbg_customers')
      .select('id')
      .eq('user_id', customerUserId)
      .single();
    if (!customer) {
      return res.status(400).json({ success: false, error: 'No BodaGoEra customer profile for this user yet' });
    }

    // Local pickup fare: real haversine estimate to the airport isn't known
    // yet at quote time (airport lat/lng not chosen), so Phase 1 uses the
    // platform's minimum fare as the pickup-leg estimate.
    const { data: pickupEstimate } = await supabaseAdmin.rpc('mbg_get_setting_numeric', { p_key: 'ride.minimum_fare', p_default: 2000 });
    const pickupFareUgx = Number(pickupEstimate) || 2000;

    // Local dropoff: Phase 1 flat estimate (real per-country fare models are
    // Phase 2 — see the approved plan's roadmap).
    const dropoffFareUgx = 20000;

    // Extra baggage/cargo the passenger is bringing along on the flight,
    // beyond a free allowance — a straightforward per-kg platform surcharge,
    // not a real Duffel ancillary-baggage booking (no such integration
    // exists yet).
    const weightKg = Number(cargoWeightKg) || 0;
    const { data: freeAllowanceSetting } = await supabaseAdmin.rpc('mbg_get_setting_numeric', { p_key: 'journey.free_baggage_kg', p_default: 23 });
    const { data: perKgSetting } = await supabaseAdmin.rpc('mbg_get_setting_numeric', { p_key: 'journey.excess_baggage_per_kg_ugx', p_default: 5000 });
    const freeAllowanceKg = Number(freeAllowanceSetting) || 23;
    const perKgRate = Number(perKgSetting) || 5000;
    const chargeableKg = Math.max(0, weightKg - freeAllowanceKg);
    const cargoFareUgx = Math.round(chargeableKg * perKgRate);

    // Everything is priced in ICAN at its live value (the airline's fare from
    // its own currency), then shown in the customer's own currency — see
    // _lib/pricing.js. Fares in a currency the price engine doesn't know are
    // refused, and so is any quote while the live price is unreachable.
    const priced = await priceJourney(supabaseAdmin, { pickupFareUgx, dropoffFareUgx, cargoFareUgx, offer, userId: customerUserId });

    res.status(200).json({
      success: true,
      quote: {
        pickupFareUgx, flightFareUgx: priced.flightFareUgx, cargoFareUgx, dropoffFareUgx, totalUgx: priced.totalUgx,
        pickupIcan: priced.pickupIcan, flightIcan: priced.flightIcan, cargoIcan: priced.cargoIcan, dropoffIcan: priced.dropoffIcan,
        totalIcan: priced.totalIcan,
        icanPriceUgx: priced.icanPriceUgx,
        local: priced.local,
        pickup, destination, offer, cargoWeightKg: weightKg
      }
    });
  } catch (error) {
    if (error instanceof UnsupportedCurrencyError) {
      return res.status(422).json({ success: false, error: `${error.message} — please choose a different flight.`, code: 'unsupported_currency' });
    }
    if (error instanceof PriceUnavailableError) {
      return res.status(503).json({ success: false, error: error.message, code: 'price_unavailable' });
    }
    console.error('Journey quote error:', error);
    res.status(500).json({ success: false, error: 'Failed to build journey quote' });
  }
}
