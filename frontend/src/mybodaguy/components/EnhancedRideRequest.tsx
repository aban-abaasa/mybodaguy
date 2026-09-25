import { useState, useRef, useEffect } from 'react';
import * as React from 'react';
import { MapPin, Search, Crown, Home, DollarSign, Star, Navigation, Phone, X, Clock, CheckCircle, XCircle, ArrowLeft, Zap, Fuel, Umbrella, Bike, Package, Tag, Car, Truck, Plane, ShieldCheck, Sparkles, ArrowRight, ArrowUpDown, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import { searchLocations, Location } from '../data/mockLocations';
import { supabase } from '../services/supabaseClient';
import { trackRideCall, trackUIInteraction } from '../../services/featureAnalyticsService';
import RideCommsBar from './RideCommsBar';
import ProductPicker, { CartLine } from './ProductPicker';
import LocationPickerMap from './LocationPickerMap';
import LiveTrackingMap from './LiveTrackingMap';
import JourneyBookingFlow from './JourneyBookingFlow';
import JourneyTracker from './JourneyTracker';
import { reverseGeocodeCountry, searchAddressSuggestions, geocodeAddress, type CountryLookup } from '../services/geocodeService';
import { verifyPin } from '../services/pinService';
import { productService, type Product } from '../services/productService';

type RideStatus = 'searching' | 'waiting_acceptance' | 'accepted' | 'declined' | 'journey_started' | 'completed';
type ServiceType = 'ride' | 'delivery';
type DeliveryMode = 'supermarket' | 'normal';
type PowerFilter = 'any' | 'electric' | 'fuel';
type VehicleTypeFilter = 'any' | 'motorcycle' | 'car' | 'van' | 'truck';
type ModePreference = 'all' | 'normal' | 'vip' | 'discount' | 'return';

interface MatchedRider {
  rider_id: string;
  full_name: string;
  phone: string | null;
  rating: number;
  total_rides: number;
  vehicle_type: string;
  power_type: 'electric' | 'fuel';
  has_umbrella: boolean;
  plate_number: string;
  vehicle_color: string;
  mode: 'normal' | 'vip' | 'discount' | 'return';
  distance_to_pickup_km: number | null;
  estimated_arrival_min: number;
  knows_destination: boolean;
  fare: number;
  distance_km: number;
  time_multiplier: number;
  verified_business_name?: string | null;
  is_admin_verified_store_driver?: boolean;
}

interface SecurityCompany {
  business_profile_id: string;
  business_name: string;
  avatar_url: string | null;
  home_city: string | null;
  home_country: string | null;
  available_escorts: number;
  has_self_transport_escort: boolean;
}

interface RideCompany {
  business_profile_id: string;
  business_name: string;
  avatar_url: string | null;
  home_city: string | null;
  home_country: string | null;
  available_vehicles: number;
}

interface Supermarket {
  id: string;
  name: string;
  location: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  business_type: string;
}

// Store type filter — supermarkets, hotels, boutiques, and restaurants/cafés
// all live in the same `supermarkets` table (business_type column). The
// delivery_mode value stays 'supermarket' regardless of the target's actual
// business_type (see mbg_request_ride / mbg_rides CHECK constraint) — it
// just means "structured store delivery scoped to a supermarket_id".
type BusinessTypeFilter = 'all' | 'supermarket' | 'hotel' | 'boutique' | 'restaurant_cafe';

const BUSINESS_TYPE_FILTERS: { value: BusinessTypeFilter; label: string; emoji: string }[] = [
  { value: 'all', label: 'All', emoji: '🏬' },
  { value: 'supermarket', label: 'Supermarkets', emoji: '🏪' },
  { value: 'hotel', label: 'Hotels', emoji: '🏨' },
  { value: 'boutique', label: 'Boutiques', emoji: '👗' },
  { value: 'restaurant_cafe', label: 'Restaurants', emoji: '🍽️' },
];

const typeEmoji = (t: string) => BUSINESS_TYPE_FILTERS.find(f => f.value === t)?.emoji || '🏪';

// Straight-line distance in km — plenty accurate for "which of these stores
// is closest" ranking; no backend geo/PostGIS support exists for this yet
// (see productService.ts), so this is computed client-side against whatever
// stores already have real latitude/longitude on file.
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

interface EnhancedRideRequestProps {
  customerId: string;
  /** Locks the flow to 'ride' or 'delivery' and hides the toggle — used to
   * keep "Book a Ride" and "Delivery" as separate tabs/experiences while
   * both still run on this one real matching-engine implementation. Omit
   * to show the toggle and let the customer switch freely. */
  fixedServiceType?: ServiceType;
  /** Surfaces "Book a Journey" (flight + boda + destination driver) as a
   * mode alongside plain Ride, inbuilt into this same screen instead of a
   * separate top-level tab. Only passed from the "Book a Ride" tab —
   * Delivery doesn't offer it. */
  showJourneyOption?: boolean;
  /** Opens an already-booked journey on its live tracking screen (chosen from My Journeys on another tab). */
  openJourneyId?: string | null;
  /** Called when the customer leaves that tracking screen, so the parent stops asking for it to be opened. */
  onJourneyClosed?: () => void;
}

// Wallet payments carry the same platform fee the backend applies when it
// actually debits the wallet (commission.icanera_platform_fee_percentage,
// mbg_respond_to_ride / mbg_complete_ride) — folded into the one number shown
// here so the customer always sees a single all-in payable amount, matching
// what leaves their wallet, with no separate fee breakdown on screen. The rate
// is read live from the public setting (developer-editable); this default only
// covers the moment before it loads.
const DEFAULT_WALLET_SURCHARGE_PCT = 8;
let cachedWalletSurchargePct: number | null = null;
function useWalletSurchargePct(): number {
  const [pct, setPct] = useState(cachedWalletSurchargePct ?? DEFAULT_WALLET_SURCHARGE_PCT);
  useEffect(() => {
    if (cachedWalletSurchargePct !== null) return;
    supabase
      .from('mbg_platform_settings')
      .select('value')
      .eq('key', 'commission.icanera_platform_fee_percentage')
      .maybeSingle()
      .then(({ data }) => {
        const fee = Number(data?.value);
        if (Number.isFinite(fee) && fee >= 0) {
          cachedWalletSurchargePct = fee;
          setPct(fee);
        }
      });
  }, []);
  return pct;
}
function payableFare(fare: number, paymentMethod: 'wallet' | 'cash' | 'company', surchargePct: number): number {
  return paymentMethod === 'wallet' ? Math.round(fare * (1 + surchargePct / 100)) : fare;
}

export default function EnhancedRideRequest({ customerId, fixedServiceType, showJourneyOption, openJourneyId, onJourneyClosed }: EnhancedRideRequestProps) {
  const [bookingMode, setBookingMode] = useState<'ride' | 'journey'>(openJourneyId ? 'journey' : 'ride');
  // The booked journey being tracked, when the customer opened one from My Journeys.
  const [resumeJourneyId, setResumeJourneyId] = useState<string | null>(openJourneyId ?? null);
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [pickupSuggestions, setPickupSuggestions] = useState<Location[]>([]);
  const [dropoffSuggestions, setDropoffSuggestions] = useState<Location[]>([]);
  const [selectedPickup, setSelectedPickup] = useState<Location | null>(null);
  const [selectedDropoff, setSelectedDropoff] = useState<Location | null>(null);
  const [showPickupSuggestions, setShowPickupSuggestions] = useState(false);
  const [showDropoffSuggestions, setShowDropoffSuggestions] = useState(false);
  const [searching, setSearching] = useState(false);
  const [matchedRiders, setMatchedRiders] = useState<MatchedRider[]>([]);
  const [selectedRider, setSelectedRider] = useState<MatchedRider | null>(null);
  const [rideStatus, setRideStatus] = useState<RideStatus | null>(null);
  const [waitingTimer, setWaitingTimer] = useState(30);
  // "Just Send" — customer skips picking a specific rider; the server
  // (mbg_sweep_auto_dispatch_cascade, pg_cron every 10s) offers it to the
  // best-matched rider and, if they don't respond within 10s, silently
  // reassigns to the next-best candidate and repeats until one accepts or
  // riders are exhausted. The client-side 30s per-rider countdown below is
  // for the "pick a specific rider" flow only — it's disabled in this mode
  // since the server owns the whole timeout/cascade lifecycle instead.
  const [isAutoDispatch, setIsAutoDispatch] = useState(false);
  const [autoDispatching, setAutoDispatching] = useState(false);
  // Which candidate mbg_sweep_auto_dispatch_cascade currently has the offer
  // out to (mbg_rides.rider_id) — used only to light up the right avatar in
  // WaitingForAcceptance's orbit; matched against matchedRiders by rider_id.
  const [autoCandidateId, setAutoCandidateId] = useState<string | null>(null);
  const [rideId, setRideId] = useState<string | null>(null);
  const [riderUserId, setRiderUserId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('Customer');

  // Service options — real vehicle/weather filters matched against riders' actual registered attributes
  const [serviceType, setServiceType] = useState<ServiceType>(fixedServiceType || 'ride');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('normal');
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([]);
  const [selectedSupermarketId, setSelectedSupermarketId] = useState('');
  const [storeTypeFilter, setStoreTypeFilter] = useState<BusinessTypeFilter>('all');
  // Lets the customer search the store list by name/area instead of only
  // scrolling it, and — paired with customerGpsLocation below — ranks
  // stores by real distance so "nearest available" is an actual answer,
  // not just whichever store happens to sort first alphabetically.
  const [storeSearchQuery, setStoreSearchQuery] = useState('');
  const [customerGpsLocation, setCustomerGpsLocation] = useState<{ lat: number; lng: number } | null>(null);
  // Normal delivery's own "smart" nearby-products preview — a few real
  // products (never mock data, straight from productService against the
  // same public.products/inventory tables ProductPicker uses) pulled from
  // each of the closest few stores, shown before the customer has picked
  // anything. Keyed by supermarket id so each store's preview only loads
  // once. Tapping a product jumps into 'supermarket' mode locked to that
  // one store (see jumpToStoreProduct below) — an order can only ever be
  // scoped to a single supermarket_id (mbg_request_ride, delivery_mode
  // CHECK constraint), so this is a fast on-ramp into a real single-store
  // order, not a cross-store cart.
  const [nearbyStoreProducts, setNearbyStoreProducts] = useState<Record<string, Product[]>>({});
  const [loadingNearbyProducts, setLoadingNearbyProducts] = useState(false);
  const [deliveryCart, setDeliveryCart] = useState<CartLine[]>([]);
  // How long the customer is willing to wait for a store order before the
  // rider is warned and, after a grace period, the customer can pull a
  // refund (mbg_request_ride requires this for delivery_mode='supermarket'
  // — see ADD_DELIVERY_ESCROW_DEADLINE_AND_RIDER_LIABILITY.sql). 3h is a
  // sane "smart" default (long enough for a normal in-town errand, short
  // enough that a stalled order gets caught same-day); bounds come from
  // the backend's own delivery.min_deadline_hours/max_deadline_hours so
  // the presets shown here never fall outside what the server will accept.
  const [maxDeliveryHours, setMaxDeliveryHours] = useState(3);
  const [deliveryWindowBounds, setDeliveryWindowBounds] = useState({ min: 1, max: 48 });
  // Whether this delivery counts as a personal errand or a business expense
  // for the customer's own ICANera Wallet bookkeeping. Applies to the WHOLE
  // order — mbg_request_ride tags every wallet debit it produces (the goods
  // leg AND the fare leg for a store delivery, just the fare leg for a
  // normal one) with this same choice, so it lands on one side of the
  // customer's Personal/Business split instead of being split across both
  // (previously the goods leg was hardcoded "business", the fare leg always
  // fell back to "personal", regardless of what the order actually was).
  const [deliveryExpenseType, setDeliveryExpenseType] = useState<'personal_expense' | 'business_expense'>('personal_expense');
  // Every real business this customer belongs to (owner, active team member,
  // or co-owner — mbg_my_business_memberships(), same three-table lookup
  // PayMoneyModal.jsx already does for its own "Choose the business for
  // this report" picker), so a customer who's in more than one company can
  // actually say which one a "Business" delivery is filed under instead of
  // it just meaning business-in-general.
  const [myBusinesses, setMyBusinesses] = useState<{ id: string; business_name: string }[]>([]);
  const [loadingMyBusinesses, setLoadingMyBusinesses] = useState(false);
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [powerFilter, setPowerFilter] = useState<PowerFilter>('any');
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState<VehicleTypeFilter>('any');
  const [umbrellaRequired, setUmbrellaRequired] = useState(false);
  // "Any Rider" (open marketplace, the previous-only behaviour) vs "From a
  // Company" — scopes matching to one transport_company's own driver
  // roster (CREATE_BODAGOERA_BUSINESS_DRIVER_ROSTER.sql) instead of every
  // available rider/vehicle.
  const [riderProviderFilter, setRiderProviderFilter] = useState<'any' | 'company'>('any');
  const [rideCompanies, setRideCompanies] = useState<RideCompany[]>([]);
  const [selectedRideCompanyId, setSelectedRideCompanyId] = useState('');
  const [escortRequested, setEscortRequested] = useState(false);
  const [escortFeeEstimate, setEscortFeeEstimate] = useState<number | null>(null);
  const [securityOnlyLoading, setSecurityOnlyLoading] = useState(false);
  const [securityCompanies, setSecurityCompanies] = useState<SecurityCompany[]>([]);
  const [selectedSecurityCompanyId, setSelectedSecurityCompanyId] = useState('');
  const [securityPassengerCount, setSecurityPassengerCount] = useState(1);
  const [modePreference, setModePreference] = useState<ModePreference>('all');
  // Wallet = charged automatically (fare + the platform fee, folded into one
  // total) the instant the trip completes. Cash = pay the rider directly in
  // person — no surcharge, but the rider owes the commission out of pocket and
  // must confirm receipt before taking new jobs (see mbg_confirm_cash_received).
  const [paymentMethod, setPaymentMethod] = useState<'wallet' | 'cash' | 'company'>('wallet');
  const [companyTransport, setCompanyTransport] = useState<{ eligible: boolean; business_name?: string; billing_mode?: string }>({ eligible: false });

  useEffect(() => {
    if (!customerId) return;
    supabase.rpc('mbg_get_company_transport_benefit').then(({ data, error }) => {
      if (error || !data?.eligible) {
        setCompanyTransport({ eligible: false });
        setPaymentMethod(previous => previous === 'company' ? 'wallet' : previous);
        return;
      }
      setCompanyTransport(data);
      setPaymentMethod('company');
    });
  }, [customerId]);

  // Loaded lazily — only once the customer actually taps "Business" — same
  // as PayMoneyModal's own guard, so a purely-personal customer never pays
  // for this lookup. Auto-picks the one business when there's only one;
  // more than one leaves it for the customer to choose (see the picker
  // rendered below the Personal/Business toggle).
  useEffect(() => {
    if (!customerId || serviceType !== 'delivery' || deliveryExpenseType !== 'business_expense' || myBusinesses.length > 0 || loadingMyBusinesses) return;
    setLoadingMyBusinesses(true);
    supabase.rpc('mbg_my_business_memberships').then(({ data, error }) => {
      if (error) {
        console.warn('[EnhancedRideRequest] Could not load business memberships:', error.message);
        setLoadingMyBusinesses(false);
        return;
      }
      const businesses = data || [];
      setMyBusinesses(businesses);
      setSelectedBusinessId(prev => prev || (businesses.length === 1 ? businesses[0].id : ''));
      setLoadingMyBusinesses(false);
    });
  }, [customerId, serviceType, deliveryExpenseType, myBusinesses.length, loadingMyBusinesses]);

  // Clear any selected products once the customer leaves the supermarket
  // delivery flow or switches stores, so a stale cart never gets submitted.
  useEffect(() => {
    if (deliveryMode !== 'supermarket' || !selectedSupermarketId) setDeliveryCart([]);
  }, [serviceType, deliveryMode, selectedSupermarketId]);

  // Power-type/rain-cover filters are hidden outside the Boda filter — reset
  // them too, so switching to Car/Van/Truck can't leave a stale boda-only
  // filter silently attached to the next search.
  useEffect(() => {
    if (vehicleTypeFilter !== 'motorcycle') {
      setPowerFilter('any');
      setUmbrellaRequired(false);
    }
  }, [vehicleTypeFilter]);

  // Customer's own registered areas — merged into the location suggestions
  const [customerAreas, setCustomerAreas] = useState<Location[]>([]);
  const [defaultDropoff, setDefaultDropoff] = useState<Location | null>(null);

  // True once pickup was auto-filled from a registered supermarket's own
  // location — the pickup field locks so the customer isn't asked to
  // re-enter something we already know.
  const [pickupIsAutoFromSupermarket, setPickupIsAutoFromSupermarket] = useState(false);
  // True while resolving a store's coordinates from its address text (only
  // needed when the supermarket record itself has no latitude/longitude)
  // — brief, but real network round-trip, so the pickup field shows it
  // instead of looking broken/empty for a moment.
  const [pickupGeocodingStore, setPickupGeocodingStore] = useState(false);

  // Map-based location picking — an alternative to the typed-suggestion
  // flow, not a replacement: either one ends up setting the same
  // selectedPickup/selectedDropoff state the rest of this component reads.
  const [showMap, setShowMap] = useState(true);
  const [routeInfo, setRouteInfo] = useState<{ distanceKm: number; durationMin: number } | null>(null);

  // Cross-border delivery detection — only meaningful for a plain "normal"
  // delivery (a boda/car ride is inherently single-country, and supermarket
  // delivery is always a known local store). Resolved lazily so the common
  // same-country case never pays for two extra geocode calls.
  const [pickupCountry, setPickupCountry] = useState<CountryLookup | null>(null);
  const [dropoffCountry, setDropoffCountry] = useState<CountryLookup | null>(null);
  const isNormalDelivery = serviceType === 'delivery' && deliveryMode === 'normal';
  // Country resolution also runs for a plain ride now — a normal ride's
  // pickup/dropoff can still land in different countries entirely (see
  // needsJourneyPath below), not just the already-handled normal-delivery
  // cross-border case.
  const wantsCountryCheck = isNormalDelivery || serviceType === 'ride';

  useEffect(() => {
    if (!wantsCountryCheck || !selectedPickup) {
      setPickupCountry(null);
      return;
    }
    reverseGeocodeCountry(selectedPickup.coordinates.lat, selectedPickup.coordinates.lng).then(setPickupCountry);
  }, [wantsCountryCheck, selectedPickup?.coordinates.lat, selectedPickup?.coordinates.lng]);

  useEffect(() => {
    if (!wantsCountryCheck || !selectedDropoff) {
      setDropoffCountry(null);
      return;
    }
    reverseGeocodeCountry(selectedDropoff.coordinates.lat, selectedDropoff.coordinates.lng).then(setDropoffCountry);
  }, [wantsCountryCheck, selectedDropoff?.coordinates.lat, selectedDropoff?.coordinates.lng]);

  // Whether this pickup/dropoff pair needs a real long-haul leg (plane or
  // ship) instead of a normal boda/car/van trip. mbg_route_needs_long_haul_transport
  // wraps mbg_route_needs_sea_leg's trade-bloc lookup (ADD_SHIP_DISPATCH.sql /
  // ADD_LONG_HAUL_DETECTION_AND_SEA_FLAT_FEE.sql), reused here for both cargo
  // (ship) and passenger (flight) crossings — same signal either way.
  const [needsJourneyPath, setNeedsJourneyPath] = useState(false);
  useEffect(() => {
    if (!pickupCountry || !dropoffCountry || pickupCountry.iso2 === dropoffCountry.iso2) {
      setNeedsJourneyPath(false);
      return;
    }
    let cancelled = false;
    supabase.rpc('mbg_route_needs_long_haul_transport', {
      p_origin_country: pickupCountry.name,
      p_destination_country: dropoffCountry.name,
    }).then(({ data, error }) => {
      if (!cancelled && !error) setNeedsJourneyPath(!!data);
    });
    return () => {
      cancelled = true;
    };
  }, [pickupCountry?.iso2, dropoffCountry?.iso2]);

  // Same-bloc cross-border (e.g. Uganda<->Kenya) stays the existing
  // single-hop cargo-vehicle path; a bloc mismatch is redirected to Journey
  // booking instead (see the bookingMode === 'journey' early return below),
  // so the two paths are mutually exclusive.
  const needsCrossBorderPath = isNormalDelivery && !!pickupCountry && !!dropoffCountry && pickupCountry.iso2 !== dropoffCountry.iso2 && !needsJourneyPath;

  // Fee preview for the "Add Security Escort" toggle — refreshed whenever
  // it's turned on, the pickup country changes, or the chosen company
  // changes. With a company picked this is exactly that company's own
  // escort_flat_fee (never a platform-wide guess); null means that company
  // hasn't set a price yet, not "estimating" forever.
  useEffect(() => {
    if (!escortRequested) return;
    setEscortFeeEstimate(null);
    supabase.rpc('mbg_estimate_escort_fee', {
      p_country: pickupCountry?.name || 'Uganda',
      p_business_profile_id: selectedSecurityCompanyId || null,
    }).then(({ data, error }) => {
      if (!error) setEscortFeeEstimate(data == null ? NaN : Number(data));
    });
  }, [escortRequested, pickupCountry, selectedSecurityCompanyId]);

  // Security companies the "just send security" flow can be scoped to —
  // loaded once, not filtered by country since a customer picking a
  // specific company cares more about who they are than distance.
  useEffect(() => {
    if (!customerId) return;
    supabase.rpc('mbg_list_security_companies', { p_country: null }).then(({ data, error }) => {
      if (!error) setSecurityCompanies(data || []);
    });
  }, [customerId]);

  // Transport companies the customer can scope a ride/delivery search to —
  // re-fetched whenever the vehicle type filter changes so the list only
  // ever shows companies that actually have that kind of vehicle.
  useEffect(() => {
    if (!customerId) return;
    supabase.rpc('mbg_list_ride_companies', {
      p_country: null,
      p_vehicle_type: vehicleTypeFilter === 'any' ? null : vehicleTypeFilter,
    }).then(({ data, error }) => {
      if (error) {
        console.error('mbg_list_ride_companies failed:', error);
        return;
      }
      setRideCompanies(data || []);
    });
  }, [customerId, vehicleTypeFilter]);

  // Dropping back to "Any Rider", or a chosen company no longer being in
  // the (possibly re-filtered) list, clears a stale selection instead of
  // silently keeping a company id that's no longer shown/valid.
  useEffect(() => {
    if (riderProviderFilter === 'any') {
      setSelectedRideCompanyId('');
      return;
    }
    if (selectedRideCompanyId && !rideCompanies.some(c => c.business_profile_id === selectedRideCompanyId)) {
      setSelectedRideCompanyId('');
    }
  }, [riderProviderFilter, rideCompanies, selectedRideCompanyId]);

  const handleMapPickupChange = (location: Location) => {
    setSelectedPickup(location);
    setPickup(location.fullAddress);
  };

  const handleMapDropoffChange = (location: Location) => {
    setSelectedDropoff(location);
    setDropoff(location.fullAddress);
  };

  const pickupRef = useRef<HTMLDivElement>(null);
  const dropoffRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase
      .from('supermarkets')
      .select('id, name, location, address, latitude, longitude, business_type')
      .eq('is_active', true)
      .order('name', { ascending: true })
      .then(async ({ data, error }) => {
        if (error) {
          // latitude/longitude migration not applied yet on this project —
          // degrade gracefully instead of losing the supermarket list.
          console.warn('[EnhancedRideRequest] supermarkets geo columns unavailable, falling back:', error.message);
          const fallback = await supabase
            .from('supermarkets')
            .select('id, name, location, address, business_type')
            .eq('is_active', true)
            .order('name', { ascending: true });
          setSupermarkets((fallback.data || []).map((sm: any) => ({ ...sm, latitude: null, longitude: null })));
          return;
        }
        setSupermarkets(data || []);
      });
  }, []);

  // Customer's own live position — fetched once, best-effort, the moment
  // they're in the delivery flow, so the store list can be ranked "nearest
  // first" instead of the customer having to already know which store is
  // close. Silent on denial/failure: it's an enhancement, not a
  // requirement — the store list just stays in its existing name order.
  useEffect(() => {
    if (serviceType !== 'delivery' || customerGpsLocation || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCustomerGpsLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  }, [serviceType, customerGpsLocation]);

  // Bounds for the delivery-window picker — public settings, safe to read
  // directly (mbg_platform_settings RLS allows SELECT where is_public=true).
  // Falls back to the defaults above if the row isn't there yet.
  useEffect(() => {
    supabase
      .from('mbg_platform_settings')
      .select('key, value')
      .in('key', ['delivery.min_deadline_hours', 'delivery.max_deadline_hours'])
      .then(({ data }) => {
        if (!data) return;
        const min = Number(data.find(r => r.key === 'delivery.min_deadline_hours')?.value ?? 1);
        const max = Number(data.find(r => r.key === 'delivery.max_deadline_hours')?.value ?? 48);
        setDeliveryWindowBounds({ min, max });
        setMaxDeliveryHours(prev => Math.min(Math.max(prev, min), max));
      });
  }, []);

  // Store list filtered by the chosen business type, then ranked nearest
  // first (once the customer's GPS position is known) so "recommend the
  // nearest available store" is an actual sort, not just a label. Stores
  // with no coordinates on file yet (see SupermarketProductManager.tsx's
  // location editor) sort to the end rather than being hidden — still
  // choosable, just not rankable.
  const filteredStores = (storeTypeFilter === 'all'
    ? supermarkets
    : supermarkets.filter(sm => sm.business_type === storeTypeFilter)
  )
    .map(sm => ({
      ...sm,
      distanceKm: (customerGpsLocation && sm.latitude != null && sm.longitude != null)
        ? haversineKm(customerGpsLocation, { lat: sm.latitude, lng: sm.longitude })
        : null,
    }))
    .sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return 0;
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });

  const nearestStoreId = filteredStores.find(sm => sm.distanceKm != null)?.id ?? null;

  // For "normal" (non-store) delivery, ranked across every registered store
  // regardless of type since that flow never shows the type pills. Same
  // "sort nulls last, never filter them out" rule as filteredStores above —
  // a store with no coordinates on file yet (the common case right now:
  // nothing has used SupermarketProductManager's location editor yet) still
  // shows up here with its real products, just not distance-ranked, instead
  // of the whole preview going empty because nothing happens to have geodata.
  const nearestAnyStores = supermarkets
    .map(sm => ({
      ...sm,
      distanceKm: (customerGpsLocation && sm.latitude != null && sm.longitude != null)
        ? haversineKm(customerGpsLocation, { lat: sm.latitude, lng: sm.longitude })
        : null,
    }))
    .sort((a, b) => {
      if (a.distanceKm == null && b.distanceKm == null) return 0;
      if (a.distanceKm == null) return 1;
      if (b.distanceKm == null) return -1;
      return a.distanceKm - b.distanceKm;
    });

  // Only ever offered as a suggestion the customer can tap to accept, and
  // only once there's a real measured distance to name — never claims a
  // store is "nearest" without actually knowing that. A normal delivery is
  // just as often "pick this up from my house" as "pick this up from a
  // shop", so it must also never silently overwrite a pickup the customer
  // is typing themselves (see the pickup-field render below).
  const nearestAnyStore = nearestAnyStores.find(sm => sm.distanceKm != null) ?? null;

  // "Be smart" for Normal Delivery: auto-load a real product preview, no
  // button, no store picked yet. Real data only (productService against
  // public.products/inventory, same as ProductPicker), capped to a handful
  // per store since this is a preview, not the full catalog. Fetches a
  // wider pool of 8 candidate stores (not just the 3 shown) because most
  // stores don't have coordinates set yet (see SupermarketProductManager's
  // location editor) — without real distances to rank by, "nearest 3" falls
  // back to alphabetical, and the literal first 3 alphabetically might
  // happen to be the ones with no products listed. Casting a wider net and
  // showing the first 3 that actually have real products (see
  // storesWithProducts in the render below) means an existing store's real
  // catalog reliably shows up instead of an empty "no products" preview.
  const previewCandidateIds = nearestAnyStores.slice(0, 8).map(sm => sm.id).join(',');
  useEffect(() => {
    if (serviceType !== 'delivery' || deliveryMode !== 'normal') return;
    const targets = nearestAnyStores.slice(0, 8).filter(sm => !(sm.id in nearbyStoreProducts));
    if (targets.length === 0) return;
    let cancelled = false;
    setLoadingNearbyProducts(true);
    Promise.all(targets.map(sm =>
      productService.getActiveProducts(sm.id)
        .then(products => [sm.id, products.slice(0, 6)] as const)
        .catch(() => [sm.id, []] as const)
    )).then(results => {
      if (cancelled) return;
      setNearbyStoreProducts(prev => {
        const next = { ...prev };
        results.forEach(([id, products]) => { next[id] = products; });
        return next;
      });
    }).finally(() => { if (!cancelled) setLoadingNearbyProducts(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceType, deliveryMode, previewCandidateIds]);

  // Jumping straight into a real single-store order from the nearby-products
  // preview — an order can only ever belong to one supermarket_id, so
  // picking a product here commits to that store the same way manually
  // searching and selecting it in "From a Store" mode would.
  const jumpToStoreProduct = (supermarketId: string) => {
    setDeliveryMode('supermarket');
    setStoreTypeFilter('all');
    setSelectedSupermarketId(supermarketId);
  };

  // Always searchable — a text filter on top of the type pills, matched
  // against name/area so the customer never has to scroll a long list.
  const visibleStores = storeSearchQuery.trim()
    ? filteredStores.filter(sm => {
        const q = storeSearchQuery.trim().toLowerCase();
        return sm.name.toLowerCase().includes(q) || (sm.location || '').toLowerCase().includes(q);
      })
    : filteredStores;

  useEffect(() => {
    if (!selectedSupermarketId) return;
    if (!filteredStores.some(sm => sm.id === selectedSupermarketId)) {
      setSelectedSupermarketId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeTypeFilter]);

  // "Be smart" default: as soon as a store type is being browsed and none
  // is chosen yet, auto-pick the nearest available one (falling back to the
  // first in the list if GPS/coordinates aren't available) instead of
  // leaving the customer staring at an empty picker — they can still
  // search/switch to a different store afterwards.
  useEffect(() => {
    if (serviceType !== 'delivery' || deliveryMode !== 'supermarket') return;
    if (selectedSupermarketId) return;
    const fallback = nearestStoreId ?? filteredStores[0]?.id ?? null;
    if (fallback) setSelectedSupermarketId(fallback);
  }, [serviceType, deliveryMode, selectedSupermarketId, nearestStoreId, filteredStores]);

  useEffect(() => {
    if (!customerId) return;
    supabase
      .from('mbg_customer_areas')
      .select('id, name, address, latitude, longitude, is_default')
      .eq('customer_user_id', customerId)
      .then(({ data }) => {
        const areas = (data || [])
          .filter((a: any) => a.latitude != null && a.longitude != null)
          .map((a: any) => ({
            id: `area_${a.id}`,
            name: a.name,
            area: a.name,
            fullAddress: a.address,
            coordinates: { lat: a.latitude, lng: a.longitude }
          }));
        setCustomerAreas(areas);
        const def = (data || []).find((a: any) => a.is_default && a.latitude != null && a.longitude != null);
        if (def) {
          setDefaultDropoff({
            id: `area_${def.id}`,
            name: def.name,
            area: def.name,
            fullAddress: def.address,
            coordinates: { lat: def.latitude, lng: def.longitude }
          });
        }
      });
  }, [customerId]);

  // Smart supermarket pickup: a delivery's pickup point is always the
  // store — never something the customer should have to look up or type
  // themselves. If the supermarket record already has coordinates, use
  // them directly; if not, geocode its address/name so this still works
  // instead of silently falling back to a manual search. Only when even
  // that fails (no address on file, geocoding down) does the customer see
  // anything to fill in themselves.
  useEffect(() => {
    if (serviceType !== 'delivery' || deliveryMode !== 'supermarket' || !selectedSupermarketId) {
      setPickupIsAutoFromSupermarket(false);
      setPickupGeocodingStore(false);
      return;
    }
    const sm = supermarkets.find(s => s.id === selectedSupermarketId);
    if (!sm) {
      setPickupIsAutoFromSupermarket(false);
      return;
    }

    const applyStorePickup = (lat: number, lng: number, displayAddress?: string) => {
      const loc: Location = {
        id: `supermarket_${sm.id}`,
        name: sm.name,
        area: sm.location,
        fullAddress: displayAddress || sm.address || `${sm.name}, ${sm.location}`,
        coordinates: { lat, lng }
      };
      setSelectedPickup(loc);
      setPickup(loc.fullAddress);
      setPickupIsAutoFromSupermarket(true);
    };

    if (sm.latitude != null && sm.longitude != null) {
      applyStorePickup(sm.latitude, sm.longitude);
      return;
    }

    // No coordinates on file for this store — geocode its address/name
    // instead of asking the customer to find their own way there.
    let cancelled = false;
    setPickupIsAutoFromSupermarket(false);
    setPickupGeocodingStore(true);
    const query = sm.address || `${sm.name}, ${sm.location || ''}`;
    geocodeAddress(query).then((result) => {
      if (cancelled) return;
      setPickupGeocodingStore(false);
      if (result) {
        applyStorePickup(result.lat, result.lng, sm.address || `${sm.name}, ${sm.location}`);
      }
    });
    return () => { cancelled = true; };
  }, [serviceType, deliveryMode, selectedSupermarketId, supermarkets]);

  // Smart default drop-off: pre-fill (but keep editable) from the
  // customer's saved default area when starting a fresh request.
  useEffect(() => {
    if (defaultDropoff && !selectedDropoff && !dropoff) {
      setSelectedDropoff(defaultDropoff);
      setDropoff(defaultDropoff.fullAddress);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultDropoff]);

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pickupRef.current && !pickupRef.current.contains(event.target as Node)) {
        setShowPickupSuggestions(false);
      }
      if (dropoffRef.current && !dropoffRef.current.contains(event.target as Node)) {
        setShowDropoffSuggestions(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Timer for waiting acceptance — real timeout withdraws the live offer.
  // Skipped entirely in auto-dispatch mode: the server-side cascade
  // (10s per rider) owns that timeout there instead, so this 30s
  // single-rider countdown would otherwise race it and kill the request
  // out from under an in-progress reassignment.
  useEffect(() => {
    if (isAutoDispatch) return;
    if (rideStatus === 'waiting_acceptance' && waitingTimer > 0) {
      const timer = setTimeout(() => setWaitingTimer(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    } else if (rideStatus === 'waiting_acceptance' && waitingTimer === 0) {
      handleTimeout();
    }
  }, [rideStatus, waitingTimer, isAutoDispatch]);

  // Poll the real ride row for status changes made by the rider
  useEffect(() => {
    if (!rideId) return;
    if (rideStatus !== 'waiting_acceptance' && rideStatus !== 'accepted' && rideStatus !== 'journey_started') return;

    const poll = async () => {
      const { data } = await supabase.from('mbg_rides').select('status, rider_id').eq('id', rideId).maybeSingle();
      if (!data) return;

      if (rideStatus === 'waiting_acceptance') {
        if (data.status === 'accepted') {
          setRideStatus('accepted');
          toast.success(isAutoDispatch ? '🎉 A rider accepted your ride!' : `🎉 ${selectedRider?.full_name} accepted your ride!`, {
            description: 'Rider is on the way',
            duration: 4000
          });
        } else if (data.status === 'cancelled') {
          // Auto-dispatch cascade ran out of candidates (mbg_sweep_auto_dispatch_cascade).
          setRideStatus('declined');
          toast.error('No riders were available to accept this request', {
            description: 'Please try again in a moment',
            duration: 4000
          });
        } else if (!isAutoDispatch && data.rider_id === null) {
          setRideStatus('declined');
          toast.error(`${selectedRider?.full_name} declined your ride`, {
            description: 'Try requesting from another rider',
            duration: 4000
          });
        } else if (isAutoDispatch && data.rider_id && data.rider_id !== autoCandidateId) {
          // The cascade quietly moved on to the next candidate — nothing
          // changes for rideStatus, just which avatar glows in the orbit.
          setAutoCandidateId(data.rider_id);
        }
      } else if (rideStatus === 'accepted' && data.status === 'in_progress') {
        setRideStatus('journey_started');
      } else if (rideStatus === 'journey_started' && data.status === 'completed') {
        setRideStatus('completed');
      }
    };

    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [rideId, rideStatus, selectedRider, isAutoDispatch, autoCandidateId]);

  // Resolve the rider's real auth user id (MatchedRider.rider_id is the
  // mbg_riders row id, not the auth id) so RideCommsBar can address them.
  useEffect(() => {
    if (!selectedRider?.rider_id) {
      setRiderUserId(null);
      return;
    }
    supabase
      .from('mbg_riders')
      .select('user_id')
      .eq('id', selectedRider.rider_id)
      .maybeSingle()
      .then(({ data }) => setRiderUserId(data?.user_id || null));
  }, [selectedRider?.rider_id]);

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

  const mergeSuggestions = (query: string): Location[] => {
    const q = query.toLowerCase();
    const personal = customerAreas.filter(
      a => a.name.toLowerCase().includes(q) || a.fullAddress.toLowerCase().includes(q)
    );
    return [...personal, ...searchLocations(query)];
  };

  const mergeRemoteSuggestions = (local: Location[], remote: Awaited<ReturnType<typeof searchAddressSuggestions>>): Location[] => {
    const existing = new Set(local.map((location) => `${location.coordinates.lat.toFixed(5)},${location.coordinates.lng.toFixed(5)}`));
    const remoteLocations: Location[] = remote
      .filter((result) => {
        const key = `${result.lat.toFixed(5)},${result.lng.toFixed(5)}`;
        if (existing.has(key)) return false;
        existing.add(key);
        return true;
      })
      .map((result, index) => ({
        id: `google_${result.lat.toFixed(5)}_${result.lng.toFixed(5)}_${index}`,
        name: result.name,
        area: result.name,
        fullAddress: result.displayName,
        coordinates: { lat: result.lat, lng: result.lng },
      }));
    return [...local, ...remoteLocations];
  };

  // Each field gets its own live request and its own result list. This makes
  // typing in pickup independent from typing in drop-off.
  useEffect(() => {
    const query = pickup.trim();
    if (pickupIsAutoFromSupermarket || query.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const remote = await searchAddressSuggestions(query);
      if (!cancelled) {
        setPickupSuggestions(mergeRemoteSuggestions(mergeSuggestions(query), remote));
        setShowPickupSuggestions(true);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pickup, pickupIsAutoFromSupermarket, customerAreas]);

  useEffect(() => {
    const query = dropoff.trim();
    if (query.length < 2) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const remote = await searchAddressSuggestions(query);
      if (!cancelled) {
        setDropoffSuggestions(mergeRemoteSuggestions(mergeSuggestions(query), remote));
        setShowDropoffSuggestions(true);
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [dropoff, customerAreas]);

  const handlePickupChange = (value: string) => {
    setPickup(value);
    setSelectedPickup(null);
    const suggestions = mergeSuggestions(value);
    setPickupSuggestions(suggestions);
    setShowPickupSuggestions(suggestions.length > 0);
  };

  const handleDropoffChange = (value: string) => {
    setDropoff(value);
    setSelectedDropoff(null);
    const suggestions = mergeSuggestions(value);
    setDropoffSuggestions(suggestions);
    setShowDropoffSuggestions(suggestions.length > 0);
  };

  const selectPickupLocation = (location: Location) => {
    setPickup(location.fullAddress);
    setSelectedPickup(location);
    setShowPickupSuggestions(false);
    toast.success(`Pickup: ${location.name}`);
  };

  const selectDropoffLocation = (location: Location) => {
    setDropoff(location.fullAddress);
    setSelectedDropoff(location);
    setShowDropoffSuggestions(false);
    toast.success(`Drop-off: ${location.name}`);
  };

  const handleSearchRiders = async () => {
    if (!selectedPickup || !selectedDropoff) {
      toast.error('Please select both pickup and drop-off locations from suggestions');
      return;
    }
    if (serviceType === 'delivery' && deliveryMode === 'supermarket' && !selectedSupermarketId) {
      toast.error('Please choose a supermarket for this delivery');
      return;
    }

    setSearching(true);
    try {
      await trackUIInteraction('click', 'search_riders', {
        pickup_location: selectedPickup?.name,
        dropoff_location: selectedDropoff?.name,
        customer_id: customerId,
        service_type: serviceType,
      });

      let riders: MatchedRider[];
      if (needsCrossBorderPath) {
        // Cross-border normal delivery — matched against cargo couriers
        // (van/truck), not boda/car passenger riders.
        const { data, error } = await supabase.rpc('mbg_find_available_vehicles', {
          p_pickup_lat: selectedPickup.coordinates.lat,
          p_pickup_lng: selectedPickup.coordinates.lng,
          p_dropoff_lat: selectedDropoff.coordinates.lat,
          p_dropoff_lng: selectedDropoff.coordinates.lng,
          p_country: pickupCountry!.name,
          p_vehicle_types: ['van', 'truck'],
          p_operator_type: 'cargo',
          p_exclude_rider_ids: [],
          p_limit: 10,
          p_business_profile_id: riderProviderFilter === 'company' ? (selectedRideCompanyId || null) : null,
        });
        if (error) throw error;
        // Synthesizes the boda-only fields (mode/power/umbrella/etc.) cargo
        // couriers don't have, so the existing RiderCard UI can render them
        // unchanged.
        riders = (data || []).map((v: any) => ({
          rider_id: v.rider_id,
          full_name: v.full_name,
          phone: v.phone,
          rating: v.rating,
          total_rides: 0,
          vehicle_type: v.vehicle_type,
          power_type: 'fuel',
          has_umbrella: false,
          plate_number: v.plate_number,
          vehicle_color: '',
          mode: 'normal',
          distance_to_pickup_km: v.distance_to_pickup_km,
          estimated_arrival_min: Math.max(5, Math.round((v.distance_to_pickup_km ?? 20) / 40 * 60)),
          knows_destination: false,
          fare: v.fare,
          distance_km: v.distance_km,
          time_multiplier: 1,
        }));
      } else {
        const { data, error } = await supabase.rpc('mbg_find_available_riders', {
          p_pickup_lat: selectedPickup.coordinates.lat,
          p_pickup_lng: selectedPickup.coordinates.lng,
          p_dropoff_lat: selectedDropoff.coordinates.lat,
          p_dropoff_lng: selectedDropoff.coordinates.lng,
          p_dropoff_area: selectedDropoff.area,
          p_power_type: powerFilter === 'any' ? null : powerFilter,
          p_require_umbrella: umbrellaRequired,
          p_exclude_rider_ids: [],
          p_limit: 10,
          p_vehicle_types: vehicleTypeFilter === 'any' ? null : [vehicleTypeFilter],
          p_business_profile_id: riderProviderFilter === 'company' ? (selectedRideCompanyId || null) : null,
        });
        if (error) throw error;
        riders = (data || []) as MatchedRider[];
      }
      setMatchedRiders(riders);

      await trackUIInteraction('success', 'riders_found', {
        riders_count: riders.length,
        pickup_location: selectedPickup?.name,
        dropoff_location: selectedDropoff?.name,
      });

      if (riders.length === 0) {
        toast.error('No available riders match your filters right now');
      } else {
        toast.success(`Found ${riders.length} available riders near you!`);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Failed to find riders');
    } finally {
      setSearching(false);
    }
  };

  // "Just Send" — reuses the exact same matching call as "Find Available
  // Riders" (mbg_find_available_riders already ranks best-first), just
  // skips showing the list and requests its top result directly, then flags
  // the ride for the server-side auto-dispatch cascade instead of the
  // single-rider 30s wait.
  const handleJustSend = async () => {
    if (!selectedPickup || !selectedDropoff) {
      toast.error('Please select both pickup and drop-off locations from suggestions');
      return;
    }
    if (serviceType === 'delivery' && deliveryMode === 'supermarket' && !selectedSupermarketId) {
      toast.error('Please choose a supermarket for this delivery');
      return;
    }
    if (needsCrossBorderPath) {
      toast.error('Cross-border deliveries need a specific courier — please pick one from the list below');
      return;
    }

    setAutoDispatching(true);
    try {
      const { data, error } = await supabase.rpc('mbg_find_available_riders', {
        p_pickup_lat: selectedPickup.coordinates.lat,
        p_pickup_lng: selectedPickup.coordinates.lng,
        p_dropoff_lat: selectedDropoff.coordinates.lat,
        p_dropoff_lng: selectedDropoff.coordinates.lng,
        p_dropoff_area: selectedDropoff.area,
        p_power_type: powerFilter === 'any' ? null : powerFilter,
        p_require_umbrella: umbrellaRequired,
        p_exclude_rider_ids: [],
        p_limit: 5,
        p_vehicle_types: vehicleTypeFilter === 'any' ? null : [vehicleTypeFilter],
        p_business_profile_id: riderProviderFilter === 'company' ? (selectedRideCompanyId || null) : null,
      });
      if (error) throw error;
      const riders = (data || []) as MatchedRider[];
      setMatchedRiders(riders);

      if (riders.length === 0) {
        toast.error('No available riders match right now — try again shortly');
        return;
      }

      await handleRequestRide(riders[0], { auto: true });
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send this request');
    } finally {
      setAutoDispatching(false);
    }
  };

  const handleRequestRide = async (rider: MatchedRider, opts?: { auto?: boolean }) => {
    if (serviceType === 'delivery' && deliveryMode === 'supermarket' && deliveryCart.length === 0) {
      toast.error('Add at least one item from the store before requesting a delivery');
      return;
    }
    if (
      serviceType === 'delivery' && deliveryMode === 'supermarket' &&
      (maxDeliveryHours < deliveryWindowBounds.min || maxDeliveryHours > deliveryWindowBounds.max)
    ) {
      toast.error(`Choose a delivery window between ${deliveryWindowBounds.min} and ${deliveryWindowBounds.max} hours`);
      return;
    }
    if (serviceType === 'delivery' && deliveryExpenseType === 'business_expense' && myBusinesses.length > 1 && !selectedBusinessId) {
      toast.error('Choose which business this delivery is for');
      return;
    }

    // Paying a store for real goods (not just the ride fare) with the
    // ICANera wallet — require the transaction PIN here, before the order
    // even goes out, same as any other wallet-funded payment in this app.
    // The actual debit + credit to the store's business wallet still only
    // happens once the rider accepts (mbg_respond_to_ride); this is the
    // customer's up-front authorization to spend from their wallet on it.
    if (serviceType === 'delivery' && deliveryMode === 'supermarket' && paymentMethod === 'wallet') {
      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData?.user;
      if (!authUser) {
        toast.error('Please sign in again to pay this store from your wallet');
        return;
      }
      const pin = window.prompt('Enter your transaction PIN to pay this store from your ICANera wallet:');
      if (pin === null) return;
      const pinCheck = await verifyPin(authUser.id, pin);
      if (!pinCheck.success) {
        toast.error(pinCheck.error || 'Incorrect PIN. Order not sent.');
        return;
      }
    }

    setSelectedRider(rider);
    setRideStatus('waiting_acceptance');
    setWaitingTimer(30);
    setIsAutoDispatch(!!opts?.auto);
    setAutoCandidateId(opts?.auto ? rider.rider_id : null);

    try {
      const orderNotes = deliveryCart.length > 0
        ? deliveryCart.map(l => `${l.qty}x ${l.product.name}`).join(', ')
        : null;
      // Structured, priced cart — this is what lets the store actually get
      // paid for the goods (separately from the ride fare) at acceptance.
      // Only meaningful for a store delivery; only sent on the plain
      // mbg_request_ride call below (mbg_request_company_ride doesn't take
      // a p_cart param).
      const cartPayload = serviceType === 'delivery' && deliveryMode === 'supermarket' && deliveryCart.length > 0
        ? deliveryCart.map(l => ({ product_id: l.product.id, quantity: l.qty }))
        : null;

      const requestArgs = {
        p_service_type: serviceType,
        p_delivery_mode: serviceType === 'delivery' ? deliveryMode : null,
        p_supermarket_id: serviceType === 'delivery' && deliveryMode === 'supermarket' ? selectedSupermarketId : null,
        p_rider_id: rider.rider_id,
        p_pickup_location: selectedPickup!.fullAddress,
        p_pickup_lat: selectedPickup!.coordinates.lat,
        p_pickup_lng: selectedPickup!.coordinates.lng,
        p_dropoff_location: selectedDropoff!.fullAddress,
        p_dropoff_lat: selectedDropoff!.coordinates.lat,
        p_dropoff_lng: selectedDropoff!.coordinates.lng,
        p_power_type_requested: powerFilter === 'any' ? null : powerFilter,
        p_umbrella_requested: umbrellaRequired,
        p_order_notes: orderNotes,
      };
      const { data, error } = needsCrossBorderPath
        ? await supabase.rpc('mbg_request_cross_border_delivery', {
            p_rider_id: rider.rider_id,
            p_pickup_location: selectedPickup!.fullAddress,
            p_pickup_lat: selectedPickup!.coordinates.lat,
            p_pickup_lng: selectedPickup!.coordinates.lng,
            p_pickup_country: pickupCountry!.name,
            p_dropoff_location: selectedDropoff!.fullAddress,
            p_dropoff_lat: selectedDropoff!.coordinates.lat,
            p_dropoff_lng: selectedDropoff!.coordinates.lng,
            p_dropoff_country: dropoffCountry!.name,
            p_order_notes: orderNotes,
          })
        : paymentMethod === 'company'
          ? await supabase.rpc('mbg_request_company_ride', requestArgs)
          : await supabase.rpc('mbg_request_ride', {
              ...requestArgs,
              p_payment_method: paymentMethod,
              p_cart: cartPayload,
              p_max_delivery_hours: deliveryMode === 'supermarket' ? maxDeliveryHours : null,
              p_expense_classification: serviceType === 'delivery' ? deliveryExpenseType : null,
              p_customer_business_profile_id: serviceType === 'delivery' && deliveryExpenseType === 'business_expense'
                ? (selectedBusinessId || null)
                : null,
            });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not create the request');

      setRideId(data.ride_id);

      // Flips this ride into the server-owned cascade (mbg_sweep_auto_dispatch_cascade,
      // pg_cron every 10s) instead of the plain single-rider offer just created above.
      if (opts?.auto) {
        supabase.rpc('mbg_mark_ride_auto_dispatch', {
          p_ride_id: data.ride_id,
          p_vehicle_types: vehicleTypeFilter === 'any' ? null : [vehicleTypeFilter],
        }).then(({ error: markError }) => {
          if (markError) console.error('[EnhancedRideRequest] mbg_mark_ride_auto_dispatch failed:', markError);
        });
      }

      if (escortRequested) {
        supabase.rpc('mbg_request_ride_escort', {
          p_ride_id: data.ride_id,
          p_business_profile_id: selectedSecurityCompanyId || null,
        }).then(({ data: escortData, error: escortError }) => {
          if (escortError || !escortData?.success) {
            toast.error(escortData?.error || 'Could not arrange a security escort for this ride');
          } else {
            toast.success('Security escort requested');
          }
        });
      }

      await trackRideCall('start_ride', rider.rider_id, {
        rider_name: rider.full_name,
        rider_rating: rider.rating,
        estimated_fare: data.fare,
        customer_id: customerId,
        pickup_location: selectedPickup?.name,
        dropoff_location: selectedDropoff?.name,
      });

      toast.info(`Request sent to ${rider.full_name}`, {
        description: 'Waiting for rider to accept...'
      });
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send this request');
      setRideStatus(null);
      setSelectedRider(null);
    }
  };

  // "Just send security" — no vehicle picked, no rider list. The backend
  // (mbg_request_security) decides whether the best-available escort brings
  // their own vehicle (one order, one fare) or needs a driver paired in
  // alongside them (ride fare + escort fee, same as the add-on toggle
  // above) — see CREATE_SECURITY_ONLY_ESCORT_BOOKING.sql for why that
  // decision can't just be "always charge both".
  const handleRequestSecurityOnly = async () => {
    if (!selectedPickup || !selectedDropoff) {
      toast.error('Choose a pickup and dropoff first');
      return;
    }
    setSecurityOnlyLoading(true);
    try {
      const { data, error } = await supabase.rpc('mbg_request_security', {
        p_pickup_location: selectedPickup.fullAddress,
        p_pickup_lat: selectedPickup.coordinates.lat,
        p_pickup_lng: selectedPickup.coordinates.lng,
        p_dropoff_location: selectedDropoff.fullAddress,
        p_dropoff_lat: selectedDropoff.coordinates.lat,
        p_dropoff_lng: selectedDropoff.coordinates.lng,
        p_country: pickupCountry?.name || 'Uganda',
        p_business_profile_id: selectedSecurityCompanyId || null,
        p_passenger_count: securityPassengerCount,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not arrange security right now');

      const { data: riderInfo } = await supabase.rpc('mbg_get_ride_rider_info', { p_ride_id: data.ride_id });
      const info = riderInfo?.[0];

      setSelectedRider({
        rider_id: info?.rider_id || '',
        full_name: info?.full_name || 'Security escort',
        phone: info?.phone ?? null,
        rating: info?.rating ?? 0,
        total_rides: info?.total_rides ?? 0,
        vehicle_type: info?.vehicle_type || 'motorcycle',
        power_type: (info?.power_type as 'electric' | 'fuel') || 'fuel',
        has_umbrella: info?.has_umbrella ?? false,
        plate_number: info?.plate_number || '',
        vehicle_color: info?.vehicle_color || '',
        mode: (info?.mode as MatchedRider['mode']) || 'normal',
        distance_to_pickup_km: null,
        estimated_arrival_min: 10,
        knows_destination: false,
        fare: data.fare,
        distance_km: data.distance_km,
        time_multiplier: 1,
      });
      setRideId(data.ride_id);
      setRideStatus('waiting_acceptance');
      setWaitingTimer(30);

      toast.success(
        data.mode === 'escort_self_transport'
          ? 'Security escort requested — they bring their own vehicle, one fare covers it'
          : 'Security requested — pairing a driver with an escort for you',
        { description: 'Waiting for acceptance...' }
      );
    } catch (error: any) {
      toast.error(error?.message || 'Failed to request security');
    } finally {
      setSecurityOnlyLoading(false);
    }
  };

  // Lets the customer switch wallet <-> cash any time before the trip is
  // marked complete — e.g. they decide at the destination they'd rather
  // pay differently than what they picked when requesting the ride.
  const handleChangePaymentMethod = async (method: 'wallet' | 'cash') => {
    if (!rideId || method === paymentMethod) return;
    try {
      const { data, error } = await supabase.rpc('mbg_update_ride_payment_method', {
        p_ride_id: rideId,
        p_payment_method: method,
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not change payment method');
      setPaymentMethod(method);
      toast.success(`Payment method changed to ${method === 'wallet' ? 'ICANera Wallet' : 'Cash'}`);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to change payment method');
    }
  };

  const handleTimeout = async () => {
    if (rideId) {
      try {
        await supabase.rpc('mbg_withdraw_ride_offer', { p_ride_id: rideId });
      } catch (_) {}
    }
    if (selectedRider) {
      await trackRideCall('decline_ride', selectedRider.rider_id, {
        rider_name: selectedRider.full_name,
        customer_id: customerId,
        reason: 'timeout',
      });
    }
    setRideStatus('declined');
  };

  const handleBackToSearch = async () => {
    if (rideId && rideStatus === 'waiting_acceptance') {
      try {
        // Auto-dispatch rides must be actually cancelled (terminal status) —
        // mbg_withdraw_ride_offer only clears rider_id and leaves the row
        // 'pending', which the cascade sweep would just pick back up and
        // reassign to yet another rider on its next 10s tick.
        if (isAutoDispatch) {
          await supabase.rpc('mbg_cancel_ride', { p_ride_id: rideId, p_reason: 'Cancelled by customer' });
        } else {
          await supabase.rpc('mbg_withdraw_ride_offer', { p_ride_id: rideId });
        }
      } catch (_) {}
    }
    setMatchedRiders(prev => prev.filter(r => r.rider_id !== selectedRider?.rider_id));
    setRideStatus(null);
    setSelectedRider(null);
    setRideId(null);
    setIsAutoDispatch(false);
    setAutoCandidateId(null);
  };

  const handleStartNewRide = () => {
    setPickup('');
    setDropoff('');
    setSelectedPickup(null);
    setSelectedDropoff(null);
    setMatchedRiders([]);
    setSelectedRider(null);
    setRideStatus(null);
    setRideId(null);
    setIsAutoDispatch(false);
    setAutoCandidateId(null);
    setPickupSuggestions([]);
    setDropoffSuggestions([]);
    setSelectedSupermarketId('');
    setPickupIsAutoFromSupermarket(false);
    setRouteInfo(null);
  };

  const handleCancelRide = async () => {
    if (rideId) {
      try {
        const { error } = await supabase.rpc('mbg_cancel_ride', { p_ride_id: rideId, p_reason: 'Cancelled by customer' });
        if (error) throw error;
      } catch (error: any) {
        toast.error(error?.message || 'Failed to cancel ride');
        return;
      }
    }
    toast.info('Ride cancelled');
    handleStartNewRide();
  };

  const handleClearSearch = () => {
    setPickup('');
    setDropoff('');
    setSelectedPickup(null);
    setSelectedDropoff(null);
    setMatchedRiders([]);
    setSelectedRider(null);
    setRideStatus(null);
    setRideId(null);
    setIsAutoDispatch(false);
    setAutoCandidateId(null);
    setPickupSuggestions([]);
    setDropoffSuggestions([]);
    setSelectedSupermarketId('');
    setPickupIsAutoFromSupermarket(false);
    setRouteInfo(null);
  };

  // "More options" (driver source + security escort) starts collapsed so the
  // form leads with the two things everyone needs: where to, and what ride.
  const [extrasOpen, setExtrasOpen] = useState(false);

  // Rider results render below a long form — bring them into view as soon as
  // a search returns instead of leaving the customer to scroll for them.
  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (matchedRiders.length > 0) {
      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [matchedRiders.length]);

  // Swap pickup and drop-off (return trips). Only offered once both are set,
  // and never for a store delivery where the pickup is the locked store.
  const handleSwapLocations = () => {
    if (!selectedPickup || !selectedDropoff || pickupIsAutoFromSupermarket) return;
    setPickup(dropoff);
    setDropoff(pickup);
    setSelectedPickup(selectedDropoff);
    setSelectedDropoff(selectedPickup);
    setPickupSuggestions([]);
    setDropoffSuggestions([]);
    setShowPickupSuggestions(false);
    setShowDropoffSuggestions(false);
    setMatchedRiders([]);
    setRouteInfo(null);
  };

  // Journey mode takes over the whole screen — it's a completely different
  // multi-leg flow (flight + boda + destination driver, or road->sea->road
  // cargo), not a variant of the single-hop ride form below. Reachable
  // either via the manual "Flying somewhere?" toggle (showJourneyOption)
  // or automatically when needsJourneyPath below detects the pickup/dropoff
  // pair can't be a normal boda/car/van trip at all.
  if (bookingMode === 'journey') {
    const prefillFromAutoRedirect = needsJourneyPath && selectedPickup && selectedDropoff;
    return (
      <div className="space-y-4">
        <button
          onClick={() => { setBookingMode('ride'); setResumeJourneyId(null); onJourneyClosed?.(); }}
          className="text-sm text-orange-600 hover:text-orange-700 flex items-center gap-1 font-medium"
        >
          <ArrowLeft size={16} /> Back to Book a Ride
        </button>
        <JourneyBookingFlow
          key={resumeJourneyId ?? 'new-journey'}
          customerId={customerId}
          resumeJourneyId={resumeJourneyId ?? undefined}
          initialBookingKind={prefillFromAutoRedirect ? (serviceType === 'delivery' ? 'ship' : 'fly') : undefined}
          initialShipPickup={
            prefillFromAutoRedirect && serviceType === 'delivery'
              ? { lat: selectedPickup!.coordinates.lat, lng: selectedPickup!.coordinates.lng, address: selectedPickup!.fullAddress }
              : undefined
          }
          initialShipDropoff={
            prefillFromAutoRedirect && serviceType === 'delivery'
              ? { lat: selectedDropoff!.coordinates.lat, lng: selectedDropoff!.coordinates.lng, address: selectedDropoff!.fullAddress }
              : undefined
          }
          initialPickupCountryIso2={prefillFromAutoRedirect ? pickupCountry?.iso2 : undefined}
        />
      </div>
    );
  }

  // Auto-redirect card — shown once both pickup and dropoff are chosen and
  // they turn out to need a plane or ship. Replaces the normal search/request
  // form entirely rather than letting the customer search for and request a
  // real nearby boda/car/van rider for a trip no such rider could ever
  // fulfil (the Uganda-\>Antigua case this was built for).
  if (needsJourneyPath && selectedPickup && selectedDropoff) {
    return (
      <div className="classic-card p-6 sm:p-8 text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-full bg-violet-100 flex items-center justify-center text-violet-600">
          <Plane size={28} />
        </div>
        <h3 className="text-lg font-bold text-slate-800">This trip needs a flight or ship</h3>
        <p className="text-sm text-slate-500">
          {pickupCountry?.name} → {dropoffCountry?.name} isn't reachable by a normal boda, car, or van trip.
          Book it as a journey instead — real flight pricing for passengers, or a flat-fee sea crossing for cargo.
        </p>
        <button
          onClick={() => setBookingMode('journey')}
          className="w-full py-3 bg-violet-600 text-white font-semibold rounded-xl hover:bg-violet-700 transition-all flex items-center justify-center gap-2"
        >
          <Plane size={18} /> Book a Journey
        </button>
      </div>
    );
  }

  // Render different UI based on ride status
  if (rideStatus === 'waiting_acceptance' && selectedRider) {
    return (
      <WaitingForAcceptance
        rider={selectedRider}
        timer={waitingTimer}
        isAutoDispatch={isAutoDispatch}
        candidates={matchedRiders}
        activeRiderId={autoCandidateId}
        onCancel={handleBackToSearch}
      />
    );
  }

  if (rideStatus === 'declined' && selectedRider) {
    return <RideDeclined rider={selectedRider} isAutoDispatch={isAutoDispatch} onBackToRiders={handleBackToSearch} onStartNew={handleStartNewRide} />;
  }

  if (rideStatus === 'accepted' && selectedRider) {
    return (
      <RiderOnTheWay
        rider={selectedRider}
        pickup={selectedPickup!}
        dropoff={selectedDropoff!}
        onCancel={handleCancelRide}
        rideId={rideId}
        customerId={customerId}
        customerName={customerName}
        riderUserId={riderUserId}
        paymentMethod={paymentMethod}
        onChangePaymentMethod={handleChangePaymentMethod}
      />
    );
  }

  if (rideStatus === 'journey_started' && selectedRider) {
    return (
      <JourneyStarted
        rider={selectedRider}
        pickup={selectedPickup!}
        dropoff={selectedDropoff!}
        rideId={rideId}
        customerId={customerId}
        customerName={customerName}
        riderUserId={riderUserId}
        paymentMethod={paymentMethod}
        onChangePaymentMethod={handleChangePaymentMethod}
      />
    );
  }

  if (rideStatus === 'completed' && selectedRider) {
    return (
      <JourneyCompleted
        rider={selectedRider}
        pickup={selectedPickup!}
        dropoff={selectedDropoff!}
        onStartNew={handleStartNewRide}
        paymentMethod={paymentMethod}
      />
    );
  }

  const routeReady = !!selectedPickup && !!selectedDropoff;
  const isDelivery = serviceType === 'delivery';
  // Delivery gets its own "details" step first, so the numbering shifts by one.
  const stepBase = isDelivery ? 1 : 0;
  const formTitle = serviceType === 'ride'
    ? 'Book a Ride'
    : deliveryMode === 'supermarket'
    ? 'Delivery From a Supermarket'
    : 'Normal Delivery';
  const selectedCompanyName = rideCompanies.find(c => c.business_profile_id === selectedRideCompanyId)?.business_name;
  const extrasSummary = [
    riderProviderFilter === 'company' && selectedCompanyName ? selectedCompanyName : 'Nearest available driver',
    escortRequested ? 'Security escort' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="space-y-5">
      {/* Hero — same ink-and-gold treatment as the Overview's Book a Ride tile */}
      <div className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-[#231b12] via-[#2f2415] to-[#4a3418] p-4 min-[360px]:p-5 text-white shadow-[0_18px_34px_-16px_rgba(0,0,0,0.65)] ring-1 ring-inset ring-[#c4a052]/40">
        <span aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full border border-[#c4a052]/25" />
        <span aria-hidden className="pointer-events-none absolute -right-5 -top-5 h-28 w-28 rounded-full border border-[#c4a052]/20" />
        <span aria-hidden className="pointer-events-none absolute -bottom-14 -left-10 h-40 w-40 rounded-full bg-orange-500/20 blur-2xl" />
        <div className="relative flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#e6c980]">{isDelivery ? 'Send anything' : 'Get moving'}</p>
            <h2 className="mt-1 font-classic-display text-[24px] font-bold leading-tight">{formTitle}</h2>
            <p className="mt-1 text-[13px] text-white/70">
              {isDelivery ? 'The nearest available rider collects and delivers it' : 'Boda, car, van or truck — nearest driver first'}
            </p>
          </div>
          <span className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-full bg-white/5 ring-1 ring-[#c4a052]/50 min-[360px]:h-16 min-[360px]:w-16">
            {isDelivery
              ? <Package size={30} strokeWidth={1.4} className="text-[#e6c980]" />
              : <Bike size={32} strokeWidth={1.4} className="text-[#e6c980]" />}
          </span>
        </div>
      </div>

      {showJourneyOption && (
        <button
          type="button"
          onClick={() => setBookingMode('journey')}
          className="classic-card flex w-full items-center gap-3 p-3.5 text-left transition-all active:scale-[0.99] hover:border-violet-300"
        >
          <span className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-600 ring-1 ring-inset ring-black/5">
            <Plane size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-tight text-slate-800">
              {isDelivery ? 'Sending it overseas?' : 'Flying somewhere?'}
            </span>
            <span className="mt-0.5 block text-xs text-slate-500">
              {isDelivery ? 'Book a full journey to ship cargo across borders' : 'Book a full journey — flight plus a ride at each end'}
            </span>
          </span>
          <ArrowRight size={16} className="flex-shrink-0 text-slate-400" />
        </button>
      )}

      {/* Journeys already booked, so they can be opened and tracked from here
          too (renders nothing when there are none). */}
      {showJourneyOption && customerId && (
        <JourneyTracker
          customerId={customerId}
          compact
          onOpen={(id) => { setResumeJourneyId(id); setBookingMode('journey'); }}
        />
      )}

      {/* Service type — hidden when the parent tab already fixes it, so
          "Book a Ride" and "Delivery" stay separate instead of one
          screen that toggles between both */}
      {!fixedServiceType && (
        <div className="classic-card grid grid-cols-2 gap-2 p-3">
          <button
            onClick={() => setServiceType('ride')}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
              serviceType === 'ride' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
            }`}
          >
            <Bike size={16} /> Ride
          </button>
          <button
            onClick={() => setServiceType('delivery')}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
              serviceType === 'delivery' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
            }`}
          >
            <Package size={16} /> Delivery
          </button>
        </div>
      )}

      {/* Delivery details — store picker, personal/business, delivery window */}
      {isDelivery && (
        <div className="classic-card p-4 sm:p-5 space-y-4">
          <StepHeading n={1}>Delivery details</StepHeading>
          {/* Delivery mode + supermarket picker */}
          {serviceType === 'delivery' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setDeliveryMode('supermarket')}
                  className={`py-2 rounded-lg text-xs sm:text-sm font-semibold border-2 transition-all ${
                    deliveryMode === 'supermarket' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'
                  }`}
                >
                  🏬 From a Store
                </button>
                <button
                  onClick={() => setDeliveryMode('normal')}
                  className={`py-2 rounded-lg text-xs sm:text-sm font-semibold border-2 transition-all ${
                    deliveryMode === 'normal' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'
                  }`}
                >
                  📦 Normal Delivery
                </button>
              </div>

              {/* Personal vs Business — applies to the WHOLE order (goods +
                  fare for a store delivery, just the fare for a normal one),
                  so it shows up as one consistent side of the ICANera Wallet
                  Personal/Business split instead of being silently divided.
                  A customer who belongs to more than one real business (owner
                  of one, team member of another, co-owner of a third — see
                  mbg_my_business_memberships) gets to say which one this
                  delivery is filed under, same as the ICAN Wallet's own
                  PayMoneyModal already lets them do for a direct payment. */}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">This delivery is for</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setDeliveryExpenseType('personal_expense')}
                    className={`py-2 rounded-lg text-xs sm:text-sm font-semibold border-2 transition-all ${
                      deliveryExpenseType === 'personal_expense' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    👤 Personal
                  </button>
                  <button
                    onClick={() => setDeliveryExpenseType('business_expense')}
                    className={`py-2 px-2 rounded-lg text-xs sm:text-sm font-semibold border-2 transition-all truncate ${
                      deliveryExpenseType === 'business_expense' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500'
                    }`}
                    title={myBusinesses.length === 1 ? myBusinesses[0].business_name : undefined}
                  >
                    🏢 {myBusinesses.length === 1 ? myBusinesses[0].business_name : 'Business'}
                  </button>
                </div>

                {deliveryExpenseType === 'business_expense' && (
                  loadingMyBusinesses ? (
                    <p className="text-[11px] text-slate-400 mt-1">Loading your businesses…</p>
                  ) : myBusinesses.length > 1 ? (
                    <div className="mt-1.5">
                      <p className="text-[11px] text-slate-500 mb-1">Which business is this for?</p>
                      <select
                        value={selectedBusinessId}
                        onChange={(e) => setSelectedBusinessId(e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-400 outline-none"
                      >
                        <option value="">Select a business…</option>
                        {myBusinesses.map(b => (
                          <option key={b.id} value={b.id}>{b.business_name}</option>
                        ))}
                      </select>
                    </div>
                  ) : myBusinesses.length === 0 ? (
                    <p className="text-[11px] text-amber-600 mt-1">
                      No business profile found on your account — this will still be recorded as a business expense.
                    </p>
                  ) : (
                    <p className="text-[11px] text-purple-600 mt-1">
                      Filed as a business expense under {myBusinesses[0].business_name}.
                    </p>
                  )
                )}
              </div>

              {/* Normal Delivery's own smart on-ramp: real products auto-loaded
                  from the closest few stores, no store picked yet. Purely a
                  shortcut — tapping anything here commits to that one store
                  via jumpToStoreProduct, same as manually choosing it in
                  "From a Store" would. */}
              {deliveryMode === 'normal' && (() => {
                const previewCandidates = nearestAnyStores.slice(0, 8);
                const storesWithProducts = previewCandidates.filter(sm => (nearbyStoreProducts[sm.id]?.length ?? 0) > 0).slice(0, 3);
                const stillLoading = loadingNearbyProducts && storesWithProducts.length === 0 && previewCandidates.some(sm => !(sm.id in nearbyStoreProducts));
                return (
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-1.5">🛒 Or shop from a nearby store</p>
                    {!customerGpsLocation && (
                      <p className="text-[11px] text-slate-400 mb-1.5">📍 Turn on location to see which store is actually nearest.</p>
                    )}
                    {supermarkets.length === 0 ? (
                      <p className="text-[11px] text-slate-400">No stores registered yet.</p>
                    ) : stillLoading && storesWithProducts.length === 0 ? (
                      <p className="text-xs text-slate-400 py-3 text-center">Loading nearby stores…</p>
                    ) : storesWithProducts.length === 0 ? (
                      <p className="text-[11px] text-slate-400">Stores near you haven't listed products yet — describe what you need below instead.</p>
                    ) : (
                      <div className="space-y-3">
                        {storesWithProducts.map(sm => {
                          const products = nearbyStoreProducts[sm.id] || [];
                          return (
                            <div key={sm.id} className="border border-slate-200 rounded-lg p-2.5">
                              <button type="button" onClick={() => jumpToStoreProduct(sm.id)} className="w-full flex items-center justify-between gap-2 mb-2 text-left">
                                <span className="min-w-0 truncate text-xs font-semibold text-slate-700">
                                  {typeEmoji(sm.business_type)} {sm.name}
                                  {sm.distanceKm != null && (
                                    <span className="ml-1.5 text-[10px] font-normal text-slate-400">
                                      {sm.distanceKm < 1 ? `${Math.round(sm.distanceKm * 1000)}m away` : `${sm.distanceKm.toFixed(1)}km away`}
                                    </span>
                                  )}
                                </span>
                                <span className="flex-shrink-0 text-[11px] text-blue-600 font-medium">Shop here →</span>
                              </button>
                              <div className="flex gap-2 overflow-x-auto pb-0.5">
                                {products.map(p => (
                                  <button
                                    key={p.id}
                                    type="button"
                                    onClick={() => jumpToStoreProduct(sm.id)}
                                    className="flex-shrink-0 w-20 text-left"
                                  >
                                    <div className="w-20 h-20 rounded-lg bg-slate-100 overflow-hidden flex items-center justify-center">
                                      {p.image_url ? (
                                        <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                                      ) : (
                                        <Package size={18} className="text-slate-300" />
                                      )}
                                    </div>
                                    <p className="text-[10px] text-slate-700 truncate mt-1">{p.name}</p>
                                    <p className="text-[10px] text-orange-600 font-semibold">
                                      UGX {Math.round(Number(p.price_ugx) * (1 + (p.tax_rate || 0) / 100)).toLocaleString()}
                                    </p>
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {deliveryMode === 'supermarket' && (
                <>
                  <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                    {BUSINESS_TYPE_FILTERS.map(f => (
                      <button
                        key={f.value}
                        onClick={() => setStoreTypeFilter(f.value)}
                        className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                          storeTypeFilter === f.value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        <span>{f.emoji}</span> {f.label}
                      </button>
                    ))}
                  </div>

                  {/* Always searchable, and ranked nearest-first once the
                      customer's GPS position resolves — see the
                      customerGpsLocation effect and filteredStores sort
                      above. */}
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={storeSearchQuery}
                      onChange={(e) => setStoreSearchQuery(e.target.value)}
                      placeholder="Search stores by name or area…"
                      className="w-full pl-8 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none"
                    />
                  </div>
                  {!customerGpsLocation && (
                    <p className="text-[11px] text-slate-400 -mt-1">
                      📍 Turn on location to see which store is nearest.
                    </p>
                  )}

                  <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {visibleStores.map(sm => (
                      <button
                        key={sm.id}
                        type="button"
                        onClick={() => setSelectedSupermarketId(sm.id)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                          selectedSupermarketId === sm.id ? 'bg-orange-50 text-orange-700' : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <span className="min-w-0 truncate flex items-center gap-1.5">
                          {typeEmoji(sm.business_type)} {sm.name} — {sm.location}
                          {sm.id === nearestStoreId && (
                            <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-semibold">Nearest</span>
                          )}
                        </span>
                        {sm.distanceKm != null && (
                          <span className="flex-shrink-0 text-xs text-slate-400">
                            {sm.distanceKm < 1 ? `${Math.round(sm.distanceKm * 1000)}m` : `${sm.distanceKm.toFixed(1)}km`}
                          </span>
                        )}
                      </button>
                    ))}
                    {visibleStores.length === 0 && (
                      <p className="px-3 py-3 text-xs text-slate-400 text-center">
                        {storeSearchQuery ? 'No stores match your search.' : 'No stores of this type yet.'}
                      </p>
                    )}
                  </div>

                  {selectedSupermarketId && (
                    <ProductPicker supermarketId={selectedSupermarketId} onCartChange={setDeliveryCart} />
                  )}

                  {selectedSupermarketId && deliveryCart.length > 0 && (
                    <div className="p-3 rounded-lg border-2 border-slate-200 bg-slate-50">
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Deliver within
                      </label>
                      <p className="text-xs text-slate-500 mb-2">
                        If your rider misses this window, you can claim a refund straight from your order receipt.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {[
                          { hours: 1, label: '1h · Express' },
                          { hours: 3, label: '3h · Standard' },
                          { hours: 6, label: '6h' },
                          { hours: 24, label: '24h · Tomorrow' },
                          { hours: 48, label: '48h · Flexible' },
                        ]
                          .filter(p => p.hours >= deliveryWindowBounds.min && p.hours <= deliveryWindowBounds.max)
                          .map(p => (
                            <button
                              key={p.hours}
                              type="button"
                              onClick={() => setMaxDeliveryHours(p.hours)}
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors ${
                                maxDeliveryHours === p.hours ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-600'
                              }`}
                            >
                              {p.label}
                            </button>
                          ))}
                        <label className="flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-white border border-slate-300 text-slate-600">
                          Custom
                          <input
                            type="number"
                            min={deliveryWindowBounds.min}
                            max={deliveryWindowBounds.max}
                            value={maxDeliveryHours}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (!Number.isNaN(v)) {
                                setMaxDeliveryHours(Math.min(Math.max(v, deliveryWindowBounds.min), deliveryWindowBounds.max));
                              }
                            }}
                            className="w-12 outline-none"
                          />
                          h
                        </label>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Route */}
      <div className="classic-card p-4 sm:p-5 space-y-4">
        <StepHeading
          n={1 + stepBase}
          action={
            <span className="flex flex-shrink-0 items-center gap-3">
              {routeReady && !pickupIsAutoFromSupermarket && (
                <button
                  type="button"
                  onClick={handleSwapLocations}
                  className="flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700"
                >
                  <ArrowUpDown size={13} /> Swap
                </button>
              )}
              {(pickup || dropoff) && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-orange-600"
                >
                  <X size={13} /> Clear
                </button>
              )}
            </span>
          }
        >
          Where to?
        </StepHeading>

        {/* Pickup Location */}
        <div ref={pickupRef} className="relative">
          <label className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Pickup
            {pickupIsAutoFromSupermarket && (
              <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-semibold normal-case tracking-normal">
                Auto-filled from supermarket
              </span>
            )}
          </label>
          <div className="relative">
            <span aria-hidden className="absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-[3px] border-green-500 bg-white" />
            <input
              type="text"
              value={pickupGeocodingStore ? 'Locating store…' : pickup}
              readOnly={pickupIsAutoFromSupermarket || pickupGeocodingStore}
              onChange={(e) => !pickupIsAutoFromSupermarket && handlePickupChange(e.target.value)}
              onFocus={() => !pickupIsAutoFromSupermarket && pickup && setShowPickupSuggestions(true)}
              placeholder="Where are you now? (e.g., Kampala Road, Acacia Mall)"
              className={`w-full pl-11 pr-9 py-3 border-2 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none text-slate-800 placeholder-slate-400 ${
                pickupIsAutoFromSupermarket || pickupGeocodingStore ? 'border-green-300 bg-green-50 cursor-default' : 'border-slate-200'
              }`}
            />
            {selectedPickup && (
              <CheckCircle size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500" />
            )}
          </div>
          {serviceType === 'delivery' && deliveryMode === 'supermarket' && selectedSupermarketId && !pickupIsAutoFromSupermarket && !pickupGeocodingStore && (
            <p className="text-xs text-amber-600 mt-1">
              Couldn't automatically locate this store — please confirm the pickup point manually.
            </p>
          )}

          {/* Smart nearest-place suggestion for normal delivery — only
              while the pickup is still empty, and only ever a tap-to-use
              suggestion, never auto-applied (see nearestAnyStore above). */}
          {serviceType === 'delivery' && deliveryMode === 'normal' && !selectedPickup && nearestAnyStore && (
            <button
              type="button"
              onClick={() => {
                const loc: Location = {
                  id: `supermarket_${nearestAnyStore.id}`,
                  name: nearestAnyStore.name,
                  area: nearestAnyStore.location,
                  fullAddress: nearestAnyStore.address || `${nearestAnyStore.name}, ${nearestAnyStore.location}`,
                  coordinates: { lat: nearestAnyStore.latitude as number, lng: nearestAnyStore.longitude as number },
                };
                setSelectedPickup(loc);
                setPickup(loc.fullAddress);
              }}
              className="mt-1.5 w-full flex items-center justify-between gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-left text-xs text-blue-700 hover:bg-blue-100 transition-colors"
            >
              <span className="truncate">
                📍 Nearest place: {typeEmoji(nearestAnyStore.business_type)} {nearestAnyStore.name}
                {' '}({(nearestAnyStore.distanceKm as number) < 1
                  ? `${Math.round((nearestAnyStore.distanceKm as number) * 1000)}m`
                  : `${(nearestAnyStore.distanceKm as number).toFixed(1)}km`})
              </span>
              <span className="flex-shrink-0 font-semibold">Use this</span>
            </button>
          )}
          {/* Pickup Suggestions */}
          {!pickupIsAutoFromSupermarket && showPickupSuggestions && pickupSuggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-2 bg-white border-2 border-slate-200 rounded-lg shadow-xl max-h-64 overflow-y-auto">
              {pickupSuggestions.map((location) => (
                <button
                  key={location.id}
                  onClick={() => selectPickupLocation(location)}
                  className="w-full text-left px-4 py-3 hover:bg-orange-50 border-b border-slate-100 last:border-b-0 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <MapPin className="text-orange-500 mt-1 flex-shrink-0" size={18} />
                    <div>
                      <div className="font-semibold text-slate-800">{location.name}</div>
                      <div className="text-sm text-slate-600">{location.fullAddress}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Dropoff Location */}
        <div ref={dropoffRef} className="relative">
          <label className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Drop-off
            {defaultDropoff && selectedDropoff?.id === defaultDropoff.id && (
              <span className="text-[10px] px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-semibold normal-case tracking-normal">
                Your default area
              </span>
            )}
          </label>
          <div className="relative">
            <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 text-red-500" size={18} />
            <input
              type="text"
              value={dropoff}
              onChange={(e) => handleDropoffChange(e.target.value)}
              onFocus={() => dropoff && setShowDropoffSuggestions(true)}
              placeholder="Where do you want to go? (e.g., Ntinda, Garden City)"
              className="w-full pl-11 pr-9 py-3 border-2 border-slate-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none text-slate-800 placeholder-slate-400"
            />
            {selectedDropoff && (
              <CheckCircle size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500" />
            )}
          </div>
          {/* Dropoff Suggestions */}
          {showDropoffSuggestions && dropoffSuggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-2 bg-white border-2 border-slate-200 rounded-lg shadow-xl max-h-64 overflow-y-auto">
              {dropoffSuggestions.map((location) => (
                <button
                  key={location.id}
                  onClick={() => selectDropoffLocation(location)}
                  className="w-full text-left px-4 py-3 hover:bg-orange-50 border-b border-slate-100 last:border-b-0 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <MapPin className="text-orange-500 mt-1 flex-shrink-0" size={18} />
                    <div>
                      <div className="font-semibold text-slate-800">{location.name}</div>
                      <div className="text-sm text-slate-600">{location.fullAddress}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {routeInfo && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-100">
              <Navigation size={12} />
              {routeInfo.distanceKm.toFixed(1)} km · ~{Math.round(routeInfo.durationMin)} min
            </span>
          </div>
        )}

        {/* Map picker — sets the same selectedPickup/selectedDropoff state
            as typing a suggestion above; either method works, and they
            stay in sync with each other. */}
        <button
          type="button"
          onClick={() => setShowMap(!showMap)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#c4a052]/60 py-2.5 text-sm font-semibold text-orange-700 hover:bg-orange-50 transition-colors"
        >
          <MapPin size={15} /> {showMap ? 'Hide map' : 'Pick on the map'}
        </button>
        {showMap && (
          <LocationPickerMap
            pickup={selectedPickup}
            dropoff={selectedDropoff}
            onPickupChange={handleMapPickupChange}
            onDropoffChange={handleMapDropoffChange}
            onRouteInfo={(distanceKm, durationMin) => setRouteInfo({ distanceKm, durationMin })}
            pickupLocked={pickupIsAutoFromSupermarket}
            gpsTarget={serviceType === 'delivery' && deliveryMode === 'supermarket' ? 'dropoff' : 'pickup'}
            height={300}
          />
        )}
      </div>

      {/* Ride options */}
      <div className="classic-card p-4 sm:p-5 space-y-4">
        <StepHeading n={2 + stepBase}>{needsCrossBorderPath ? 'Your courier' : isDelivery ? 'Choose a vehicle' : 'Choose your ride'}</StepHeading>

        {/* Cross-border delivery: mode/vehicle-type/power/rain-cover filters
            below don't apply to cargo couriers, so hide them and explain
            what's actually happening instead. */}
        {needsCrossBorderPath && (
          <div className="mb-4 p-3 rounded-lg border-2 border-orange-200 bg-orange-50 text-sm text-orange-800 flex items-start gap-2">
            <Truck size={16} className="mt-0.5 shrink-0" />
            <span>
              Cross-border delivery ({pickupCountry?.name} → {dropoffCountry?.name}) — matched with cargo couriers
              (van/truck), not boda/car riders. Ride-type and vehicle filters don't apply here.
            </span>
          </div>
        )}

        {!needsCrossBorderPath && (
          <>
            {/* Vehicle — matched against mbg_find_available_riders'
                p_vehicle_types filter so a request only reaches drivers of
                the chosen type. */}
            <div className="grid grid-cols-5 gap-2">
              {([
                { id: 'any' as VehicleTypeFilter, label: 'Any', icon: Sparkles },
                { id: 'motorcycle' as VehicleTypeFilter, label: 'Boda', icon: Bike },
                { id: 'car' as VehicleTypeFilter, label: 'Car', icon: Car },
                { id: 'van' as VehicleTypeFilter, label: 'Van', icon: Truck },
                { id: 'truck' as VehicleTypeFilter, label: 'Truck', icon: Truck },
              ]).map(opt => {
                const selected = vehicleTypeFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setVehicleTypeFilter(opt.id)}
                    className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 px-1 py-2.5 transition-all active:scale-[0.97] ${
                      selected ? 'border-orange-500 bg-orange-50 ring-2 ring-orange-200/70' : 'border-slate-200 hover:border-orange-300'
                    }`}
                  >
                    <span className={`grid h-10 w-10 place-items-center rounded-2xl ring-1 ring-inset ring-black/5 ${
                      selected ? 'bg-gradient-to-br from-orange-500 to-amber-400 text-white' : 'bg-orange-50 text-orange-600'
                    }`}>
                      <opt.icon size={20} />
                    </span>
                    <span className={`text-[11px] font-semibold ${selected ? 'text-orange-700' : 'text-slate-600'}`}>{opt.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Power / rain cover — only mean anything for a boda
                (motorcycle/bicycle/tuktuk); a car/van/truck has neither
                concept, so these only show for the Boda filter. */}
            {vehicleTypeFilter === 'motorcycle' && (
              <div className="grid grid-cols-3 gap-2">
                {(['any', 'electric', 'fuel'] as PowerFilter[]).map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setPowerFilter(opt)}
                    className={`flex items-center justify-center gap-1 py-2 rounded-xl text-xs sm:text-sm font-semibold border-2 transition-all ${
                      powerFilter === opt ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    {opt === 'electric' ? <Zap size={14} /> : opt === 'fuel' ? <Fuel size={14} /> : null}
                    {opt === 'any' ? 'Any Vehicle' : opt === 'electric' ? 'Electric' : 'Fuel'}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setUmbrellaRequired(!umbrellaRequired)}
                  className={`col-span-3 flex items-center justify-center gap-2 py-2 rounded-xl text-xs sm:text-sm font-semibold border-2 transition-all ${
                    umbrellaRequired ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'
                  }`}
                >
                  <Umbrella size={14} /> {umbrellaRequired ? 'Rain cover required' : 'Rain cover not required'}
                </button>
              </div>
            )}

            {/* Fare style — filters matched riders by their real pricing mode */}
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Fare style</p>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-hide">
                {(
                  [
                    { id: 'all' as ModePreference, label: 'All', icon: null },
                    { id: 'normal' as ModePreference, label: 'Normal', icon: DollarSign },
                    { id: 'vip' as ModePreference, label: 'VIP +10%', icon: Crown },
                    { id: 'discount' as ModePreference, label: 'Discount −10%', icon: Tag },
                    { id: 'return' as ModePreference, label: 'Return home −30%', icon: Home },
                  ] as const
                ).map(opt => {
                  const Icon = opt.icon;
                  const selected = modePreference === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setModePreference(opt.id)}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border-2 px-3.5 py-2 text-xs font-semibold whitespace-nowrap transition-all ${
                        selected
                          ? opt.id === 'return' ? 'border-green-500 bg-green-50 text-green-700' : 'border-orange-500 bg-orange-50 text-orange-700'
                          : 'border-slate-200 text-slate-500 hover:border-orange-300'
                      }`}
                    >
                      {Icon && <Icon size={13} />}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Payment + extras */}
      <div className="classic-card p-4 sm:p-5 space-y-4">
        <StepHeading n={3 + stepBase}>Payment</StepHeading>

        {/* Payment method — Wallet settles automatically the instant the
            trip ends, for the all-in amount shown as the fare; Cash means
            paying the rider directly in person. */}
        <div>
          <div className={companyTransport.eligible ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2'}>
            {companyTransport.eligible && (
              <button
                type="button"
                aria-pressed={paymentMethod === 'company'}
                onClick={() => setPaymentMethod('company')}
                className={`flex flex-col items-center gap-1 rounded-2xl border-2 py-3 text-xs sm:text-sm font-semibold transition-all active:scale-[0.98] ${
                  paymentMethod === 'company' ? 'border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200/70' : 'border-slate-200 text-slate-500'
                }`}
              >
                <span className="text-xl leading-none">🏢</span> Company
              </button>
            )}
            <button
              type="button"
              aria-pressed={paymentMethod === 'wallet'}
              onClick={() => setPaymentMethod('wallet')}
              className={`flex flex-col items-center gap-1 rounded-2xl border-2 py-3 text-xs sm:text-sm font-semibold transition-all active:scale-[0.98] ${
                paymentMethod === 'wallet' ? 'border-purple-500 bg-purple-50 text-purple-700 ring-2 ring-purple-200/70' : 'border-slate-200 text-slate-500'
              }`}
            >
              <span className="text-xl leading-none">🪙</span> ICANera Wallet
            </button>
            <button
              type="button"
              aria-pressed={paymentMethod === 'cash'}
              onClick={() => setPaymentMethod('cash')}
              className={`flex flex-col items-center gap-1 rounded-2xl border-2 py-3 text-xs sm:text-sm font-semibold transition-all active:scale-[0.98] ${
                paymentMethod === 'cash' ? 'border-green-500 bg-green-50 text-green-700 ring-2 ring-green-200/70' : 'border-slate-200 text-slate-500'
              }`}
            >
              <span className="text-xl leading-none">💵</span> Cash
            </button>
          </div>
          {paymentMethod === 'company' ? (
            <p className="text-[11px] text-blue-600 mt-2">Paid by {companyTransport.business_name || 'your company'} from its business wallet ({companyTransport.billing_mode === 'monthly' ? 'monthly settlement' : 'per ride'}).</p>
          ) : paymentMethod === 'wallet' ? (
            <p className="text-[11px] text-slate-400 mt-2">Charged automatically when the trip ends.</p>
          ) : (
            <p className="text-[11px] text-slate-400 mt-2">Pay the rider directly in cash at the end of the trip.</p>
          )}
        </div>

        <div className="landing-classic-divider" />

        {/* More options — collapsed by default (same pattern as the
            Overview's Recent Rides) with a one-line summary of what's set. */}
        <div>
          <button
            type="button"
            onClick={() => setExtrasOpen(o => !o)}
            aria-expanded={extrasOpen}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-orange-50 ring-1 ring-inset ring-orange-100">
                <SlidersHorizontal size={17} className="text-orange-500" />
              </span>
              <span className="min-w-0">
                <span className="block font-classic-display text-base font-semibold leading-tight text-slate-800">More options</span>
                <span className="block truncate text-xs text-slate-400">{extrasSummary}</span>
              </span>
            </span>
            <ChevronDown size={18} className={`flex-shrink-0 text-slate-400 transition-transform ${extrasOpen ? 'rotate-180' : ''}`} />
          </button>

          {extrasOpen && (
            <div className="mt-4 space-y-5">
              {/* Any available driver (nearest first) vs one specific
                  transport company's own roster — mbg_list_ride_companies /
                  p_business_profile_id on mbg_find_available_riders /
                  mbg_find_available_vehicles (ADD_COMPANY_CHOICE_TO_RIDE_AND_
                  ESCORT_REQUESTS.sql). Riders always come back nearest first,
                  so leaving the company unpicked simply means "nearest". */}
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Choose driver from</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRiderProviderFilter('any')}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                      riderProviderFilter === 'any' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    Anyone nearest
                  </button>
                  <button
                    type="button"
                    onClick={() => setRiderProviderFilter('company')}
                    className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                      riderProviderFilter === 'company' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
                    }`}
                  >
                    A specific company
                  </button>
                </div>
                {riderProviderFilter === 'company' && (
                  <>
                    <select
                      value={selectedRideCompanyId}
                      onChange={(e) => setSelectedRideCompanyId(e.target.value)}
                      className="mt-2 w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
                    >
                      <option value="">Any company — nearest available driver</option>
                      {rideCompanies.map((c) => (
                        <option key={c.business_profile_id} value={c.business_profile_id}>
                          {c.business_name} ({c.available_vehicles} available)
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {selectedRideCompanyId
                        ? 'Only this company\'s drivers are offered your trip, nearest first.'
                        : 'No company chosen — we\'ll use the nearest available driver from any company.'}
                    </p>
                    {rideCompanies.length === 0 && (
                      <p className="text-xs text-slate-400 mt-1">No transport companies with an available vehicle of this type right now.</p>
                    )}
                  </>
                )}
              </div>

              {/* Security escort add-on — available for both rides and
                  deliveries, assigned from mbg_riders rows with operator_type =
                  'escort' via mbg_request_ride_escort once the ride is created. */}
              <div>
                <button
                  type="button"
                  onClick={() => setEscortRequested(!escortRequested)}
                  className={`w-full flex items-center justify-between gap-2 py-3 px-3.5 rounded-xl text-sm font-semibold border-2 transition-all ${
                    escortRequested ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-500'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <ShieldCheck size={16} /> Add a security escort
                  </span>
                  {escortRequested && (
                    <span className="text-xs font-medium">
                      {escortFeeEstimate == null
                        ? 'Estimating…'
                        : Number.isNaN(escortFeeEstimate)
                        ? selectedSecurityCompanyId
                          ? "This company hasn't set escort pricing yet"
                          : 'No escort pricing set up yet'
                        : `+UGX ${escortFeeEstimate.toLocaleString()}`}
                    </span>
                  )}
                </button>
                {/* Which security company the escort comes from — same choice
                    (and shared selection) as the standalone "Just send security"
                    picker below. Left on "anyone available", the nearest
                    escort to the pickup is assigned. */}
                {escortRequested && (
                  <select
                    value={selectedSecurityCompanyId}
                    onChange={(e) => setSelectedSecurityCompanyId(e.target.value)}
                    className="mt-2 w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:ring-2 focus:ring-violet-500 outline-none"
                  >
                    <option value="">Anyone available — nearest to your pickup</option>
                    {securityCompanies.map((c) => (
                      <option key={c.business_profile_id} value={c.business_profile_id}>
                        {c.business_name} ({c.available_escorts} available)
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-3">
        {!routeReady && (
          <p className="text-center text-xs text-slate-500">
            Choose your pickup and drop-off above to see riders.
          </p>
        )}

        <button
          onClick={handleSearchRiders}
          disabled={searching || autoDispatching || !routeReady}
          className="w-full py-4 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-bold text-lg rounded-2xl hover:from-orange-600 hover:to-yellow-600 transition-all shadow-lg shadow-orange-500/25 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {searching ? (
            <>
              <div className="animate-spin w-5 h-5 border-3 border-white border-t-transparent rounded-full" />
              Searching for riders...
            </>
          ) : (
            <>
              <Search size={20} />
              Find Available Riders — Choose One
            </>
          )}
        </button>

        {!needsCrossBorderPath && (
          <button
            onClick={handleJustSend}
            disabled={searching || autoDispatching || !routeReady}
            className="classic-card w-full py-3.5 !border-2 !border-orange-400 text-orange-600 font-bold rounded-2xl hover:bg-orange-50 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {autoDispatching ? (
              <>
                <div className="animate-spin w-5 h-5 border-3 border-orange-400 border-t-transparent rounded-full" />
                Sending...
              </>
            ) : (
              <>
                <Zap size={20} />
                Just Send — Nearest Available Rider
              </>
            )}
          </button>
        )}
        <p className="text-[11px] text-slate-400 text-center">
          We'll offer it to the nearest rider first — if they don't respond in 10s, it moves to the next one automatically.
        </p>
      </div>

      {/* No vehicle of your own — skip picking a rider entirely and let
          the system decide whether the escort transports you directly
          or a driver gets paired in alongside them. */}
      {serviceType === 'ride' && !needsCrossBorderPath && (
        <div className="classic-card !border-violet-200 p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-600 ring-1 ring-inset ring-black/5">
              <ShieldCheck size={19} />
            </span>
            <div className="min-w-0">
              <p className="font-classic-display text-base font-semibold leading-tight text-slate-800">No transport of your own?</p>
              <p className="text-xs text-slate-500">Just send security — the nearest available escort comes to you.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={selectedSecurityCompanyId}
              onChange={(e) => setSelectedSecurityCompanyId(e.target.value)}
              className="border rounded-xl p-2 bg-white text-slate-900 text-xs"
            >
              <option value="">Anyone available (nearest)</option>
              {securityCompanies.map((c) => (
                <option key={c.business_profile_id} value={c.business_profile_id}>
                  {c.business_name} ({c.available_escorts} available)
                </option>
              ))}
            </select>

            <div className="flex items-center justify-between border rounded-xl bg-white px-2 py-1">
              <span className="text-xs text-slate-500">People</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSecurityPassengerCount((n) => Math.max(1, n - 1))}
                  className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 font-bold text-sm"
                >
                  −
                </button>
                <span className="text-sm font-semibold text-slate-800 w-4 text-center">{securityPassengerCount}</span>
                <button
                  type="button"
                  onClick={() => setSecurityPassengerCount((n) => Math.min(8, n + 1))}
                  className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 font-bold text-sm"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            If the escort has their own vehicle, that's your one fare. Otherwise we pair the nearest{' '}
            {securityPassengerCount <= 1 ? 'boda' : securityPassengerCount <= 4 ? 'car' : 'van'} with them automatically.
          </p>

          <button
            onClick={handleRequestSecurityOnly}
            disabled={securityOnlyLoading || !routeReady}
            className="w-full py-3 bg-violet-600 text-white font-semibold text-sm rounded-2xl hover:bg-violet-700 transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {securityOnlyLoading ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Arranging security...
              </>
            ) : (
              <>
                <ShieldCheck size={18} />
                Send Nearest Security
              </>
            )}
          </button>
        </div>
      )}

      {/* Matched Riders */}
      {matchedRiders.length > 0 && (() => {
        const displayedRiders = modePreference === 'all'
          ? matchedRiders
          : matchedRiders.filter(r => r.mode === modePreference);

        return (
          <div ref={resultsRef} className="classic-card scroll-mt-32 p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-3">
              <h3 className="font-classic-display text-lg font-semibold text-slate-800">
                Available Riders ({displayedRiders.length})
              </h3>
              <div className="landing-classic-divider flex-1" />
              <span className="text-xs text-slate-500">Nearest first</span>
            </div>

            <VipDemandInsight riders={matchedRiders} />

            {displayedRiders.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-slate-500 text-sm mb-3">
                  No {modePreference} riders available right now.
                </p>
                <button
                  onClick={() => setModePreference('all')}
                  className="px-4 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm font-semibold hover:bg-orange-200 transition-colors"
                >
                  Show All Modes
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {displayedRiders.map((rider) => (
                  <RiderCard
                    key={rider.rider_id}
                    rider={rider}
                    onRequest={handleRequestRide}
                    isSelected={selectedRider?.rider_id === rider.rider_id}
                    paymentMethod={paymentMethod}
                  />
                ))}
              </div>
            )}

            {/* Algorithm Info */}
            <p className="mt-5 text-[11px] leading-relaxed text-slate-500">
              <strong className="text-slate-600">Real matching:</strong> riders are ranked by real GPS distance first,
              then the areas they know, rating, and their own vehicle/mode. Riders who know your destination
              area are favoured among the closest — no simulated data.
            </p>
          </div>
        );
      })()}
    </div>
  );
}

// Numbered section heading — same serif + gold-rule treatment as the
// Overview's SectionHeading, with a step badge so the form reads top to bottom.
function StepHeading({ n, children, action }: { n: number; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-500 to-amber-400 text-xs font-bold text-white shadow-sm ring-1 ring-[#c4a052]/40">
        {n}
      </span>
      <h3 className="font-classic-display text-lg font-semibold text-slate-800">{children}</h3>
      <div className="landing-classic-divider flex-1" />
      {action}
    </div>
  );
}

// Real call functionality: only render a working tel: link when the rider
// actually has a phone number on file (mbg_user_profiles.phone falling back
// to mbg_users.phone) — never a dead/broken "Call" button.
// Lets the customer switch wallet <-> cash any time before the trip
// completes — shown throughout the active ride, not just at request time,
// so they can change their mind at the destination.
function PaymentMethodSwitcher({ paymentMethod, onChange }: { paymentMethod: 'wallet' | 'cash' | 'company'; onChange: (m: 'wallet' | 'cash') => void }) {
  return (
    <div className="mt-4">
      <p className="text-xs font-semibold text-slate-500 mb-2">Payment method</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onChange('wallet')}
          className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs sm:text-sm font-semibold border-2 transition-all ${
            paymentMethod === 'wallet' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500'
          }`}
        >
          🪙 ICANera Wallet
        </button>
        <button
          onClick={() => onChange('cash')}
          className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs sm:text-sm font-semibold border-2 transition-all ${
            paymentMethod === 'cash' ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'
          }`}
        >
          💵 Cash
        </button>
      </div>
    </div>
  );
}

function CallButton({ phone, label = 'Call', className = '' }: { phone: string | null; label?: string; className?: string }) {
  if (!phone) {
    return (
      <span className={`bg-slate-100 text-slate-400 rounded-lg font-semibold flex items-center justify-center gap-2 cursor-not-allowed ${className}`}>
        <Phone size={18} />
        No phone on file
      </span>
    );
  }
  return (
    <a
      href={`tel:${phone}`}
      className={`bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 transition-all shadow-md flex items-center justify-center gap-2 ${className}`}
    >
      <Phone size={18} />
      {label}
    </a>
  );
}

// Real demand signal, not decoration: driven by the server-computed
// time-of-day surge multiplier (mbg_current_time_multiplier) and how many
// riders actually came back from the live search — the same numbers that
// set the fare. No fabricated "high demand" banners.
function VipDemandInsight({ riders }: { riders: MatchedRider[] }) {
  if (riders.length === 0) return null;

  const timeMultiplier = riders[0]?.time_multiplier ?? 1;
  const vipCount = riders.filter(r => r.mode === 'vip').length;
  const normalCount = riders.length - vipCount;
  const isPeak = timeMultiplier > 1;
  const isScarce = riders.length <= 2;
  const vipWorthIt = isPeak || isScarce;

  if (!vipWorthIt) {
    return (
      <div className="mb-4 p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center gap-2 text-xs sm:text-sm text-slate-600">
        <Crown size={16} className="text-slate-400 flex-shrink-0" />
        Normal demand right now — {normalCount} standard-priced rider{normalCount === 1 ? '' : 's'} nearby.
        VIP won't get you picked up meaningfully faster.
      </div>
    );
  }

  return (
    <div className="mb-4 p-3 rounded-lg border-2 border-purple-300 bg-purple-50 flex items-start gap-2 text-xs sm:text-sm text-purple-800">
      <Crown size={16} className="text-purple-500 flex-shrink-0 mt-0.5" />
      <div>
        <strong>VIP may actually help right now: </strong>
        {isPeak && `it's peak hours (fares are already at ${timeMultiplier}x)`}
        {isPeak && isScarce && ' and '}
        {isScarce && `only ${riders.length} rider${riders.length === 1 ? ' is' : 's are'} available nearby`}
        {vipCount > 0
          ? ` — ${vipCount} VIP rider${vipCount === 1 ? '' : 's'} in this list get priority pickup.`
          : ' — no VIP riders are online in your area yet, so this won\'t change your wait time either.'}
      </div>
    </div>
  );
}

function RiderCard({
  rider,
  onRequest,
  isSelected,
  paymentMethod
}: {
  rider: MatchedRider;
  onRequest: (rider: MatchedRider) => void;
  isSelected: boolean;
  paymentMethod: 'wallet' | 'cash' | 'company';
}) {
  const modeConfig = {
    normal: { color: 'slate', icon: DollarSign, label: 'Standard' },
    vip: { color: 'purple', icon: Crown, label: 'VIP Service' },
    discount: { color: 'orange', icon: DollarSign, label: 'Discount' },
    return: { color: 'green', icon: Home, label: 'Return Home' }
  };

  const config = modeConfig[rider.mode] || modeConfig.normal;
  const ModeIcon = config.icon;
  const walletSurchargePct = useWalletSurchargePct();

  return (
    <div className={`border-2 rounded-xl p-4 sm:p-5 transition-all ${
      isSelected
        ? 'border-orange-500 bg-gradient-to-br from-orange-50 to-yellow-50'
        : 'border-slate-200 bg-white hover:border-orange-300'
    }`}>
      <div className="flex items-start gap-3 sm:gap-4">
        {/* Rider Avatar */}
        <div className="relative flex-shrink-0">
          <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-full flex items-center justify-center text-white font-bold text-lg sm:text-xl shadow-lg">
            {rider.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </div>
          {rider.is_admin_verified_store_driver ? (
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-blue-600 rounded-full border-2 border-white flex items-center justify-center">
              <ShieldCheck size={12} className="text-white" />
            </div>
          ) : rider.knows_destination && (
            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 rounded-full border-2 border-white flex items-center justify-center">
              <Navigation size={12} className="text-white" />
            </div>
          )}
        </div>

        {/* Rider Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <h4 className="font-bold text-slate-800 text-base sm:text-lg">{rider.full_name}</h4>
              <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-600">
                <div className="flex items-center gap-1">
                  <Star size={14} className="text-yellow-500 fill-yellow-500" />
                  <span className="font-medium">{rider.rating}</span>
                </div>
                <span>•</span>
                <span>{rider.total_rides} rides</span>
              </div>
            </div>
            <div className={`px-2.5 py-1 rounded-full text-xs font-semibold flex items-center gap-1 bg-${config.color}-100 text-${config.color}-700 flex-shrink-0`}>
              <ModeIcon size={12} />
              {config.label}
            </div>
          </div>

          {/* Rider Highlights */}
          <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-3">
            {rider.is_admin_verified_store_driver && rider.verified_business_name && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">
                <ShieldCheck size={12} />
                Verified {rider.verified_business_name} driver
              </span>
            )}
            {rider.knows_destination && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                <Navigation size={12} />
                Knows your destination
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
              {rider.distance_to_pickup_km != null ? `${rider.distance_to_pickup_km.toFixed(1)} km away` : 'Distance unknown'}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
              Arrives in {rider.estimated_arrival_min} min
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-medium rounded-full">
              {rider.power_type === 'electric' ? <Zap size={12} /> : <Fuel size={12} />}
              {rider.power_type === 'electric' ? 'Electric' : 'Fuel'}
            </span>
            {rider.has_umbrella && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-sky-100 text-sky-700 text-xs font-medium rounded-full">
                <Umbrella size={12} /> Rain cover
              </span>
            )}
          </div>

          {/* Pricing and Action */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-baseline gap-2">
              <span className="text-xl sm:text-2xl font-bold text-slate-800">
                UGX {payableFare(rider.fare, paymentMethod, walletSurchargePct).toLocaleString()}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {isSelected && (
                <CallButton phone={rider.phone} className="px-4 py-2.5" />
              )}
              <button
                onClick={() => onRequest(rider)}
                disabled={isSelected}
                className={`px-5 sm:px-6 py-2.5 rounded-lg font-semibold transition-all ${
                  isSelected
                    ? 'bg-slate-200 text-slate-600 cursor-not-allowed'
                    : 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white hover:from-orange-600 hover:to-yellow-600 shadow-md'
                }`}
              >
                {isSelected ? '✓ Requested' : 'Request'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Vehicle Details */}
      {isSelected && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <div className="flex items-center justify-between text-sm flex-wrap gap-2">
            <div className="flex items-center gap-2 text-slate-600">
              <span className="font-semibold">Vehicle:</span>
              <span>{rider.vehicle_color} {rider.vehicle_type}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-600">
              <span className="font-semibold">Plate:</span>
              <span className="bg-yellow-400 text-slate-900 px-2 py-0.5 rounded font-bold">
                {rider.plate_number}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Waiting for Acceptance Component
function WaitingForAcceptance({
  rider,
  timer,
  isAutoDispatch,
  candidates = [],
  activeRiderId,
  onCancel,
}: {
  rider: MatchedRider;
  timer: number;
  isAutoDispatch?: boolean;
  // The real nearby-rider pool mbg_sweep_auto_dispatch_cascade is cycling
  // through (ADD_AUTO_DISPATCH_CASCADE.sql) — matchedRiders from the search
  // that led here, not a decorative placeholder list.
  candidates?: MatchedRider[];
  // mbg_rides.rider_id as last seen by polling — whichever of `candidates`
  // currently has the live offer, so the orbit can light up the real one.
  activeRiderId?: string | null;
  onCancel: () => void;
}) {
  const orbit = isAutoDispatch ? candidates.slice(0, 6) : [];
  const activeId = activeRiderId ?? rider.rider_id;
  const activeCandidate = orbit.find(c => c.rider_id === activeId) || orbit[0] || null;

  return (
    <div className="min-h-[500px] bg-gradient-to-br from-orange-50 to-yellow-50 rounded-xl shadow-xl p-6 sm:p-8 flex flex-col items-center justify-center overflow-hidden">
      {/* Animated Loading / Radar */}
      <div className="relative mb-8" style={{ width: 260, height: 260, maxWidth: '100%' }}>
        {/* Expanding radar rings — auto-dispatch only, suggests an active nearby search */}
        {isAutoDispatch && [0, 0.7, 1.4].map((delay) => (
          <div
            key={delay}
            className="absolute inset-0 m-auto w-32 h-32 rounded-full border-2 border-orange-400 animate-radar-ring"
            style={{ animationDelay: `${delay}s` }}
          />
        ))}

        {/* Orbiting candidate riders — the real pool being offered this ride */}
        {orbit.map((c, i) => {
          const angle = -Math.PI / 2 + (i * (2 * Math.PI)) / orbit.length;
          const radius = 98;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          const isActive = c.rider_id === activeId;
          return (
            <div
              key={c.rider_id}
              className="absolute top-1/2 left-1/2 flex flex-col items-center transition-all duration-500 ease-out"
              style={{ transform: `translate(${x - 22}px, ${y - 22}px)` }}
            >
              <div
                className={`w-11 h-11 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md border-2 border-white transition-all duration-500 ${
                  isActive
                    ? 'bg-gradient-to-br from-orange-500 to-yellow-500 scale-110 animate-candidate-glow'
                    : 'bg-slate-300 opacity-70 grayscale'
                }`}
              >
                {c.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              {isActive && (
                <span className="mt-1 text-[10px] font-semibold text-orange-600 bg-white/90 px-1.5 py-0.5 rounded-full shadow-sm whitespace-nowrap">
                  {c.full_name.split(' ')[0]}
                </span>
              )}
            </div>
          );
        })}

        {/* Center hub */}
        <div className="absolute inset-0 m-auto w-32 h-32">
          <div className="w-32 h-32 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-full flex items-center justify-center text-white shadow-2xl animate-pulse">
            {isAutoDispatch ? (
              <Zap size={44} />
            ) : (
              <span className="font-bold text-4xl">{rider.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)}</span>
            )}
          </div>
          <div className="absolute -top-2 -right-2 w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center animate-bounce">
            <Clock className="text-white" size={24} />
          </div>
        </div>
      </div>

      {/* Status */}
      <h2 className="text-3xl font-bold text-slate-800 mb-2 text-center">
        {isAutoDispatch ? 'Matching you with a rider' : `Waiting for ${rider.full_name.split(' ')[0]}`}
      </h2>
      <p className="text-slate-600 mb-6 text-center max-w-md">
        {isAutoDispatch
          ? activeCandidate
            ? `We're currently asking ${activeCandidate.full_name.split(' ')[0]} nearby — this switches automatically if they don't respond.`
            : "We're offering it to nearby riders one at a time — this switches automatically if one doesn't respond."
          : 'Your ride request has been sent. The rider will respond shortly.'}
      </p>

      {/* Timer — a live countdown for a specific rider, or the real current
          candidate (with a queue count) once it's the server's own cascade. */}
      {isAutoDispatch ? (
        <div className="bg-white rounded-xl p-5 mb-8 shadow-lg w-full max-w-md">
          {activeCandidate ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-500 to-yellow-500 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                {activeCandidate.full_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="font-semibold text-slate-800 truncate">Asking {activeCandidate.full_name.split(' ')[0]}…</p>
                <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                  <span className="flex items-center gap-1">
                    <Star size={12} className="text-yellow-500 fill-yellow-500" />
                    {activeCandidate.rating}
                  </span>
                  {activeCandidate.distance_to_pickup_km != null && (
                    <span className="flex items-center gap-1">
                      <Navigation size={12} />
                      {activeCandidate.distance_to_pickup_km.toFixed(1)} km away
                    </span>
                  )}
                </div>
              </div>
              <div className="w-2.5 h-2.5 rounded-full bg-orange-500 animate-ping flex-shrink-0" />
            </div>
          ) : (
            <div className="flex items-center gap-3 justify-center text-slate-600">
              <div className="w-3 h-3 rounded-full bg-orange-500 animate-ping" />
              <span className="font-medium">Searching for the next available rider…</span>
            </div>
          )}
          {orbit.length > 1 && (
            <p className="text-xs text-slate-400 text-center mt-3 pt-3 border-t border-slate-100">
              {orbit.length} nearby riders in the queue
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl p-6 mb-8 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className="text-5xl font-bold text-orange-500">{timer}</div>
              <div className="text-sm text-slate-600 mt-1">seconds</div>
            </div>
            <div className="border-l-2 border-slate-200 h-16"></div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Star className="text-yellow-500 fill-yellow-500" size={20} />
                <span className="font-semibold text-slate-800">{rider.rating} rating</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Navigation size={16} />
                <span>{rider.distance_to_pickup_km != null ? `${rider.distance_to_pickup_km.toFixed(1)} km away` : 'Distance unknown'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading Bar — indeterminate sweep in auto mode (no fixed countdown
          to size it against), a real 0-30s fill otherwise. */}
      <div className="w-full max-w-md mb-8">
        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
          {isAutoDispatch ? (
            <div className="h-full w-1/3 bg-gradient-to-r from-orange-500 to-yellow-500 rounded-full animate-[loading-sweep_1.2s_ease-in-out_infinite]" />
          ) : (
            <div
              className="h-full bg-gradient-to-r from-orange-500 to-yellow-500 transition-all duration-1000"
              style={{ width: `${((30 - timer) / 30) * 100}%` }}
            />
          )}
        </div>
      </div>

      {/* Cancel Button */}
      <button
        onClick={onCancel}
        className="px-8 py-3 bg-slate-200 text-slate-700 rounded-lg font-semibold hover:bg-slate-300 transition-all"
      >
        Cancel Request
      </button>
    </div>
  );
}

// Ride Declined Component
function RideDeclined({ rider, isAutoDispatch, onBackToRiders, onStartNew }: { rider: MatchedRider; isAutoDispatch?: boolean; onBackToRiders: () => void; onStartNew: () => void }) {
  return (
    <div className="min-h-[500px] bg-gradient-to-br from-red-50 to-orange-50 rounded-xl shadow-xl p-8 flex flex-col items-center justify-center">
      {/* Declined Icon */}
      <div className="relative mb-8">
        <div className="w-32 h-32 bg-gradient-to-br from-red-500 to-orange-500 rounded-full flex items-center justify-center shadow-2xl">
          <XCircle className="text-white" size={64} />
        </div>
      </div>

      {/* Message */}
      <h2 className="text-3xl font-bold text-slate-800 mb-3 text-center">
        Ride Not Available
      </h2>
      <p className="text-lg text-slate-700 mb-2 text-center">
        {isAutoDispatch ? 'No nearby riders were able to accept right now' : `${rider.full_name} couldn't accept your ride`}
      </p>
      <p className="text-slate-600 text-center mb-8 max-w-md">
        {isAutoDispatch
          ? "We tried the nearest available riders one after another and none responded in time. Try again in a moment, or pick a specific rider yourself."
          : "Don't worry! There are other available riders nearby. Try requesting from another rider or start a new search."}
      </p>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={onBackToRiders}
          className="px-8 py-4 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-bold rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all shadow-lg flex items-center gap-2"
        >
          <ArrowLeft size={20} />
          {isAutoDispatch ? 'Back to Riders' : 'Try Another Rider'}
        </button>
        <button
          onClick={onStartNew}
          className="px-8 py-4 bg-white text-slate-700 font-semibold rounded-xl hover:bg-slate-50 transition-all shadow-md border-2 border-slate-200"
        >
          Start New Search
        </button>
      </div>
    </div>
  );
}

// Rider On The Way Component (covers 'accepted' — rider confirmed and heading to pickup)
function RiderOnTheWay({
  rider,
  pickup,
  dropoff,
  onCancel,
  rideId,
  customerId,
  customerName,
  riderUserId,
  paymentMethod,
  onChangePaymentMethod
}: {
  rider: MatchedRider;
  pickup: Location;
  dropoff: Location;
  onCancel: () => void;
  rideId: string | null;
  customerId: string;
  customerName: string;
  riderUserId: string | null;
  paymentMethod: 'wallet' | 'cash' | 'company';
  onChangePaymentMethod: (m: 'wallet' | 'cash') => void;
}) {
  const walletSurchargePct = useWalletSurchargePct();

  return (
    <div className="space-y-6">
      {/* Header Status */}
      <div className="bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl shadow-xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
            <h2 className="text-xl sm:text-2xl font-bold">Rider On The Way</h2>
          </div>
          <div className="bg-white/20 px-4 py-2 rounded-lg">
            <div className="text-sm opacity-90">Arriving in</div>
            <div className="text-2xl font-bold">{rider.estimated_arrival_min} min</div>
          </div>
        </div>
        <p className="opacity-90">Your rider is heading to your pickup location</p>
      </div>

      {/* Live map — rider's real position, pushed instantly via realtime
          subscription on mbg_riders.current_lat/current_lng (kept fresh by
          useLiveLocationPing on the rider's own dashboard). */}
      <LiveTrackingMap riderId={rider.rider_id} pickup={pickup} dropoff={dropoff} phase="to_pickup" />

      {/* Rider Details Card */}
      <div className="classic-card p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Rider Details</h3>
        <div className="flex items-start gap-4 mb-6">
          <div className="w-20 h-20 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-full flex items-center justify-center text-white font-bold text-2xl shadow-lg">
            {rider.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </div>
          <div className="flex-1">
            <h4 className="text-xl font-bold text-slate-800">{rider.full_name}</h4>
            <div className="flex items-center gap-3 text-sm text-slate-600 mb-2">
              <div className="flex items-center gap-1">
                <Star className="text-yellow-500 fill-yellow-500" size={16} />
                <span className="font-semibold">{rider.rating}</span>
              </div>
              <span>•</span>
              <span>{rider.total_rides} completed rides</span>
            </div>
            {rideId && riderUserId ? (
              <RideCommsBar
                rideId={rideId}
                selfUserId={customerId}
                selfName={customerName}
                peerUserId={riderUserId}
                peerName={rider.full_name}
                peerPhone={rider.phone}
              />
            ) : (
              <CallButton phone={rider.phone} label="Call Rider" className="w-full px-4 py-2" />
            )}
          </div>
        </div>

        {/* Vehicle Info */}
        <div className="grid grid-cols-2 gap-4 mb-6 pb-6 border-b border-slate-200">
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="text-sm text-slate-600 mb-1">Vehicle</div>
            <div className="font-semibold text-slate-800">{rider.vehicle_color} {rider.vehicle_type}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="text-sm text-slate-600 mb-1">Plate Number</div>
            <div className="font-bold text-lg bg-yellow-400 text-slate-900 inline-block px-3 py-1 rounded">
              {rider.plate_number}
            </div>
          </div>
        </div>

        {/* Trip Details */}
        <div className="space-y-4">
          <h4 className="font-bold text-slate-800">Trip Details</h4>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <MapPin className="text-green-600" size={18} />
              </div>
              <div className="flex-1">
                <div className="text-sm text-slate-600">Pickup Location</div>
                <div className="font-semibold text-slate-800">{pickup.name}</div>
                <div className="text-sm text-slate-600">{pickup.fullAddress}</div>
              </div>
            </div>

            <div className="ml-4 border-l-2 border-dashed border-slate-300 h-8"></div>

            <div className="flex items-start gap-3">
              <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <MapPin className="text-red-600" size={18} />
              </div>
              <div className="flex-1">
                <div className="text-sm text-slate-600">Drop-off Location</div>
                <div className="font-semibold text-slate-800">{dropoff.name}</div>
                <div className="text-sm text-slate-600">{dropoff.fullAddress}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Fare */}
        <div className="mt-6 pt-6 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-slate-600">Fare Amount</span>
            <span className="text-2xl font-bold text-slate-800">
              UGX {payableFare(rider.fare, paymentMethod, walletSurchargePct).toLocaleString()}
            </span>
          </div>
          <PaymentMethodSwitcher paymentMethod={paymentMethod} onChange={onChangePaymentMethod} />
        </div>
      </div>

      {/* Cancel Ride */}
      <button
        onClick={onCancel}
        className="w-full py-3 bg-red-50 text-red-600 font-semibold rounded-lg hover:bg-red-100 transition-all border-2 border-red-200"
      >
        Cancel Ride
      </button>
    </div>
  );
}

// Journey Started Component ('in_progress' — rider marks pickup/completion, customer just watches)
function JourneyStarted({
  rider,
  pickup,
  dropoff,
  rideId,
  customerId,
  customerName,
  riderUserId,
  paymentMethod,
  onChangePaymentMethod
}: {
  rider: MatchedRider;
  pickup: Location;
  dropoff: Location;
  rideId: string | null;
  customerId: string;
  customerName: string;
  riderUserId: string | null;
  paymentMethod: 'wallet' | 'cash' | 'company';
  onChangePaymentMethod: (m: 'wallet' | 'cash') => void;
}) {
  const [journeyTime, setJourneyTime] = React.useState(0);
  const walletSurchargePct = useWalletSurchargePct();

  React.useEffect(() => {
    const timer = setInterval(() => {
      setJourneyTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Journey In Progress Header */}
      <div className="bg-gradient-to-r from-green-500 via-emerald-500 to-teal-500 rounded-2xl shadow-2xl p-8 text-white text-center relative overflow-hidden">
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-64 h-64 bg-white opacity-10 rounded-full animate-pulse"></div>
          <div className="absolute bottom-0 right-1/4 w-48 h-48 bg-white opacity-10 rounded-full animate-pulse" style={{ animationDelay: '1s' }}></div>
        </div>

        <div className="relative z-10">
          <div className="inline-flex items-center gap-3 bg-white/20 rounded-full px-6 py-3 mb-4">
            <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
            <span className="font-semibold text-lg">Journey In Progress</span>
          </div>

          <h2 className="text-3xl sm:text-4xl font-bold mb-3">
            🚗 On Your Way!
          </h2>
          <p className="text-lg sm:text-xl opacity-95 mb-4">
            Heading to your destination
          </p>

          <div className="inline-block bg-white/20 rounded-xl px-8 py-4 backdrop-blur-sm">
            <div className="text-sm opacity-90 mb-1">Journey Time</div>
            <div className="text-4xl sm:text-5xl font-bold font-mono">{formatTime(journeyTime)}</div>
          </div>
        </div>
      </div>

      {/* Live map — same realtime rider position as the "On The Way" screen,
          now tracking the drop-off leg instead of the pickup leg. */}
      <LiveTrackingMap riderId={rider.rider_id} pickup={pickup} dropoff={dropoff} phase="to_dropoff" />

      {/* Trip Details */}
      <div className="classic-card p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Trip Details</h3>

        {/* Route */}
        <div className="space-y-4 mb-6">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
              <CheckCircle className="text-green-600" size={20} />
            </div>
            <div className="flex-1">
              <div className="text-sm text-green-600 font-semibold mb-1">Picked up from</div>
              <div className="font-bold text-slate-800">{pickup.name}</div>
              <div className="text-sm text-slate-600">{pickup.area}</div>
            </div>
          </div>

          <div className="ml-5 border-l-2 border-dashed border-slate-300 h-12"></div>

          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0 mt-1 animate-pulse">
              <MapPin className="text-red-600" size={20} />
            </div>
            <div className="flex-1">
              <div className="text-sm text-red-600 font-semibold mb-1">Heading to</div>
              <div className="font-bold text-slate-800">{dropoff.name}</div>
              <div className="text-sm text-slate-600">{dropoff.area}</div>
            </div>
          </div>
        </div>

        {/* Rider Info */}
        <div className="border-t border-slate-200 pt-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-lg">
              {rider.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-slate-800 text-lg">{rider.full_name}</h4>
              <div className="text-sm text-slate-600">
                {rider.vehicle_color} {rider.vehicle_type} • {rider.plate_number}
              </div>
            </div>
            {!(rideId && riderUserId) && <CallButton phone={rider.phone} className="px-4 py-2" />}
          </div>
          {rideId && riderUserId && (
            <RideCommsBar
              rideId={rideId}
              selfUserId={customerId}
              selfName={customerName}
              peerUserId={riderUserId}
              peerName={rider.full_name}
              peerPhone={rider.phone}
            />
          )}
        </div>

        {/* Fare */}
        <div className="mt-6 pt-6 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-slate-600 font-medium">Trip Fare</span>
            <span className="text-2xl sm:text-3xl font-bold text-green-600">
              UGX {payableFare(rider.fare, paymentMethod, walletSurchargePct).toLocaleString()}
            </span>
          </div>
          <PaymentMethodSwitcher paymentMethod={paymentMethod} onChange={onChangePaymentMethod} />
        </div>
      </div>

      {/* Info — completion is confirmed by the rider */}
      <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 text-center">
        <p className="text-sm text-blue-800">
          <strong>Almost there!</strong> {rider.full_name.split(' ')[0]} will mark the trip complete on arrival.
          Always wear a helmet and follow traffic rules.
        </p>
      </div>
    </div>
  );
}

// Journey Completed Component
function JourneyCompleted({
  rider,
  pickup,
  dropoff,
  onStartNew,
  paymentMethod
}: {
  rider: MatchedRider;
  pickup: Location;
  dropoff: Location;
  onStartNew: () => void;
  paymentMethod: 'wallet' | 'cash' | 'company';
}) {
  const [rating, setRating] = React.useState(0);
  const [hoveredRating, setHoveredRating] = React.useState(0);
  const walletSurchargePct = useWalletSurchargePct();

  return (
    <div className="space-y-6">
      {/* Success Header */}
      <div className="bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 rounded-2xl shadow-2xl p-8 text-white text-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 left-0 w-full h-full bg-white animate-pulse"></div>
        </div>

        <div className="relative z-10">
          <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
            <CheckCircle className="text-green-500" size={64} />
          </div>

          <h2 className="text-3xl sm:text-4xl font-bold mb-3">
            ✅ Journey Complete!
          </h2>
          <p className="text-lg sm:text-xl opacity-95 mb-2">
            You've arrived safely at your destination
          </p>
          <p className="text-base sm:text-lg opacity-90">
            Thanks for riding with BodaGoEra
          </p>
        </div>
      </div>

      {/* Trip Summary */}
      <div className="classic-card p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Trip Summary</h3>

        <div className="space-y-3 mb-6">
          <div className="flex justify-between py-2">
            <span className="text-slate-600">From</span>
            <span className="font-semibold text-slate-800 text-right">{pickup.name}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-slate-600">To</span>
            <span className="font-semibold text-slate-800 text-right">{dropoff.name}</span>
          </div>
          <div className="flex justify-between py-2">
            <span className="text-slate-600">Rider</span>
            <span className="font-semibold text-slate-800">{rider.full_name}</span>
          </div>
          <div className="flex justify-between py-2 border-t-2 border-slate-200 pt-4">
            <span className="text-slate-700 font-medium text-lg">Total Fare</span>
            <span className="text-2xl sm:text-3xl font-bold text-green-600">
              UGX {payableFare(rider.fare, paymentMethod, walletSurchargePct).toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Rate Your Rider */}
      <div className="classic-card p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4 text-center">Rate Your Experience</h3>
        <p className="text-slate-600 text-center mb-4">How was your ride with {rider.full_name.split(' ')[0]}?</p>

        <div className="flex justify-center gap-2 mb-6">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(0)}
              className="transition-transform hover:scale-110"
            >
              <Star
                size={40}
                className={`${
                  star <= (hoveredRating || rating)
                    ? 'text-yellow-500 fill-yellow-500'
                    : 'text-slate-300'
                } transition-colors`}
              />
            </button>
          ))}
        </div>

        {rating > 0 && (
          <div className="text-center">
            <p className="text-lg font-semibold text-slate-800 mb-4">
              {rating === 5 && "⭐ Excellent! Thanks for the feedback!"}
              {rating === 4 && "😊 Great! Thanks for your rating!"}
              {rating === 3 && "👍 Good! Thanks for your feedback!"}
              {rating === 2 && "😐 We'll work to improve"}
              {rating === 1 && "😔 Sorry to hear that. We'll do better"}
            </p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="space-y-3">
        <button
          onClick={onStartNew}
          className="w-full py-5 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-bold text-xl rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all shadow-xl"
        >
          Book Another Ride
        </button>
      </div>
    </div>
  );
}
