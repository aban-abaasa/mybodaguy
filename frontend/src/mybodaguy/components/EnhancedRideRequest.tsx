import { useState } from 'react';
import { MapPin, Search, Crown, Home, DollarSign, Star, User, Navigation } from 'lucide-react';
import { toast } from 'sonner';

interface MatchedRider {
  id: string;
  name: string;
  rating: number;
  total_rides: number;
  mode: 'normal' | 'vip' | 'return';
  knows_destination: boolean;
  distance_km: number;
  estimated_arrival_min: number;
  price: number;
  original_price?: number;
  profile_image?: string;
}

interface EnhancedRideRequestProps {
  customerId: string;
}

export default function EnhancedRideRequest({ customerId }: EnhancedRideRequestProps) {
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [searching, setSearching] = useState(false);
  const [matchedRiders, setMatchedRiders] = useState<MatchedRider[]>([]);
  const [selectedRider, setSelectedRider] = useState<string | null>(null);

  const handleSearchRiders = async () => {
    if (!pickup || !dropoff) {
      toast.error('Please enter both pickup and drop-off locations');
      return;
    }

    setSearching(true);
    try {
      // TODO: Implement API call to match riders based on algorithm
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Placeholder matched riders with algorithm-based sorting
      const riders: MatchedRider[] = [
        {
          id: '1',
          name: 'John Mukasa',
          rating: 4.8,
          total_rides: 245,
          mode: 'return',
          knows_destination: true,
          distance_km: 1.2,
          estimated_arrival_min: 5,
          price: 8000,
          original_price: 15000
        },
        {
          id: '2',
          name: 'Sarah Namugga',
          rating: 4.9,
          total_rides: 312,
          mode: 'vip',
          knows_destination: true,
          distance_km: 0.8,
          estimated_arrival_min: 3,
          price: 18000,
          original_price: 15000
        },
        {
          id: '3',
          name: 'David Okello',
          rating: 4.7,
          total_rides: 189,
          mode: 'normal',
          knows_destination: true,
          distance_km: 2.1,
          estimated_arrival_min: 8,
          price: 15000
        },
        {
          id: '4',
          name: 'Grace Nakato',
          rating: 4.6,
          total_rides: 156,
          mode: 'normal',
          knows_destination: false,
          distance_km: 1.5,
          estimated_arrival_min: 6,
          price: 15000
        }
      ];

      setMatchedRiders(riders);
      toast.success(`Found ${riders.length} available riders`);
    } catch (error) {
      toast.error('Failed to find riders');
    } finally {
      setSearching(false);
    }
  };

  const handleRequestRide = async (riderId: string) => {
    try {
      // TODO: Implement API call to request ride
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const rider = matchedRiders.find(r => r.id === riderId);
      toast.success(`Ride requested from ${rider?.name}!`);
      setSelectedRider(riderId);
    } catch (error) {
      toast.error('Failed to request ride');
    }
  };

  return (
    <div className="space-y-6">
      {/* Search Form */}
      <div className="bg-white rounded-xl shadow-lg p-6">
        <h3 className="text-xl font-bold text-slate-800 mb-4">Request a Ride</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Pickup Location
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type="text"
                value={pickup}
                onChange={(e) => setPickup(e.target.value)}
                placeholder="Where are you now?"
                className="w-full pl-11 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Drop-off Location
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input
                type="text"
                value={dropoff}
                onChange={(e) => setDropoff(e.target.value)}
                placeholder="Where do you want to go?"
                className="w-full pl-11 pr-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          <button
            onClick={handleSearchRiders}
            disabled={searching}
            className="w-full py-4 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-bold text-lg rounded-xl hover:from-orange-600 hover:to-yellow-600 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
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
      {matchedRiders.length > 0 && (
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-slate-800">
              Available Riders ({matchedRiders.length})
            </h3>
            <p className="text-sm text-slate-600">
              Sorted by best match
            </p>
          </div>

          <div className="space-y-3">
            {matchedRiders.map((rider) => (
              <RiderCard
                key={rider.id}
                rider={rider}
                onRequest={handleRequestRide}
                isSelected={selectedRider === rider.id}
              />
            ))}
          </div>

          {/* Algorithm Info */}
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Smart Matching:</strong> Riders are ranked by location knowledge, distance, 
              rating, and mode. Riders who know your destination area appear first!
            </p>
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
  onRequest: (id: string) => void;
  isSelected: boolean;
}) {
  const modeConfig = {
    normal: { color: 'slate', icon: DollarSign, label: 'Standard' },
    vip: { color: 'purple', icon: Crown, label: 'VIP Service' },
    return: { color: 'green', icon: Home, label: 'Return Home' }
  };

  const config = modeConfig[rider.mode];
  const ModeIcon = config.icon;
  const discountPercent = rider.original_price 
    ? Math.round(((rider.original_price - rider.price) / rider.original_price) * 100)
    : 0;

  return (
    <div className={`border-2 rounded-xl p-5 transition-all ${
      isSelected 
        ? 'border-orange-500 bg-gradient-to-br from-orange-50 to-yellow-50'
        : 'border-slate-200 bg-white hover:border-orange-300'
    }`}>
      <div className="flex items-start gap-4">
        {/* Rider Avatar */}
        <div className="relative flex-shrink-0">
          <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-yellow-400 rounded-full flex items-center justify-center text-white font-bold text-xl shadow-lg">
            {rider.name.split(' ').map(n => n[0]).join('')}
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
              <h4 className="font-bold text-slate-800 text-lg">{rider.name}</h4>
              <div className="flex items-center gap-3 text-sm text-slate-600">
                <div className="flex items-center gap-1">
                  <Star size={14} className="text-yellow-500 fill-yellow-500" />
                  <span className="font-medium">{rider.rating}</span>
                </div>
                <span>•</span>
                <span>{rider.total_rides} rides</span>
              </div>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1 bg-${config.color}-100 text-${config.color}-700`}>
              <ModeIcon size={12} />
              {config.label}
            </div>
          </div>

          {/* Rider Highlights */}
          <div className="flex flex-wrap gap-2 mb-3">
            {rider.knows_destination && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                <Navigation size={12} />
                Knows your destination
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
              {rider.distance_km} km away
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 text-xs font-medium rounded-full">
              Arrives in {rider.estimated_arrival_min} min
            </span>
          </div>

          {/* Pricing and Action */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-800">
                  UGX {rider.price.toLocaleString()}
                </span>
                {rider.original_price && (
                  <span className="text-sm text-slate-500 line-through">
                    UGX {rider.original_price.toLocaleString()}
                  </span>
                )}
              </div>
              {discountPercent > 0 && (
                <span className="text-xs font-semibold text-green-600">
                  Save {discountPercent}% 🎉
                </span>
              )}
            </div>
            
            <button
              onClick={() => onRequest(rider.id)}
              disabled={isSelected}
              className={`px-6 py-2.5 rounded-lg font-semibold transition-all ${
                isSelected
                  ? 'bg-slate-200 text-slate-600 cursor-not-allowed'
                  : 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white hover:from-orange-600 hover:to-yellow-600 shadow-md'
              }`}
            >
              {isSelected ? 'Requested' : 'Request'}
            </button>
          </div>
        </div>
      </div>

      {/* Why This Rider Notice */}
      {rider.knows_destination && rider.mode === 'return' && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <p className="text-sm text-slate-600">
            <strong className="text-green-600">Best Value:</strong> This rider knows your exact destination 
            and is heading home in that direction. Great price + local expertise!
          </p>
        </div>
      )}
    </div>
  );
}
