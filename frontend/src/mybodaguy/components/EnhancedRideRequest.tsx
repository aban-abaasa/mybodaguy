import { useState, useRef, useEffect } from 'react';
import * as React from 'react';
import { MapPin, Search, Crown, Home, DollarSign, Star, Navigation, Phone, X, Clock, CheckCircle, XCircle, ArrowLeft, Zap, Fuel, Umbrella, Bike, Package, Tag, Car, Truck, Plane } from 'lucide-react';
import { toast } from 'sonner';
import { searchLocations, Location } from '../data/mockLocations';
import { supabase } from '../services/supabaseClient';
import { trackRideCall, trackUIInteraction } from '../../services/featureAnalyticsService';
import RideCommsBar from './RideCommsBar';
import ProductPicker, { CartLine } from './ProductPicker';
import LocationPickerMap from './LocationPickerMap';
import JourneyBookingFlow from './JourneyBookingFlow';
import { reverseGeocodeCountry, type CountryLookup } from '../services/geocodeService';

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
}

export default function EnhancedRideRequest({ customerId, fixedServiceType, showJourneyOption }: EnhancedRideRequestProps) {
  const [bookingMode, setBookingMode] = useState<'ride' | 'journey'>('ride');
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
  const [rideId, setRideId] = useState<string | null>(null);
  const [riderUserId, setRiderUserId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('Customer');

  // Service options — real vehicle/weather filters matched against riders' actual registered attributes
  const [serviceType, setServiceType] = useState<ServiceType>(fixedServiceType || 'ride');
  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>('normal');
  const [supermarkets, setSupermarkets] = useState<Supermarket[]>([]);
  const [selectedSupermarketId, setSelectedSupermarketId] = useState('');
  const [storeTypeFilter, setStoreTypeFilter] = useState<BusinessTypeFilter>('all');
  const [deliveryCart, setDeliveryCart] = useState<CartLine[]>([]);
  const [powerFilter, setPowerFilter] = useState<PowerFilter>('any');
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState<VehicleTypeFilter>('any');
  const [umbrellaRequired, setUmbrellaRequired] = useState(false);
  const [modePreference, setModePreference] = useState<ModePreference>('all');
  // Wallet = charged automatically (fare + 7% convenience surcharge) the
  // instant the trip completes. Cash = pay the rider directly in person —
  // no surcharge, but the rider owes the commission out of pocket and must
  // confirm receipt before taking new jobs (see mbg_confirm_cash_received).
  const [paymentMethod, setPaymentMethod] = useState<'wallet' | 'cash'>('wallet');

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

  useEffect(() => {
    if (!isNormalDelivery || !selectedPickup) {
      setPickupCountry(null);
      return;
    }
    reverseGeocodeCountry(selectedPickup.coordinates.lat, selectedPickup.coordinates.lng).then(setPickupCountry);
  }, [isNormalDelivery, selectedPickup?.coordinates.lat, selectedPickup?.coordinates.lng]);

  useEffect(() => {
    if (!isNormalDelivery || !selectedDropoff) {
      setDropoffCountry(null);
      return;
    }
    reverseGeocodeCountry(selectedDropoff.coordinates.lat, selectedDropoff.coordinates.lng).then(setDropoffCountry);
  }, [isNormalDelivery, selectedDropoff?.coordinates.lat, selectedDropoff?.coordinates.lng]);

  const needsCrossBorderPath = isNormalDelivery && !!pickupCountry && !!dropoffCountry && pickupCountry.iso2 !== dropoffCountry.iso2;

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

  // Store list filtered by the chosen business type — reset the current
  // selection if it no longer belongs to the active filter.
  const filteredStores = storeTypeFilter === 'all'
    ? supermarkets
    : supermarkets.filter(sm => sm.business_type === storeTypeFilter);

  useEffect(() => {
    if (!selectedSupermarketId) return;
    if (!filteredStores.some(sm => sm.id === selectedSupermarketId)) {
      setSelectedSupermarketId('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeTypeFilter]);

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

  // Smart supermarket pickup: once a registered supermarket with known
  // coordinates is chosen, fill pickup automatically instead of making the
  // customer search for a place they already picked from a dropdown.
  useEffect(() => {
    if (serviceType !== 'delivery' || deliveryMode !== 'supermarket' || !selectedSupermarketId) {
      setPickupIsAutoFromSupermarket(false);
      return;
    }
    const sm = supermarkets.find(s => s.id === selectedSupermarketId);
    if (sm && sm.latitude != null && sm.longitude != null) {
      const loc: Location = {
        id: `supermarket_${sm.id}`,
        name: sm.name,
        area: sm.location,
        fullAddress: sm.address || `${sm.name}, ${sm.location}`,
        coordinates: { lat: sm.latitude, lng: sm.longitude }
      };
      setSelectedPickup(loc);
      setPickup(loc.fullAddress);
      setPickupIsAutoFromSupermarket(true);
    } else {
      setPickupIsAutoFromSupermarket(false);
    }
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

  // Timer for waiting acceptance — real timeout withdraws the live offer
  useEffect(() => {
    if (rideStatus === 'waiting_acceptance' && waitingTimer > 0) {
      const timer = setTimeout(() => setWaitingTimer(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    } else if (rideStatus === 'waiting_acceptance' && waitingTimer === 0) {
      handleTimeout();
    }
  }, [rideStatus, waitingTimer]);

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
          toast.success(`🎉 ${selectedRider?.full_name} accepted your ride!`, {
            description: 'Rider is on the way',
            duration: 4000
          });
        } else if (data.rider_id === null) {
          setRideStatus('declined');
          toast.error(`${selectedRider?.full_name} declined your ride`, {
            description: 'Try requesting from another rider',
            duration: 4000
          });
        }
      } else if (rideStatus === 'accepted' && data.status === 'in_progress') {
        setRideStatus('journey_started');
      } else if (rideStatus === 'journey_started' && data.status === 'completed') {
        setRideStatus('completed');
      }
    };

    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [rideId, rideStatus, selectedRider]);

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

  const handleRequestRide = async (rider: MatchedRider) => {
    setSelectedRider(rider);
    setRideStatus('waiting_acceptance');
    setWaitingTimer(30);

    try {
      const orderNotes = deliveryCart.length > 0
        ? deliveryCart.map(l => `${l.qty}x ${l.product.name}`).join(', ')
        : null;

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
        : await supabase.rpc('mbg_request_ride', {
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
            p_payment_method: paymentMethod,
          });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not create the request');

      setRideId(data.ride_id);

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
        await supabase.rpc('mbg_withdraw_ride_offer', { p_ride_id: rideId });
      } catch (_) {}
    }
    setMatchedRiders(prev => prev.filter(r => r.rider_id !== selectedRider?.rider_id));
    setRideStatus(null);
    setSelectedRider(null);
    setRideId(null);
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
    setPickupSuggestions([]);
    setDropoffSuggestions([]);
    setSelectedSupermarketId('');
    setPickupIsAutoFromSupermarket(false);
    setRouteInfo(null);
  };

  // Journey mode takes over the whole screen — it's a completely different
  // multi-leg flow (flight + boda + destination driver), not a variant of
  // the single-hop ride form below.
  if (showJourneyOption && bookingMode === 'journey') {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setBookingMode('ride')}
          className="text-sm text-orange-600 hover:text-orange-700 flex items-center gap-1 font-medium"
        >
          <ArrowLeft size={16} /> Back to Book a Ride
        </button>
        <JourneyBookingFlow customerId={customerId} />
      </div>
    );
  }

  // Render different UI based on ride status
  if (rideStatus === 'waiting_acceptance' && selectedRider) {
    return <WaitingForAcceptance rider={selectedRider} timer={waitingTimer} onCancel={handleBackToSearch} />;
  }

  if (rideStatus === 'declined' && selectedRider) {
    return <RideDeclined rider={selectedRider} onBackToRiders={handleBackToSearch} onStartNew={handleStartNewRide} />;
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
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Search Form */}
      <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6">
        {showJourneyOption && (
          <button
            onClick={() => setBookingMode('journey')}
            className="w-full mb-4 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border-2 border-dashed border-orange-300 text-orange-700 hover:bg-orange-50 transition-all"
          >
            <Plane size={16} /> Flying somewhere? Book a full journey instead
          </button>
        )}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg sm:text-xl font-bold text-slate-800">
            {serviceType === 'ride'
              ? 'Book a Ride'
              : deliveryMode === 'supermarket'
              ? 'Delivery From a Supermarket'
              : 'Normal Delivery'}
          </h3>
          {(pickup || dropoff) && (
            <button
              onClick={handleClearSearch}
              className="text-sm text-slate-600 hover:text-orange-600 flex items-center gap-1"
            >
              <X size={16} />
              Clear
            </button>
          )}
        </div>

        {/* Service type — hidden when the parent tab already fixes it, so
            "Book a Ride" and "Delivery" stay separate instead of one
            screen that toggles between both */}
        {!fixedServiceType && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button
            onClick={() => setServiceType('ride')}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all ${
              serviceType === 'ride' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
            }`}
          >
            <Bike size={16} /> Ride
          </button>
          <button
            onClick={() => setServiceType('delivery')}
            className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border-2 transition-all ${
              serviceType === 'delivery' ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
            }`}
          >
            <Package size={16} /> Delivery
          </button>
        </div>
        )}

        {/* Delivery mode + supermarket picker */}
        {serviceType === 'delivery' && (
          <div className="mb-4 space-y-3">
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

                <select
                  value={selectedSupermarketId}
                  onChange={(e) => setSelectedSupermarketId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none"
                >
                  <option value="">Select a store…</option>
                  {filteredStores.map(sm => (
                    <option key={sm.id} value={sm.id}>{typeEmoji(sm.business_type)} {sm.name} — {sm.location}</option>
                  ))}
                </select>
                {filteredStores.length === 0 && (
                  <p className="text-xs text-slate-400">No stores of this type yet.</p>
                )}

                {selectedSupermarketId && (
                  <ProductPicker supermarketId={selectedSupermarketId} onCartChange={setDeliveryCart} />
                )}
              </>
            )}
          </div>
        )}

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
        {/* Ride mode preference — filters matched riders by their real pricing mode */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">Ride Type</label>
          <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
            {(
              [
                { id: 'all' as ModePreference, label: 'All', icon: null, badge: null },
                { id: 'normal' as ModePreference, label: 'Normal', icon: DollarSign, badge: '0%' },
                { id: 'vip' as ModePreference, label: 'VIP', icon: Crown, badge: '+10%' },
                { id: 'discount' as ModePreference, label: 'Discount', icon: Tag, badge: '-10%' },
              ] as const
            ).map(opt => {
              const Icon = opt.icon;
              const isSelected = modePreference === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => setModePreference(opt.id)}
                  className={`flex flex-col items-center justify-center gap-0.5 py-2 rounded-lg text-[10px] sm:text-xs font-semibold border-2 transition-all ${
                    isSelected ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
                  }`}
                >
                  {Icon && <Icon size={14} />}
                  <span>{opt.label}</span>
                  {opt.badge && <span className="text-[9px] opacity-75">{opt.badge}</span>}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setModePreference(modePreference === 'return' ? 'all' : 'return')}
            className={`mt-1.5 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[10px] sm:text-xs font-semibold border-2 transition-all ${
              modePreference === 'return' ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'
            }`}
          >
            <Home size={14} />
            <span>Return (rider going home) — -30%</span>
          </button>
        </div>

        {/* Ride type — Boda vs Car, matched against mbg_find_available_riders'
            p_vehicle_types filter so a request actually only reaches
            drivers of the chosen type, instead of any vehicle_type mixed
            together with no way to tell them apart before choosing. */}
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
          {([
            { id: 'any' as VehicleTypeFilter, label: 'Any Ride', icon: null },
            { id: 'motorcycle' as VehicleTypeFilter, label: 'Boda', icon: Bike },
            { id: 'car' as VehicleTypeFilter, label: 'Car', icon: Car },
            { id: 'van' as VehicleTypeFilter, label: 'Van', icon: Truck },
            { id: 'truck' as VehicleTypeFilter, label: 'Truck', icon: Truck },
          ]).map(opt => (
            <button
              key={opt.id}
              onClick={() => setVehicleTypeFilter(opt.id)}
              className={`flex items-center justify-center gap-1 py-2 rounded-lg text-xs sm:text-sm font-semibold border-2 transition-all ${
                vehicleTypeFilter === opt.id ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
              }`}
            >
              {opt.icon && <opt.icon size={14} />}
              {opt.label}
            </button>
          ))}
        </div>

        {/* Vehicle / weather filters — fuel/electric and rain cover only mean
            anything for a boda (motorcycle/bicycle/tuktuk); a car/van/truck
            has neither concept, so these only show for the Boda filter. */}
        {vehicleTypeFilter === 'motorcycle' && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            {(['any', 'electric', 'fuel'] as PowerFilter[]).map(opt => (
              <button
                key={opt}
                onClick={() => setPowerFilter(opt)}
                className={`flex items-center justify-center gap-1 py-2 rounded-lg text-xs sm:text-sm font-semibold border-2 transition-all ${
                  powerFilter === opt ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'
                }`}
              >
                {opt === 'electric' ? <Zap size={14} /> : opt === 'fuel' ? <Fuel size={14} /> : null}
                {opt === 'any' ? 'Any Vehicle' : opt === 'electric' ? 'Electric' : 'Fuel'}
              </button>
            ))}
            <button
              onClick={() => setUmbrellaRequired(!umbrellaRequired)}
              className={`col-span-3 flex items-center justify-center gap-2 py-2 rounded-lg text-xs sm:text-sm font-semibold border-2 transition-all ${
                umbrellaRequired ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'
              }`}
            >
              <Umbrella size={14} /> {umbrellaRequired ? 'Rain cover required' : 'Rain cover not required'}
            </button>
          </div>
        )}
        </>
        )}

        {/* Payment method — Wallet settles automatically the instant the
            trip ends (fare + 7% convenience surcharge); Cash means paying
            the rider directly in person, no surcharge. */}
        <div className="mb-4">
          <p className="text-xs font-semibold text-slate-500 mb-2">Payment method</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setPaymentMethod('wallet')}
              className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs sm:text-sm font-semibold border-2 transition-all ${
                paymentMethod === 'wallet' ? 'border-purple-500 bg-purple-50 text-purple-700' : 'border-slate-200 text-slate-500'
              }`}
            >
              🪙 ICANera Wallet
            </button>
            <button
              onClick={() => setPaymentMethod('cash')}
              className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs sm:text-sm font-semibold border-2 transition-all ${
                paymentMethod === 'cash' ? 'border-green-500 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500'
              }`}
            >
              💵 Cash
            </button>
          </div>
          {paymentMethod === 'wallet' ? (
            <p className="text-[11px] text-slate-400 mt-1">Charged automatically when the trip ends (fare + 7% convenience fee).</p>
          ) : (
            <p className="text-[11px] text-slate-400 mt-1">Pay the rider directly in cash at the end of the trip.</p>
          )}
        </div>

        <div className="space-y-4">
          {/* Map picker — sets the same selectedPickup/selectedDropoff state
              as typing a suggestion below; either method works, and they
              stay in sync with each other. */}
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-700">Pick locations on the map</label>
            <button
              type="button"
              onClick={() => setShowMap(!showMap)}
              className="text-xs text-orange-600 hover:text-orange-700 font-medium"
            >
              {showMap ? 'Hide map' : 'Show map'}
            </button>
          </div>
          {showMap && (
            <LocationPickerMap
              pickup={selectedPickup}
              dropoff={selectedDropoff}
              onPickupChange={handleMapPickupChange}
              onDropoffChange={handleMapDropoffChange}
              onRouteInfo={(distanceKm, durationMin) => setRouteInfo({ distanceKm, durationMin })}
              pickupLocked={pickupIsAutoFromSupermarket}
            />
          )}

          {/* Pickup Location */}
          <div ref={pickupRef} className="relative">
            <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
              Pickup Location
              {pickupIsAutoFromSupermarket && (
                <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-semibold">
                  Auto-filled from supermarket
                </span>
              )}
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-green-500" size={20} />
              <input
                type="text"
                value={pickup}
                readOnly={pickupIsAutoFromSupermarket}
                onChange={(e) => !pickupIsAutoFromSupermarket && handlePickupChange(e.target.value)}
                onFocus={() => !pickupIsAutoFromSupermarket && pickup && setShowPickupSuggestions(true)}
                placeholder="Where are you now? (e.g., Kampala Road, Acacia Mall)"
                className={`w-full pl-11 pr-4 py-3 border-2 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none text-slate-800 placeholder-slate-400 ${
                  pickupIsAutoFromSupermarket ? 'border-green-300 bg-green-50 cursor-default' : 'border-slate-300'
                }`}
              />
              {selectedPickup && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 bg-green-500 rounded-full" />
              )}
            </div>
            {serviceType === 'delivery' && deliveryMode === 'supermarket' && selectedSupermarketId && !pickupIsAutoFromSupermarket && (
              <p className="text-xs text-amber-600 mt-1">
                This supermarket hasn't set its exact location yet — please confirm the pickup point manually.
              </p>
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
            <label className="block text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
              Drop-off Location
              {defaultDropoff && selectedDropoff?.id === defaultDropoff.id && (
                <span className="text-[10px] px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-semibold">
                  Your default area
                </span>
              )}
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-red-500" size={20} />
              <input
                type="text"
                value={dropoff}
                onChange={(e) => handleDropoffChange(e.target.value)}
                onFocus={() => dropoff && setShowDropoffSuggestions(true)}
                placeholder="Where do you want to go? (e.g., Ntinda, Garden City)"
                className="w-full pl-11 pr-4 py-3 border-2 border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none text-slate-800 placeholder-slate-400"
              />
              {selectedDropoff && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 w-2 h-2 bg-red-500 rounded-full" />
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
            <p className="text-xs text-slate-500 -mt-2">
              Estimated road distance: <span className="font-semibold text-slate-700">{routeInfo.distanceKm.toFixed(1)} km</span>
              {' '}(~{Math.round(routeInfo.durationMin)} min)
            </p>
          )}

          <button
            onClick={handleSearchRiders}
            disabled={searching || !selectedPickup || !selectedDropoff}
            className="w-full py-4 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-bold text-lg rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {searching ? (
              <>
                <div className="animate-spin w-5 h-5 border-3 border-white border-t-transparent rounded-full" />
                Searching for riders...
              </>
            ) : (
              <>
                <Search size={20} />
                Find Available Riders
              </>
            )}
          </button>
        </div>
      </div>

      {/* Matched Riders */}
      {matchedRiders.length > 0 && (() => {
        const displayedRiders = modePreference === 'all'
          ? matchedRiders
          : matchedRiders.filter(r => r.mode === modePreference);

        return (
          <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg sm:text-xl font-bold text-slate-800">
                Available Riders ({displayedRiders.length})
              </h3>
              <p className="text-xs sm:text-sm text-slate-600">
                Sorted by best match
              </p>
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
                  />
                ))}
              </div>
            )}

            {/* Algorithm Info */}
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Real Matching:</strong> Riders are ranked by real registered areas they know,
                real GPS distance, rating, and their own vehicle/mode. Riders who know your destination
                area appear first — no simulated data.
              </p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// Real call functionality: only render a working tel: link when the rider
