/**
 * Journey booking service — talks to mybodaguy/frontend/api/'s serverless
 * functions, not Supabase directly, because booking a real flight and
 * debiting ICAN must happen atomically with a Duffel API call that needs a
 * secret access token the browser must never see.
 *
 * Always points at the live, already-deployed Vercel backend — never a
 * relative/same-origin path — so this works identically whether the
 * frontend itself is running locally or deployed, with no local API server
 * required. mybodaguy/frontend/api/_lib/cors.js already allowlists the
 * local dev origins, so this remains a normal cross-origin call in dev.
 */
import { supabase } from '../../services/supabaseClient';

const MBG_API_BASE_URL = 'https://bodagoera.icanera.space';

export interface FlightOffer {
  offerId: string;
  carrier: string;
  totalAmount: string;
  totalCurrency: string;
  slices: any[];
  expiresAt: string;
  // Duffel-assigned passenger ids from the offer — order creation must
  // reference these exactly, one per passenger booked on this offer.
  passengers: Array<{ id: string; type: string }>;
  // Sent by newer versions of the search API; the flight picker falls back to
  // the segment data in `slices` when they're absent.
  carrierIata?: string | null;
  carrierLogoUrl?: string | null;
  /** Whether the fare can be refunded before departure (null = airline didn't say). */
  refundable?: boolean | null;
  // The fare in ICAN at its live value, and in the signed-in customer's own
  // currency (from the country they chose). Null/absent when the price engine
  // has no price for the airline's currency — the airline's own price shows.
  priceIcan?: number | null;
  priceLocal?: number | null;
  localCurrency?: string | null;
}

export interface JourneyPickup {
  /** Null when the customer skipped the airport pickup (own car / a friend drives them). */
  lat: number | null;
  lng: number | null;
  address: string;
  country?: string;
  city?: string;
  /** Customer's choice for the first leg — 'motorcycle' or 'car'. Falls
   * back to matching any available passenger vehicle when omitted. */
  vehicleType?: 'motorcycle' | 'car';
  /** Same ride preferences as Book a Ride (electric/petrol bike, umbrella, a specific transport company). */
  preferences?: { powerType?: 'electric' | 'fuel'; umbrella?: boolean; companyId?: string };
}

export interface JourneyDestination {
  address: string;
  country: string;
  city?: string;
  lat?: number | null;
  lng?: number | null;
}

/** The quote's amounts in the customer's own currency, at the live ICAN price in that currency. */
export interface QuoteLocalView {
  currency: string;
  countryCode: string;
  /** Live price of 1 ICAN in `currency`. */
  pricePerIcan: number;
  pickup: number;
  flight: number;
  cargo: number;
  dropoff: number;
  /** Goods bought from a store abroad (0 / absent when there are none). */
  goods?: number;
  total: number;
}

export interface JourneyQuote {
  pickupFareUgx: number;
  /** Distance to the departure airport the ride fare was priced on (null = unknown, minimum fare applied). */
  pickupKm?: number | null;
  pickupAirport?: { iataCode: string | null; name: string } | null;
  flightFareUgx: number;
  cargoFareUgx: number;
  dropoffFareUgx: number;
  totalUgx: number;
  // Priced in ICAN first (at its live value) — the amount actually charged.
  totalIcan: number;
  pickupIcan?: number;
  flightIcan?: number;
  cargoIcan?: number;
  dropoffIcan?: number;
  /** Live UGX price of 1 ICAN used for this quote. */
  icanPriceUgx?: number;
  /** Same amounts in the customer's currency; null when it couldn't be worked out. */
  local?: QuoteLocalView | null;
  pickup: JourneyPickup;
  destination: JourneyDestination;
  offer: FlightOffer;
  cargoWeightKg: number;
  /** Whether a BodaGoEra ride to the departure airport / from the arrival airport is part of (and charged in) this journey. */
  pickupRide?: boolean;
  dropoffRide?: boolean;
  /** How many travellers the offer (and so every price above) covers. */
  partySize?: number;
  /** 'parcel' = the ground legs are couriers carrying goods (see ParcelDetails). Default: 'travel'. */
  serviceMode?: 'travel' | 'parcel';
  parcel?: ParcelDetails;
  /** Goods bought from a registered store abroad — already in ICAN, and included in totalIcan. */
  goodsIcan?: number;
  store?: StoreOrderSummary;
}

/** A store order as the server priced it. */
export interface StoreOrderSummary {
  supermarketId: string;
  storeName: string;
  /** The store's own price currency, and the goods' total in it. */
  currency: string;
  goodsLocal: number;
  goodsIcan: number;
  lines: Array<{ productId: string; name: string; quantity: number; unitPrice: number; lineTotal: number }>;
  cart: StoreCartLine[];
}

