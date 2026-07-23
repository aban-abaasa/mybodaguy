import { supabaseAdmin } from '../_lib/supabaseAdmin.js';
import { createOrder } from '../_lib/duffel.js';
import { applyCors } from '../_lib/cors.js';

/**
 * Debit ICAN (tithe-free), book the real Duffel flight, create the journey
 * + 3 legs, and mark the pickup leg ready to dispatch immediately. The
 * dropoff leg's dispatch_after is picked up by the pg_cron job in Supabase
 * (mbg_run_due_journey_dispatch) — no in-process scheduler needed here.
 */
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const { customerUserId, quote, passengers } = req.body;

  try {
    const { data: customer } = await supabaseAdmin
      .from('mbg_customers')
      .select('id')
      .eq('user_id', customerUserId)
      .single();
    if (!customer) {
      return res.status(400).json({ success: false, error: 'No BodaGoEra customer profile for this user yet' });
    }

    const { data: journey, error: journeyError } = await supabaseAdmin
      .from('mbg_journeys')
      .insert({
        customer_id: customer.id,
        status: 'pending_payment',
        origin_country: quote.pickup.country || 'Uganda',
        origin_city: quote.pickup.city,
        destination_country: quote.destination.country,
        destination_city: quote.destination.city,
        destination_address: quote.destination.address,
        destination_lat: quote.destination.lat ?? null,
        destination_lng: quote.destination.lng ?? null,
        total_fare_ugx: quote.totalUgx,
        total_fare_ican: quote.totalIcan
      })
      .select()
      .single();
    if (journeyError) throw journeyError;

    // Tithe-free debit — see ICAN/backend/CREATE_JOURNEY_ESCROW_FUNCTION.sql.
    const { data: debitResult, error: debitError } = await supabaseAdmin.rpc('mbg_debit_journey_fare', {
      p_user_id: customerUserId,
      p_ican_amount: quote.totalIcan,
      p_source_app: 'mybodaguy',
      p_reference_id: journey.id
    });
    if (debitError || !debitResult?.success) {
      await supabaseAdmin.from('mbg_journeys').update({ status: 'failed' }).eq('id', journey.id);
      return res.status(400).json({ success: false, error: debitResult?.error || debitError?.message || 'Payment failed' });
    }

    // Book the real flight via Duffel — customer already paid, so a failure
    // here must fail loudly rather than silently strand them.
    let bookedFlight;
    try {
      bookedFlight = await createOrder({
        offerId: quote.offer.offerId,
        passengers,
        paymentAmount: quote.offer.totalAmount,
        paymentCurrency: quote.offer.totalCurrency
      });
    } catch (flightError) {
      console.error('Duffel booking failed after payment:', flightError.duffelResponse || flightError.message);
      await supabaseAdmin.from('mbg_journeys').update({ status: 'failed' }).eq('id', journey.id);
      return res.status(502).json({ success: false, error: 'Flight booking failed after payment — contact support for a refund' });
    }

    const legs = [
      {
        journey_id: journey.id, leg_order: 1, leg_type: 'local_pickup', status: 'ready_to_dispatch',
        origin_country: quote.pickup.country || 'Uganda', origin_city: quote.pickup.city,
        origin_lat: quote.pickup.lat, origin_lng: quote.pickup.lng,
        destination_country: quote.pickup.country || 'Uganda',
        preferred_vehicle_type: quote.pickup.vehicleType || null,
        dispatch_after: new Date().toISOString()
      },
      { journey_id: journey.id, leg_order: 2, leg_type: 'flight', status: 'dispatched', dispatched_at: new Date().toISOString() },
      {
        journey_id: journey.id, leg_order: 3, leg_type: 'local_dropoff', status: 'pending',
        origin_country: quote.destination.country, origin_city: quote.destination.city,
        destination_country: quote.destination.country, destination_city: quote.destination.city,
        destination_lat: quote.destination.lat ?? null, destination_lng: quote.destination.lng ?? null,
        dispatch_after: bookedFlight.arrivalAt
      }
    ];
    const { data: insertedLegs, error: legsError } = await supabaseAdmin.from('mbg_journey_legs').insert(legs).select();
    if (legsError) throw legsError;

    const flightLeg = insertedLegs.find((l) => l.leg_type === 'flight');
    const { data: flightBooking, error: flightBookingError } = await supabaseAdmin
      .from('mbg_flight_bookings')
      .insert({
        journey_leg_id: flightLeg.id,
        provider_order_id: bookedFlight.orderId,
        pnr: bookedFlight.pnr,
        status: 'booked',
        origin_iata: bookedFlight.originIata,
        destination_iata: bookedFlight.destinationIata,
        carrier: bookedFlight.carrier,
        flight_number: bookedFlight.flightNumber,
        scheduled_departure_at: bookedFlight.departureAt,
        scheduled_arrival_at: bookedFlight.arrivalAt,
        current_departure_at: bookedFlight.departureAt,
        current_arrival_at: bookedFlight.arrivalAt,
        last_status_check_at: new Date().toISOString(),
        fare_amount_fiat: quote.offer.totalAmount,
        fare_currency: quote.offer.totalCurrency,
        fare_amount_ugx: quote.flightFareUgx,
        passenger_details: passengers
      })
      .select()
      .single();
    if (flightBookingError) throw flightBookingError;

    await supabaseAdmin.from('mbg_journey_legs').update({ flight_booking_id: flightBooking.id }).eq('id', flightLeg.id);
    const dropoffLeg = insertedLegs.find((l) => l.leg_type === 'local_dropoff');
    await supabaseAdmin.from('mbg_journey_legs').update({ flight_booking_id: flightBooking.id }).eq('id', dropoffLeg.id);

    await supabaseAdmin.from('mbg_journeys').update({ status: 'confirmed', ican_journey_tx_id: debitResult.tx_id }).eq('id', journey.id);

    // Dispatch the pickup leg immediately rather than waiting for the next
    // pg_cron tick — better customer experience for the leg that's ready to
    // go right now.
    await supabaseAdmin.rpc('mbg_dispatch_journey_leg', { p_journey_leg_id: insertedLegs.find((l) => l.leg_type === 'local_pickup').id });

    res.status(200).json({ success: true, journeyId: journey.id, pnr: bookedFlight.pnr });
  } catch (error) {
    console.error('Journey confirm error:', error);
    res.status(500).json({ success: false, error: 'Failed to confirm journey' });
  }
}