// actually has a phone number on file (mbg_user_profiles.phone falling back
// to mbg_users.phone) — never a dead/broken "Call" button.
// Lets the customer switch wallet <-> cash any time before the trip
// completes — shown throughout the active ride, not just at request time,
// so they can change their mind at the destination.
function PaymentMethodSwitcher({ paymentMethod, onChange }: { paymentMethod: 'wallet' | 'cash'; onChange: (m: 'wallet' | 'cash') => void }) {
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
  isSelected
}: {
  rider: MatchedRider;
  onRequest: (rider: MatchedRider) => void;
  isSelected: boolean;
}) {
  const modeConfig = {
    normal: { color: 'slate', icon: DollarSign, label: 'Standard' },
    vip: { color: 'purple', icon: Crown, label: 'VIP Service' },
    discount: { color: 'orange', icon: DollarSign, label: 'Discount' },
    return: { color: 'green', icon: Home, label: 'Return Home' }
  };

  const config = modeConfig[rider.mode] || modeConfig.normal;
  const ModeIcon = config.icon;

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
          {rider.knows_destination && (
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
                UGX {rider.fare.toLocaleString()}
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
function WaitingForAcceptance({ rider, timer, onCancel }: { rider: MatchedRider; timer: number; onCancel: () => void }) {
  return (
    <div className="min-h-[500px] bg-gradient-to-br from-orange-50 to-yellow-50 rounded-xl shadow-xl p-8 flex flex-col items-center justify-center">
      {/* Animated Loading */}
      <div className="relative mb-8">
        <div className="w-32 h-32 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-full flex items-center justify-center text-white font-bold text-4xl shadow-2xl animate-pulse">
          {rider.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
        </div>
        <div className="absolute -top-2 -right-2 w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center animate-bounce">
          <Clock className="text-white" size={24} />
        </div>
      </div>

      {/* Status */}
      <h2 className="text-3xl font-bold text-slate-800 mb-2 text-center">
        Waiting for {rider.full_name.split(' ')[0]}
      </h2>
      <p className="text-slate-600 mb-6 text-center">
        Your ride request has been sent. The rider will respond shortly.
      </p>

      {/* Timer */}
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

      {/* Loading Bar */}
      <div className="w-full max-w-md mb-8">
        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-orange-500 to-yellow-500 transition-all duration-1000"
            style={{ width: `${((30 - timer) / 30) * 100}%` }}
          />
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
function RideDeclined({ rider, onBackToRiders, onStartNew }: { rider: MatchedRider; onBackToRiders: () => void; onStartNew: () => void }) {
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
        {rider.full_name} couldn't accept your ride
      </p>
      <p className="text-slate-600 text-center mb-8 max-w-md">
        Don't worry! There are other available riders nearby. Try requesting from another rider or start a new search.
      </p>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={onBackToRiders}
          className="px-8 py-4 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-bold rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all shadow-lg flex items-center gap-2"
        >
          <ArrowLeft size={20} />
          Try Another Rider
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
  paymentMethod: 'wallet' | 'cash';
  onChangePaymentMethod: (m: 'wallet' | 'cash') => void;
}) {
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

      {/* Rider Details Card */}
      <div className="bg-white rounded-xl shadow-lg p-6">
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
              UGX {rider.fare.toLocaleString()}
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
  paymentMethod: 'wallet' | 'cash';
  onChangePaymentMethod: (m: 'wallet' | 'cash') => void;
}) {
  const [journeyTime, setJourneyTime] = React.useState(0);

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

      {/* Trip Details */}
      <div className="bg-white rounded-xl shadow-lg p-6">
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
              UGX {rider.fare.toLocaleString()}
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
  onStartNew
}: {
  rider: MatchedRider;
  pickup: Location;
  dropoff: Location;
  onStartNew: () => void;
}) {
  const [rating, setRating] = React.useState(0);
  const [hoveredRating, setHoveredRating] = React.useState(0);

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
            Thanks for riding with BodaGo
          </p>
        </div>
      </div>

      {/* Trip Summary */}
      <div className="bg-white rounded-xl shadow-lg p-6">
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
              UGX {rider.fare.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Rate Your Rider */}
      <div className="bg-white rounded-xl shadow-lg p-6">
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
