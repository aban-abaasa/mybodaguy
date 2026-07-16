import { useEffect, useRef, useState } from 'react';
import { MapPin, Plane, Home, CreditCard, CheckCircle, Loader2, Star, Phone, Car, Search, Bike, Ship, Package, Printer, User } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import {
  searchFlights, searchAirports, getJourneyQuote, confirmJourney, pollJourney, requestShipCargoJourney,
  type FlightOffer, type Journey, type JourneyQuote, type AirportSuggestion,
} from '../services/journeyService';
import { geocodeAddress, reverseGeocodeCountry, searchCities, type CountryLookup, type CitySuggestion } from '../services/geocodeService';
import { printFlightTicket, printShipTicket } from '../services/printTicket';
import { getBalance, ICAN_TO_UGX, formatICAN, SOURCE_APP } from '../services/icanWalletService';
import { payWithFlutterwave, generateTxRef } from '../services/flutterwaveClient';
import LocationPickerMap from './LocationPickerMap';
import type { Location } from '../data/mockLocations';
import { COUNTRIES } from '../data/countries';

interface JourneyBookingFlowProps {
  customerId: string;
}

interface CustomerArea {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

type BookingKind = 'fly' | 'ship';
type Step = 'pickup' | 'flight' | 'destination' | 'review' | 'confirming' | 'tracking' | 'ship-details';

const legLabel: Record<string, string> = {
  local_pickup: 'Boda to the airport',
  flight: 'Flight',
  local_dropoff: 'Driver to your final address',
  road_leg: 'Road transport',
  sea_leg: 'Sea crossing',
};

export default function JourneyBookingFlow({ customerId }: JourneyBookingFlowProps) {
  const [bookingKind, setBookingKind] = useState<BookingKind>('fly');
  const [step, setStep] = useState<Step>('pickup');
  const [error, setError] = useState<string | null>(null);

  const changeBookingKind = (kind: BookingKind) => {
    setBookingKind(kind);
    setStep(kind === 'fly' ? 'pickup' : 'ship-details');
    setError(null);
  };

  // Ship Cargo mode — a separate, simpler direct-book flow (no flight
  // search): pickup + destination pins, what's being shipped, submit.
  const [shipPickup, setShipPickup] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [shipPickupCountry, setShipPickupCountry] = useState<CountryLookup | null>(null);
  const [shipDropoff, setShipDropoff] = useState<{ lat: number; lng: number; address: string } | null>(null);
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
    setSubmittingShip(true);
    try {
      const result = await requestShipCargoJourney({
        pickupLocation: shipPickup.address, pickupLat: shipPickup.lat, pickupLng: shipPickup.lng, pickupCountry: shipPickupCountry.name,
        dropoffLocation: shipDropoff.address, dropoffLat: shipDropoff.lat, dropoffLng: shipDropoff.lng, dropoffCountry: shipDropoffCountry.name,
        cargoDescription: cargoDescription.trim() || undefined,
        cargoWeightKg: shipCargoWeightKg ? Number(shipCargoWeightKg) : undefined,
      });
      if (!result.success || !result.journeyId) {
        setError(result.error || 'Could not book this shipment');
        return;
      }
      setStep('tracking');
      pollJourney(result.journeyId, setJourney);
    } catch (err: any) {
      setError(err.message || 'Could not book this shipment');
    } finally {
      setSubmittingShip(false);
    }
  };

