import { createOrder, getOfferStatus, DUFFEL_TEST_MODE } from '../_lib/duffel.js';
import { planPickupDispatch, haversineKm } from '../_lib/transfer.js';
import { computeQuoteAmounts } from '../_lib/journeyQuote.js';
import { UnsupportedCurrencyError, PriceUnavailableError } from '../_lib/pricing.js';
import { validatePassengers, describeDuffelFailure, testModeDetail } from '../_lib/bookingChecks.js';

// The live price may drift a little between quote and confirm (the ICAN price
// engine moves); beyond this the customer is asked to re-quote instead.
const PRICE_DRIFT_TOLERANCE = 0.02;
import { applyCors } from '../_lib/cors.js';
import { loadServer, sendMisconfigured } from '../_lib/loadServer.js';

/**
 * Debit ICAN (tithe-free), book the real Duffel flight, create the journey
 * + 3 legs, and mark the pickup leg ready to dispatch immediately. The
 * dropoff leg's dispatch_after is picked up by the pg_cron job in Supabase
 * (mbg_run_due_journey_dispatch) — no in-process scheduler needed here.
 */
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

  const { customerUserId, quote, passengers } = req.body;
  if (!requireMatchingUser(user, customerUserId, res)) return;

  // Set once the wallet debit succeeds, so any later failure can tell the
  // customer their money is held and point them at support for a refund.
  let paidJourneyId = null;
  let bookedOrderRef = null; // Duffel order id/PNR once the airline booking exists

  try {
    const { data: customer } = await supabaseAdmin
      .from('mbg_customers')
      .select('id')
      .eq('user_id', customerUserId)
      .single();
    if (!customer) {
      return res.status(400).json({ success: false, error: 'No BodaGoEra customer profile for this user yet' });
    }

    // ---- Everything that can be checked BEFORE any money moves. A booking the
    // airline would certainly reject must never take a payment in the first place.
    if (!quote?.offer?.offerId || !quote?.pickup || !quote?.destination) {
      return res.status(400).json({ success: false, error: 'This flight offer has expired — please search flights again.' });
    }
    const passengerProblem = validatePassengers(passengers);
    if (passengerProblem) {
      return res.status(400).json({ success: false, error: passengerProblem });
    }

    let live;
    try {
      live = await getOfferStatus(quote.offer.offerId);
    } catch (err) {
      console.error('Duffel offer check failed before payment:', err.duffelResponse || err.message);
      return res.status(503).json({ success: false, error: `Flight booking is temporarily unavailable. You have not been charged — please try again shortly.${DUFFEL_TEST_MODE ? testModeDetail(err) : ''}` });
    }
    if (!live.available) {
      return res.status(409).json({ success: false, error: 'This flight is no longer available. You have not been charged — please search flights again.', code: 'offer_expired' });
    }

    // Charge what the airline's CURRENT price works out to, never figures sent by
    // the browser (which could be stale or edited).
    const liveOffer = { ...quote.offer, totalAmount: live.totalAmount, totalCurrency: live.totalCurrency };
    let amounts;
    try {
      amounts = await computeQuoteAmounts(supabaseAdmin, { pickup: quote.pickup, offer: liveOffer, cargoWeightKg: quote.cargoWeightKg, userId: customerUserId });
    } catch (err) {
      if (err instanceof UnsupportedCurrencyError) {
        return res.status(422).json({ success: false, error: `${err.message} — please choose a different flight. You have not been charged.`, code: 'unsupported_currency' });
      }
      if (err instanceof PriceUnavailableError) {
        return res.status(503).json({ success: false, error: `${err.message} You have not been charged.`, code: 'price_unavailable' });
      }
      throw err;
    }
    const chargeIcan = amounts.priced.totalIcan;
    const quotedIcan = Number(quote.totalIcan);
    if (!Number.isFinite(quotedIcan) || quotedIcan <= 0 || Math.abs(chargeIcan - quotedIcan) / quotedIcan > PRICE_DRIFT_TOLERANCE) {
      return res.status(409).json({
        success: false,
        error: `The price has changed to ${chargeIcan.toFixed(4)} ICAN. You have not been charged — please review the new price and confirm again.`,
        code: 'price_changed',
        newTotalIcan: chargeIcan
      });
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
        total_fare_ugx: amounts.priced.totalUgx,
        total_fare_ican: chargeIcan
      })
      .select()
      .single();
    if (journeyError) throw journeyError;

    // Tithe-free debit — see ICAN/backend/CREATE_JOURNEY_ESCROW_FUNCTION.sql.
    const { data: debitResult, error: debitError } = await supabaseAdmin.rpc('mbg_debit_journey_fare', {
      p_user_id: customerUserId,
      p_ican_amount: chargeIcan,
      p_source_app: 'mybodaguy',
      p_reference_id: journey.id
    });
    if (debitError || !debitResult?.success) {
      await supabaseAdmin.from('mbg_journeys').update({ status: 'failed' }).eq('id', journey.id);
      return res.status(400).json({ success: false, error: debitResult?.error || debitError?.message || 'Payment failed' });
    }

    paidJourneyId = journey.id;
    // Kept on the journey even if booking fails below, so the customer's page
    // (and support) can tell "payment taken, no ticket" from "never charged".
    await supabaseAdmin.from('mbg_journeys').update({ ican_journey_tx_id: debitResult.tx_id }).eq('id', journey.id);

    // Book the real flight via Duffel — customer already paid, so a failure
    // here must fail loudly rather than silently strand them.
    let bookedFlight;
    try {
      bookedFlight = await createOrder({
        offerId: quote.offer.offerId,
        passengers,
        paymentAmount: live.totalAmount,
        paymentCurrency: live.totalCurrency
      });
    } catch (flightError) {
      const failure = describeDuffelFailure(flightError);
      console.error('Duffel booking failed after payment:', failure.code, flightError.duffelResponse || flightError.message);
      await supabaseAdmin.from('mbg_journeys').update({ status: 'failed' }).eq('id', journey.id);

      // No ticket was issued, so put the money straight back instead of asking
      // the customer to chase support.
      const { data: refund, error: refundError } = await supabaseAdmin.rpc('mbg_refund_journey_fare', {
        p_journey_id: journey.id,
        p_reason: `airline booking failed (${failure.code})`
      });
      if (!refundError && refund?.success) {
        return res.status(502).json({
          success: false,
          error: `${failure.message} Nothing was charged — ${chargeIcan.toFixed(4)} ICAN has been returned to your wallet.${DUFFEL_TEST_MODE ? testModeDetail(flightError) : ''}`,
          refunded: true,
          reasonCode: failure.code,
          journeyId: journey.id
        });
      }

      // The refund itself failed (e.g. its SQL isn't installed yet): the money
      // is still held, so fall back to telling the customer to contact support.
      console.error('AUTO-REFUND FAILED for journey', journey.id, refundError || refund);
      return res.status(502).json({
        success: false,
        error: `Flight booking failed after payment — contact support for a refund${DUFFEL_TEST_MODE ? testModeDetail(flightError) : ''}`,
        paymentTaken: true,
        reasonCode: failure.code,
        journeyId: journey.id
      });
    }

    bookedOrderRef = { orderId: bookedFlight.orderId, pnr: bookedFlight.pnr };

    // The pickup ride goes to the departure airport (so the rider is told
    // where to take the customer), at the fixed price already paid above, and
    // with the customer's ride preferences. A future flight doesn't get a driver
    // days early: the leg is scheduled for shortly before the customer has to
    // leave, and the dispatch job sends it out then.
    const airport = amounts.airport;
    const airportKm = airport?.lat != null && airport?.lng != null && Number.isFinite(Number(quote.pickup.lat)) && Number.isFinite(Number(quote.pickup.lng))
      ? haversineKm(Number(quote.pickup.lat), Number(quote.pickup.lng), airport.lat, airport.lng)
      : NaN;
    const plan = planPickupDispatch(liveOffer, airportKm);
    const prefs = quote.pickup.preferences || {};
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const legs = [
      {
        journey_id: journey.id, leg_order: 1, leg_type: 'local_pickup',
        status: plan.immediate ? 'ready_to_dispatch' : 'pending',
        origin_country: quote.pickup.country || 'Uganda', origin_city: quote.pickup.city,
        origin_lat: quote.pickup.lat, origin_lng: quote.pickup.lng,
        destination_country: quote.pickup.country || 'Uganda',
        destination_city: airport?.name || null,
        destination_lat: airport?.lat ?? null, destination_lng: airport?.lng ?? null,
        preferred_vehicle_type: quote.pickup.vehicleType || null,
        power_type_requested: ['electric', 'fuel'].includes(prefs.powerType) ? prefs.powerType : null,
        umbrella_requested: prefs.umbrella === true,
        preferred_business_profile_id: uuid.test(prefs.companyId || '') ? prefs.companyId : null,
        fare_ugx: amounts.pickupFareUgx,
        dispatch_after: plan.dispatchAt.toISOString()
      },
      { journey_id: journey.id, leg_order: 2, leg_type: 'flight', status: 'dispatched', dispatched_at: new Date().toISOString() },
      {
        journey_id: journey.id, leg_order: 3, leg_type: 'local_dropoff', status: 'pending',
        origin_country: quote.destination.country, origin_city: quote.destination.city,
        destination_country: quote.destination.country, destination_city: quote.destination.city,
        destination_lat: quote.destination.lat ?? null, destination_lng: quote.destination.lng ?? null,
        fare_ugx: amounts.dropoffFareUgx,
        dispatch_after: bookedFlight.arrivalAt
      }
    ];
    // The customer has already paid and the airline ticket exists, so if a
    // journey SQL hasn't been run yet (a column missing on mbg_journey_legs) drop
    // just that optional column and book the legs without it, rather than strand
    // a paid, ticketed customer. The core columns are never dropped.
    const REQUIRED_LEG_COLUMNS = new Set(['journey_id', 'leg_order', 'leg_type', 'status']);
    let legRows = legs;
    let { data: insertedLegs, error: legsError } = await supabaseAdmin.from('mbg_journey_legs').insert(legRows).select();
    for (let attempt = 0; legsError && attempt < 6; attempt++) {
      const missing = /Could not find the '([^']+)' column of 'mbg_journey_legs'/.exec(legsError.message || '')?.[1];
      if (!missing || REQUIRED_LEG_COLUMNS.has(missing)) break;
      console.error(`mbg_journey_legs.${missing} is missing — run the journey SQL that adds it. Booking the legs without it for now.`);
      legRows = legRows.map(({ [missing]: _dropped, ...rest }) => rest);
      ({ data: insertedLegs, error: legsError } = await supabaseAdmin.from('mbg_journey_legs').insert(legRows).select());
    }
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
        fare_amount_fiat: live.totalAmount,
        fare_currency: live.totalCurrency,
        fare_amount_ugx: amounts.priced.flightFareUgx,
        passenger_details: passengers
      })
      .select()
      .single();
    if (flightBookingError) throw flightBookingError;

    await supabaseAdmin.from('mbg_journey_legs').update({ flight_booking_id: flightBooking.id }).eq('id', flightLeg.id);
    const dropoffLeg = insertedLegs.find((l) => l.leg_type === 'local_dropoff');
    await supabaseAdmin.from('mbg_journey_legs').update({ flight_booking_id: flightBooking.id }).eq('id', dropoffLeg.id);

    await supabaseAdmin.from('mbg_journeys').update({ status: 'confirmed', ican_journey_tx_id: debitResult.tx_id }).eq('id', journey.id);

    // A ride that is due now goes out immediately rather than waiting for the
    // next pg_cron tick; a scheduled one is picked up by that job when due.
    if (plan.immediate) {
      await supabaseAdmin.rpc('mbg_dispatch_journey_leg', { p_journey_leg_id: insertedLegs.find((l) => l.leg_type === 'local_pickup').id });
    }

    res.status(200).json({
      success: true,
      journeyId: journey.id,
      pnr: bookedFlight.pnr,
      pickupDispatchAt: plan.immediate ? null : plan.dispatchAt.toISOString(),
      leaveBy: plan.leaveBy ? plan.leaveBy.toISOString() : null
    });
  } catch (error) {
    console.error('Journey confirm error:', error, paidJourneyId ? { journeyId: paidJourneyId, bookedOrderRef } : '');
    if (paidJourneyId && bookedOrderRef) {
      // The airline ticket exists — a refund would be wrong; support must finish the setup.
      return res.status(500).json({
        success: false,
        error: `Your ticket was booked (reference ${bookedOrderRef.pnr}) but we could not finish setting up your journey. Contact support with the reference below — do not pay again.`,
        paymentTaken: true,
        ticketIssued: true,
        pnr: bookedOrderRef.pnr,
        journeyId: paidJourneyId
      });
    }
    if (paidJourneyId) {
      return res.status(500).json({
        success: false,
        error: 'Your payment went through but we could not finish setting up your journey — contact support for a refund',
        paymentTaken: true,
        journeyId: paidJourneyId
      });
    }
    res.status(500).json({ success: false, error: 'Failed to confirm journey' });
  }
}