export interface StoreCartLine {
  productId: string;
  quantity: number;
}

/** What a "Send a parcel" journey carries. The parcel's weight is the journey's baggage weight. */
export interface ParcelDetails {
  description: string;
  /** Whoever meets the parcel on arrival — only needed when the arrival courier is kept. */
  recipientName: string;
  recipientPhone: string;
  /** Courier vehicle for both legs; a bike only takes a small parcel. */
  vehicleType: 'motorcycle' | 'car' | null;
}

/** Thrown when the server says the customer's wallet was already debited but
 * the booking didn't complete — the UI must tell them to contact support. */
export class PaymentTakenError extends Error {
  journeyId: string | null;
  /** The airline ticket WAS issued — only the journey set-up failed, so no refund is due. */
  ticketIssued: boolean;
  constructor(message: string, journeyId: string | null, ticketIssued = false) {
    super(message);
    this.name = 'PaymentTakenError';
    this.journeyId = journeyId;
    this.ticketIssued = ticketIssued;
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const res = await fetch(`${MBG_API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  // A timeout or gateway error comes back as an HTML page, not JSON.
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok || data.success === false) {
    // A server-side misconfiguration carries the reason in `detail` — keep it
    // out of the customer-facing message but make it easy to find.
    if (data.detail) console.error(`[journey API] ${path}: ${data.code || 'error'} — ${data.detail}`);
    if (!data.error && (res.status === 502 || res.status === 504)) {
      throw new Error('The server took too long to respond — please try again.');
    }
    if (data.paymentTaken) throw new PaymentTakenError(data.error, data.journeyId ?? null, data.ticketIssued === true);
    const failure: Error & { code?: string } = new Error(data.error || `Request to ${path} failed (${res.status})`);
    failure.code = data.code;
    throw failure;
  }
  return data as T;
}

export async function searchFlights(params: {
  originIata: string;
  destinationIata: string;
  departureDate: string;
  passengerCount?: number;
  cabinClass?: 'economy' | 'premium_economy' | 'business' | 'first';
}): Promise<{ offerRequestId: string; offers: FlightOffer[] }> {
  return postJson('/api/journeys/flights/search', params);
}

export interface AirportSuggestion {
  iataCode: string;
  name: string;
  cityName: string | null;
  countryCode: string;
}

/** Resolves a typed city/airport name to real IATA codes (Duffel Places API)
 * so a customer never has to know/type a raw airport code. */
export async function searchAirports(query: string, countryCode?: string): Promise<{ airports: AirportSuggestion[] }> {
  return postJson('/api/journeys/flights/airports', { query, countryCode });
}

export async function getJourneyQuote(params: {
  customerUserId: string;
  pickup: JourneyPickup;
  offer: FlightOffer;
  destination: JourneyDestination;
  /** Extra baggage/cargo the passenger is bringing along on the flight,
   * beyond the free allowance — a straightforward per-kg platform
   * surcharge, not a real airline ancillary-baggage booking. */
  cargoWeightKg?: number;
  /** Each airport ride is optional — leave one out when the customer has their own car or a friend drives them. Default: both. */
  pickupRide?: boolean;
  dropoffRide?: boolean;
  /** Send a parcel instead of travelling: the ground legs become couriers. */
  serviceMode?: 'travel' | 'parcel';
  parcel?: ParcelDetails;
  /** Buy the parcel from a registered store abroad: the store is the pickup, and the goods are added to the total. */
  store?: { supermarketId: string; cart: StoreCartLine[] };
}): Promise<{ quote: JourneyQuote }> {
  return postJson('/api/journeys/quote', params);
}

/** The company that may pay this person's journeys, if any (ADD_JOURNEY_COMPANY_PAYMENT.sql). */
export interface CompanyJourneyBenefit {
  eligible: boolean;
  businessName?: string;
  /** The most the company allows for one journey, in ICAN; absent = no limit. */
  limitIcan?: number | null;
}

export async function getCompanyJourneyBenefit(): Promise<CompanyJourneyBenefit> {
  const { data, error } = await supabase.rpc('mbg_get_company_journey_benefit');
  // Anything wrong (or the SQL not installed yet) simply means "Business" isn't offered.
  if (error || !data?.eligible) return { eligible: false };
  return {
    eligible: true,
    businessName: data.business_name || undefined,
    limitIcan: data.limit_ican == null ? null : Number(data.limit_ican),
  };
}

export async function confirmJourney(params: {
  customerUserId: string;
  quote: JourneyQuote;
  /** Charge the company wallet (per the person's company allocation) instead of their own. */
  payWithCompany?: boolean;
  passengers: Array<{ id: string; type: 'adult'; given_name: string; family_name: string; born_on: string; gender: 'm' | 'f'; email: string; phone_number: string; title?: string }>;
}): Promise<{ journeyId: string; pnr: string }> {
  try {
    return await postJson('/api/journeys/confirm', params);
  } catch (err: any) {
    // A timeout / dropped connection can happen after the wallet was debited,
    // so never tell the customer to just retry without checking first.
    const noAnswer = err instanceof TypeError || /took too long/i.test(err?.message || '');
    if (noAnswer) {
      throw new PaymentTakenError('We could not confirm whether your booking went through.', null);
    }
    throw err;
  }
}

export interface JourneyLeg {
  id: string;
  leg_order: number;
  leg_type: 'local_pickup' | 'flight' | 'local_dropoff' | 'road_leg' | 'sea_leg';
  status: string;
  ride_id: string | null;
  dispatch_after: string | null;
  flight_booking?: {
    pnr: string;
    status: string;
    current_departure_at: string;
    current_arrival_at: string;
  } | null;
  // The actual best-available rider mbg_dispatch_journey_leg matched (see
  // mbg_find_available_vehicles — nearest, then highest-rated) for this leg.
  ride?: {
    id: string;
    status: string;
    fare: number;
    rider?: {
      plate_number: string;
      vehicle_type: string;
      vehicle_color: string | null;
      vehicle_model: string | null;
      rating: number;
      current_lat: number | null;
      current_lng: number | null;
      location_updated_at: string | null;
      user?: { phone: string | null; profile?: { full_name: string | null } | null } | null;
    } | null;
  } | null;
}

export interface Journey {
  id: string;
  status: string;
  created_at?: string;
  /** Last change — for a finished journey, roughly when it finished. */
  updated_at?: string;
  destination_country: string;
  destination_city: string | null;
  destination_address: string | null;
  /** Travellers on the booking (1 when the column doesn't exist yet or for a solo trip). */
  passenger_count?: number;
  total_fare_ugx: number;
  total_fare_ican: number;
  /** Set once the wallet was debited — even when the booking then failed, which is what tells "money taken, no ticket" from "never charged". */
  ican_journey_tx_id?: string | null;
  /** Set when a failed booking's payment was automatically returned to the wallet. */
  refunded_at?: string | null;
  legs: JourneyLeg[];
}

export interface AirTicketSegment {
  carrier: string | null;
  carrierIata: string | null;
  flightNumber: string | null;
  operatedBy: string | null;
  aircraft: string | null;
  origin: { iata: string | null; name: string | null; city: string | null; terminal: string | null };
  destination: { iata: string | null; name: string | null; city: string | null; terminal: string | null };
  departingAt: string | null;
  arrivingAt: string | null;
  cabin: string | null;
  baggages: Array<{ type: string; quantity: number }>;
}

export interface AirTicket {
  journeyId: string;
  orderId: string;
  bookingReference: string;
  airline: string | null;
  passengers: Array<{ id: string; title: string | null; givenName: string; familyName: string; type: string }>;
  segments: AirTicketSegment[];
  /** Empty until the airline has issued the e-ticket number(s) — usually within minutes. */
  eTickets: string[];
  totalAmount: string;
  totalCurrency: string;
  totalPaidIcan: number | null;
  totalPaidUgx: number | null;
  bookedAt: string | null;
  /** Random code behind the ticket's QR (mbg_journeys.ticket_verify_code); null until ADD_AIR_TICKET_VERIFICATION.sql is run. */
  verifyCode?: string | null;
}

/** Where a ticket's QR points — always the live site, since a printed/PDF ticket is scanned in the real world. */
export const airTicketVerifyUrl = (code: string) => `${MBG_API_BASE_URL}/ticket/${code}`;

/** The customer's air ticket for a booked journey, read live from the airline order. */
export async function getAirTicket(journeyId: string): Promise<AirTicket> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers: Record<string, string> = {};
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const res = await fetch(`${MBG_API_BASE_URL}/api/journeys/${journeyId}?ticket=1`, { headers });
  const data = await res.json().catch(() => ({} as any));
  if (!res.ok || !data.success) throw new Error(data.error || 'Could not load your air ticket right now — please try again.');
  return data.ticket as AirTicket;
}

const JOURNEY_SELECT = `*, legs:mbg_journey_legs(
      *,
      flight_booking:mbg_flight_bookings!mbg_journey_legs_flight_booking_fkey(*),
      ride:mbg_rides(
        id, status, fare,
        rider:mbg_riders(
          plate_number, vehicle_type, vehicle_color, vehicle_model, rating,
          current_lat, current_lng, location_updated_at,
          user:mbg_users!user_id(phone, profile:mbg_user_profiles(full_name))
        )
      )
    )`;

export async function getJourney(journeyId: string): Promise<Journey> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {};
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    // Never wait on the journey service forever — if it is slow or the route
    // isn't deployed, fall through to the direct database read below.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${MBG_API_BASE_URL}/api/journeys/${journeyId}`, { headers, signal: controller.signal });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to fetch journey');
      return data.journey as Journey;
    } finally {
      clearTimeout(timer);
    }
  } catch (apiError) {
    // The booking is already made and paid at this point, so if the journey
    // service can't be reached fall back to reading it straight from the
    // database (the same read the My Journeys list uses) instead of leaving the
    // customer on a spinner.
    const { data, error } = await supabase.from('mbg_journeys').select(JOURNEY_SELECT).eq('id', journeyId).maybeSingle();
    if (error || !data) throw apiError;
    return data as Journey;
  }
}

