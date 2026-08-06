import { supabaseAdmin } from '../_lib/supabaseAdmin.js';
import { applyCors } from '../_lib/cors.js';
import { requireUser, requireMatchingUser } from '../_lib/auth.js';

const ICAN_TO_UGX = 5000; // must match ICAN's floor price (see ICAN_CROSS_APP_WALLET_MIGRATION.sql)

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

    // Flight fare converted at a platform FX setting (fallback: a fixed
    // illustrative rate — replace with a live FX feed in Phase 2).
    const { data: fxSetting } = await supabaseAdmin.from('mbg_platform_settings').select('value').eq('key', 'fx.usd_ugx_rate').single();
    const fxRate = Number(fxSetting?.value) || 3800;
    const flightFareUgx = Math.round(Number(offer.totalAmount) * fxRate);

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

    const totalUgx = pickupFareUgx + flightFareUgx + cargoFareUgx + dropoffFareUgx;
    const totalIcan = Number((totalUgx / ICAN_TO_UGX).toFixed(8));

    res.status(200).json({
      success: true,
      quote: { pickupFareUgx, flightFareUgx, cargoFareUgx, dropoffFareUgx, totalUgx, totalIcan, pickup, destination, offer, cargoWeightKg: weightKg }
    });
  } catch (error) {
    console.error('Journey quote error:', error);
    res.status(500).json({ success: false, error: 'Failed to build journey quote' });
  }
}
