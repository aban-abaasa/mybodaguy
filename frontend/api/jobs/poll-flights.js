/**
 * Backup for the Duffel webhook — webhooks can be missed or delayed, and a
 * customer's local pickup being stranded is a bad enough failure mode to
 * warrant a belt-and-suspenders poll. Triggered by a Supabase pg_cron job
 * (every 15 minutes) via pg_net's net.http_post — see
 * mybodaguy/backend/database/ADD_PG_CRON_DISPATCH.sql — not by a Vercel
 * Cron Job, since Vercel's free tier only allows once-daily crons.
 *
 * Protected by a shared secret header (not Duffel's webhook signature —
 * this endpoint is called by Supabase, not Duffel) so it can't be triggered
 * by anyone who finds the URL.
 */
import { supabaseAdmin } from '../_lib/supabaseAdmin.js';
import { getOrder } from '../_lib/duffel.js';
import { retimeDropoffLeg } from '../_lib/retimeDropoffLeg.js';

export default async function handler(req, res) {
  if (req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  const in48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const { data: bookings, error } = await supabaseAdmin
    .from('mbg_flight_bookings')
    .select('id, provider_order_id, current_arrival_at')
    .in('status', ['booked', 'ticketed', 'delayed', 'rescheduled'])
    .lte('scheduled_arrival_at', in48h)
    .or(`last_status_check_at.is.null,last_status_check_at.lt.${staleBefore}`)
    .limit(50);

  if (error) {
    console.error('poll-flights: failed to load bookings:', error);
    return res.status(500).json({ success: false, error: error.message });
  }

  let checked = 0;
  let retimed = 0;

  for (const booking of bookings || []) {
    try {
      const latest = await getOrder(booking.provider_order_id);
      checked += 1;

      await supabaseAdmin
        .from('mbg_flight_bookings')
        .update({ last_status_check_at: new Date().toISOString() })
        .eq('id', booking.id);

      const arrivalChanged = latest.arrivalAt && latest.arrivalAt !== booking.current_arrival_at;
      if (arrivalChanged) {
        await supabaseAdmin
          .from('mbg_flight_bookings')
          .update({ current_arrival_at: latest.arrivalAt, current_departure_at: latest.departureAt, status: 'delayed' })
          .eq('id', booking.id);
        await retimeDropoffLeg(booking.id, latest.arrivalAt);
        retimed += 1;
      }
    } catch (pollError) {
      console.error(`poll-flights: failed to poll order ${booking.provider_order_id}:`, pollError.message);
    }
  }

  res.status(200).json({ success: true, checked, retimed });
}
