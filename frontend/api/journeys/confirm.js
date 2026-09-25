import { createOrder, getOfferStatus, DUFFEL_TEST_MODE } from '../_lib/duffel.js';
import { planPickupDispatch, haversineKm } from '../_lib/transfer.js';
import { computeQuoteAmounts, cleanParcel, loadStoreOrder, RideCapacityError, StoreOrderError, MAX_PARTY_SIZE } from '../_lib/journeyQuote.js';
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

  const { customerUserId, quote, passengers, payWithCompany } = req.body;
  if (!requireMatchingUser(user, customerUserId, res)) return;

  // "Business": the company wallet pays instead of the customer's own. Which company is
  // worked out from this user's allocation in the database — never taken from the browser.
  const paidByCompany = payWithCompany === true;

  // Either airport ride is optional (own car / a friend drives or collects the
  // customer). A ride that is left out is neither charged nor created; the
  // flight is always booked. Older clients send neither flag = both rides.
  const pickupRide = quote?.pickupRide !== false;
  const dropoffRide = quote?.dropoffRide !== false;
  // "Send a parcel": the two ground legs are couriers carrying goods, not rides for
  // the travellers. The flight itself is booked exactly as usual.
  const parcelMode = quote?.serviceMode === 'parcel';

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
    if (!Array.isArray(passengers) || passengers.length < 1 || passengers.length > MAX_PARTY_SIZE) {
      return res.status(400).json({ success: false, error: `Please enter the details of every traveller (up to ${MAX_PARTY_SIZE}).` });
    }
    if (pickupRide && !(Number.isFinite(Number(quote.pickup.lat)) && Number.isFinite(Number(quote.pickup.lng)))) {
      return res.status(400).json({ success: false, error: 'Choose where the driver should collect you, or turn the airport pickup off. You have not been charged.' });
    }
    // Where the flight lands: used for the journey record when there is no
    // arrival ride (so no address was asked for).
    const landing = quote.offer.slices?.[0]?.segments?.at(-1)?.destination;
    const destinationCountry = quote.destination.country || landing?.iata_country_code || '';
    const destinationCity = quote.destination.city || landing?.city_name || landing?.name || null;
    if (!destinationCountry) {
      return res.status(400).json({ success: false, error: 'Please choose the country you are flying to. You have not been charged.' });
    }
    if (dropoffRide && !quote.destination.address) {
      return res.status(400).json({ success: false, error: 'Enter where the driver should take you on arrival, or turn the arrival ride off. You have not been charged.' });
    }

    // Goods from a registered store abroad: re-priced from the database now (never the
    // browser's figures), and the store's own location is the pickup.
    let storeOrder = null;
    if (quote.store) {
      if (!parcelMode || !pickupRide) {
        return res.status(400).json({ success: false, error: 'A store order is collected from the store by a courier. You have not been charged.' });
      }
      try {
        storeOrder = await loadStoreOrder(supabaseAdmin, quote.store);
      } catch (err) {
        if (err instanceof StoreOrderError) {
          return res.status(422).json({ success: false, error: `${err.message} You have not been charged.`, code: 'store_order' });
        }
        throw err;
      }
      quote.pickup = { ...quote.pickup, ...storeOrder.pickup };
    }
    const goodsIcan = storeOrder?.goodsIcan ?? 0;

    const parcelCheck = parcelMode
      ? cleanParcel({ ...quote.parcel, ...(storeOrder ? { description: storeOrder.description } : {}) }, { dropoffRide, weightKg: quote.cargoWeightKg })
      : null;
    if (parcelCheck?.error) {
      return res.status(400).json({ success: false, error: `${parcelCheck.error} You have not been charged.` });
    }
    const parcel = parcelCheck?.parcel ?? null;

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

    // One set of details per traveller the airline's offer was searched for — the
    // airline's own count, not the browser's.
    const partySize = live.passengerCount;
    const passengerProblem = validatePassengers(passengers, partySize);
    if (passengerProblem) {
      return res.status(400).json({ success: false, error: passengerProblem });
    }

    // Charge what the airline's CURRENT price works out to, never figures sent by
    // the browser (which could be stale or edited).
    const liveOffer = { ...quote.offer, totalAmount: live.totalAmount, totalCurrency: live.totalCurrency };
    let amounts;
    try {
      amounts = await computeQuoteAmounts(supabaseAdmin, { pickup: quote.pickup, offer: liveOffer, cargoWeightKg: quote.cargoWeightKg, userId: customerUserId, pickupRide, dropoffRide, partySize, parcel: parcelMode, goodsIcan });
    } catch (err) {
      if (err instanceof RideCapacityError) {
        return res.status(422).json({ success: false, error: `${err.message} You have not been charged.`, code: 'ride_capacity' });
      }
      if (err instanceof UnsupportedCurrencyError) {
        return res.status(422).json({ success: false, error: `${err.message} — please choose a different flight. You have not been charged.`, code: 'unsupported_currency' });
      }
      if (err instanceof PriceUnavailableError) {
        return res.status(503).json({ success: false, error: `${err.message} You have not been charged.`, code: 'price_unavailable' });
      }
      throw err;
    }
    // chargeIcan is everything the customer pays; the transport part is debited as the
    // journey fare and the goods part separately (held for the store), so a failure can
    // put each back exactly.
    const chargeIcan = amounts.priced.totalIcan;
    const transportIcan = Number((chargeIcan - goodsIcan).toFixed(8));
    const transportUgx = amounts.priced.totalUgx - Math.round(goodsIcan * amounts.priced.icanPriceUgx);
    const quotedIcan = Number(quote.totalIcan);
    if (!Number.isFinite(quotedIcan) || quotedIcan <= 0 || Math.abs(chargeIcan - quotedIcan) / quotedIcan > PRICE_DRIFT_TOLERANCE) {
      return res.status(409).json({
        success: false,
        error: `The price has changed to ${chargeIcan.toFixed(4)} ICAN. You have not been charged — please review the new price and confirm again.`,
        code: 'price_changed',
        newTotalIcan: chargeIcan
      });
    }

    // A company payment is only started if the company is allowed and can cover all of it
    // (fare + goods), so a refusal here has charged nothing.
    if (paidByCompany) {
      const { data: companyCheck, error: companyCheckError } = await supabaseAdmin.rpc('mbg_company_journey_check', {
        p_user_id: customerUserId,
        p_amount_ican: chargeIcan
      });
      if (companyCheckError || !companyCheck?.success) {
        if (companyCheckError) console.error('Company journey check failed:', companyCheckError.message);
        return res.status(422).json({
          success: false,
          error: `${companyCheck?.error || 'Paying with your company is not available right now.'} You have not been charged.`,
          code: 'company_payment'
        });
      }
    }

    const journeyRow = {
      customer_id: customer.id,
      status: 'pending_payment',
      origin_country: quote.pickup.country || 'Uganda',
      origin_city: quote.pickup.city,
      destination_country: destinationCountry,
      destination_city: destinationCity,
      destination_address: dropoffRide ? quote.destination.address : null,
      destination_lat: dropoffRide ? (quote.destination.lat ?? null) : null,
      destination_lng: dropoffRide ? (quote.destination.lng ?? null) : null,
      total_fare_ugx: transportUgx,
      total_fare_ican: transportIcan,
      // Only sent for a party: a solo booking works even where
      // ADD_JOURNEY_MULTI_PASSENGER.sql hasn't been run yet.
      ...(partySize > 1 ? { passenger_count: partySize } : {}),
      // The parcel's details ride on the journey; the couriers are told from them.
      ...(parcel ? {
        service_mode: 'parcel',
        cargo_description: parcel.description,
        cargo_weight_kg: amounts.weightKg,
        recipient_name: dropoffRide ? parcel.recipientName : null,
        recipient_phone: dropoffRide ? parcel.recipientPhone : null
      } : {})
    };
    let { data: journey, error: journeyError } = await supabaseAdmin.from('mbg_journeys').insert(journeyRow).select().single();
    if (journeyError && /passenger_count/.test(journeyError.message || '')) {
      // Nothing has been charged yet, so booking without the count is harmless — the
      // passenger list itself is stored with the flight booking.
      console.error('mbg_journeys.passenger_count is missing — run ADD_JOURNEY_MULTI_PASSENGER.sql. Booking without it for now.');
      const { passenger_count: _dropped, ...withoutCount } = journeyRow;
      ({ data: journey, error: journeyError } = await supabaseAdmin.from('mbg_journeys').insert(withoutCount).select().single());
    }
    if (journeyError && parcel && /service_mode|recipient_name|recipient_phone|cargo_description|cargo_weight_kg/.test(journeyError.message || '')) {
      // Booking it as a normal journey would send passenger rides for a parcel, so refuse instead.
      console.error('Parcel columns are missing — run ADD_JOURNEY_PARCEL_AND_SHIP_LAND_LEGS.sql.', journeyError.message);
      return res.status(503).json({ success: false, error: "Parcel journeys aren't available yet. You have not been charged.", code: 'parcel_unavailable' });
    }
    if (journeyError) throw journeyError;

    // Tithe-free debit — see ICAN/backend/CREATE_JOURNEY_ESCROW_FUNCTION.sql.
    // (A company payment comes out of the company's business wallet instead, and its
    // result has the same shape.)
    const { data: debitResult, error: debitError } = paidByCompany
      ? await supabaseAdmin.rpc('mbg_charge_company_journey', {
          p_journey_id: journey.id,
          p_user_id: customerUserId,
          p_amount_ican: transportIcan,
          p_part: 'fare'
        })
      : await supabaseAdmin.rpc('mbg_debit_journey_fare', {
          p_user_id: customerUserId,
          p_ican_amount: transportIcan,
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

    // The goods from the store: debited and held now, paid out to the store only once the
    // courier has collected them. If they can't be charged, the fare just taken goes back.
    if (storeOrder) {
      const { data: goodsResult, error: goodsError } = await supabaseAdmin.rpc('mbg_charge_import_goods', {
        p_journey_id: journey.id,
        p_customer_user_id: customerUserId,
        p_supermarket_id: storeOrder.supermarketId,
        p_cart: storeOrder.cart,
        p_transport: 'air',
        p_pay_with_company: paidByCompany
      });
      if (goodsError || !goodsResult?.success) {
        console.error('Import goods charge failed:', goodsError?.message || goodsResult?.error);
        await supabaseAdmin.from('mbg_journeys').update({ status: 'failed' }).eq('id', journey.id);
        const { data: fareRefund, error: fareRefundError } = await supabaseAdmin.rpc('mbg_refund_journey_fare', {
          p_journey_id: journey.id,
          p_reason: 'the goods from the store could not be charged'
        });
        const reason = goodsResult?.error || 'The goods from the store could not be charged.';
        if (!fareRefundError && fareRefund?.success) {
          return res.status(409).json({ success: false, error: `${reason} Nothing was charged.`, refunded: true, journeyId: journey.id });
        }
        return res.status(500).json({ success: false, error: `${reason} Contact support to have the transport fare returned.`, paymentTaken: true, journeyId: journey.id });
      }
    }

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
      // ...and the goods from the store, with their stock.
      let goodsBack = true;
      if (storeOrder) {
        const { data: goodsRefund, error: goodsRefundError } = await supabaseAdmin.rpc('mbg_refund_import_goods', {
          p_journey_id: journey.id,
          p_reason: `airline booking failed (${failure.code})`
        });
        goodsBack = !goodsRefundError && !!goodsRefund?.success;
      }
      if (!refundError && refund?.success && goodsBack) {
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
    const airportKm = pickupRide && airport?.lat != null && airport?.lng != null
      ? haversineKm(Number(quote.pickup.lat), Number(quote.pickup.lng), airport.lat, airport.lng)
      : NaN;
    const plan = pickupRide ? planPickupDispatch(liveOffer, airportKm) : null;
    const prefs = quote.pickup.preferences || {};
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // The flight is always a leg; each airport ride is a leg only when the customer
    // asked for it. leg_order stays 1 / 2 / 3 so the tracker's ordering is unchanged.
    const legs = [
      ...(pickupRide ? [{
        journey_id: journey.id, leg_order: 1, leg_type: 'local_pickup',
        status: plan.immediate ? 'ready_to_dispatch' : 'pending',
        origin_country: quote.pickup.country || 'Uganda', origin_city: quote.pickup.city,
        origin_lat: quote.pickup.lat, origin_lng: quote.pickup.lng,
        destination_country: quote.pickup.country || 'Uganda',
        destination_city: airport?.name || null,
        destination_lat: airport?.lat ?? null, destination_lng: airport?.lng ?? null,
        // A bike carries one traveller, so any party goes by car; a parcel courier
        // uses the vehicle chosen for the parcel.
        preferred_vehicle_type: parcel ? parcel.vehicleType : (partySize > 1 ? 'car' : (quote.pickup.vehicleType || null)),
        power_type_requested: ['electric', 'fuel'].includes(prefs.powerType) ? prefs.powerType : null,
        umbrella_requested: prefs.umbrella === true,
        preferred_business_profile_id: uuid.test(prefs.companyId || '') ? prefs.companyId : null,
        fare_ugx: amounts.pickupFareUgx,
        dispatch_after: plan.dispatchAt.toISOString()
      }] : []),
      // A bulk insert sends every column named on ANY row as null on the rest, so
      // umbrella_requested (NOT NULL) must be spelled out on every leg.
      { journey_id: journey.id, leg_order: 2, leg_type: 'flight', status: 'dispatched', dispatched_at: new Date().toISOString(), umbrella_requested: false },
      ...(dropoffRide ? [{
        journey_id: journey.id, leg_order: 3, leg_type: 'local_dropoff', status: 'pending', umbrella_requested: false,
        preferred_vehicle_type: parcel ? parcel.vehicleType : (partySize > 1 ? 'car' : null),
        origin_country: destinationCountry, origin_city: destinationCity,
        destination_country: destinationCountry, destination_city: destinationCity,
        destination_lat: quote.destination.lat ?? null, destination_lng: quote.destination.lng ?? null,
        fare_ugx: amounts.dropoffFareUgx,
        dispatch_after: bookedFlight.arrivalAt
      }] : [])
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
    if (dropoffLeg) {
      await supabaseAdmin.from('mbg_journey_legs').update({ flight_booking_id: flightBooking.id }).eq('id', dropoffLeg.id);
    }

    await supabaseAdmin.from('mbg_journeys').update({ status: 'confirmed', ican_journey_tx_id: debitResult.tx_id }).eq('id', journey.id);

    // A ride that is due now goes out immediately rather than waiting for the
    // next pg_cron tick; a scheduled one is picked up by that job when due.
    if (plan?.immediate) {
      await supabaseAdmin.rpc('mbg_dispatch_journey_leg', { p_journey_leg_id: insertedLegs.find((l) => l.leg_type === 'local_pickup').id });
    }

    res.status(200).json({
      success: true,
      journeyId: journey.id,
      pnr: bookedFlight.pnr,
      pickupDispatchAt: plan && !plan.immediate ? plan.dispatchAt.toISOString() : null,
      leaveBy: plan?.leaveBy ? plan.leaveBy.toISOString() : null
    });
  } catch (error) {
    console.error('Journey confirm error:', error, paidJourneyId ? { journeyId: paidJourneyId, bookedOrderRef } : '');
    // On a Duffel test token only, hand the real reason back so it shows in the
    // browser console (journeyService logs `detail`) without digging through logs.
    const detail = DUFFEL_TEST_MODE ? String(error?.message || error?.details || error).slice(0, 400) : undefined;
    if (paidJourneyId && bookedOrderRef) {
      // The airline ticket exists — a refund would be wrong; support must finish the setup.
      return res.status(500).json({
        success: false,
        error: `Your ticket was booked (reference ${bookedOrderRef.pnr}) but we could not finish setting up your journey. Contact support with the reference below — do not pay again.`,
        paymentTaken: true,
        ticketIssued: true,
        pnr: bookedOrderRef.pnr,
        journeyId: paidJourneyId,
        detail
      });
    }
    if (paidJourneyId) {
      return res.status(500).json({
        success: false,
        error: 'Your payment went through but we could not finish setting up your journey — contact support for a refund',
        paymentTaken: true,
        journeyId: paidJourneyId,
        detail
      });
    }
    res.status(500).json({ success: false, error: 'Failed to confirm journey' });
  }
}
