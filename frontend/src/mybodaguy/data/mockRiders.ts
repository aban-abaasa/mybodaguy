// Mock rider data
export interface Rider {
  id: string;
  name: string;
  rating: number;
  total_rides: number;
  mode: 'normal' | 'vip' | 'return';
  phone: string;
  vehicle: {
    type: string;
    plate: string;
    color: string;
  };
  current_location: {
    lat: number;
    lng: number;
    area: string;
  };
  knows_destinations: string[]; // Area names they know well
  is_available: boolean;
  profile_image?: string;
}

export const mockRiders: Rider[] = [
  {
    id: 'rider_1',
    name: 'John Mukasa',
    rating: 4.8,
    total_rides: 245,
    mode: 'return',
    phone: '+256700123456',
    vehicle: {
      type: 'Motorcycle',
      plate: 'UEV 234A',
      color: 'Red'
    },
    current_location: {
      lat: 0.3156,
      lng: 32.5811,
      area: 'Central'
    },
    knows_destinations: ['Nakasero', 'Kololo', 'Central', 'Ntinda'],
    is_available: true
  },
  {
    id: 'rider_2',
    name: 'Sarah Namugga',
    rating: 4.9,
    total_rides: 312,
    mode: 'vip',
    phone: '+256700234567',
    vehicle: {
      type: 'Motorcycle',
      plate: 'UAM 567B',
      color: 'Black'
    },
    current_location: {
      lat: 0.3203,
      lng: 32.5789,
      area: 'Nakasero'
    },
    knows_destinations: ['Nakasero', 'Kololo', 'Central', 'Bugolobi', 'Lugogo'],
    is_available: true
  },
  {
    id: 'rider_3',
    name: 'David Okello',
    rating: 4.7,
    total_rides: 189,
    mode: 'normal',
    phone: '+256700345678',
    vehicle: {
      type: 'Motorcycle',
      plate: 'UBD 789C',
      color: 'Blue'
    },
    current_location: {
      lat: 0.3515,
      lng: 32.6126,
      area: 'Ntinda'
    },
    knows_destinations: ['Ntinda', 'Bukoto', 'Nakawa', 'Kololo'],
    is_available: true
  },
  {
    id: 'rider_4',
    name: 'Grace Nakato',
    rating: 4.6,
    total_rides: 156,
    mode: 'normal',
    phone: '+256700456789',
    vehicle: {
      type: 'Motorcycle',
      plate: 'UDC 123D',
      color: 'Green'
    },
    current_location: {
      lat: 0.2978,
      lng: 32.5989,
      area: 'Kabalagala'
    },
    knows_destinations: ['Kabalagala', 'Ndeeba', 'Makindye'],
    is_available: true
  },
  {
    id: 'rider_5',
    name: 'Peter Ssemakula',
    rating: 4.9,
    total_rides: 421,
    mode: 'vip',
    phone: '+256700567890',
    vehicle: {
      type: 'Motorcycle',
      plate: 'UAE 456E',
      color: 'Silver'
    },
    current_location: {
      lat: 0.3367,
      lng: 32.6034,
      area: 'Lugogo'
    },
    knows_destinations: ['Lugogo', 'Nakawa', 'Ntinda', 'Kololo', 'Bugolobi'],
    is_available: true
  },
  {
    id: 'rider_6',
    name: 'Moses Kato',
    rating: 4.5,
    total_rides: 134,
    mode: 'normal',
    phone: '+256700678901',
    vehicle: {
      type: 'Motorcycle',
      plate: 'UBF 789F',
      color: 'Yellow'
    },
    current_location: {
      lat: 0.3298,
      lng: 32.5689,
      area: 'Wandegeya'
    },
    knows_destinations: ['Wandegeya', 'Makerere', 'Mulago', 'Kawempe'],
    is_available: true
  },
  {
    id: 'rider_7',
    name: 'Rebecca Namutebi',
    rating: 4.8,
    total_rides: 278,
    mode: 'return',
    phone: '+256700789012',
    vehicle: {
      type: 'Motorcycle',
      plate: 'UAG 234G',
      color: 'White'
    },
    current_location: {
      lat: 0.3689,
      lng: 32.6345,
      area: 'Najjera'
    },
    knows_destinations: ['Najjera', 'Naalya', 'Kira', 'Ntinda'],
    is_available: true
  },
  {
    id: 'rider_8',
    name: 'James Wanyama',
    rating: 4.7,
    total_rides: 203,
    mode: 'normal',
    phone: '+256700890123',
    vehicle: {
      type: 'Motorcycle',
      plate: 'UDH 567H',
      color: 'Red'
    },
    current_location: {
      lat: 0.3678,
      lng: 32.5589,
      area: 'Kawempe'
    },
    knows_destinations: ['Kawempe', 'Bwaise', 'Kalerwe', 'Wandegeya'],
    is_available: true
  }
];