/** Live-ish polling helper for the journey status screen (no realtime channel yet in Phase 1). */
export function pollJourney(journeyId: string, onUpdate: (journey: Journey) => void, intervalMs = 10000, onError?: (err: unknown) => void): () => void {
  let cancelled = false;
  const tick = async () => {
    if (cancelled) return;
    try {
      onUpdate(await getJourney(journeyId));
    } catch (err) {
      console.error('pollJourney error:', err);
      onError?.(err);
    }
  };
  tick();
  const id = setInterval(tick, intervalMs);
  return () => {
    cancelled = true;
    clearInterval(id);
  };
}

/** How a shipment's land legs are set up. A skipped leg isn't booked or charged. */
export interface ShipLandOptions {
  /** A truck/van collects from the pickup address and takes it to the departure port. Default true. */
  pickupLeg?: boolean;
  /** A vehicle takes it from the arrival port to the final address. Default true. */
  dropoffLeg?: boolean;
  /** null = automatic (truck/van matched on weight). */
  vehicleType?: 'motorcycle' | 'car' | 'van' | 'truck' | null;
}

interface ShipRouteParams extends ShipLandOptions {
  /** Coordinates of a skipped leg's address aren't needed. */
  pickupLat: number | null; pickupLng: number | null; pickupCountry: string;
  dropoffLat: number | null; dropoffLng: number | null; dropoffCountry: string;
  cargoWeightKg?: number;
  /** Buying from a registered store abroad: the store is the pickup (the server ignores the pickup fields) and the goods are charged with the shipping. */
  store?: { supermarketId: string; cart: StoreCartLine[] };
}

