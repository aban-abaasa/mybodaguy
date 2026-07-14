import { supabaseAdmin } from '../_lib/supabaseAdmin.js';
import { applyCors } from '../_lib/cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const { id } = req.query;
    const { data: journey, error } = await supabaseAdmin
      .from('mbg_journeys')
      .select(`
        *,
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
      .single();
    if (error) throw error;
    res.status(200).json({ success: true, journey });
  } catch (error) {
    console.error('Journey fetch error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch journey' });
  }
}