// Calculate distance between two coordinates (Haversine formula)
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Base fare calculation (UGX)
function calculateBaseFare(distanceKm: number): number {
  const baseFare = 5000;
  const perKmRate = 2000;
  return baseFare + (distanceKm * perKmRate);
}

export interface MatchedRider {
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
  vehicle: {
    type: string;
    plate: string;
    color: string;
  };
  phone: string;
}

export function findAvailableRiders(
  pickupLat: number,
  pickupLng: number,
  dropoffArea: string
): MatchedRider[] {
  const availableRiders = mockRiders.filter(rider => rider.is_available);
  
  const matchedRiders: MatchedRider[] = availableRiders.map(rider => {
    const distanceToPickup = calculateDistance(
      rider.current_location.lat,
      rider.current_location.lng,
      pickupLat,
      pickupLng
    );
    
    const knowsDestination = rider.knows_destinations.some(area => 
      dropoffArea.toLowerCase().includes(area.toLowerCase()) ||
      area.toLowerCase().includes(dropoffArea.toLowerCase())
    );
    
    // Estimate arrival time (avg speed 20 km/h in traffic)
    const estimatedArrivalMin = Math.max(2, Math.round((distanceToPickup / 20) * 60));
    
    // Calculate base price
    let baseFare = 15000; // Standard fare
    let originalPrice = baseFare;
    
    // Apply mode pricing
    if (rider.mode === 'vip') {
      baseFare = Math.round(baseFare * 1.3); // 30% premium
      originalPrice = baseFare;
    } else if (rider.mode === 'return') {
      originalPrice = baseFare;
      baseFare = Math.round(baseFare * 0.6); // 40% discount
    }
    
    // Apply destination knowledge discount
    if (knowsDestination && rider.mode === 'normal') {
      originalPrice = baseFare;
      baseFare = Math.round(baseFare * 0.95); // 5% discount
    }
    
    return {
      id: rider.id,
      name: rider.name,
      rating: rider.rating,
      total_rides: rider.total_rides,
      mode: rider.mode,
      knows_destination: knowsDestination,
      distance_km: parseFloat(distanceToPickup.toFixed(1)),
      estimated_arrival_min: estimatedArrivalMin,
      price: baseFare,
      original_price: originalPrice !== baseFare ? originalPrice : undefined,
      vehicle: rider.vehicle,
      phone: rider.phone
    };
  });
  
  // Sort by algorithm:
  // 1. Knows destination (higher priority)
  // 2. Distance (closer is better)
  // 3. Rating (higher is better)
  // 4. Mode (return > normal > vip for value)
  matchedRiders.sort((a, b) => {
    // Prioritize riders who know destination
    if (a.knows_destination && !b.knows_destination) return -1;
    if (!a.knows_destination && b.knows_destination) return 1;
    
    // Then by distance
    const distanceDiff = a.distance_km - b.distance_km;
    if (Math.abs(distanceDiff) > 0.5) return distanceDiff;
    
    // Then by rating
    const ratingDiff = b.rating - a.rating;
    if (Math.abs(ratingDiff) > 0.1) return ratingDiff;
    
    // Finally by mode priority (return home = best value)
    const modeWeight = { return: 3, normal: 2, vip: 1 };
    return modeWeight[b.mode] - modeWeight[a.mode];
  });
  
  return matchedRiders;
}