const shipRouteArgs = (params: ShipRouteParams) => ({
  p_pickup_lat: params.pickupLat,
  p_pickup_lng: params.pickupLng,
  p_pickup_country: params.pickupCountry,
  p_dropoff_lat: params.dropoffLat,
  p_dropoff_lng: params.dropoffLng,
  p_dropoff_country: params.dropoffCountry,
  p_pickup_leg: params.pickupLeg ?? true,
  p_dropoff_leg: params.dropoffLeg ?? true,
  p_land_vehicle_type: params.vehicleType ?? null,
  p_cargo_weight_kg: params.cargoWeightKg ?? null,
});

export interface ShipCargoQuote {
  pickupFareUgx: number;
  seaFareUgx: number;
  dropoffFareUgx: number;
  totalUgx: number;
  /** What will be charged, at ICAN's live value. */
  totalIcan: number;
  originPort: { city: string; name: string; country: string };
  destPort: { city: string; name: string; country: string };
}

/** The price of a shipment as currently set up, before anything is charged. */
export async function quoteShipCargoJourney(params: ShipRouteParams): Promise<{ success: boolean; quote?: ShipCargoQuote; error?: string }> {
  const { data, error } = await supabase.rpc('mbg_quote_ship_cargo_journey', shipRouteArgs(params));
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error };
  return {
    success: true,
    quote: {
      pickupFareUgx: Number(data.pickup_fare_ugx), seaFareUgx: Number(data.sea_fare_ugx), dropoffFareUgx: Number(data.dropoff_fare_ugx),
      totalUgx: Number(data.total_ugx), totalIcan: Number(data.total_ican),
      originPort: data.origin_port, destPort: data.dest_port,
    },
  };
}

