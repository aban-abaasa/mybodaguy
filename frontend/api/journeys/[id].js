import { loadServer, sendMisconfigured } from '../_lib/loadServer.js';
import { applyCors } from '../_lib/cors.js';

/**
 * GET /api/journeys/:id           — the journey with its legs, riders and flight booking.
 * GET /api/journeys/:id?ticket=1  — the air ticket for the journey's flight, read live
 *                                   from the airline order (kept on this route rather than
 *                                   a new file to stay within the host's function limit).
 *
 * Only the customer who booked the journey may read it — it carries passport-style
 * passenger details and the booking reference.
 */
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  let server;
  try {
    server = await loadServer();
  } catch (err) {
    return sendMisconfigured(res, err);
  }
  const { supabaseAdmin, requireUser } = server;

  const user = await requireUser(req, res);
  if (!user) return;

  try {
    const { id, ticket } = req.query;
    const { data: journey, error } = await supabaseAdmin
      .from('mbg_journeys')
      .select(`
        *,
        customer:mbg_customers(user_id),
        legs:mbg_journey_legs(
          *,
          flight_booking:mbg_flight_bookings(*),
          ride:mbg_rides(
            id, status, fare, distance_km, duration_minutes,
            rider:mbg_riders(
              id, plate_number, vehicle_type, vehicle_color, vehicle_model, rating,
              user:mbg_users(phone, profile:mbg_user_profiles(full_name))
            )
          )
        )
      `)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!journey || journey.customer?.user_id !== user.id) {
      return res.status(404).json({ success: false, error: 'Journey not found' });
    }
    const { customer, ...journeyOut } = journey;

    if (!ticket) return res.status(200).json({ success: true, journey: journeyOut });

    const booking = journey.legs?.find((l) => l.leg_type === 'flight')?.flight_booking;
    if (!booking?.provider_order_id) {
      return res.status(404).json({ success: false, error: 'This journey has no air ticket' });
    }
    const { getOrderTicket } = await import('../_lib/duffel.js');
    const airTicket = await getOrderTicket(booking.provider_order_id);
    res.status(200).json({ success: true, ticket: { ...airTicket, journeyId: journey.id, totalPaidIcan: journey.total_fare_ican, totalPaidUgx: journey.total_fare_ugx } });
  } catch (error) {
    console.error('Journey fetch error:', error.duffelResponse || error);
    res.status(500).json({ success: false, error: req.query.ticket ? 'Could not load your air ticket right now — please try again.' : 'Failed to fetch journey' });
  }
}
