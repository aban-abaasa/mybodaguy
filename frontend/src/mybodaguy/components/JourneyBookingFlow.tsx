import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MapPin, Plane, Home, CreditCard, CheckCircle, Loader2, Star, Phone, Car, Search, Bike, Ship, Package, Printer, User, ArrowRight, Wallet, ShieldCheck, Truck, AlertTriangle } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import {
  searchFlights, searchAirports, getJourneyQuote, confirmJourney, pollJourney, getMyJourneys, requestShipCargoJourney, PaymentTakenError,
  type FlightOffer, type Journey, type JourneyQuote, type AirportSuggestion,
} from '../services/journeyService';
import { geocodeAddress, reverseGeocodeCountry, searchCities, searchAddresses, type CountryLookup, type CitySuggestion, type AddressSuggestion, type GeocodeResult } from '../services/geocodeService';
import { printShipTicket } from '../services/printTicket';
import AirTicketButton from './AirTicketButton';
import JourneyLegRideActions from './JourneyLegRideActions';
import { toInternationalPhone, genderForTitle } from '../services/phone';
import JourneyRideOptions, { DEFAULT_PICKUP_PREFERENCES, preferencesForApi, describePreferences, type PickupPreferences } from './JourneyRideOptions';
import { getBalance, ICAN_TO_UGX, formatICAN, SOURCE_APP } from '../services/icanWalletService';
import { payWithFlutterwave, generateTxRef } from '../services/flutterwaveClient';
import LocationPickerMap from './LocationPickerMap';
import FlightResultsPicker, { CabinPicker } from './FlightResultsPicker';
import { JourneyStepper, StepCard, Field, TripSummary, ErrorBanner, FlightSkeleton, type StepperStep } from './JourneyUI';
import { formatIcan, formatMoney, summarizeOffer, todayIsoDate, type CabinClass } from '../services/flightOffers';
import type { Location } from '../data/mockLocations';
import { COUNTRIES } from '../data/countries';

const SHIP_BOOKING_TIMEOUT_MS = 60_000;

/** Most travellers on one booking (the airline's own limit per order). */
const MAX_PARTY_SIZE = 9;
/** One BodaGoEra car carries this many; a bigger party keeps the flight but makes its own way to/from the airport. */
const CAR_SEATS = 4;

type PassengerTitle = 'mr' | 'mrs' | 'ms' | 'miss' | 'dr';

interface PassengerForm {
  title: PassengerTitle;
  gender: 'm' | 'f';
  givenName: string;
  familyName: string;
  dob: string;
  phone: string;
}

const blankPassenger = (): PassengerForm => ({ title: 'mr', gender: 'm', givenName: '', familyName: '', dob: '', phone: '' });

interface JourneyPrefillPoint {
  lat: number;
  lng: number;
  address: string;
}

interface JourneyBookingFlowProps {
  customerId: string;
  // Set when a customer got here via the auto-redirect from a normal
  // ride/delivery request that turned out to need a plane or ship
  // (EnhancedRideRequest.tsx's needsJourneyPath) — lets them land straight
  // in the right mode instead of re-choosing Fly vs Ship, and for a cargo
  // redirect, skips re-dropping pins they already placed.
  initialBookingKind?: 'fly' | 'ship';
  initialShipPickup?: JourneyPrefillPoint;
  initialShipDropoff?: JourneyPrefillPoint;
  initialPickupCountryIso2?: string;
}

