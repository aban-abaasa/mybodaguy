/**
 * Duffel webhook handler — the primary trigger for the journey
 * auto-re-dispatch flow. Signature verification needs the exact raw request
 * body, so automatic body parsing is disabled and the body is read/parsed
 * manually.
 *
 * Setup: add this URL in the Duffel dashboard under Webhooks —
 * https://<your-app>.vercel.app/api/webhooks/duffel — subscribed to
 * `order.airline_initiated_change_detected`.
 */
import crypto from 'crypto';
import { supabaseAdmin } from '../_lib/supabaseAdmin.js';
import { retimeDropoffLeg } from '../_lib/retimeDropoffLeg.js';

export const config = {
  api: { bodyParser: false }
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Duffel-Signature header format: "t=<timestamp>,v1=<hex hmac>"
 * hmac is computed over "<timestamp>.<raw body>" with the webhook secret.
 */
function verifyWebhookSignature(header, rawBody) {
  try {
    if (!header) return false;
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
    if (!parts.t || !parts.v1) return false;

    const expected = crypto
      .createHmac('sha256', process.env.DUFFEL_WEBHOOK_SECRET)
      .update(`${parts.t}.${rawBody}`)
      .digest('hex');

    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  } catch (error) {
    console.error('Duffel webhook signature verification error:', error);
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const rawBody = await readRawBody(req);

  if (!verifyWebhookSignature(req.headers['duffel-signature'], rawBody)) {
    return res.status(401).json({ success: false, error: 'Invalid signature' });
  }

  const event = JSON.parse(rawBody);

  try {
    if (event.type === 'order.airline_initiated_change_detected') {
      const order = event.data.object;
      const orderId = order.id ?? event.data.id;

      const firstSlice = order.slices?.[0];
      const newArrivalAt = firstSlice?.segments?.[firstSlice.segments.length - 1]?.arriving_at;
      const newDepartureAt = firstSlice?.segments?.[0]?.departing_at;

      const { data: booking } = await supabaseAdmin
        .from('mbg_flight_bookings')
        .update({
          current_departure_at: newDepartureAt,
          current_arrival_at: newArrivalAt,
          status: 'delayed',
          last_status_check_at: new Date().toISOString(),
          raw_provider_payload: event
        })
        .eq('provider_order_id', orderId)
        .select('id')
        .single();

      if (booking && newArrivalAt) {
        await retimeDropoffLeg(booking.id, newArrivalAt);
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Duffel webhook processing error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}
