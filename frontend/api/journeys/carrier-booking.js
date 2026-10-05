/**
 * Books the sea leg of a PAID cargo journey with the shipping line (see _lib/carriers).
 *
 * POST /api/journeys/carrier-booking   { journeyId, dryRun?: boolean }
 * Header: x-cron-secret: <CRON_SECRET>   — an operations call, not a customer one: a real
 * booking commits money with the carrier, so it is never triggered by the customer's app
 * and never automatically on payment.
 *
 *   dryRun true  -> returns the exact request that WOULD be sent; books nothing.
 *   otherwise    -> sends it, then records the carrier's booking reference on the sea leg,
 *                   which the waybill and its QR page then show.
 *
 * Safe against double booking: the leg is claimed ("requesting") before the carrier is
 * called, a booking that timed out is left "unconfirmed" for a person to check (never
 * retried automatically), and only a clear refusal ("failed") can be tried again.
 */
import { applyCors } from '../_lib/cors.js';
import { loadServer, sendMisconfigured } from '../_lib/loadServer.js';
import { getCarrier } from '../_lib/carriers/index.js';
import { buildDcsaBookingRequest, CarrierRequestError } from '../_lib/carriers/dcsa.js';
import { CarrierUnconfirmedError } from '../_lib/carriers/maersk.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  if (!process.env.CRON_SECRET || req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  let server;
  try {
    server = await loadServer();
  } catch (err) {
    return sendMisconfigured(res, err);
  }
  const { supabaseAdmin: db } = server;

  const journeyId = String(req.body?.journeyId || '');
  const dryRun = req.body?.dryRun === true;
  if (!/^[0-9a-f-]{36}$/i.test(journeyId)) return res.status(400).json({ success: false, error: 'journeyId is required' });

  let claimedLegId = null;
  try {
    const { data: journey } = await db.from('mbg_journeys').select('*').eq('id', journeyId).maybeSingle();
    if (!journey) return res.status(404).json({ success: false, error: 'Journey not found' });
    if (journey.journey_kind !== 'cargo') return res.status(422).json({ success: false, error: 'Only cargo journeys are booked with a shipping line.' });
    if (!['confirmed', 'in_progress'].includes(journey.status)) return res.status(422).json({ success: false, error: `A ${journey.status} journey cannot be booked.` });
    // Never commit the carrier's money for a journey the customer has not paid for.
    if (!journey.ican_journey_tx_id || journey.refunded_at) return res.status(422).json({ success: false, error: 'This journey is not paid, so it will not be booked.' });

    const { data: seaLeg } = await db.from('mbg_journey_legs').select('*').eq('journey_id', journeyId).eq('leg_type', 'sea_leg').maybeSingle();
    if (!seaLeg) return res.status(422).json({ success: false, error: 'This journey has no sea leg.' });
    if (seaLeg.carrier_booking_ref) return res.status(409).json({ success: false, error: `Already booked: ${seaLeg.carrier_booking_ref}.`, code: 'already_booked' });
    if (['requesting', 'unconfirmed'].includes(seaLeg.carrier_booking_status)) {
      return res.status(409).json({ success: false, error: `A booking is ${seaLeg.carrier_booking_status} for this leg — check the carrier's portal before trying again.`, code: seaLeg.carrier_booking_status });
    }

    const { data: ports } = await db.from('mbg_ports').select('country, city, port_name, un_locode').eq('is_active', true);
    const findPort = (country, city) => (ports || []).find((p) => p.country === country && p.city === city);
    const originPort = findPort(seaLeg.origin_country, seaLeg.origin_city);
    const destinationPort = findPort(seaLeg.destination_country, seaLeg.destination_city);
    if (!originPort || !destinationPort) return res.status(422).json({ success: false, error: 'The sea leg’s ports are not in the port list.' });

    const request = buildDcsaBookingRequest({ journey, originPort, destinationPort });
    const carrier = getCarrier();
    if (dryRun) return res.status(200).json({ success: true, dryRun: true, provider: carrier.id, request });

    // Claim the leg so two calls cannot both book it.
    const { data: claimed } = await db.from('mbg_journey_legs')
      .update({ carrier_provider: carrier.id, carrier_booking_status: 'requesting', carrier_booking_error: null })
      .eq('id', seaLeg.id).is('carrier_booking_ref', null)
      .or('carrier_booking_status.is.null,carrier_booking_status.eq.failed')
      .select('id');
    if (!claimed?.length) return res.status(409).json({ success: false, error: 'This leg is already being booked.', code: 'requesting' });
    claimedLegId = seaLeg.id;

    const booking = await carrier.createBooking(request);
    await db.from('mbg_journey_legs').update({
      carrier_provider: carrier.id, carrier_booking_ref: booking.reference, carrier_booking_status: booking.status,
      carrier_booked_at: new Date().toISOString(), carrier_booking_error: null, updated_at: new Date().toISOString(),
    }).eq('id', seaLeg.id);
    return res.status(200).json({ success: true, provider: carrier.id, reference: booking.reference, status: booking.status });
  } catch (err) {
    const unconfirmed = err instanceof CarrierUnconfirmedError;
    const refused = err instanceof CarrierRequestError;
    if (claimedLegId) {
      // unconfirmed = may exist at the carrier, a person must look; failed = clearly not booked, can be retried.
      await db.from('mbg_journey_legs')
        .update({ carrier_booking_status: unconfirmed ? 'unconfirmed' : 'failed', carrier_booking_error: String(err?.message || err).slice(0, 300) })
        .eq('id', claimedLegId);
    }
    if (unconfirmed) return res.status(502).json({ success: false, error: err.message, code: 'unconfirmed' });
    if (refused) return res.status(422).json({ success: false, error: err.message, code: 'refused' });
    console.error('carrier-booking error:', err);
    return res.status(500).json({ success: false, error: 'Could not book the shipment.' });
  }
}
