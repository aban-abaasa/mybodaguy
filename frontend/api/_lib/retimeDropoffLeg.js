import { supabaseAdmin } from './supabaseAdmin.js';

/**
 * Withdraws a stale ride offer (if one already went out on the old ETA) and
 * recomputes dispatch_after from the flight's current arrival time. The
 * pg_cron-driven mbg_run_due_journey_dispatch() job (see
 * mybodaguy/backend/database/ADD_PG_CRON_DISPATCH.sql) picks the leg back
 * up once dispatch_after arrives — this is the whole "re-dispatch on delay"
 * mechanism; there is no separate code path for it. Shared by both the
 * Duffel webhook (primary trigger) and the poll-flights backup job.
 */
export async function retimeDropoffLeg(flightBookingId, currentArrivalAt) {
  const { data: leg } = await supabaseAdmin
    .from('mbg_journey_legs')
    .select('id, status, ride_id')
    .eq('flight_booking_id', flightBookingId)
    .eq('leg_type', 'local_dropoff')
    .single();

  if (!leg) return;

  const { data: bufferSetting } = await supabaseAdmin
    .from('mbg_platform_settings')
    .select('value')
    .eq('key', 'journey.dropoff_buffer_minutes')
    .single();
  const bufferMinutes = Number(bufferSetting?.value || 45);
  const dispatchAfter = new Date(new Date(currentArrivalAt).getTime() + bufferMinutes * 60000).toISOString();

  if (['dispatched', 'searching_driver'].includes(leg.status)) {
    if (leg.ride_id) {
      await supabaseAdmin.rpc('mbg_cancel_ride', { p_ride_id: leg.ride_id, p_reason: 'Flight schedule changed — re-dispatching for new arrival time' });
    }
    await supabaseAdmin
      .from('mbg_journey_legs')
      .update({ status: 'awaiting_flight_update', dispatch_after: dispatchAfter, ride_id: null, updated_at: new Date().toISOString() })
      .eq('id', leg.id);
  } else {
    await supabaseAdmin
      .from('mbg_journey_legs')
      .update({ dispatch_after: dispatchAfter, updated_at: new Date().toISOString() })
      .eq('id', leg.id);
  }
}
