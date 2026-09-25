import { applyCors } from '../_lib/cors.js';
import { loadServer, sendMisconfigured } from '../_lib/loadServer.js';
import { computeQuoteAmounts, RideCapacityError } from '../_lib/journeyQuote.js';
import { UnsupportedCurrencyError, PriceUnavailableError } from '../_lib/pricing.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  let server;
  try {
    server = await loadServer();
  } catch (err) {
    return sendMisconfigured(res, err);
  }
  const { supabaseAdmin, requireUser, requireMatchingUser } = server;

  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const { customerUserId, pickup, offer, destination, cargoWeightKg } = req.body;
    // The customer can leave either airport ride out (own car / a friend drives them).
    const pickupRide = req.body.pickupRide !== false;
    const dropoffRide = req.body.dropoffRide !== false;
    if (!requireMatchingUser(user, customerUserId, res)) return;

    const { data: customer } = await supabaseAdmin
      .from('mbg_customers')
      .select('id')
      .eq('user_id', customerUserId)
      .single();
    if (!customer) {
      return res.status(400).json({ success: false, error: 'No BodaGoEra customer profile for this user yet' });
    }

    const { airport, pickupFareUgx, pickupKm, dropoffFareUgx, cargoFareUgx, weightKg, priced, partySize } =
      await computeQuoteAmounts(supabaseAdmin, { pickup, offer, cargoWeightKg, userId: customerUserId, pickupRide, dropoffRide });

    res.status(200).json({
      success: true,
      quote: {
        pickupFareUgx, flightFareUgx: priced.flightFareUgx, cargoFareUgx, dropoffFareUgx, totalUgx: priced.totalUgx,
        pickupIcan: priced.pickupIcan, flightIcan: priced.flightIcan, cargoIcan: priced.cargoIcan, dropoffIcan: priced.dropoffIcan,
        totalIcan: priced.totalIcan,
        icanPriceUgx: priced.icanPriceUgx,
        local: priced.local,
        pickupKm, pickupAirport: airport,
        pickup, destination, offer, cargoWeightKg: weightKg,
        pickupRide, dropoffRide, partySize
      }
    });
  } catch (error) {
    if (error instanceof RideCapacityError) {
      return res.status(422).json({ success: false, error: error.message, code: 'ride_capacity' });
    }
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