  const [areas, setAreas] = useState<CustomerArea[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [manualPickup, setManualPickup] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const [pickupVehicleType, setPickupVehicleType] = useState<'motorcycle' | 'car'>('motorcycle');
  // Which country the journey actually STARTS in — was hardcoded to
  // 'Uganda' throughout (geocoding, quote, and the leg mbg_dispatch_journey_leg
  // matches against), even though the backend (mbg_find_available_vehicles,
  // gated on r.service_countries) already supports any country. Defaults to
  // Uganda since that's the primary market, but is now a real customer choice.
  const [pickupCountry, setPickupCountry] = useState(COUNTRIES[0]);

  const [originIata, setOriginIata] = useState('EBB');
  const [originLabel, setOriginLabel] = useState<string | null>('Entebbe International Airport (EBB)');
  const [destinationIata, setDestinationIata] = useState('');
  const [destinationLabel, setDestinationLabel] = useState<string | null>(null);
  const [departureDate, setDepartureDate] = useState('');
  const [flightCargoWeightKg, setFlightCargoWeightKg] = useState('');
  const [searchingFlights, setSearchingFlights] = useState(false);
  const [offers, setOffers] = useState<FlightOffer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<FlightOffer | null>(null);

  const [destCountry, setDestCountry] = useState('');
  const [destCity, setDestCity] = useState('');
  const [destAddress, setDestAddress] = useState('');
  const [destPin, setDestPin] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const [findingDestPin, setFindingDestPin] = useState(false);

  const [quote, setQuote] = useState<JourneyQuote | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [journey, setJourney] = useState<Journey | null>(null);
  const [customerName, setCustomerName] = useState('Customer');

  // Real traveler details — must match the passenger's ID/passport, since
  // this books an actual seat with a real airline via Duffel.
  const [passengerTitle, setPassengerTitle] = useState<'mr' | 'mrs' | 'ms' | 'miss' | 'dr'>('mr');
  const [passengerGender, setPassengerGender] = useState<'m' | 'f'>('m');
  const [passengerGivenName, setPassengerGivenName] = useState('');
  const [passengerFamilyName, setPassengerFamilyName] = useState('');
  const [passengerDob, setPassengerDob] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');
  const passengerDetailsValid =
    passengerGivenName.trim().length > 0 &&
    passengerFamilyName.trim().length > 0 &&
    !!passengerDob &&
    passengerPhone.trim().length >= 7;

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
  const hasEnoughBalance = walletIcan === null ? true : shortfallIcan <= 0;

  const doTopUp = async () => {
    if (!quote || shortfallIcan <= 0) return;
    setError(null);
    setToppingUp(true);
    try {
      const { data: authUser } = await supabase.auth.getUser();
      const email = authUser?.user?.email;
      // Round up to whole shillings, and up to at least the platform's
      // minimum purchase, so a fractional shortfall still clears Flutterwave
      // and buy_ican_coins' own minimum-amount expectations.
      const ugxAmount = Math.max(ICAN_TO_UGX, Math.ceil(shortfallIcan * ICAN_TO_UGX));
      const icanAmount = ugxAmount / ICAN_TO_UGX;
      const txRef = generateTxRef('MBGJ-TOPUP');

      const payment = await payWithFlutterwave({
        amount: ugxAmount,
        currency: 'UGX',
        customerEmail: email,
        customerPhone: passengerPhone.trim() || undefined,
        customerName: `${passengerGivenName} ${passengerFamilyName}`.trim() || customerName,
        title: 'BodaGo Journey — Top up ICAN',
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
    setPassengerGivenName((prev) => prev || parts[0] || '');
    setPassengerFamilyName((prev) => prev || parts.slice(1).join(' '));
  }, [customerName]);

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
    setDestPin(null);
  }, [destAddress, destCity, destCountry]);

  const handleMapPickupChange = (location: Location) => {
    setSelectedAreaId('');
    setManualAddress(location.fullAddress);
    setManualPickup({ lat: location.coordinates.lat, lng: location.coordinates.lng, address: location.fullAddress });
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

  const runFlightSearch = async () => {
    setError(null);
    setSearchingFlights(true);
    try {
      const { offers } = await searchFlights({ originIata, destinationIata, departureDate, passengerCount: 1 });
      setOffers(offers);
      if (offers.length === 0) setError('No flights found for that route/date.');
    } catch (err: any) {
      setError(err.message || 'Flight search failed');
    } finally {
      setSearchingFlights(false);
    }
  };

  const buildQuote = async () => {
    if (!pickup || !selectedOffer) return;
    setError(null);
    try {
      const { quote } = await getJourneyQuote({
        customerUserId: customerId,
        pickup: { ...pickup, country: pickupCountry.name, vehicleType: pickupVehicleType },
        offer: selectedOffer,
        destination: { address: destAddress, country: destCountry, city: destCity, lat: destPin?.lat ?? null, lng: destPin?.lng ?? null },
        cargoWeightKg: flightCargoWeightKg ? Number(flightCargoWeightKg) : undefined,
      });
      setQuote(quote);
      setStep('review');
    } catch (err: any) {
      setError(err.message || 'Could not build a quote');
    }
  };

  const doConfirm = async () => {
    if (!quote) return;
    const passengerId = quote.offer.passengers?.[0]?.id;
    if (!passengerId) {
      setError('This flight offer has expired — please search flights again.');
      return;
    }
    if (!passengerDetailsValid) {
      setError('Please fill in the passenger\'s full name, date of birth and phone number.');
      return;
    }
    if (!hasEnoughBalance) {
      setError('Top up your ICAN wallet before confirming this booking.');
      return;
    }
    setConfirming(true);
    setError(null);
    try {
      const { data: authUser } = await supabase.auth.getUser();
      const email = authUser?.user?.email || '';
      const { journeyId } = await confirmJourney({
        customerUserId: customerId,
        quote,
        passengers: [{
          id: passengerId, type: 'adult', title: passengerTitle,
          given_name: passengerGivenName.trim(), family_name: passengerFamilyName.trim(),
          born_on: passengerDob, gender: passengerGender, email, phone_number: passengerPhone.trim(),
        }],
      });
      setStep('tracking');
      pollJourney(journeyId, setJourney);
    } catch (err: any) {
      setError(err.message || 'Journey confirmation failed');
      setStep('review');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-slate-800 flex items-center justify-center gap-2">
          <Plane className="text-orange-500" /> Book a full journey
        </h2>
        <p className="text-slate-500 text-sm mt-1">Boda to the airport, a real flight, and a driver waiting when you land.</p>
      </div>

      {step !== 'tracking' && step !== 'confirming' && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => changeBookingKind('fly')}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all ${
              bookingKind === 'fly' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
            }`}
          >
            <Plane size={16} /> Fly
          </button>
          <button
            type="button"
            onClick={() => changeBookingKind('ship')}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all ${
              bookingKind === 'ship' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
            }`}
          >
            <Ship size={16} /> Ship Cargo
          </button>
        </div>
      )}

      {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg p-3">{error}</div>}

      {step === 'ship-details' && (
        <div className="space-y-4">
          <h3 className="font-semibold text-slate-700 flex items-center gap-2"><Package size={18} /> What are you shipping?</h3>
          <p className="text-xs text-slate-500">
            For real overseas cargo — pickup and destination in different countries not reachable by road.
            Routed automatically via a real seaport when needed.
          </p>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Pickup location</label>
            <LocationPickerMap
              pickup={shipPickup ? { id: 'ship_pickup', name: shipPickup.address, area: shipPickup.address, fullAddress: shipPickup.address, coordinates: { lat: shipPickup.lat, lng: shipPickup.lng } } : null}
              dropoff={shipDropoff ? { id: 'ship_dropoff', name: shipDropoff.address, area: shipDropoff.address, fullAddress: shipDropoff.address, coordinates: { lat: shipDropoff.lat, lng: shipDropoff.lng } } : null}
              onPickupChange={(loc) => setShipPickup({ lat: loc.coordinates.lat, lng: loc.coordinates.lng, address: loc.fullAddress })}
              onDropoffChange={(loc) => setShipDropoff({ lat: loc.coordinates.lat, lng: loc.coordinates.lng, address: loc.fullAddress })}
            />
            <p className="text-xs text-slate-500 mt-1">Tap the map to set the destination, drag either pin to fine-tune.</p>
          </div>

          {(shipPickupCountry || shipDropoffCountry) && (
            <p className="text-xs text-slate-500">
              {shipPickupCountry?.name || '…'} → {shipDropoffCountry?.name || '…'}
            </p>
          )}

          <input
            className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400"
            placeholder="What's in the shipment? (e.g. furniture, textiles)"
            value={cargoDescription}
            onChange={(e) => setCargoDescription(e.target.value)}
          />
          <input
            className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400"
            type="number"
            min="0"
            placeholder="Total weight (kg)"
            value={shipCargoWeightKg}
            onChange={(e) => setShipCargoWeightKg(e.target.value)}
          />
          <p className="text-xs text-slate-500">Weight is used to match a vehicle that can actually carry the load.</p>

          <button
            disabled={!shipPickup || !shipDropoff || !shipPickupCountry || !shipDropoffCountry || submittingShip}
            onClick={submitShipCargo}
            className="w-full bg-orange-500 disabled:bg-slate-300 text-white rounded-lg py-3 font-semibold flex items-center justify-center gap-2"
          >
            {submittingShip ? <Loader2 className="animate-spin" size={18} /> : <Ship size={18} />}
            {submittingShip ? 'Booking…' : 'Ship this cargo'}
          </button>
        </div>
      )}

      {bookingKind === 'fly' && step === 'pickup' && (
        <div className="space-y-4">
          <h3 className="font-semibold text-slate-700 flex items-center gap-2"><MapPin size={18} /> Pickup</h3>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Which country are you starting from?</label>
            <select
              className="w-full border rounded-lg p-3 bg-white text-slate-900"
              value={pickupCountry.iso2}
              onChange={(e) => {
                const next = COUNTRIES.find((c) => c.iso2 === e.target.value) || COUNTRIES[0];
                setPickupCountry(next);
                // A pickup address/pin found under the old country no longer
                // applies once the country itself changes.
                setManualPickup(null);
                setSelectedAreaId('');
              }}
            >
              {COUNTRIES.map((c) => (
                <option key={c.iso2 || c.name} value={c.iso2}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Ride to the airport</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPickupVehicleType('motorcycle')}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all ${
                  pickupVehicleType === 'motorcycle' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
                }`}
              >
                <Bike size={16} /> Bike
              </button>
              <button
                type="button"
                onClick={() => setPickupVehicleType('car')}
                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all ${
                  pickupVehicleType === 'car' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
                }`}
              >
                <Car size={16} /> Car
              </button>
            </div>
          </div>

          {areas.length > 0 && (
            <select className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400" value={selectedAreaId} onChange={(e) => setSelectedAreaId(e.target.value)}>
              <option value="">Select a saved pickup location</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          {!selectedAreaId && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                {areas.length > 0 ? 'Or enter your pickup location:' : 'No saved areas yet — enter your pickup location:'}
              </p>
              <input
                className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400"
                placeholder="e.g. Ntinda, Kampala"
                value={manualAddress}
                onChange={(e) => {
                  // Typing invalidates whatever pin/geocode result was
                  // attached to the previous text — a stale one must never
                  // silently get used for the new address.
                  setManualAddress(e.target.value);
                  setManualPickup(null);
                }}
              />
            </div>
          )}
          <p className="text-xs text-slate-500">Or drop a pin — same map picker as booking a ride:</p>
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
          <button
            disabled={(!selectedAreaId && !manualAddress.trim()) || geocoding}
            onClick={goToFlightStep}
            className="w-full bg-orange-500 disabled:bg-slate-300 text-white rounded-lg py-3 font-semibold flex items-center justify-center gap-2"
          >
            {geocoding ? <Loader2 className="animate-spin" size={18} /> : null}
            {geocoding ? 'Finding your location…' : 'Next: choose your flight'}
          </button>
        </div>
      )}

      {step === 'flight' && (
        <div className="space-y-4">
          <h3 className="font-semibold text-slate-700 flex items-center gap-2"><Plane size={18} /> Flight</h3>
          <AirportPicker
            label="From"
            defaultCountryIso2={pickupCountry.iso2 || 'UG'}
            selectedLabel={originLabel}
            onSelect={(iata, label) => { setOriginIata(iata); setOriginLabel(label); }}
          />
          <AirportPicker
            label="To"
            selectedLabel={destinationLabel}
            onSelect={(iata, label) => { setDestinationIata(iata); setDestinationLabel(label); }}
          />
          <input className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400" type="date" value={departureDate} onChange={(e) => setDepartureDate(e.target.value)} />
          <div>
            <input
              className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400"
              type="number"
              min="0"
              placeholder="Extra baggage/cargo beyond the free allowance (kg, optional)"
              value={flightCargoWeightKg}
              onChange={(e) => setFlightCargoWeightKg(e.target.value)}
            />
            <p className="text-xs text-slate-500 mt-1">Charged as a per-kg platform surcharge, added to your total below.</p>
          </div>
          <button
            disabled={!originIata || !destinationIata || !departureDate || searchingFlights}
            onClick={runFlightSearch}
            className="w-full bg-slate-800 disabled:bg-slate-300 text-white rounded-lg py-3 font-semibold flex items-center justify-center gap-2"
          >
            {searchingFlights ? <Loader2 className="animate-spin" size={18} /> : null}
            Search flights
          </button>

          {offers.length > 0 && (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {offers.map((offer) => (
                <button
                  key={offer.offerId}
                  onClick={() => setSelectedOffer(offer)}
                  className={`w-full text-left border rounded-lg p-3 ${selectedOffer?.offerId === offer.offerId ? 'border-orange-500 bg-orange-50' : 'border-slate-200'}`}
                >
                  <div className="flex justify-between">
                    <span className="font-medium">{offer.carrier}</span>
                    <span className="font-semibold">{offer.totalAmount} {offer.totalCurrency}</span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <button
            disabled={!selectedOffer}
            onClick={() => setStep('destination')}
            className="w-full bg-orange-500 disabled:bg-slate-300 text-white rounded-lg py-3 font-semibold"
          >
            Next: where you're staying
          </button>
        </div>
      )}

      {step === 'destination' && (
        <div className="space-y-4">
          <h3 className="font-semibold text-slate-700 flex items-center gap-2"><Home size={18} /> Final destination</h3>
          <select
            className="w-full border rounded-lg p-3 bg-white text-slate-900"
            value={destCountry}
            onChange={(e) => { setDestCountry(e.target.value); setDestCity(''); }}
          >
            <option value="">Select a country</option>
            {COUNTRIES.map((c) => (
              <option key={c.iso2 || c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          <CitySearchInput
            countryIso2={COUNTRIES.find((c) => c.name === destCountry)?.iso2}
            value={destCity}
            onChange={setDestCity}
          />
          <input className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400" placeholder="Hotel / room address" value={destAddress} onChange={(e) => setDestAddress(e.target.value)} />
          <p className="text-xs text-slate-500">A driver is dispatched automatically once you land — timed off your actual arrival, and re-timed automatically if your flight is delayed.</p>

          <button
            type="button"
            onClick={findDestinationOnMap}
            disabled={!destAddress.trim() || findingDestPin}
            className="w-full border-2 border-orange-300 text-orange-700 rounded-lg py-2.5 font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {findingDestPin ? <Loader2 className="animate-spin" size={16} /> : <MapPin size={16} />}
            {destPin ? 'Re-check location on map' : 'Confirm exact location on map'}
          </button>
          {destPin && (
            <div className="space-y-2">
              <LocationPickerMap
                pickup={null}
                dropoff={{ id: 'journey_destination', name: destPin.address, area: destPin.address, fullAddress: destPin.address, coordinates: { lat: destPin.lat, lng: destPin.lng } }}
                onPickupChange={() => {}}
                onDropoffChange={handleDestPinChange}
                autoLocateGPS={false}
              />
              <p className="text-xs text-slate-500">
                Drag the pin if it isn't quite right — this is what the driver waiting for you on arrival will be sent to.
              </p>
            </div>
          )}

          <button
            disabled={!destCountry || !destAddress}
            onClick={buildQuote}
            className="w-full bg-orange-500 disabled:bg-slate-300 text-white rounded-lg py-3 font-semibold"
          >
            Get my price
          </button>
        </div>
      )}

      {step === 'review' && quote && (
        <div className="space-y-4">
          <h3 className="font-semibold text-slate-700 flex items-center gap-2"><CreditCard size={18} /> Review & pay</h3>
          <div className="border rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between"><span>Boda to airport</span><span>UGX {quote.pickupFareUgx.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>Flight ({selectedOffer?.carrier})</span><span>UGX {quote.flightFareUgx.toLocaleString()}</span></div>
            {quote.cargoFareUgx > 0 && (
              <div className="flex justify-between"><span>Extra baggage ({quote.cargoWeightKg} kg)</span><span>UGX {quote.cargoFareUgx.toLocaleString()}</span></div>
            )}
            <div className="flex justify-between"><span>Driver at destination</span><span>UGX {quote.dropoffFareUgx.toLocaleString()}</span></div>
            <div className="flex justify-between font-semibold border-t pt-2"><span>Total</span><span>UGX {quote.totalUgx.toLocaleString()} ({quote.totalIcan.toFixed(4)} ICAN)</span></div>
          </div>
          <p className="text-xs text-slate-500">Paid in full from your ICAN wallet — no tithe on journey payments.</p>

          <div className="border rounded-lg p-3 text-sm flex items-center justify-between">
            <span className="text-slate-500">Wallet balance</span>
            <span className="font-semibold">
              {checkingBalance ? 'Checking…' : walletIcan !== null ? `${walletIcan.toFixed(4)} ICAN` : '—'}
            </span>
          </div>

          {!checkingBalance && walletIcan !== null && !hasEnoughBalance && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <p className="text-sm text-amber-800">
                You need {shortfallIcan.toFixed(4)} more ICAN (about UGX {Math.ceil(shortfallIcan * ICAN_TO_UGX).toLocaleString()}) to complete this booking.
              </p>
              <button
                type="button"
                disabled={toppingUp}
                onClick={doTopUp}
                className="w-full bg-amber-500 disabled:bg-slate-300 text-white rounded-lg py-2.5 font-semibold text-sm flex items-center justify-center gap-2"
              >
                {toppingUp ? <Loader2 className="animate-spin" size={16} /> : <CreditCard size={16} />}
                {toppingUp ? 'Processing top-up…' : 'Top up via Flutterwave'}
              </button>
            </div>
          )}

          <div className="space-y-3 border-t pt-4">
            <h4 className="font-semibold text-slate-700 flex items-center gap-2"><User size={16} /> Passenger details</h4>
            <p className="text-xs text-slate-500">Must match the traveler's ID/passport exactly — this books a real seat with the airline.</p>
            <div className="grid grid-cols-2 gap-2">
              <select
                className="border rounded-lg p-2.5 bg-white text-slate-900 text-sm"
                value={passengerTitle}
                onChange={(e) => setPassengerTitle(e.target.value as typeof passengerTitle)}
              >
                <option value="mr">Mr</option>
                <option value="mrs">Mrs</option>
                <option value="ms">Ms</option>
                <option value="miss">Miss</option>
                <option value="dr">Dr</option>
              </select>
              <select
                className="border rounded-lg p-2.5 bg-white text-slate-900 text-sm"
                value={passengerGender}
                onChange={(e) => setPassengerGender(e.target.value as 'm' | 'f')}
              >
                <option value="m">Male</option>
                <option value="f">Female</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                className="border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400"
                placeholder="Given name"
                value={passengerGivenName}
                onChange={(e) => setPassengerGivenName(e.target.value)}
              />
              <input
                className="border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400"
                placeholder="Family name"
                value={passengerFamilyName}
                onChange={(e) => setPassengerFamilyName(e.target.value)}
              />
            </div>
            <input
              className="w-full border rounded-lg p-3 bg-white text-slate-900"
              type="date"
              value={passengerDob}
              onChange={(e) => setPassengerDob(e.target.value)}
            />
            <input
              className="w-full border rounded-lg p-3 bg-white text-slate-900 placeholder-slate-400"
              type="tel"
              placeholder="Phone number (e.g. +2567XXXXXXXX)"
              value={passengerPhone}
              onChange={(e) => setPassengerPhone(e.target.value)}
            />
          </div>

          <button
            disabled={confirming || !passengerDetailsValid || !hasEnoughBalance}
            onClick={doConfirm}
            className="w-full bg-orange-500 disabled:bg-slate-300 text-white rounded-lg py-3 font-semibold flex items-center justify-center gap-2"
          >
            {confirming ? <Loader2 className="animate-spin" size={18} /> : <CheckCircle size={18} />}
            Confirm & pay {quote.totalIcan.toFixed(4)} ICAN
          </button>
        </div>
      )}

      {step === 'tracking' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-700">Your journey</h3>
            {journey && bookingKind === 'fly' && (
              <button
                type="button"
                onClick={() => {
                  const flightLeg = journey.legs.find((l) => l.leg_type === 'flight');
                  printFlightTicket({
                    passengerName: `${passengerGivenName} ${passengerFamilyName}`.trim() || customerName,
                    pnr: flightLeg?.flight_booking?.pnr || null,
                    carrier: selectedOffer?.carrier || 'Airline',
                    originLabel: originLabel || originIata,
                    destinationLabel: destinationLabel || destinationIata,
                    departureAt: flightLeg?.flight_booking?.current_departure_at || null,
                    arrivalAt: flightLeg?.flight_booking?.current_arrival_at || null,
                    totalIcan: quote?.totalIcan || 0,
                    totalUgx: quote?.totalUgx || 0,
                  });
                }}
                className="text-xs sm:text-sm text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1"
              >
                <Printer size={14} /> Print Air Ticket
              </button>
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
                className="text-xs sm:text-sm text-orange-600 hover:text-orange-700 font-medium flex items-center gap-1"
              >
                <Printer size={14} /> Print Shipping Waybill
              </button>
            )}
          </div>
          {!journey ? (
            <Loader2 className="animate-spin mx-auto" />
          ) : (
            <div className="space-y-3">
              {bookingKind === 'ship' && journey.total_fare_ican > 0 && (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-sm text-orange-800 flex justify-between">
                  <span>Charged automatically from your ICAN wallet</span>
                  <span className="font-semibold">{journey.total_fare_ican.toFixed(4)} ICAN (UGX {journey.total_fare_ugx.toLocaleString()})</span>
                </div>
              )}
              {journey.legs.sort((a, b) => a.leg_order - b.leg_order).map((leg) => {
                const rider = leg.ride?.rider;
                return (
                  <div key={leg.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-medium">{legLabel[leg.leg_type]}</div>
                        {leg.flight_booking?.pnr && <div className="text-xs text-slate-500">PNR: {leg.flight_booking.pnr}</div>}
                      </div>
                      <span className="text-xs font-semibold uppercase text-orange-600">{leg.status.replace(/_/g, ' ')}</span>
                    </div>
                    {rider && (
                      <div className="bg-orange-50 rounded-lg p-3 flex items-center justify-between text-sm">
                        <div>
                          <div className="font-semibold text-slate-800">{rider.user?.profile?.full_name || 'Your driver'}</div>
                          <div className="text-slate-500 flex items-center gap-1">
                            <Car size={14} /> {rider.vehicle_type} · {rider.vehicle_color || ''} {rider.vehicle_model || ''} · {rider.plate_number}
                          </div>
                        </div>
                        <div className="text-right space-y-1">
                          <div className="flex items-center gap-1 text-amber-600 font-semibold"><Star size={14} fill="currentColor" /> {Number(rider.rating || 0).toFixed(1)}</div>
                          {rider.user?.phone && (
                            <a href={`tel:${rider.user.phone}`} className="flex items-center gap-1 text-orange-600"><Phone size={14} /> Call</a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
  onSelect: (iataCode: string, displayLabel: string) => void;
}) {
  const [countryIso2, setCountryIso2] = useState(defaultCountryIso2 || 'UG');
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AirportSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-slate-500">{label}</label>
      <div className="grid grid-cols-2 gap-2">
        <select
          className="border rounded-lg p-2.5 bg-white text-slate-900 text-sm"
          value={countryIso2}
          onChange={(e) => setCountryIso2(e.target.value)}
        >
          {COUNTRIES.map((c) => (
            <option key={c.iso2 || c.name} value={c.iso2}>{c.name}</option>
          ))}
        </select>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
          <input
            className="w-full border rounded-lg p-2.5 pl-8 bg-white text-slate-900 placeholder-slate-400 text-sm"
            placeholder="City or airport"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => query.trim().length >= 2 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          />
        </div>
      </div>
      {selectedLabel && !showSuggestions && (
        <p className="text-xs text-emerald-600 font-medium">✓ {selectedLabel}</p>
      )}
      {showSuggestions && (
        <div className="border rounded-lg bg-white shadow-md max-h-48 overflow-y-auto">
          {loading && <div className="p-2.5 text-xs text-slate-400">Searching…</div>}
          {!loading && suggestions.length === 0 && query.trim().length >= 2 && (
            <div className="p-2.5 text-xs text-slate-400">No airports found</div>
          )}
          {suggestions.map((a) => (
            <button
              key={a.iataCode}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onSelect(a.iataCode, `${a.name} (${a.iataCode})${a.cityName ? ` — ${a.cityName}` : ''}`);
                setQuery('');
                setShowSuggestions(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50 border-b border-slate-100 last:border-b-0"
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

// Real city/town/village autocomplete (Nominatim, free — see geocodeService's
// searchCities) scoped to whichever country was selected, so "get their
// cities" works for any of the ~195 countries in data/countries.ts, not
// just a hardcoded shortlist. Free typing is still allowed — a suggestion
// just makes it a real, spellchecked place name.
function CitySearchInput({
  countryIso2,
  value,
  onChange,
}: {
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
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
      <input
        className="w-full border rounded-lg p-3 pl-8 bg-white text-slate-900 placeholder-slate-400"
        placeholder="City (e.g. New York)"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => value.trim().length >= 2 && setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
      />
      {showSuggestions && (
        <div className="absolute z-10 w-full mt-1 border rounded-lg bg-white shadow-md max-h-48 overflow-y-auto">
          {loading && <div className="p-2.5 text-xs text-slate-400">Searching…</div>}
          {!loading && suggestions.length === 0 && value.trim().length >= 2 && (
            <div className="p-2.5 text-xs text-slate-400">No cities found — you can still type your own</div>
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
              className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50 border-b border-slate-100 last:border-b-0"
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