interface CustomerArea {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

type BookingKind = 'fly' | 'ship';
type Step = 'pickup' | 'flight' | 'destination' | 'review' | 'confirming' | 'tracking' | 'ship-details';

export const legLabel: Record<string, string> = {
  local_pickup: 'Ride to the airport',
  flight: 'Flight',
  local_dropoff: 'Driver to your final address',
  road_leg: 'Road transport',
  sea_leg: 'Sea crossing',
};

const legIcon: Record<string, typeof Car> = {
  local_pickup: Car,
  flight: Plane,
  local_dropoff: Home,
  road_leg: Truck,
  sea_leg: Ship,
};

// Leg statuses are free-form strings from the dispatch engine, so colour by
// meaning (done / trouble / not started / in motion) rather than exact value.
function legStatusClass(status: string): string {
  if (/complet|deliver|arriv|done/.test(status)) return 'bg-emerald-100 text-emerald-700';
  if (/fail|cancel/.test(status)) return 'bg-red-100 text-red-700';
  if (/^pending$/.test(status)) return 'bg-slate-100 text-slate-500';
  return 'bg-orange-100 text-orange-700';
}

export default function JourneyBookingFlow({
  customerId,
  initialBookingKind,
  initialShipPickup,
  initialShipDropoff,
  initialPickupCountryIso2,
}: JourneyBookingFlowProps) {
  const [bookingKind, setBookingKind] = useState<BookingKind>(initialBookingKind || 'fly');
  const [step, setStep] = useState<Step>(initialBookingKind === 'ship' ? 'ship-details' : 'pickup');
  const [error, setError] = useState<string | null>(null);

  const changeBookingKind = (kind: BookingKind) => {
    setBookingKind(kind);
    setStep(kind === 'fly' ? 'pickup' : 'ship-details');
    setError(null);
  };

  // Ship Cargo mode — a separate, simpler direct-book flow (no flight
  // search): pickup + destination pins, what's being shipped, submit.
  const [shipPickup, setShipPickup] = useState<{ lat: number; lng: number; address: string } | null>(initialShipPickup || null);
  const [shipPickupCountry, setShipPickupCountry] = useState<CountryLookup | null>(null);
  const [shipDropoff, setShipDropoff] = useState<{ lat: number; lng: number; address: string } | null>(initialShipDropoff || null);
  const [shipDropoffCountry, setShipDropoffCountry] = useState<CountryLookup | null>(null);
  const [cargoDescription, setCargoDescription] = useState('');
  const [shipCargoWeightKg, setShipCargoWeightKg] = useState('');
  const [submittingShip, setSubmittingShip] = useState(false);

  useEffect(() => {
    if (!shipPickup) { setShipPickupCountry(null); return; }
    reverseGeocodeCountry(shipPickup.lat, shipPickup.lng).then(setShipPickupCountry);
  }, [shipPickup?.lat, shipPickup?.lng]);

  useEffect(() => {
    if (!shipDropoff) { setShipDropoffCountry(null); return; }
    reverseGeocodeCountry(shipDropoff.lat, shipDropoff.lng).then(setShipDropoffCountry);
  }, [shipDropoff?.lat, shipDropoff?.lng]);

  const submitShipCargo = async () => {
    if (!shipPickup || !shipDropoff || !shipPickupCountry || !shipDropoffCountry) return;
    setError(null);
    setPaymentIssue(null);
    setSubmittingShip(true);
    try {
      // Payment and booking happen in one server step. Never leave the button
      // spinning forever: after a minute, work out what actually happened.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        requestShipCargoJourney({
          pickupLocation: shipPickup.address, pickupLat: shipPickup.lat, pickupLng: shipPickup.lng, pickupCountry: shipPickupCountry.name,
          dropoffLocation: shipDropoff.address, dropoffLat: shipDropoff.lat, dropoffLng: shipDropoff.lng, dropoffCountry: shipDropoffCountry.name,
          cargoDescription: cargoDescription.trim() || undefined,
          cargoWeightKg: shipCargoWeightKg ? Number(shipCargoWeightKg) : undefined,
        }),
        new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), SHIP_BOOKING_TIMEOUT_MS); }),
      ]);
      clearTimeout(timer);

      const noAnswer = outcome === 'timeout' || (!outcome.success && /failed to fetch|network|timeout|timed out|aborted/i.test(outcome.error || ''));
      if (noAnswer) {
        // We never got an answer — the booking may still have gone through.
        const existing = await findRecentShipJourney();
        if (existing) {
          startTracking(existing);
          return;
        }
        setPaymentIssue({ journeyId: null, certain: false });
        return;
      }
      if (!outcome.success || !outcome.journeyId) {
        setError(outcome.error || 'Could not book this shipment');
        return;
      }
      startTracking(outcome.journeyId);
    } catch (err: any) {
      setError(err.message || 'Could not book this shipment');
    } finally {
      setSubmittingShip(false);
    }
  };

  /** A shipment this customer booked in the last few minutes, if the server saved one. */
  const findRecentShipJourney = async (): Promise<string | null> => {
    try {
      const rows = await getMyJourneys(customerId);
      const recent = rows.find((j) => j.legs?.some((l) => l.leg_type === 'sea_leg') && j.created_at && Date.now() - new Date(j.created_at).getTime() < 5 * 60_000);
      return recent?.id ?? null;
    } catch {
      return null;
    }
  };

  // Journey status screen: poll the booking, surface a load failure instead of
  // an endless spinner, and stop polling when the page goes away.
  const stopPollingRef = useRef<(() => void) | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const startTracking = (journeyId: string) => {
    stopPollingRef.current?.();
    setTrackingError(null);
    setStep('tracking');
    stopPollingRef.current = pollJourney(
      journeyId,
      (j) => { setTrackingError(null); setJourney(j); },
      10000,
      (err: any) => setTrackingError(err?.message || 'Could not load your booking'),
    );
  };
  useEffect(() => () => stopPollingRef.current?.(), []);

  const [areas, setAreas] = useState<CustomerArea[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [manualPickup, setManualPickup] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [pickupSearchResult, setPickupSearchResult] = useState<GeocodeResult | null>(null);
  const [searchingPickup, setSearchingPickup] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [pickupVehicleType, setPickupVehicleType] = useState<'motorcycle' | 'car'>('motorcycle');
  // Either airport ride can be left out — the customer has their own car, or a
  // friend drives them / collects them. A ride left out isn't charged or booked.
  const [wantPickupRide, setWantPickupRide] = useState(true);
  const [wantDropoffRide, setWantDropoffRide] = useState(true);
  // How many people are travelling on this one booking. It sizes the flight
  // search and decides what the ground rides can be (see CAR_SEATS).
  const [partySize, setPartySize] = useState(1);
  const ridesAvailable = partySize <= CAR_SEATS;
  // A bike carries one traveller, so any party goes by car.
  const effectiveVehicleType: 'motorcycle' | 'car' = partySize > 1 ? 'car' : pickupVehicleType;
  const [pickupPreferences, setPickupPreferences] = useState<PickupPreferences>(DEFAULT_PICKUP_PREFERENCES);
  // Which country the journey actually STARTS in — was hardcoded to
  // 'Uganda' throughout (geocoding, quote, and the leg mbg_dispatch_journey_leg
  // matches against), even though the backend (mbg_find_available_vehicles,
  // gated on r.service_countries) already supports any country. Defaults to
  // Uganda since that's the primary market, but is now a real customer choice.
  const [pickupCountry, setPickupCountry] = useState(
    COUNTRIES.find((c) => c.iso2 === initialPickupCountryIso2) || COUNTRIES[0]
  );

  const [originIata, setOriginIata] = useState('EBB');
  const [originLabel, setOriginLabel] = useState<string | null>('Entebbe International Airport (EBB)');
  const [destinationIata, setDestinationIata] = useState('');
  const [destinationLabel, setDestinationLabel] = useState<string | null>(null);
  const [departureDate, setDepartureDate] = useState('');
  const [flightCargoWeightKg, setFlightCargoWeightKg] = useState('');
  const [searchingFlights, setSearchingFlights] = useState(false);
  const [offers, setOffers] = useState<FlightOffer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<FlightOffer | null>(null);
  const [cabinClass, setCabinClass] = useState<CabinClass>('economy');
  const [hasSearched, setHasSearched] = useState(false);

  // Offers belong to one exact route + date + cabin. The moment any of those
  // change they no longer describe what's on screen, and a still-selected old
  // offer would get quoted and booked for the wrong trip.
  const clearFlightResults = () => {
    setOffers([]);
    setSelectedOffer(null);
    setHasSearched(false);
    setError(null);
  };

  const [destCountry, setDestCountry] = useState('');
  const [destCity, setDestCity] = useState('');
  const [destAddress, setDestAddress] = useState('');
  const [destPin, setDestPin] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [findingDestPin, setFindingDestPin] = useState(false);
  const selectedDestinationAddressRef = useRef('');

  const [quote, setQuote] = useState<JourneyQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Set when the wallet may have been debited but no ticket was issued — kept
  // separate from `error` so it can't be dismissed or cleared by navigating.
  const [paymentIssue, setPaymentIssue] = useState<{ journeyId: string | null; certain: boolean; ticketIssued?: boolean } | null>(null);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [customerName, setCustomerName] = useState('Customer');

  // Real traveler details — must match each passenger's ID/passport, since
  // this books actual seats with a real airline via Duffel. One entry per
  // traveller; the first is the lead traveller (the account holder, usually).
  const [passengers, setPassengers] = useState<PassengerForm[]>(() => [blankPassenger()]);
  const updatePassenger = (index: number, patch: Partial<PassengerForm>) =>
    setPassengers((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  // Everyone else's phone number may be left blank: the airline needs one per
  // ticket, so they fall back to the lead traveller's.
  const leadPhone = passengers[0]?.phone ?? '';
  const phoneFor = (index: number) => toInternationalPhone(passengers[index]?.phone.trim() ? passengers[index].phone : leadPhone, pickupCountry.iso2);
  const passengerDetailsValid = passengers.length === partySize && passengers.every((p, i) =>
    p.givenName.trim().length > 0 &&
    p.familyName.trim().length > 0 &&
    !!p.dob &&
    !!phoneFor(i)
  );

  // Real ICAN wallet balance, checked against the quote before letting the
  // customer confirm — avoids creating a doomed mbg_journeys row (confirm.js
  // marks it 'failed' on an insufficient-balance debit) when we can instead
  // offer a real Flutterwave top-up right here.
  const [walletIcan, setWalletIcan] = useState<number | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [toppingUp, setToppingUp] = useState(false);

  const refreshBalance = async () => {
    if (!customerId) return;
    setCheckingBalance(true);
    try {
      const balance = await getBalance(customerId);
      setWalletIcan(balance.ican);
    } catch {
      setWalletIcan(null);
    } finally {
      setCheckingBalance(false);
    }
  };

  useEffect(() => {
    if (step === 'review' && quote) refreshBalance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, quote]);

  const shortfallIcan = quote && walletIcan !== null ? Math.max(0, quote.totalIcan - walletIcan) : 0;
  // A top-up buys ICAN at its live UGX price — the same value the quote used.
  // Never below the 5,000 UGX launch floor, which is also the least the
  // payment verifier will accept per coin (verify-flutterwave-payment).
  const topUpUnitUgx = Math.max(ICAN_TO_UGX, quote?.icanPriceUgx ?? 0);
  const hasEnoughBalance = walletIcan === null ? true : shortfallIcan <= 0;

  const doTopUp = async () => {
    if (!quote || shortfallIcan <= 0) return;
    setError(null);
    setToppingUp(true);
    try {
      const { data: authUser } = await supabase.auth.getUser();
      const email = authUser?.user?.email;
      // Round up to whole shillings, and up to at least one coin, so a
      // fractional shortfall still clears Flutterwave and buy_ican_coins' own
      // minimum-amount expectations. The coin amount is floored (8 dp) so it
      // can never be worth more than the shillings actually paid.
      const ugxAmount = Math.max(Math.ceil(topUpUnitUgx), Math.ceil(shortfallIcan * topUpUnitUgx));
      const icanAmount = Math.floor((ugxAmount / topUpUnitUgx) * 1e8) / 1e8;
      const txRef = generateTxRef('MBGJ-TOPUP');

      const payment = await payWithFlutterwave({
        amount: ugxAmount,
        currency: 'UGX',
        customerEmail: email,
        customerPhone: leadPhone.trim() || undefined,
        customerName: `${passengers[0]?.givenName ?? ''} ${passengers[0]?.familyName ?? ''}`.trim() || customerName,
        title: 'BodaGoEra Journey — Top up ICAN',
        description: `Top up ${formatICAN(icanAmount)} ICAN to complete your journey booking`,
        txRef,
      });

      if (payment.status === 'cancelled') {
        setError('Top-up cancelled.');
        return;
      }
      if (payment.status !== 'successful' || !payment.transaction_id) {
        setError('Top-up payment was not successful.');
        return;
      }

      // Server-side verification against Flutterwave's own API (secret key,
      // never in the browser) before crediting — see
      // ICAN/backend/components/supabase/functions/verify-flutterwave-payment.
      // buy_ican_coins itself is locked to service_role only, so this edge
      // function is the only real way to credit a wallet.
      const { data, error: verifyError } = await supabase.functions.invoke('verify-flutterwave-payment', {
        body: {
          transaction_id: payment.transaction_id,
          tx_ref: txRef,
          ican_amount: icanAmount,
          source_app: SOURCE_APP,
        },
      });
      if (verifyError) throw verifyError;
      if (!data?.success) throw new Error(data?.error || 'Top-up verification failed');

      await refreshBalance();
    } catch (err: any) {
      setError(err.message || 'Top-up failed');
    } finally {
      setToppingUp(false);
    }
  };

  useEffect(() => {
    if (!customerId) return;
    supabase
      .from('mbg_customer_areas')
      .select('id, name, latitude, longitude')
      .eq('customer_user_id', customerId)
      .then(({ data }) => setAreas((data ?? []) as CustomerArea[]));
  }, [customerId]);

  useEffect(() => {
    if (!customerId) return;
    supabase
      .from('mbg_users')
      .select('email, mbg_user_profiles(full_name)')
      .eq('id', customerId)
      .maybeSingle()
      .then(({ data }) => {
        const name = (data as any)?.mbg_user_profiles?.[0]?.full_name || data?.email?.split('@')[0] || 'Customer';
        setCustomerName(name);
      });
  }, [customerId]);

  // Best-effort prefill of the passenger name form from the customer's
  // profile — still editable, since the traveler isn't always the account
  // holder and the name must match their travel document exactly.
  useEffect(() => {
    if (!customerName || customerName === 'Customer') return;
    const parts = customerName.trim().split(/\s+/);
    setPassengers((prev) => prev.map((p, i) => (i === 0
      ? { ...p, givenName: p.givenName || parts[0] || '', familyName: p.familyName || parts.slice(1).join(' ') }
      : p)));
  }, [customerName]);

  useEffect(() => {
    setPassengers((prev) => (prev.length === partySize
      ? prev
      : partySize > prev.length
        ? [...prev, ...Array.from({ length: partySize - prev.length }, blankPassenger)]
        : prev.slice(0, partySize)));
  }, [partySize]);

  // Bigger than one car can carry: airport rides can't be booked for the party.
  useEffect(() => {
    if (!ridesAvailable) {
      setWantPickupRide(false);
      setWantDropoffRide(false);
    }
  }, [ridesAvailable]);

  const isFirstPickupCountryRender = useRef(true);
  useEffect(() => {
    // Skip on mount — the initial EBB/Entebbe default already matches the
    // initial pickupCountry (Uganda). Only re-sync when the customer
    // actually changes it afterward, so a stale "Entebbe" origin never
    // sticks around once they've picked a different departure country.
    if (isFirstPickupCountryRender.current) {
      isFirstPickupCountryRender.current = false;
      return;
    }
    clearFlightResults();
    if (pickupCountry.iso2 === 'UG') {
      setOriginIata('EBB');
      setOriginLabel('Entebbe International Airport (EBB)');
    } else {
      setOriginIata('');
      setOriginLabel(null);
    }
  }, [pickupCountry.iso2]);

  const selectedArea = areas.find((a) => a.id === selectedAreaId) || null;
  // Not every customer has a saved area yet — let them type a pickup point
  // directly (geocoded on "Next", see goToFlightStep) instead of blocking
  // the whole flow on that or asking them for raw coordinates.
  const pickup = selectedArea
    ? { lat: selectedArea.latitude, lng: selectedArea.longitude, address: selectedArea.name }
    : manualPickup;

  useEffect(() => {
    if (selectedDestinationAddressRef.current === destAddress) {
      selectedDestinationAddressRef.current = '';
      return;
    }
    setDestPin(null);
  }, [destAddress, destCity, destCountry]);

  const handleMapPickupChange = (location: Location) => {
    setSelectedAreaId('');
    setManualAddress(location.fullAddress);
    setManualPickup({ lat: location.coordinates.lat, lng: location.coordinates.lng, address: location.fullAddress });
    setPickupSearchResult({ lat: location.coordinates.lat, lng: location.coordinates.lng, displayName: location.fullAddress });
  };

  const searchPickupOnMap = async () => {
    const query = manualAddress.trim();
    if (!query) return;
    setError(null);
    setSearchingPickup(true);
    setPickupSearchResult(null);
    try {
      const result = await geocodeAddress(query, pickupCountry.name);
      if (!result) {
        setError(`Couldn't find "${query}" in ${pickupCountry.name}. Try adding a neighborhood, city, or landmark.`);
        return;
      }
      setPickupSearchResult(result);
    } catch (err: any) {
      setError(err.message || 'Could not search that pickup location');
    } finally {
      setSearchingPickup(false);
    }
  };

  const usePickupSearchResult = () => {
    if (!pickupSearchResult) return;
    setSelectedAreaId('');
    setManualAddress(pickupSearchResult.displayName);
    setManualPickup({ lat: pickupSearchResult.lat, lng: pickupSearchResult.lng, address: pickupSearchResult.displayName });
  };

  const findDestinationOnMap = async () => {
    setError(null);
    setFindingDestPin(true);
    try {
      const query = [destAddress, destCity, destCountry].filter(Boolean).join(', ');
      const result = await geocodeAddress(query);
      if (!result) {
        setError("Couldn't find that address on the map — you can still continue without it, or add more detail and try again.");
        return;
      }
      setDestPin({ lat: result.lat, lng: result.lng, address: result.displayName });
    } catch (err: any) {
      setError(err.message || 'Could not look up that address');
    } finally {
      setFindingDestPin(false);
    }
  };

  const handleDestPinChange = (location: Location) => {
    setDestPin({ lat: location.coordinates.lat, lng: location.coordinates.lng, address: location.fullAddress });
  };

  const goToFlightStep = async () => {
    // No pickup ride: nothing to locate, the customer makes their own way.
    if (!wantPickupRide) {
      setStep('flight');
      return;
    }
    // A saved area or a map pin already carries real coordinates — only a
    // freshly typed address (never geocoded yet) needs looking up here.
    if (selectedArea || manualPickup) {
      setStep('flight');
      return;
    }
    setError(null);
    setGeocoding(true);
    try {
      const result = await geocodeAddress(manualAddress, pickupCountry.name);
      if (!result) {
        setError("Couldn't find that address — try adding more detail (e.g. neighborhood, city).");
        return;
      }
      setManualPickup({ lat: result.lat, lng: result.lng, address: manualAddress });
      setStep('flight');
    } catch (err: any) {
      setError(err.message || 'Could not look up that address');
    } finally {
      setGeocoding(false);
    }
  };

  // Duffel rejects both of these outright, so catch them here with a message
  // the customer can act on rather than sending a search that can only fail.
  const sameAirport = !!originIata && originIata === destinationIata;
  const pastDate = !!departureDate && departureDate < todayIsoDate();
  const searchProblem = sameAirport
    ? 'Your departure and arrival airports are the same — choose a different destination.'
    : pastDate
      ? 'That date has already passed — choose today or a later date.'
      : null;

  const runFlightSearch = async (cabin: CabinClass = cabinClass) => {
    setError(null);
    if (searchProblem) {
      setError(searchProblem);
      return;
    }
    setSearchingFlights(true);
    setSelectedOffer(null);
    try {
      const { offers } = await searchFlights({ originIata, destinationIata, departureDate, passengerCount: partySize, cabinClass: cabin });
      setOffers(offers);
      setHasSearched(true);
      if (offers.length === 0) setError(`No ${cabin.replace('_', ' ')} flights found for that route/date — try another date or cabin.`);
    } catch (err: any) {
      setError(err.message || 'Flight search failed');
    } finally {
      setSearchingFlights(false);
    }
  };

  const buildQuote = async () => {
    if (!selectedOffer || (wantPickupRide && !pickup)) return;
    setError(null);
    setQuoting(true);
    try {
      const { quote } = await getJourneyQuote({
        customerUserId: customerId,
        pickup: wantPickupRide && pickup
          ? { ...pickup, country: pickupCountry.name, vehicleType: effectiveVehicleType, preferences: preferencesForApi(pickupPreferences, effectiveVehicleType) }
          : { lat: null, lng: null, address: '', country: pickupCountry.name },
        offer: selectedOffer,
        // With no arrival ride there is no address to collect: the server records
        // the airport the flight lands at.
        destination: wantDropoffRide
          ? { address: destAddress, country: destCountry, city: destCity, lat: destPin?.lat ?? null, lng: destPin?.lng ?? null }
          : { address: '', country: destCountry, city: destCity || undefined, lat: null, lng: null },
        cargoWeightKg: flightCargoWeightKg ? Number(flightCargoWeightKg) : undefined,
        pickupRide: wantPickupRide,
        dropoffRide: wantDropoffRide,
      });
      setQuote(quote);
      setStep('review');
    } catch (err: any) {
      setError(err.message || 'Could not build a quote');
    } finally {
      setQuoting(false);
    }
  };

  const doConfirm = async () => {
    if (!quote) return;
    const offerPassengers = quote.offer.passengers ?? [];
    if (offerPassengers.length === 0 || offerPassengers.length !== passengers.length) {
      setError('This flight offer has expired — please search flights again.');
      return;
    }
    if (!passengerDetailsValid) {
      setError(`Please fill in ${partySize > 1 ? "every traveller's" : "the passenger's"} full name, date of birth and a phone number with its country code (e.g. +256 7XX XXX XXX).`);
      return;
    }
    if (!hasEnoughBalance) {
      setError('Top up your ICAN wallet before confirming this booking.');
      return;
    }
    setConfirming(true);
    setError(null);
    setPaymentIssue(null);
    try {
      const { data: authUser } = await supabase.auth.getUser();
      const email = authUser?.user?.email || '';
      const { journeyId } = await confirmJourney({
        customerUserId: customerId,
        quote,
        passengers: passengers.map((p, i) => ({
          // Each traveller is matched to the airline's own passenger id, in order.
          id: offerPassengers[i].id, type: 'adult' as const, title: p.title,
          given_name: p.givenName.trim(), family_name: p.familyName.trim(),
          born_on: p.dob, gender: p.gender, email, phone_number: phoneFor(i) || (p.phone.trim() || leadPhone.trim()),
        })),
      });
      startTracking(journeyId);
    } catch (err: any) {
      if (err instanceof PaymentTakenError) {
        setPaymentIssue({ journeyId: err.journeyId, certain: !!err.journeyId, ticketIssued: err.ticketIssued });
      } else if (err?.code === 'price_changed') {
        // Nothing was charged. Show the fresh price so the customer can confirm it.
        await buildQuote();
        setError(err.message);
      } else {
        setError(err.message || 'Journey confirmation failed');
      }
      setStep('review');
    } finally {
      setConfirming(false);
    }
  };

  const flowSteps: StepperStep[] = [
    { id: 'pickup', label: 'Pickup' },
    { id: 'flight', label: 'Flight' },
    { id: 'destination', label: 'Arrival' },
    { id: 'review', label: 'Pay' },
  ];
  const flowIndex = flowSteps.findIndex((s) => s.id === step);
  const showStepper = bookingKind === 'fly' && flowIndex >= 0;
  const selectedSummary = selectedOffer ? summarizeOffer(selectedOffer) : null;
  const destinationLine = [destAddress, destCity, destCountry].filter(Boolean).join(', ');
  const PickupVehicleIcon = effectiveVehicleType === 'car' ? Car : Bike;
  const flightLine = selectedSummary
    ? `${selectedSummary.departClock} ${selectedSummary.originIata} → ${selectedSummary.arriveClock}${selectedSummary.arriveDayOffset > 0 ? ` (+${selectedSummary.arriveDayOffset})` : ''} ${selectedSummary.destinationIata}`
    : '';

  // What's already been decided, kept in view while working on the next step.
  const tripItems: Array<{ icon: ReactNode; label: string; value: string }> = [];
  if (bookingKind === 'fly' && partySize > 1 && (step === 'flight' || step === 'destination')) {
    tripItems.push({ icon: <User size={15} />, label: 'Travellers', value: `${partySize} people on one booking` });
  }
  if (bookingKind === 'fly' && (step === 'flight' || step === 'destination') && (pickup || !wantPickupRide)) {
    tripItems.push({ icon: <PickupVehicleIcon size={15} />, label: 'To the airport', value: wantPickupRide && pickup ? pickup.address : 'Own way (no BodaGoEra ride)' });
  }
  if (step === 'destination' && selectedSummary) {
    tripItems.push({ icon: <Plane size={15} />, label: 'Flight', value: `${selectedSummary.airline} · ${selectedSummary.departDayLabel} · ${flightLine}` });
  }

  // A new step starts at its top — otherwise, on a phone, "Next" lands the
  // customer mid-way down a long page.
  const containerRef = useRef<HTMLDivElement>(null);
  const isFirstStepRender = useRef(true);
  useEffect(() => {
    if (isFirstStepRender.current) {
      isFirstStepRender.current = false;
      return;
    }
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step]);

  const goToStep = (next: Step) => {
    setError(null);
    setStep(next);
  };

  return (
    <div ref={containerRef} className="mx-auto max-w-2xl scroll-mt-4 space-y-5 px-4 py-6">
      <header className="text-center">
        <p className="classic-eyebrow">Door to door</p>
        <h2 className="mt-1 font-classic-display text-[28px] font-bold leading-tight text-slate-800">Book a full journey</h2>
        <div className="landing-classic-divider mx-auto mt-3 max-w-[14rem]" />
        <p className="mx-auto mt-3 max-w-md text-[13px] leading-relaxed text-slate-500">
          {bookingKind === 'ship'
            ? 'Cargo collected from your door, carried across the water, and delivered at the other end.'
            : 'A ride to the airport, a real flight, and a driver waiting when you land.'}
        </p>
      </header>

      {step !== 'tracking' && step !== 'confirming' && (
        <div className="classic-card grid grid-cols-2 gap-1 !rounded-2xl p-1" role="group" aria-label="What are you booking?">
          {([['fly', 'Fly', Plane], ['ship', 'Ship Cargo', Ship]] as const).map(([kind, label, Icon]) => {
            const active = bookingKind === kind;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={active}
                onClick={() => changeBookingKind(kind)}
                className={`flex min-h-[44px] items-center justify-center gap-2 rounded-xl text-sm font-bold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c4a052] ${
                  active
                    ? 'bg-gradient-to-br from-[#231b12] to-[#3d2e18] text-[#f6e7bd] shadow-md ring-1 ring-inset ring-[#c4a052]/50'
                    : 'text-slate-500 hover:bg-[#c4a052]/10 hover:text-[#7a5a12]'
                }`}
              >
                <Icon size={16} /> {label}
              </button>
            );
          })}
        </div>
      )}

      {showStepper && <JourneyStepper steps={flowSteps} currentIndex={flowIndex} onGoTo={(id) => goToStep(id as Step)} />}

      {paymentIssue && (
        <div role="alert" className="animate-step-in rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2.5">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-600" />
            <div className="space-y-2 leading-snug">
              <p className="font-bold">
                {paymentIssue.ticketIssued
                  ? 'Your air ticket was booked, but we could not finish setting up your journey.'
                  : paymentIssue.certain
                    ? 'Your payment was taken but your air ticket was NOT issued.'
                    : 'We could not confirm your booking — your money may have been deducted.'}
              </p>
              <p>
                {paymentIssue.ticketIssued
                  ? 'Please contact the support team to complete it. You do not need a refund and should not pay again.'
                  : paymentIssue.certain
                  ? 'Please contact the support team to be refunded. Do not pay again until this is sorted out.'
                  : 'Check your wallet balance and My Journeys before trying again. If money was deducted and you have no ticket, contact the support team to be refunded.'}
              </p>
              {paymentIssue.journeyId && (
                <p className="text-xs">Quote this reference to support: <span className="select-all font-mono font-semibold">{paymentIssue.journeyId}</span></p>
              )}
            </div>
          </div>
        </div>
      )}

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {tripItems.length > 0 && <TripSummary items={tripItems} />}

      {step === 'ship-details' && (
        <StepCard
          eyebrow="Cargo · by sea"
          title="What are you shipping?"
          description="For real overseas cargo — pickup and destination in different countries not reachable by road. Routed automatically via a real seaport when needed."
        >
          <Field label="Pickup & destination" hint="Tap the map to set the destination, drag either pin to fine-tune.">
            <div className="overflow-hidden rounded-2xl border border-[#c4a052]/40">
              <LocationPickerMap
                pickup={shipPickup ? { id: 'ship_pickup', name: shipPickup.address, area: shipPickup.address, fullAddress: shipPickup.address, coordinates: { lat: shipPickup.lat, lng: shipPickup.lng } } : null}
                dropoff={shipDropoff ? { id: 'ship_dropoff', name: shipDropoff.address, area: shipDropoff.address, fullAddress: shipDropoff.address, coordinates: { lat: shipDropoff.lat, lng: shipDropoff.lng } } : null}
                onPickupChange={(loc) => setShipPickup({ lat: loc.coordinates.lat, lng: loc.coordinates.lng, address: loc.fullAddress })}
                onDropoffChange={(loc) => setShipDropoff({ lat: loc.coordinates.lat, lng: loc.coordinates.lng, address: loc.fullAddress })}
              />
            </div>
          </Field>

          {(shipPickupCountry || shipDropoffCountry) && (
            <p className="flex items-center justify-center gap-2 rounded-full bg-[#fbf3dc] px-3 py-1.5 text-xs font-semibold text-[#7a5a12]">
              {shipPickupCountry?.name || '…'} <ArrowRight size={13} /> {shipDropoffCountry?.name || '…'}
            </p>
          )}

          <Field label="What's in the shipment?" htmlFor="jb-cargo-desc">
            <input
              id="jb-cargo-desc"
              className="classic-input"
              placeholder="e.g. furniture, textiles"
              value={cargoDescription}
              onChange={(e) => setCargoDescription(e.target.value)}
            />
          </Field>
          <Field label="Total weight (kg)" htmlFor="jb-cargo-weight" hint="Used to match a vehicle that can actually carry the load.">
            <input
              id="jb-cargo-weight"
              className="classic-input"
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="e.g. 250"
              value={shipCargoWeightKg}
              onChange={(e) => setShipCargoWeightKg(e.target.value)}
            />
          </Field>

          <button
            disabled={!shipPickup || !shipDropoff || !shipPickupCountry || !shipDropoffCountry || submittingShip}
            onClick={submitShipCargo}
            className="classic-btn classic-btn-primary"
          >
            {submittingShip ? <Loader2 className="animate-spin" size={18} /> : <Ship size={18} />}
            {submittingShip ? 'Booking…' : 'Ship this cargo'}
          </button>
          {(!shipPickup || !shipDropoff) && (
            <p className="-mt-2 text-center text-xs text-slate-500">Set both pins on the map to continue.</p>
          )}
        </StepCard>
      )}

      {bookingKind === 'fly' && step === 'pickup' && (
        <StepCard
          eyebrow="Step 1 of 4"
          title="Where should we collect you?"
          description="Your ride to the airport starts here — or skip it if someone else is taking you."
        >
          <Field
            label="How many people are travelling?"
            htmlFor="jb-party-size"
            hint={partySize > 1
              ? (ridesAvailable
                ? 'One car takes the whole party to the airport, and everyone is booked on the same flight.'
                : `A BodaGoEra car seats up to ${CAR_SEATS}, so for ${partySize} travellers only the flights are booked — you make your own way to and from the airport.`)
              : 'Booking for a family or group? Everyone is booked on the same flight and you pay once.'}
          >
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Fewer travellers"
                disabled={partySize <= 1}
                onClick={() => { setPartySize((n) => Math.max(1, n - 1)); clearFlightResults(); }}
                className="classic-btn classic-btn-outline !min-h-[44px] !w-12 !px-0 text-lg"
              >−</button>
              <output id="jb-party-size" className="min-w-[4.5rem] text-center font-classic-display text-lg font-semibold text-slate-800">
                {partySize} {partySize === 1 ? 'traveller' : 'travellers'}
              </output>
              <button
                type="button"
                aria-label="More travellers"
                disabled={partySize >= MAX_PARTY_SIZE}
                onClick={() => { setPartySize((n) => Math.min(MAX_PARTY_SIZE, n + 1)); clearFlightResults(); }}
                className="classic-btn classic-btn-outline !min-h-[44px] !w-12 !px-0 text-lg"
              >+</button>
            </div>
          </Field>

          <Field label="Starting country" htmlFor="jb-country">
            <select
              id="jb-country"
              className="classic-input"
              value={pickupCountry.iso2}
              onChange={(e) => {
                const next = COUNTRIES.find((c) => c.iso2 === e.target.value) || COUNTRIES[0];
                setPickupCountry(next);
                // A pickup address/pin found under the old country no longer
                // applies once the country itself changes.
                setManualPickup(null);
                setSelectedAreaId('');
                setPickupSearchResult(null);
              }}
            >
              {COUNTRIES.map((c) => (
                <option key={c.iso2 || c.name} value={c.iso2}>{c.name}</option>
              ))}
            </select>
          </Field>

          <div>
            <span className="classic-label">How will you get to the airport?</span>
            <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="How you get to the airport">
              {([
                { on: true, label: 'BodaGoEra ride', desc: partySize > 1 ? 'A car collects everyone' : 'A driver collects you' },
                { on: false, label: 'My own way', desc: 'Own car or a friend drives me' },
              ] as const).map(({ on, label, desc }) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={wantPickupRide === on}
                  disabled={on && !ridesAvailable}
                  onClick={() => { setWantPickupRide(on); setError(null); }}
                  className={`classic-tile p-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${wantPickupRide === on ? 'is-active' : ''}`}
                >
                  <span className="block font-classic-display text-[15px] font-semibold leading-tight text-slate-800">{label}</span>
                  <span className="block text-[11px] leading-tight text-slate-500">{desc}</span>
                </button>
              ))}
            </div>
            {!wantPickupRide && (
              <p className="mt-2 text-xs leading-relaxed text-slate-500">No ride is booked or charged for this part. You only pay for what you choose.</p>
            )}
          </div>

          {wantPickupRide && (<>
          <div>
            <span className="classic-label">Ride to the airport</span>
            <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="Ride to the airport">
              {([
                { value: 'motorcycle', label: 'Bike', desc: partySize > 1 ? 'Carries one traveller' : 'Quickest through traffic', Icon: Bike },
                { value: 'car', label: 'Car', desc: 'Room for luggage', Icon: Car },
              ] as const).map(({ value, label, desc, Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={effectiveVehicleType === value}
                  disabled={partySize > 1 && value === 'motorcycle'}
                  onClick={() => setPickupVehicleType(value)}
                  className={`classic-tile flex items-center gap-3 p-3 disabled:cursor-not-allowed disabled:opacity-50 ${effectiveVehicleType === value ? 'is-active' : ''}`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#fbf3dc] text-[#a17c28] ring-1 ring-[#c4a052]/40">
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-classic-display text-[15px] font-semibold leading-tight text-slate-800">{label}</span>
                    <span className="block text-[11px] leading-tight text-slate-500">{desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <JourneyRideOptions vehicleType={effectiveVehicleType} country={pickupCountry.name} value={pickupPreferences} onChange={setPickupPreferences} />

          {areas.length > 0 && (
            <Field label="Saved places" htmlFor="jb-saved-area">
              <select id="jb-saved-area" className="classic-input" value={selectedAreaId} onChange={(e) => setSelectedAreaId(e.target.value)}>
                <option value="">Choose a saved pickup location</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}

          {!selectedAreaId && (
            <div className="space-y-2.5">
              <Field
                label={areas.length > 0 ? 'Or search for a place' : 'Pickup location'}
                htmlFor="jb-pickup-search"
              >
                <input
                  id="jb-pickup-search"
                  className="classic-input"
                  placeholder={`An area, landmark, or address in ${pickupCountry.name}`}
                  value={manualAddress}
                  onChange={(e) => {
                    // Typing invalidates whatever pin/geocode result was
                    // attached to the previous text — a stale one must never
                    // silently get used for the new address.
                    setManualAddress(e.target.value);
                    setManualPickup(null);
                    setPickupSearchResult(null);
                  }}
                />
              </Field>
              <button
                type="button"
                onClick={searchPickupOnMap}
                disabled={!manualAddress.trim() || searchingPickup}
                className="classic-btn classic-btn-outline !min-h-[44px] !text-sm"
              >
                {searchingPickup ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
                {searchingPickup ? 'Searching the map…' : 'Find it on the map'}
              </button>
              {pickupSearchResult && (
                <button
                  type="button"
                  onClick={usePickupSearchResult}
                  className={`classic-tile p-3 ${manualPickup?.lat === pickupSearchResult.lat && manualPickup?.lng === pickupSearchResult.lng ? 'is-active' : ''}`}
                >
                  <span className="flex items-start gap-2.5">
                    <MapPin size={17} className="mt-0.5 shrink-0 text-[#a17c28]" />
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">{manualPickup ? 'Pickup selected ✓' : 'Use this map result'}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{pickupSearchResult.displayName}</span>
                    </span>
                  </span>
                </button>
              )}
            </div>
          )}

          <Field label="Or drop a pin" hint="Same map picker as booking a ride.">
            <div className="overflow-hidden rounded-2xl border border-[#c4a052]/40">
              <LocationPickerMap
                pickup={
                  pickup
                    ? { id: 'journey_pickup', name: pickup.address, area: pickup.address, fullAddress: pickup.address, coordinates: { lat: pickup.lat, lng: pickup.lng } }
                    : null
                }
                dropoff={null}
                onPickupChange={handleMapPickupChange}
                onDropoffChange={() => {}}
              />
            </div>
          </Field>
          </>)}

          <div className="space-y-2">
            <button
              disabled={wantPickupRide && ((!selectedAreaId && !manualAddress.trim()) || geocoding)}
              onClick={goToFlightStep}
              className="classic-btn classic-btn-primary"
            >
              {geocoding ? <Loader2 className="animate-spin" size={18} /> : null}
              {geocoding ? 'Finding your location…' : <>Continue to flights <ArrowRight size={18} /></>}
            </button>
            {wantPickupRide && !selectedAreaId && !manualAddress.trim() && (
              <p className="text-center text-xs text-slate-500">Choose or enter a pickup location to continue.</p>
            )}
          </div>
        </StepCard>
      )}

      {step === 'flight' && (
        <StepCard
          eyebrow="Step 2 of 4"
          title="Choose your flight"
          description="Pick your route and date, and we'll show every airline flying it."
          onBack={() => goToStep('pickup')}
          backLabel="Pickup"
        >
          <AirportPicker
            label="From"
            defaultCountryIso2={pickupCountry.iso2 || 'UG'}
            selectedLabel={originLabel}
            onSelect={(iata, label) => { setOriginIata(iata); setOriginLabel(label); clearFlightResults(); }}
          />
          <AirportPicker
            label="To"
            selectedLabel={destinationLabel}
            onSelect={(iata, label, countryIso2) => {
              setDestinationIata(iata);
              setDestinationLabel(label);
              clearFlightResults();
              const country = COUNTRIES.find((c) => c.iso2 === countryIso2);
              if (country && country.name !== destCountry) {
                setDestCountry(country.name);
                setDestCity('');
                setDestAddress('');
                setDestPin(null);
              }
            }}
          />
          <Field label="Departure date" htmlFor="jb-departure-date">
            <input
              id="jb-departure-date"
              className="classic-input"
              type="date"
              min={todayIsoDate()}
              value={departureDate}
              onChange={(e) => { setDepartureDate(e.target.value); clearFlightResults(); }}
            />
          </Field>
          <CabinPicker
            value={cabinClass}
            disabled={searchingFlights}
            onChange={(cabin) => {
              if (cabin === cabinClass) return;
              setCabinClass(cabin);
              // Cabin changes what airlines offer and charge, so re-run the
              // search for them when they've already searched once.
              if (hasSearched && originIata && destinationIata && departureDate && !searchProblem) runFlightSearch(cabin);
              else clearFlightResults();
            }}
          />
          <Field
            label={partySize > 1 ? 'Extra baggage for everyone (kg) — optional' : 'Extra baggage (kg) — optional'}
            htmlFor="jb-flight-cargo"
            hint={partySize > 1
              ? 'The total weight for the whole party. Each traveller has their own free allowance; only what is beyond all of them is charged, as a per-kg platform surcharge added to your total.'
              : 'Anything beyond the free allowance. Charged as a per-kg platform surcharge, added to your total.'}
          >
            <input
              id="jb-flight-cargo"
              className="classic-input"
              type="number"
              inputMode="decimal"
              min="0"
              placeholder="0"
              value={flightCargoWeightKg}
              onChange={(e) => setFlightCargoWeightKg(e.target.value)}
            />
          </Field>

          <button
            disabled={!originIata || !destinationIata || !departureDate || !!searchProblem || searchingFlights}
            onClick={() => runFlightSearch()}
            className="classic-btn classic-btn-ink"
          >
            {searchingFlights ? <Loader2 className="animate-spin" size={18} /> : <Search size={17} />}
            {searchingFlights ? 'Finding airlines…' : hasSearched ? 'Search again' : 'Find available airlines'}
          </button>
          {searchProblem ? (
            <p role="alert" className="-mt-2 text-center text-xs font-medium text-red-600">{searchProblem}</p>
          ) : (!originIata || !destinationIata || !departureDate) && !searchingFlights ? (
            <p className="-mt-2 text-center text-xs text-slate-500">
              Pick both airports and a date to search.
            </p>
          ) : null}

          {searchingFlights && offers.length === 0 && <FlightSkeleton />}

          <FlightResultsPicker offers={offers} selectedOffer={selectedOffer} onSelect={setSelectedOffer} travellers={partySize} />

          <button
            disabled={!selectedOffer}
            onClick={() => goToStep('destination')}
            className="classic-btn classic-btn-primary"
          >
            {selectedOffer ? <>Continue with {selectedOffer.carrier || 'this flight'} <ArrowRight size={18} /></> : 'Choose a flight to continue'}
          </button>
        </StepCard>
      )}

      {step === 'destination' && (
        <StepCard
          eyebrow="Step 3 of 4"
          title="Where are you headed?"
          description="A driver is dispatched automatically once you land — timed off your actual arrival, and re-timed if your flight is delayed."
          onBack={() => goToStep('flight')}
          backLabel="Flight"
        >
          <div>
            <span className="classic-label">When you land</span>
            <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="What happens when you land">
              {([
                { on: true, label: 'BodaGoEra ride', desc: partySize > 1 ? 'A car is waiting for everyone' : 'A driver is waiting for you' },
                { on: false, label: partySize > 1 ? 'Someone collects us' : 'Someone collects me', desc: partySize > 1 ? 'Own car or a friend picks us up' : 'Own car or a friend picks me up' },
              ] as const).map(({ on, label, desc }) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={wantDropoffRide === on}
                  disabled={on && !ridesAvailable}
                  onClick={() => { setWantDropoffRide(on); setError(null); }}
                  className={`classic-tile p-3 text-left disabled:cursor-not-allowed disabled:opacity-50 ${wantDropoffRide === on ? 'is-active' : ''}`}
                >
                  <span className="block font-classic-display text-[15px] font-semibold leading-tight text-slate-800">{label}</span>
                  <span className="block text-[11px] leading-tight text-slate-500">{desc}</span>
                </button>
              ))}
            </div>
            {!wantDropoffRide && (
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Your flight is booked to {destinationLabel || 'your arrival airport'} and no ride is booked or charged on arrival.
              </p>
            )}
          </div>

          {wantDropoffRide && (<>
          <Field label="Country" htmlFor="jb-dest-country">
            <select
              id="jb-dest-country"
              className="classic-input"
              value={destCountry}
              onChange={(e) => {
                setDestCountry(e.target.value);
                setDestCity('');
                setDestAddress('');
                setDestPin(null);
              }}
            >
              <option value="">Select a country</option>
              {COUNTRIES.map((c) => (
                <option key={c.iso2 || c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="City" htmlFor="jb-dest-city">
            <CitySearchInput
              id="jb-dest-city"
              countryIso2={COUNTRIES.find((c) => c.name === destCountry)?.iso2}
              value={destCity}
              onChange={setDestCity}
            />
          </Field>
          <Field label="Hotel, lodge or address" htmlFor="jb-dest-address">
            <AddressSearchInput
              id="jb-dest-address"
              countryIso2={COUNTRIES.find((c) => c.name === destCountry)?.iso2}
              city={destCity}
              value={destAddress}
              onChange={setDestAddress}
              onSelect={(address, lat, lng) => {
                selectedDestinationAddressRef.current = address;
                setDestAddress(address);
                setDestPin({ lat, lng, address });
              }}
            />
          </Field>

          <button
            type="button"
            onClick={findDestinationOnMap}
            disabled={!destAddress.trim() || findingDestPin}
            className="classic-btn classic-btn-outline !min-h-[44px] !text-sm"
          >
            {findingDestPin ? <Loader2 className="animate-spin" size={16} /> : <MapPin size={16} />}
            {destPin ? 'Re-check location on map' : 'Confirm exact location on map'}
          </button>
          {destPin && (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-2xl border border-[#c4a052]/40">
                <LocationPickerMap
                  pickup={null}
                  dropoff={{ id: 'journey_destination', name: destPin.address, area: destPin.address, fullAddress: destPin.address, coordinates: { lat: destPin.lat, lng: destPin.lng } }}
                  onPickupChange={() => {}}
                  onDropoffChange={handleDestPinChange}
                  autoLocateGPS={false}
                />
              </div>
              <p className="text-xs text-slate-500">
                Drag the pin if it isn't quite right — this is where the driver waiting for you will take you.
              </p>
            </div>
          )}
          </>)}

          <div className="space-y-2">
            <button
              disabled={(wantDropoffRide && (!destCountry || !destAddress)) || quoting}
              onClick={buildQuote}
              className="classic-btn classic-btn-primary"
            >
              {quoting ? <Loader2 className="animate-spin" size={18} /> : null}
              {quoting ? 'Pricing your journey…' : <>See my price <ArrowRight size={18} /></>}
            </button>
            {wantDropoffRide && (!destCountry || !destAddress) && (
              <p className="text-center text-xs text-slate-500">Choose a country and enter where you'll be staying.</p>
            )}
          </div>
        </StepCard>
      )}

      {step === 'review' && quote && (
        <StepCard
          eyebrow="Step 4 of 4"
          title="Review & pay"
          description="Your whole journey, door to door."
          onBack={() => goToStep('destination')}
          backLabel="Arrival"
        >
          <ol>
            {[
              ...(quote.pickupRide !== false
                ? [{ key: 'pickup', icon: <PickupVehicleIcon size={16} />, title: 'Ride to the airport', detail: [pickup?.address, quote.pickupAirport?.name && `→ ${quote.pickupAirport.name}${quote.pickupKm ? ` (${quote.pickupKm} km)` : ''}`, describePreferences(pickupPreferences, effectiveVehicleType).join(', '), 'Driver is sent shortly before you need to leave'].filter(Boolean).join(' · '), ican: quote.pickupIcan, local: quote.local?.pickup, ugx: quote.pickupFareUgx }]
                : []),
              {
                key: 'flight',
                icon: <Plane size={16} />,
                title: `Flight · ${selectedOffer?.carrier || 'Airline'}${partySize > 1 ? ` · ${partySize} travellers` : ''}`,
                detail: [
                  selectedSummary ? `${selectedSummary.departDayLabel} · ${flightLine}` : '',
                  // The airline's own price, so the ICAN figure is traceable.
                  selectedOffer && selectedOffer.totalCurrency !== 'UGX' ? `Airline fare ${Number(selectedOffer.totalAmount).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${selectedOffer.totalCurrency}` : '',
                ].filter(Boolean).join(' · ') || undefined,
                ican: quote.flightIcan,
                local: quote.local?.flight,
                ugx: quote.flightFareUgx,
              },
              ...(quote.cargoFareUgx > 0
                ? [{ key: 'bag', icon: <Package size={16} />, title: 'Extra baggage', detail: `${quote.cargoWeightKg} kg`, ican: quote.cargoIcan, local: quote.local?.cargo, ugx: quote.cargoFareUgx }]
                : []),
              ...(quote.dropoffRide !== false
                ? [{ key: 'dropoff', icon: <Home size={16} />, title: partySize > 1 ? 'Car on arrival' : 'Driver on arrival', detail: destinationLine, ican: quote.dropoffIcan, local: quote.local?.dropoff, ugx: quote.dropoffFareUgx }]
                : []),
            ].map((leg, i, all) => (
              <li key={leg.key} className="relative flex gap-3 pb-5 last:pb-0">
                {i < all.length - 1 && <span aria-hidden className="absolute bottom-0 left-4 top-9 w-px bg-[#c4a052]/40" />}
                <span className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fbf3dc] text-[#a17c28] ring-1 ring-[#c4a052]/50">
                  {leg.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-classic-display text-[15px] font-semibold leading-tight text-slate-800">{leg.title}</p>
                  {leg.detail && <p className="mt-0.5 text-xs leading-snug text-slate-500">{leg.detail}</p>}
                </div>
                <div className="shrink-0 text-right">
                  {/* ICAN first, then the customer's own currency; UGX only
                      when the server didn't send ICAN figures (older API). */}
                  <p className="text-[13px] font-semibold tabular-nums text-slate-800">
                    {leg.ican !== undefined ? `${formatIcan(leg.ican)} ICAN` : `UGX ${leg.ugx.toLocaleString()}`}
                  </p>
                  {leg.ican !== undefined && quote.local && leg.local !== undefined && (
                    <p className="text-[11px] tabular-nums text-slate-500">≈ {formatMoney(leg.local, quote.local.currency)}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <div className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-[#231b12] via-[#2f2415] to-[#4a3418] p-4 text-white shadow-[0_18px_34px_-16px_rgba(0,0,0,0.65)] ring-1 ring-inset ring-[#c4a052]/40">
            <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full border border-[#c4a052]/25" />
            <span aria-hidden className="pointer-events-none absolute -bottom-12 -left-8 h-32 w-32 rounded-full bg-orange-500/20 blur-2xl" />
            <p className="relative text-[10px] font-semibold uppercase tracking-[0.24em] text-[#e6c980]">Total</p>
            <p className="relative mt-1 font-classic-display text-[30px] font-bold leading-none">
              {formatIcan(quote.totalIcan)} <span className="text-[18px] font-semibold text-[#e6c980]">ICAN</span>
            </p>
            <p className="relative mt-1.5 text-[15px] font-medium tabular-nums text-white/90">
              {quote.local ? `≈ ${formatMoney(quote.local.total, quote.local.currency)}` : `≈ UGX ${quote.totalUgx.toLocaleString()}`}
            </p>
            <p className="relative mt-2 text-[12.5px] leading-relaxed text-white/70">
              A fixed price in ICAN, paid in full from your wallet with no tithe.
              {quote.local && ` At today's live value: 1 ICAN = ${formatMoney(quote.local.pricePerIcan, quote.local.currency)}.`}
            </p>
          </div>

          <div className="classic-tile !cursor-default space-y-3 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2.5 text-sm text-slate-600">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[#fbf3dc] text-[#a17c28] ring-1 ring-[#c4a052]/40"><Wallet size={16} /></span>
                ICAN wallet
              </span>
              <span className="text-right font-semibold tabular-nums text-slate-800">
                {checkingBalance ? 'Checking…' : walletIcan !== null ? `${walletIcan.toFixed(4)} ICAN` : '—'}
                {!checkingBalance && walletIcan !== null && quote.local && (
                  <span className="block text-[11px] font-normal text-slate-500">≈ {formatMoney(walletIcan * quote.local.pricePerIcan, quote.local.currency)}</span>
                )}
              </span>
            </div>
            {!checkingBalance && walletIcan !== null && hasEnoughBalance && (
              <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600"><ShieldCheck size={14} /> Your balance covers this journey.</p>
            )}
            {!checkingBalance && walletIcan !== null && !hasEnoughBalance && (
              <div className="space-y-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm text-amber-800">
                  You need {shortfallIcan.toFixed(4)} more ICAN (about UGX {Math.ceil(shortfallIcan * topUpUnitUgx).toLocaleString()} at today's live value) to complete this booking.
                </p>
                <button type="button" disabled={toppingUp} onClick={doTopUp} className="classic-btn classic-btn-ink !min-h-[44px] !text-sm">
                  {toppingUp ? <Loader2 className="animate-spin" size={16} /> : <CreditCard size={16} />}
                  {toppingUp ? 'Processing top-up…' : 'Top up via Flutterwave'}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-3.5">
            <div className="flex items-center gap-3">
              <h4 className="flex items-center gap-2 font-classic-display text-lg font-semibold text-slate-800"><User size={16} /> {partySize > 1 ? 'Traveller details' : 'Passenger details'}</h4>
              <div className="landing-classic-divider flex-1" />
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              {partySize > 1
                ? "Each traveller's name must match their own ID or passport exactly — this books a real seat with the airline for every one of them."
                : "Must match the traveller's ID or passport exactly — this books a real seat with the airline."}
            </p>
            {passengers.map((pax, i) => {
              const id = `jb-pax-${i}`;
              const phoneIntl = phoneFor(i);
              return (
                <fieldset key={i} className={partySize > 1 ? 'space-y-3.5 rounded-2xl border border-[#c4a052]/40 p-3.5' : 'space-y-3.5'}>
                  {partySize > 1 && (
                    <legend className="px-1.5 font-classic-display text-[15px] font-semibold text-slate-800">
                      Traveller {i + 1}{i === 0 ? ' (you)' : ''}
                    </legend>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Title" htmlFor={`${id}-title`}>
                      <select id={`${id}-title`} className="classic-input" value={pax.title} onChange={(e) => {
                        const title = e.target.value as PassengerTitle;
                        // The airline rejects a title that contradicts the gender.
                        const implied = genderForTitle(title);
                        updatePassenger(i, implied ? { title, gender: implied } : { title });
                      }}>
                        <option value="mr">Mr</option>
                        <option value="mrs">Mrs</option>
                        <option value="ms">Ms</option>
                        <option value="miss">Miss</option>
                        <option value="dr">Dr</option>
                      </select>
                    </Field>
                    <Field label="Gender" htmlFor={`${id}-gender`}>
                      <select id={`${id}-gender`} className="classic-input" value={pax.gender} onChange={(e) => {
                        const gender = e.target.value as 'm' | 'f';
                        const implied = genderForTitle(pax.title);
                        updatePassenger(i, implied && implied !== gender ? { gender, title: gender === 'm' ? 'mr' : 'ms' } : { gender });
                      }}>
                        <option value="m">Male</option>
                        <option value="f">Female</option>
                      </select>
                    </Field>
                    <Field label="Given name" htmlFor={`${id}-given`}>
                      <input id={`${id}-given`} className="classic-input" autoComplete={i === 0 ? 'given-name' : 'off'} placeholder="As on passport" value={pax.givenName} onChange={(e) => updatePassenger(i, { givenName: e.target.value })} />
                    </Field>
                    <Field label="Family name" htmlFor={`${id}-family`}>
                      <input id={`${id}-family`} className="classic-input" autoComplete={i === 0 ? 'family-name' : 'off'} placeholder="As on passport" value={pax.familyName} onChange={(e) => updatePassenger(i, { familyName: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="Date of birth" htmlFor={`${id}-dob`}>
                    <input id={`${id}-dob`} className="classic-input" type="date" autoComplete={i === 0 ? 'bday' : 'off'} max={todayIsoDate()} value={pax.dob} onChange={(e) => updatePassenger(i, { dob: e.target.value })} />
                  </Field>
                  <Field label={i === 0 ? 'Phone number' : 'Phone number (optional)'} htmlFor={`${id}-phone`}>
                    <input
                      id={`${id}-phone`}
                      className="classic-input"
                      type="tel"
                      inputMode="tel"
                      autoComplete={i === 0 ? 'tel' : 'off'}
                      placeholder={i === 0 ? '+2567XXXXXXXX' : "Leave blank to use traveller 1's number"}
                      value={pax.phone}
                      onChange={(e) => updatePassenger(i, { phone: e.target.value })}
                    />
                    {pax.phone.trim() && (
                      <p className={`mt-1 text-xs ${phoneIntl ? 'text-emerald-700' : 'text-red-600'}`}>
                        {phoneIntl ? `Will be sent to the airline as ${phoneIntl}` : 'Start with your country code, e.g. +256 7XX XXX XXX'}
                      </p>
                    )}
                  </Field>
                </fieldset>
              );
            })}
          </div>

          <div className="space-y-2">
            <button
              disabled={confirming || !passengerDetailsValid || !hasEnoughBalance}
              onClick={doConfirm}
              className="classic-btn classic-btn-primary"
            >
              {confirming ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle size={18} />}
              {confirming ? 'Booking your journey…' : `Confirm & pay ${quote.totalIcan.toFixed(4)} ICAN`}
            </button>
            {!confirming && !passengerDetailsValid && (
              <p className="text-center text-xs text-slate-500">Complete {partySize > 1 ? "every traveller's" : "the passenger's"} name, date of birth and phone number to continue.</p>
            )}
            {!confirming && passengerDetailsValid && !hasEnoughBalance && (
              <p className="text-center text-xs text-slate-500">Top up your wallet above to continue.</p>
            )}
          </div>
        </StepCard>
      )}

      {step === 'tracking' && (
        <section className="animate-step-in space-y-4">
          <div className="relative overflow-hidden rounded-[20px] bg-gradient-to-br from-[#231b12] via-[#2f2415] to-[#4a3418] p-5 text-white shadow-[0_18px_34px_-16px_rgba(0,0,0,0.65)] ring-1 ring-inset ring-[#c4a052]/40">
            <span aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full border border-[#c4a052]/25" />
            <div className="relative flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/5 ring-1 ring-[#c4a052]/50">
                <CheckCircle size={22} className="text-[#e6c980]" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#e6c980]">
                  {journey ? 'Booked' : 'Booking'}
                </p>
                <h3 className="font-classic-display text-[22px] font-bold leading-tight">Your journey</h3>
              </div>
            </div>
            {journey && bookingKind === 'fly' && journey.legs.some((l) => l.leg_type === 'flight' && l.flight_booking) && (
              <div className="relative mt-4">
                <AirTicketButton
                  journeyId={journey.id}
                  className="classic-btn !min-h-[42px] w-full !text-[13px] text-[#f6e7bd] ring-1 ring-inset ring-[#c4a052]/50 hover:bg-white/5"
                />
              </div>
            )}
            {journey && bookingKind === 'ship' && (
              <button
                type="button"
                onClick={() => {
                  printShipTicket({
                    shipperName: customerName,
                    journeyId: journey.id,
                    cargoDescription: cargoDescription.trim() || null,
                    cargoWeightKg: shipCargoWeightKg ? Number(shipCargoWeightKg) : null,
                    pickupAddress: shipPickup?.address || '',
                    pickupCountry: shipPickupCountry?.name || '',
                    dropoffAddress: shipDropoff?.address || '',
                    dropoffCountry: shipDropoffCountry?.name || '',
                  });
                }}
                className="classic-btn relative mt-4 !min-h-[42px] !text-[13px] text-[#f6e7bd] ring-1 ring-inset ring-[#c4a052]/50 hover:bg-white/5"
              >
                <Printer size={15} /> Print shipping waybill
              </button>
            )}
          </div>

          {!journey ? (
            trackingError ? (
              <div className="classic-card space-y-2 p-5 text-center text-sm text-slate-600" role="alert">
                <p className="font-semibold text-slate-800">Your booking is placed — we just can't load its status right now.</p>
                <p>It is safe to leave this page; you'll find it under My Journeys in the Orders tab of your dashboard.</p>
              </div>
            ) : (
              <div className="classic-card flex items-center justify-center gap-2 p-6 text-sm text-slate-500" role="status">
                <Loader2 className="animate-spin" size={18} /> Getting your journey…
              </div>
            )
          ) : (
            <div className="space-y-3">
              {bookingKind === 'ship' && journey.total_fare_ican > 0 && (
                <div className="flex justify-between gap-3 rounded-2xl border border-[#c4a052]/40 bg-[#fbf3dc] p-3.5 text-sm text-[#5c4410]">
                  <span>Charged automatically from your ICAN wallet</span>
                  <span className="shrink-0 font-semibold tabular-nums">{journey.total_fare_ican.toFixed(4)} ICAN (UGX {journey.total_fare_ugx.toLocaleString()})</span>
                </div>
              )}
              <ol className="classic-card p-4">
                {[...journey.legs].sort((a, b) => a.leg_order - b.leg_order).map((leg, i, all) => {
                  const rider = leg.ride?.rider;
                  const LegIcon = legIcon[leg.leg_type] || MapPin;
                  return (
                    <li key={leg.id} className="relative flex gap-3 pb-5 last:pb-0">
                      {i < all.length - 1 && <span aria-hidden className="absolute bottom-0 left-4 top-9 w-px bg-[#c4a052]/40" />}
                      <span className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fbf3dc] text-[#a17c28] ring-1 ring-[#c4a052]/50">
                        <LegIcon size={16} />
                      </span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-classic-display text-[15px] font-semibold leading-tight text-slate-800">{legLabel[leg.leg_type]}</p>
                            {leg.flight_booking?.pnr && (
                              <p className="mt-0.5 text-xs text-slate-500">Booking reference <span className="font-semibold tracking-wider text-slate-700">{leg.flight_booking.pnr}</span></p>
                            )}
                          </div>
                          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${legStatusClass(leg.status)}`}>
                            {leg.status.replace(/_/g, ' ')}
                          </span>
                        </div>
                        {rider && (
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#c4a052]/30 bg-[#fdf8ea] p-3 text-sm dark:bg-[#c4a052]/10">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-slate-800">{rider.user?.profile?.full_name || 'Your driver'}</p>
                              <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                                <Car size={13} className="shrink-0" />
                                <span className="truncate">{rider.vehicle_type} · {rider.vehicle_color || ''} {rider.vehicle_model || ''} · {rider.plate_number}</span>
                              </p>
                            </div>
                            <div className="shrink-0 space-y-1 text-right">
                              <p className="flex items-center justify-end gap-1 font-semibold text-amber-600"><Star size={13} fill="currentColor" /> {Number(rider.rating || 0).toFixed(1)}</p>
                              {rider.user?.phone && (
                                <a href={`tel:${rider.user.phone}`} className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600"><Phone size={13} /> Call</a>
                              )}
                            </div>
                          </div>
                        )}
                        <JourneyLegRideActions leg={leg} customerId={customerId} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// Resolves a typed city/airport name to a real IATA code (Duffel Places API,
// via searchAirports) so a customer never has to know/type one themselves.
function AirportPicker({
  label,
  defaultCountryIso2,
  selectedLabel,
  onSelect,
}: {
  label: string;
  defaultCountryIso2?: string;
  selectedLabel: string | null;
  onSelect: (iataCode: string, displayLabel: string, countryIso2?: string) => void;
}) {
  const [countryIso2, setCountryIso2] = useState(defaultCountryIso2 || 'UG');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AirportSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadCountryAirports = async (iso2: string, open = true) => {
    const country = COUNTRIES.find((c) => c.iso2 === iso2);
    if (!country) return;

    setLoading(true);
    try {
      // Load the country's airports immediately; the input remains available
      // for narrowing the results by city or airport name.
      const { airports } = await searchAirports(country.name, iso2);
      setSuggestions(airports);
      setShowSuggestions(open);
    } catch {
      setSuggestions([]);
      setShowSuggestions(open);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Only open the list straight away when there's nothing chosen yet —
    // otherwise (e.g. the Entebbe default) it just hides what's selected.
    loadCountryAirports(countryIso2, !selectedLabel);
    // The initial airport list is driven by the selected country.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const { airports } = await searchAirports(query.trim(), countryIso2 || undefined);
        setSuggestions(airports);
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, countryIso2]);

  return (
    <div className="space-y-2">
      <span className="classic-label !mb-0">{label}</span>
      <div className="grid grid-cols-2 gap-2">
        <select
          aria-label={`${label} — country`}
          className="classic-input !text-sm"
          value={countryIso2}
          onChange={(e) => {
            const nextIso2 = e.target.value;
            setCountryIso2(nextIso2);
            setQuery('');
            setSuggestions([]);
            setShowSuggestions(true);
            onSelect('', '');
            loadCountryAirports(nextIso2);
          }}
        >
          {COUNTRIES.map((c) => (
            <option key={c.iso2 || c.name} value={c.iso2}>{c.name}</option>
          ))}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            aria-label={`${label} — city or airport`}
            className="classic-input !pl-9 !text-sm"
            placeholder="City or airport"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              if (query.trim().length >= 2) setShowSuggestions(true);
              // Focus with nothing typed browses the country's airports.
              else if (suggestions.length === 0) loadCountryAirports(countryIso2);
              else setShowSuggestions(true);
            }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          />
        </div>
      </div>
      {selectedLabel && !showSuggestions && (
        <p className="flex items-center gap-1.5 rounded-lg bg-[#fbf3dc] px-3 py-2 text-xs font-semibold text-[#5c4410]">
          <Plane size={13} className="shrink-0 text-[#a17c28]" /> {selectedLabel}
        </p>
      )}
      {showSuggestions && (
        <div className="max-h-56 overflow-y-auto rounded-xl border border-[#c4a052]/40 bg-white shadow-lg">
          {loading && <div className="p-3 text-xs text-slate-500">Searching…</div>}
          {!loading && suggestions.length === 0 && (
            <div className="p-3 text-xs text-slate-500">No airports found</div>
          )}
          {suggestions.map((a) => (
            <button
              key={a.iataCode}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(a.iataCode, `${a.name} (${a.iataCode})${a.cityName ? ` — ${a.cityName}` : ''}`, a.countryCode);
                setQuery('');
                setShowSuggestions(false);
              }}
              className="w-full border-b border-slate-100 px-3 py-2.5 text-left text-sm hover:bg-[#fbf3dc] focus-visible:bg-[#fbf3dc] focus-visible:outline-none last:border-b-0"
            >
              <div className="font-medium text-slate-800">{a.name} ({a.iataCode})</div>
              {a.cityName && <div className="text-xs text-slate-500">{a.cityName}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddressSearchInput({
  id,
  countryIso2,
  city,
  value,
  onChange,
  onSelect,
}: {
  id?: string;
  countryIso2?: string;
  city: string;
  value: string;
  onChange: (value: string) => void;
  onSelect: (address: string, lat: number, lng: number) => void;
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!countryIso2 || value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        setSuggestions(await searchAddresses(value.trim(), countryIso2, city));
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 450);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, countryIso2, city]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
      <input
        id={id}
        className="classic-input !pl-9"
        placeholder={countryIso2 ? 'Hotel, lodge or street address' : 'Select a country first'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => value.trim().length >= 2 && setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
        disabled={!countryIso2}
      />
      {showSuggestions && (
        <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-[#c4a052]/40 bg-white shadow-lg">
          {loading && <div className="p-3 text-xs text-slate-500">Searching hotels and addresses…</div>}
          {!loading && suggestions.length === 0 && value.trim().length >= 2 && (
            <div className="p-3 text-xs text-slate-500">No matching hotel found — you can still type the address</div>
          )}
          {suggestions.map((a, i) => (
            <button
              key={`${a.displayName}-${i}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(a.displayName, a.lat, a.lng);
                setShowSuggestions(false);
              }}
              className="w-full border-b border-slate-100 px-3 py-2.5 text-left text-sm hover:bg-[#fbf3dc] focus-visible:bg-[#fbf3dc] focus-visible:outline-none last:border-b-0"
            >
              <div className="font-medium text-slate-800">{a.name}</div>
              <div className="text-xs text-slate-500 truncate">{a.displayName}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Real city/town/village autocomplete (Nominatim, free — see geocodeService's
// searchCities) scoped to whichever country was selected, so "get their
// cities" works for any of the ~195 countries in data/countries.ts, not
// just a hardcoded shortlist. Free typing is still allowed — a suggestion
// just makes it a real, spellchecked place name.
function CitySearchInput({
  id,
  countryIso2,
  value,
  onChange,
}: {
  id?: string;
  countryIso2?: string;
  value: string;
  onChange: (cityName: string) => void;
}) {
  const [suggestions, setSuggestions] = useState<CitySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        setSuggestions(await searchCities(value.trim(), countryIso2));
        setShowSuggestions(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, countryIso2]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
      <input
        id={id}
        className="classic-input !pl-9"
        placeholder="City (e.g. New York)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => value.trim().length >= 2 && setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
      />
      {showSuggestions && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-[#c4a052]/40 bg-white shadow-lg">
          {loading && <div className="p-3 text-xs text-slate-500">Searching…</div>}
          {!loading && suggestions.length === 0 && value.trim().length >= 2 && (
            <div className="p-3 text-xs text-slate-500">No cities found — you can still type your own</div>
          )}
          {suggestions.map((c, i) => (
            <button
              key={`${c.name}-${i}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(c.name);
                setShowSuggestions(false);
              }}
              className="w-full border-b border-slate-100 px-3 py-2.5 text-left text-sm hover:bg-[#fbf3dc] focus-visible:bg-[#fbf3dc] focus-visible:outline-none last:border-b-0"
            >
              <div className="font-medium text-slate-800">{c.name}</div>
              <div className="text-xs text-slate-500 truncate">{c.displayName}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