/**
 * Books a full end-to-end cargo shipment (pickup -> departure port -> sea
 * crossing -> arrival port -> final delivery) directly via Supabase RPC —
 * the land legs are optional (see ShipLandOptions). Unlike flight booking this
 * needs no third-party secret, so it's called straight from the browser like any
 * other mbg_* RPC, not through /api.
 */
export async function requestShipCargoJourney(params: ShipRouteParams & {
  pickupLocation: string;
  dropoffLocation: string;
  cargoDescription?: string;
  /** Charge the company wallet (per the person's company allocation) instead of their own. */
  payWithCompany?: boolean;
}): Promise<{ success: boolean; journeyId?: string; error?: string }> {
  const { data, error } = await supabase.rpc('mbg_request_ship_cargo_journey', {
    ...shipRouteArgs(params),
    ...(params.payWithCompany ? { p_pay_with_company: true } : {}),
    p_pickup_location: params.pickupLocation,
    p_dropoff_location: params.dropoffLocation,
    p_cargo_description: params.cargoDescription ?? null,
    ...(params.store ? {
      p_supermarket_id: params.store.supermarketId,
      p_cart: params.store.cart.map((l) => ({ product_id: l.productId, quantity: l.quantity })),
    } : {}),
  });
  if (error) return { success: false, error: error.message };
  return { success: !!data?.success, journeyId: data?.journey_id, error: data?.error };
}

/**
 * Removes finished journeys from the server (ADD_JOURNEY_SELF_DELETE.sql).
 * The database refuses anything not the caller's own, not finished, still
 * awaiting a refund, or with a flight that hasn't landed — those come back in
 * `skipped` with the reason instead of being deleted.
 */
export async function deleteMyJourneys(journeyIds: string[]): Promise<{ deletedIds: string[]; skipped: Array<{ id: string; reason: string }> }> {
  const { data, error } = await supabase.rpc('mbg_delete_my_journeys', { p_journey_ids: journeyIds });
  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || 'Could not remove the journey right now.');
  return { deletedIds: data.deleted_ids ?? [], skipped: data.skipped ?? [] };
}

export interface ImportStore {
  id: string;
  name: string;
  businessType: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  country: string;
  /** The currency the store's prices are written in. */
  currency: string;
  productCount: number;
}

/** Registered stores in a country other than the customer's own — the ones they can buy from abroad. */
export async function listImportStores(homeCountry: string): Promise<ImportStore[]> {
  const { data, error } = await supabase.rpc('mbg_list_import_stores', { p_home_country: homeCountry });
  if (error) throw new Error(/mbg_list_import_stores/.test(error.message) ? 'Buying from abroad is not switched on yet.' : error.message);
  return (data || []).map((r: any) => ({
    id: r.id, name: r.name, businessType: r.business_type, address: r.address,
    latitude: Number(r.latitude), longitude: Number(r.longitude), country: r.country,
    currency: r.price_currency, productCount: Number(r.product_count) || 0,
  }));
}

export interface ImportGoodsQuote {
  currency: string;
  goodsLocal: number;
  goodsIcan: number;
  lines: StoreOrderSummary['lines'];
}

/** What the items in a cart cost, converted to ICAN at the live value of the store's currency. */
export async function quoteImportGoods(supermarketId: string, cart: StoreCartLine[]): Promise<{ success: boolean; quote?: ImportGoodsQuote; error?: string }> {
  const { data, error } = await supabase.rpc('mbg_quote_import_goods', {
    p_supermarket_id: supermarketId,
    p_cart: cart.map((l) => ({ product_id: l.productId, quantity: l.quantity })),
  });
  if (error) return { success: false, error: error.message };
  if (!data?.success) return { success: false, error: data?.error };
  return {
    success: true,
    quote: {
      currency: data.currency, goodsLocal: Number(data.goods_local), goodsIcan: Number(data.goods_ican),
      lines: (data.lines || []).map((l: any) => ({ productId: l.product_id, name: l.product_name, quantity: Number(l.quantity), unitPrice: Number(l.unit_price), lineTotal: Number(l.line_total) })),
    },
  };
}

export async function getMyJourneys(customerUserId: string): Promise<Journey[]> {
  const { data: customer } = await supabase.from('mbg_customers').select('id').eq('user_id', customerUserId).single();
  if (!customer) return [];
  const { data, error } = await supabase
    .from('mbg_journeys')
    .select(JOURNEY_SELECT)
    .eq('customer_id', customer.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as Journey[];
}
