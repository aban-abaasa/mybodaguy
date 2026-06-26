import { useState, useRef, useEffect } from 'react';
import * as React from 'react';
import { MapPin, Search, Crown, Home, DollarSign, Star, User, Navigation, Phone, X, Clock, CheckCircle, XCircle, Loader, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { searchLocations, Location } from '../data/mockLocations';
import { findAvailableRiders, MatchedRider } from '../data/mockRiders';
import { trackJourneyEvent, trackRideCall, trackUIInteraction } from '../../services/featureAnalyticsService';

type RideStatus = 'searching' | 'waiting_acceptance' | 'accepted' | 'declined' | 'on_the_way' | 'arrived' | 'journey_started' | 'completed';

interface EnhancedRideRequestProps {
  customerId: string;
}

export default function EnhancedRideRequest({ customerId }: EnhancedRideRequestProps) {
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
  const [estimatedArrival, setEstimatedArrival] = useState(0);
  const pickupRef = useRef<HTMLDivElement>(null);
  const dropoffRef = useRef<HTMLDivElement>(null);

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

  // Timer for waiting acceptance
  useEffect(() => {
    if (rideStatus === 'waiting_acceptance' && waitingTimer > 0) {
      const timer = setTimeout(() => setWaitingTimer(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    } else if (rideStatus === 'waiting_acceptance' && waitingTimer === 0) {
      // Auto decline after 30 seconds
      handleRiderResponse(false);
    }
  }, [rideStatus, waitingTimer]);

  // Timer for rider arrival
  useEffect(() => {
    if (rideStatus === 'on_the_way' && estimatedArrival > 0) {
      const timer = setTimeout(() => {
        const newTime = estimatedArrival - 1;
        setEstimatedArrival(newTime);
        
        // When timer reaches 0, rider has arrived
        if (newTime === 0) {
          setRideStatus('arrived');
          toast.success('🎉 Your rider has arrived!', {
            description: 'Please meet your rider at the pickup location',
            duration: 5000
          });
        }
      }, 60000); // 1 minute (use 6000 for faster testing - 6 seconds)
      return () => clearTimeout(timer);
    }
  }, [rideStatus, estimatedArrival]);

  const handlePickupChange = (value: string) => {
    setPickup(value);
    setSelectedPickup(null);
    const suggestions = searchLocations(value);
    setPickupSuggestions(suggestions);
    setShowPickupSuggestions(suggestions.length > 0);
  };

  const handleDropoffChange = (value: string) => {
    setDropoff(value);
    setSelectedDropoff(null);
    const suggestions = searchLocations(value);
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

    setSearching(true);
    try {
      // Track feature usage for ride search
      await trackUIInteraction('click', 'search_riders', {
        pickup_location: selectedPickup?.name,
        dropoff_location: selectedDropoff?.name,
        customer_id: customerId,
      });

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Use mock data to find riders
      const riders = findAvailableRiders(
        selectedPickup.coordinates.lat,
        selectedPickup.coordinates.lng,
        selectedDropoff.area
      );

      setMatchedRiders(riders);
      
      // Track successful search
      await trackUIInteraction('success', 'riders_found', {
        riders_count: riders.length,
        pickup_location: selectedPickup?.name,
        dropoff_location: selectedDropoff?.name,
      });

      toast.success(`Found ${riders.length} available riders near you!`);
    } catch (error) {
      toast.error('Failed to find riders');
    } finally {
      setSearching(false);
    }
  };

  const handleRequestRide = async (rider: MatchedRider) => {
    setSelectedRider(rider);
    setRideStatus('waiting_acceptance');
    setWaitingTimer(30);
    
    // Track ride request
    await trackRideCall('start_ride', rider.id, {
      rider_name: rider.name,
      rider_rating: rider.rating,
      estimated_fare: rider.estimatedFare,
      customer_id: customerId,
      pickup_location: selectedPickup?.name,
      dropoff_location: selectedDropoff?.name,
    });
    
    toast.info(`Request sent to ${rider.name}`, {
      description: 'Waiting for rider to accept...'
    });

    // Simulate rider response after 3-8 seconds
    const responseTime = Math.floor(Math.random() * 5000) + 3000;
    setTimeout(() => {
      // 85% chance of acceptance
      const accepted = Math.random() > 0.15;
      handleRiderResponse(accepted);
    }, responseTime);
  };

  const handleRiderResponse = async (accepted: boolean) => {
    if (accepted) {
      setRideStatus('accepted');
      
      // Track ride acceptance
      if (selectedRider) {
        await trackRideCall('accept_ride', selectedRider.id, {
          rider_name: selectedRider.name,
          customer_id: customerId,
          estimated_fare: selectedRider.estimatedFare,
        });
      }
      
      toast.success(`🎉 ${selectedRider?.name} accepted your ride!`, {
        description: 'Rider is on the way',
        duration: 4000
      });
      
      // Move to "on the way" after 2 seconds
      setTimeout(() => {
        setRideStatus('on_the_way');
        setEstimatedArrival(selectedRider?.estimated_arrival_min || 5);
      }, 2000);
    } else {
      setRideStatus('declined');
      
      // Track ride decline
      if (selectedRider) {
        await trackRideCall('decline_ride', selectedRider.id, {
          rider_name: selectedRider.name,
          customer_id: customerId,
        });
      }
      
      toast.error(`${selectedRider?.name} declined your ride`, {
        description: 'Try requesting from another rider',
        duration: 4000
      });
    }
  };

  const handleBackToSearch = () => {
    setRideStatus(null);
    setSelectedRider(null);
    setMatchedRiders([]);
  };

  const handleStartNewRide = () => {
    setPickup('');
    setDropoff('');
    setSelectedPickup(null);
    setSelectedDropoff(null);
    setMatchedRiders([]);
    setSelectedRider(null);
    setRideStatus(null);
    setPickupSuggestions([]);
    setDropoffSuggestions([]);
  };

  const handleStartJourney = async () => {
    setRideStatus('journey_started');
    
    // Track feature usage for journey start
    if (selectedRider) {
      await trackJourneyEvent('start', selectedRider.id, {
        customer_id: customerId,
        pickup_location: selectedPickup?.name,
        dropoff_location: selectedDropoff?.name,
        rider_name: selectedRider.name,
        estimated_fare: selectedRider.estimatedFare,
      });
    }
    
    toast.success('🚀 Let\'s start the journey!', {
      description: 'Have a safe trip!',
      duration: 3000
    });
  };

  const handleCompleteJourney = async () => {
    setRideStatus('completed');
    
    // Track journey completion
    if (selectedRider) {
      await trackJourneyEvent('complete', selectedRider.id, {
        customer_id: customerId,
        rider_name: selectedRider.name,
        pickup_location: selectedPickup?.name,
        dropoff_location: selectedDropoff?.name,
      });
    }
    
    toast.success('✅ Journey completed!', {
      description: 'Thanks for riding with My Boda Guy',
      duration: 4000
    });
  };

  const handleClearSearch = () => {
    setPickup('');
    setDropoff('');
    setSelectedPickup(null);
    setSelectedDropoff(null);
    setMatchedRiders([]);
    setSelectedRider(null);
    setRideStatus(null);
    setPickupSuggestions([]);
    setDropoffSuggestions([]);
  };

  // Render different UI based on ride status
  if (rideStatus === 'waiting_acceptance' && selectedRider) {
    return <WaitingForAcceptance rider={selectedRider} timer={waitingTimer} onCancel={handleBackToSearch} />;
  }

  if (rideStatus === 'accepted' && selectedRider) {
    return <RideAccepted rider={selectedRider} />;
  }

  if (rideStatus === 'declined' && selectedRider) {
    return <RideDeclined rider={selectedRider} onBackToRiders={handleBackToSearch} onStartNew={handleStartNewRide} />;
  }

  if (rideStatus === 'on_the_way' && selectedRider) {
    return (
      <RiderOnTheWay 
        rider={selectedRider} 
        pickup={selectedPickup!} 
        dropoff={selectedDropoff!}
        estimatedArrival={estimatedArrival}
        onCancel={handleStartNewRide}
      />
    );
  }

  if (rideStatus === 'arrived' && selectedRider) {
    return (
      <RiderArrived 
        rider={selectedRider} 
        pickup={selectedPickup!}
        onStartJourney={handleStartJourney}
        onCancel={handleStartNewRide}
      />
    );
  }

  if (rideStatus === 'journey_started' && selectedRider) {
    return (
      <JourneyStarted 
        rider={selectedRider} 
        pickup={selectedPickup!} 
        dropoff={selectedDropoff!}
        onComplete={handleCompleteJourney}
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
    <div className="space-y-3 p-2 bg-gradient-to-br from-orange-50 via-yellow-50 to-red-50 min-h-screen">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-500 to-red-600 rounded-xl shadow-xl p-3 text-white">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-white/20 backdrop-blur rounded-lg flex items-center justify-center">
            <MapPin size={20} />
          </div>
          <div>
            <h3 className="text-base font-bold">Book Your Ride</h3>
            <p className="text-[10px] text-white/80">Fast, safe & affordable</p>
          </div>
        </div>
      </div>

      {/* Search Form */}
      <div className="bg-white rounded-xl shadow-lg p-3 space-y-3">
        {/* Pickup Location */}
        <div ref={pickupRef} className="relative">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1.5">
            <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center">
              <MapPin className="text-green-600" size={12} />
            </div>
            Pickup
          </label>
          <div className="relative">
            <input
              type="text"
              value={pickup}
              onChange={(e) => handlePickupChange(e.target.value)}
              onFocus={() => pickup && setShowPickupSuggestions(true)}
              placeholder="Where are you?"
              className="w-full pl-3 pr-3 py-2 border-2 border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-slate-800 placeholder-slate-400 text-sm"
            />
            {selectedPickup && (
              <CheckCircle className="absolute right-2 top-1/2 -translate-y-1/2 text-green-500" size={16} />
            )}
          </div>
          
          {/* Pickup Suggestions */}
          {showPickupSuggestions && pickupSuggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border-2 border-slate-200 rounded-lg shadow-2xl max-h-48 overflow-y-auto">
              {pickupSuggestions.map((location) => (
                <button
                  key={location.id}
                  onClick={() => selectPickupLocation(location)}
                  className="w-full text-left px-3 py-2 hover:bg-green-50 border-b border-slate-100 last:border-b-0 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <MapPin className="text-green-500 mt-0.5 flex-shrink-0" size={14} />
                    <div>
                      <div className="font-semibold text-slate-800 text-xs">{location.name}</div>
                      <div className="text-[10px] text-slate-500 truncate">{location.fullAddress}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Visual Connector */}
        <div className="flex justify-center">
          <div className="flex flex-col items-center gap-0.5">
            <div className="w-0.5 h-3 bg-gradient-to-b from-green-400 to-red-400 rounded-full"></div>
            <div className="w-0.5 h-3 bg-gradient-to-b from-green-400 to-red-400 rounded-full"></div>
          </div>
        </div>

        {/* Dropoff Location */}
        <div ref={dropoffRef} className="relative">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1.5">
            <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center">
              <MapPin className="text-red-600" size={12} />
            </div>
            Drop-off
          </label>
          <div className="relative">
            <input
              type="text"
              value={dropoff}
              onChange={(e) => handleDropoffChange(e.target.value)}
              onFocus={() => dropoff && setShowDropoffSuggestions(true)}
              placeholder="Where to?"
              className="w-full pl-3 pr-3 py-2 border-2 border-red-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none text-slate-800 placeholder-slate-400 text-sm"
            />
            {selectedDropoff && (
              <CheckCircle className="absolute right-2 top-1/2 -translate-y-1/2 text-red-500" size={16} />
            )}
          </div>
          
          {/* Dropoff Suggestions */}
          {showDropoffSuggestions && dropoffSuggestions.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border-2 border-slate-200 rounded-lg shadow-2xl max-h-48 overflow-y-auto">
              {dropoffSuggestions.map((location) => (
                <button
                  key={location.id}
                  onClick={() => selectDropoffLocation(location)}
                  className="w-full text-left px-3 py-2 hover:bg-red-50 border-b border-slate-100 last:border-b-0 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <MapPin className="text-red-500 mt-0.5 flex-shrink-0" size={14} />
                    <div>
                      <div className="font-semibold text-slate-800 text-xs">{location.name}</div>
                      <div className="text-[10px] text-slate-500 truncate">{location.fullAddress}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search Button */}
        <button
          onClick={handleSearchRiders}
          disabled={searching || !selectedPickup || !selectedDropoff}
          className="w-full py-3 bg-gradient-to-r from-orange-500 via-red-500 to-pink-500 text-white font-bold text-sm rounded-lg hover:shadow-lg transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {searching ? (
            <>
              <Loader className="animate-spin" size={16} />
              Searching...
            </>
          ) : (
            <>
              <Search size={16} />
              Find Riders
            </>
          )}
        </button>

        {/* Quick Clear */}
        {(pickup || dropoff) && (
          <button
            onClick={handleClearSearch}
            className="w-full py-1.5 text-xs text-slate-500 hover:text-slate-700 flex items-center justify-center gap-1"
          >
            <X size={12} />
            Clear All
          </button>
        )}
      </div>

      {/* Matched Riders */}
      {matchedRiders.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-2">
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center">
                <User size={16} className="text-orange-600" />
              </div>
              {matchedRiders.length} Riders Found
            </h3>
          </div>

          <div className="space-y-3">
            {matchedRiders.map((rider) => (
              <RiderCard
                key={rider.id}
                rider={rider}
                onRequest={handleRequestRide}
                isSelected={selectedRider?.id === rider.id}
              />
            ))}
          </div>
        </div>
      )}
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
    normal: { color: 'bg-blue-100 text-blue-700', icon: DollarSign, label: 'Standard' },
    vip: { color: 'bg-purple-100 text-purple-700', icon: Crown, label: 'VIP' },
    return: { color: 'bg-green-100 text-green-700', icon: Home, label: 'Return' }
  };

  const config = modeConfig[rider.mode];
  const ModeIcon = config.icon;
  const discountPercent = rider.original_price 
    ? Math.round(((rider.original_price - rider.price) / rider.original_price) * 100)
    : 0;

  return (
    <div className={`border-2 rounded-2xl overflow-hidden transition-all shadow-md ${
      isSelected 
        ? 'border-orange-500 bg-gradient-to-br from-orange-50 to-amber-50 shadow-lg'
        : 'border-slate-200 bg-white hover:border-orange-300 hover:shadow-lg'
    }`}>
      {/* Header Section */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 p-4 text-white">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-14 h-14 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg flex-shrink-0">
            {rider.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-bold text-lg truncate">{rider.name}</h4>
            <div className="flex items-center gap-2 text-sm">
              <div className="flex items-center gap-1">
                <Star size={14} className="text-yellow-400 fill-yellow-400" />
                <span className="font-semibold">{rider.rating}</span>
              </div>
              <span className="text-slate-400">•</span>
              <span className="text-slate-300">{rider.total_rides} trips</span>
            </div>
          </div>
          <div className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1 ${config.color} flex-shrink-0`}>
            <ModeIcon size={12} />
            {config.label}
          </div>
        </div>
      </div>

      {/* Body Section */}
      <div className="p-4">
        {/* Badges */}
        <div className="flex flex-wrap gap-2 mb-3">
          {rider.knows_destination && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-full">
              <Navigation size={12} />
              Knows route
            </span>
          )}
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded-full">
            📍 {rider.distance_km} km
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 text-xs font-semibold rounded-full">
            ⏱️ {rider.estimated_arrival_min} min
          </span>
        </div>

        {/* Pricing */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-800">
                {rider.price.toLocaleString()}
              </span>
              <span className="text-sm text-slate-600">UGX</span>
            </div>
            {rider.original_price && discountPercent > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400 line-through">
                  {rider.original_price.toLocaleString()}
                </span>
                <span className="text-xs font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                  -{discountPercent}%
                </span>
              </div>
            )}
          </div>
          
          <button
            onClick={() => onRequest(rider)}
            disabled={isSelected}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
              isSelected
                ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-orange-500 to-red-500 text-white hover:shadow-lg active:scale-95'
            }`}
          >
            {isSelected ? (
              <><CheckCircle size={16} /> Requested</>
            ) : (
              'Book Now'
            )}
          </button>
        </div>

        {/* Vehicle Details - Show when selected */}
        {isSelected && (
          <div className="bg-slate-50 rounded-xl p-3 border-2 border-orange-200">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-slate-600 font-medium">Vehicle:</span>
              <span className="text-slate-800 font-semibold">{rider.vehicle.color} {rider.vehicle.type}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-600 font-medium text-sm">Plate:</span>
              <span className="bg-yellow-400 text-slate-900 px-3 py-1 rounded-lg font-bold text-sm">
                {rider.vehicle.plate}
              </span>
            </div>
            {rider.phone && (
              <a
                href={`tel:${rider.phone}`}
                className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 transition-all"
              >
                <Phone size={18} />
                Call Rider
              </a>
            )}
          </div>
        )}

        {/* Best Value Notice */}
        {rider.knows_destination && rider.mode === 'return' && (
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <p className="text-xs text-emerald-800 flex items-start gap-2">
              <span className="text-base">💡</span>
              <span><strong>Best Value:</strong> This rider knows your destination and is heading that way!</span>
            </p>
          </div>
        )}
      </div>
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
          {rider.name.split(' ').map(n => n[0]).join('')}
        </div>
        <div className="absolute -top-2 -right-2 w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center animate-bounce">
          <Clock className="text-white" size={24} />
        </div>
      </div>

      {/* Status */}
      <h2 className="text-3xl font-bold text-slate-800 mb-2 text-center">
        Waiting for {rider.name.split(' ')[0]}
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
              <span>{rider.distance_km} km away</span>
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

// Ride Accepted Component
function RideAccepted({ rider }: { rider: MatchedRider }) {
  return (
    <div className="min-h-[500px] bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl shadow-xl p-8 flex flex-col items-center justify-center">
      {/* Success Animation */}
      <div className="relative mb-8 animate-bounce">
        <div className="w-32 h-32 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center shadow-2xl">
          <CheckCircle className="text-white" size={64} />
        </div>
        <div className="absolute inset-0 bg-green-500 rounded-full opacity-25 animate-ping"></div>
      </div>

      {/* Success Message */}
      <h2 className="text-4xl font-bold text-slate-800 mb-3 text-center">
        Ride Accepted! 🎉
      </h2>
      <p className="text-xl text-slate-700 mb-2 text-center">
        {rider.name} is getting ready
      </p>
      <p className="text-slate-600 text-center mb-8">
        Your rider will be on the way shortly
      </p>

      {/* Rider Info Card */}
      <div className="bg-white rounded-xl p-6 shadow-lg max-w-md w-full">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-full flex items-center justify-center text-white font-bold text-xl">
            {rider.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-lg text-slate-800">{rider.name}</h3>
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Star className="text-yellow-500 fill-yellow-500" size={14} />
              <span>{rider.rating}</span>
              <span>•</span>
              <span>{rider.total_rides} rides</span>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-slate-600 mb-1">Vehicle</div>
            <div className="font-semibold text-slate-800">{rider.vehicle.color} {rider.vehicle.type}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-3">
            <div className="text-slate-600 mb-1">Plate</div>
            <div className="font-bold text-slate-800 bg-yellow-400 inline-block px-2 py-0.5 rounded">
              {rider.vehicle.plate}
            </div>
          </div>
        </div>
      </div>
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
        {rider.name} couldn't accept your ride
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

// Rider On The Way Component
function RiderOnTheWay({ 
  rider, 
  pickup, 
  dropoff, 
  estimatedArrival,
  onCancel 
}: { 
  rider: MatchedRider; 
  pickup: Location; 
  dropoff: Location;
  estimatedArrival: number;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Header Status */}
      <div className="bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl shadow-xl p-6 text-white">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
            <h2 className="text-2xl font-bold">Rider On The Way</h2>
          </div>
          <div className="bg-white/20 px-4 py-2 rounded-lg">
            <div className="text-sm opacity-90">Arriving in</div>
            <div className="text-2xl font-bold">{estimatedArrival} min</div>
          </div>
        </div>
        <p className="opacity-90">Your rider is heading to your pickup location</p>
      </div>

      {/* Rider Details Card */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Rider Details</h3>
        <div className="flex items-start gap-4 mb-6">
          <div className="w-20 h-20 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-full flex items-center justify-center text-white font-bold text-2xl shadow-lg">
            {rider.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div className="flex-1">
            <h4 className="text-xl font-bold text-slate-800">{rider.name}</h4>
            <div className="flex items-center gap-3 text-sm text-slate-600 mb-2">
              <div className="flex items-center gap-1">
                <Star className="text-yellow-500 fill-yellow-500" size={16} />
                <span className="font-semibold">{rider.rating}</span>
              </div>
              <span>•</span>
              <span>{rider.total_rides} completed rides</span>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`tel:${rider.phone}`}
                className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 transition-all flex items-center justify-center gap-2"
              >
                <Phone size={18} />
                Call Rider
              </a>
              <button className="flex-1 px-4 py-2 bg-blue-500 text-white rounded-lg font-semibold hover:bg-blue-600 transition-all">
                Send Message
              </button>
            </div>
          </div>
        </div>

        {/* Vehicle Info */}
        <div className="grid grid-cols-2 gap-4 mb-6 pb-6 border-b border-slate-200">
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="text-sm text-slate-600 mb-1">Vehicle</div>
            <div className="font-semibold text-slate-800">{rider.vehicle.color} {rider.vehicle.type}</div>
          </div>
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="text-sm text-slate-600 mb-1">Plate Number</div>
            <div className="font-bold text-lg bg-yellow-400 text-slate-900 inline-block px-3 py-1 rounded">
              {rider.vehicle.plate}
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
              UGX {rider.price.toLocaleString()}
            </span>
          </div>
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

// Rider Arrived Component
function RiderArrived({ 
  rider, 
  pickup,
  onStartJourney,
  onCancel 
}: { 
  rider: MatchedRider; 
  pickup: Location;
  onStartJourney: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Arrival Announcement */}
      <div className="bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl shadow-2xl p-8 text-white text-center relative overflow-hidden">
        {/* Background Animation */}
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 left-0 w-32 h-32 bg-white rounded-full -translate-x-1/2 -translate-y-1/2 animate-ping"></div>
          <div className="absolute bottom-0 right-0 w-32 h-32 bg-white rounded-full translate-x-1/2 translate-y-1/2 animate-ping" style={{ animationDelay: '1s' }}></div>
        </div>
        
        {/* Content */}
        <div className="relative z-10">
          <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl animate-bounce">
            <CheckCircle className="text-blue-500" size={48} />
          </div>
          
          <h2 className="text-4xl font-bold mb-3">
            🎉 Rider Has Arrived!
          </h2>
          <p className="text-xl opacity-95 mb-2">
            {rider.name} is waiting for you
          </p>
          <p className="text-lg opacity-90">
            Please proceed to the pickup location
          </p>
        </div>
      </div>

      {/* Rider & Vehicle Info */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Your Rider</h3>
        
        <div className="flex items-center gap-4 mb-6 pb-6 border-b border-slate-200">
          <div className="w-20 h-20 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-full flex items-center justify-center text-white font-bold text-2xl shadow-lg">
            {rider.name.split(' ').map(n => n[0]).join('')}
          </div>
          <div className="flex-1">
            <h4 className="text-xl font-bold text-slate-800">{rider.name}</h4>
            <div className="flex items-center gap-2 text-sm text-slate-600 mb-2">
              <Star className="text-yellow-500 fill-yellow-500" size={16} />
              <span className="font-semibold">{rider.rating}</span>
              <span>•</span>
              <span>{rider.total_rides} rides</span>
            </div>
          </div>
        </div>

        {/* Vehicle Details - Emphasized */}
        <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl p-6 mb-6 border-2 border-yellow-300">
          <h4 className="font-bold text-slate-800 mb-3 text-center">Look for this vehicle:</h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-lg p-4 text-center shadow-md">
              <div className="text-sm text-slate-600 mb-2">Vehicle</div>
              <div className="font-bold text-lg text-slate-800">{rider.vehicle.color}</div>
              <div className="font-semibold text-slate-700">{rider.vehicle.type}</div>
            </div>
            <div className="bg-white rounded-lg p-4 text-center shadow-md">
              <div className="text-sm text-slate-600 mb-2">Plate Number</div>
              <div className="font-black text-2xl bg-yellow-400 text-slate-900 inline-block px-4 py-2 rounded-lg shadow-lg mt-1">
                {rider.vehicle.plate}
              </div>
            </div>
          </div>
        </div>

        {/* Pickup Location */}
        <div className="bg-slate-50 rounded-lg p-4 mb-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <MapPin className="text-green-600" size={20} />
            </div>
            <div className="flex-1">
              <div className="text-sm text-slate-600 mb-1">Meeting Point</div>
              <div className="font-bold text-slate-800">{pickup.name}</div>
              <div className="text-sm text-slate-600">{pickup.fullAddress}</div>
            </div>
          </div>
        </div>

        {/* Contact */}
        <div className="flex gap-3">
          <a
            href={`tel:${rider.phone}`}
            className="flex-1 px-6 py-4 bg-green-500 text-white rounded-xl font-bold hover:bg-green-600 transition-all flex items-center justify-center gap-2 shadow-lg"
          >
            <Phone size={20} />
            Call Rider
          </a>
          <button className="flex-1 px-6 py-4 bg-blue-500 text-white rounded-xl font-bold hover:bg-blue-600 transition-all flex items-center justify-center gap-2 shadow-lg">
            Message
          </button>
        </div>
      </div>

      {/* Start Journey Button */}
      <button
        onClick={onStartJourney}
        className="w-full py-5 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold text-xl rounded-xl hover:from-green-600 hover:to-emerald-700 transition-all shadow-xl flex items-center justify-center gap-3"
      >
        <CheckCircle size={24} />
        Let's start the journey
      </button>

      {/* Cancel */}
      <button
        onClick={onCancel}
        className="w-full py-3 bg-red-50 text-red-600 font-semibold rounded-lg hover:bg-red-100 transition-all border-2 border-red-200"
      >
        Cancel Ride
      </button>
    </div>
  );
}

// Journey Started Component
function JourneyStarted({ 
  rider, 
  pickup, 
  dropoff,
  onComplete
}: { 
  rider: MatchedRider; 
  pickup: Location; 
  dropoff: Location;
  onComplete: () => void;
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
        {/* Animated Background */}
        <div className="absolute inset-0">
          <div className="absolute top-0 left-1/4 w-64 h-64 bg-white opacity-10 rounded-full animate-pulse"></div>
          <div className="absolute bottom-0 right-1/4 w-48 h-48 bg-white opacity-10 rounded-full animate-pulse" style={{ animationDelay: '1s' }}></div>
        </div>
        
        <div className="relative z-10">
          <div className="inline-flex items-center gap-3 bg-white/20 rounded-full px-6 py-3 mb-4">
            <div className="w-3 h-3 bg-white rounded-full animate-pulse"></div>
            <span className="font-semibold text-lg">Journey In Progress</span>
          </div>
          
          <h2 className="text-4xl font-bold mb-3">
            🚗 On Your Way!
          </h2>
          <p className="text-xl opacity-95 mb-4">
            Heading to your destination
          </p>
          
          {/* Journey Timer */}
          <div className="inline-block bg-white/20 rounded-xl px-8 py-4 backdrop-blur-sm">
            <div className="text-sm opacity-90 mb-1">Journey Time</div>
            <div className="text-5xl font-bold font-mono">{formatTime(journeyTime)}</div>
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
        <div className="border-t border-slate-200 pt-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-lg">
              {rider.name.split(' ').map(n => n[0]).join('')}
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-slate-800 text-lg">{rider.name}</h4>
              <div className="text-sm text-slate-600">
                {rider.vehicle.color} {rider.vehicle.type} • {rider.vehicle.plate}
              </div>
            </div>
            <a
              href={`tel:${rider.phone}`}
              className="px-4 py-2 bg-green-500 text-white rounded-lg font-semibold hover:bg-green-600 transition-all flex items-center gap-2"
            >
              <Phone size={18} />
              Call
            </a>
          </div>
        </div>

        {/* Fare */}
        <div className="mt-6 pt-6 border-t border-slate-200">
          <div className="flex items-center justify-between">
            <span className="text-slate-600 font-medium">Trip Fare</span>
            <span className="text-3xl font-bold text-green-600">
              UGX {rider.price.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Arrived Button */}
      <button
        onClick={onComplete}
        className="w-full py-5 bg-gradient-to-r from-blue-500 to-purple-600 text-white font-bold text-xl rounded-xl hover:from-blue-600 hover:to-purple-700 transition-all shadow-xl flex items-center justify-center gap-3"
      >
        <CheckCircle size={24} />
        I've Arrived - End Journey
      </button>

      {/* Safety Info */}
      <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 text-center">
        <p className="text-sm text-blue-800">
          <strong>Safety First:</strong> Always wear a helmet and follow traffic rules
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
          
          <h2 className="text-4xl font-bold mb-3">
            ✅ Journey Complete!
          </h2>
          <p className="text-xl opacity-95 mb-2">
            You've arrived safely at your destination
          </p>
          <p className="text-lg opacity-90">
            Thanks for riding with My Boda Guy
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
            <span className="font-semibold text-slate-800">{rider.name}</span>
          </div>
          <div className="flex justify-between py-2 border-t-2 border-slate-200 pt-4">
            <span className="text-slate-700 font-medium text-lg">Total Fare</span>
            <span className="text-3xl font-bold text-green-600">
              UGX {rider.price.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Rate Your Rider */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-4 text-center">Rate Your Experience</h3>
        <p className="text-slate-600 text-center mb-4">How was your ride with {rider.name.split(' ')[0]}?</p>
        
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
                size={48}
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
        
        <button
          onClick={onStartNew}
          className="w-full py-3 bg-white text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition-all border-2 border-slate-200"
        >
          Back to Home
        </button>
      </div>
    </div>
  );
}
