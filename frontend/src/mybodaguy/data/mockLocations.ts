// Mock location data for Kampala, Uganda
export interface Location {
  id: string;
  name: string;
  area: string;
  fullAddress: string;
  coordinates: {
    lat: number;
    lng: number;
  };
}

export const mockLocations: Location[] = [
  // Central Kampala
  { id: '1', name: 'Kampala Road', area: 'Central', fullAddress: 'Kampala Road, Central Division, Kampala', coordinates: { lat: 0.3136, lng: 32.5811 } },
  { id: '2', name: 'Oasis Mall', area: 'Kampala', fullAddress: 'Oasis Mall, Yusuf Lule Road, Kampala', coordinates: { lat: 0.3163, lng: 32.5822 } },
  { id: '3', name: 'Garden City', area: 'Kampala', fullAddress: 'Garden City Mall, Yusuf Lule Road, Kampala', coordinates: { lat: 0.3198, lng: 32.5925 } },
  { id: '4', name: 'Acacia Mall', area: 'Kololo', fullAddress: 'Acacia Mall, Kisementi, Kololo', coordinates: { lat: 0.3358, lng: 32.5953 } },
  { id: '5', name: 'City Square', area: 'Central', fullAddress: 'City Square, Ben Kiwanuka Street, Kampala', coordinates: { lat: 0.3167, lng: 32.5811 } },
  
  // Nakasero
  { id: '6', name: 'Sheraton Hotel', area: 'Nakasero', fullAddress: 'Sheraton Kampala Hotel, Ternan Avenue, Nakasero', coordinates: { lat: 0.3232, lng: 32.5817 } },
  { id: '7', name: 'Serena Hotel', area: 'Nakasero', fullAddress: 'Serena Hotel, Kintu Road, Nakasero', coordinates: { lat: 0.3189, lng: 32.5758 } },
  { id: '8', name: 'Nakasero Market', area: 'Nakasero', fullAddress: 'Nakasero Market, Kampala Road, Nakasero', coordinates: { lat: 0.3203, lng: 32.5789 } },
  
  // Ntinda
  { id: '9', name: 'Ntinda Complex', area: 'Ntinda', fullAddress: 'Ntinda Shopping Complex, Ntinda Road, Ntinda', coordinates: { lat: 0.3515, lng: 32.6126 } },
  { id: '10', name: 'Bukoto Market', area: 'Ntinda', fullAddress: 'Bukoto Market, Bukoto Street, Ntinda', coordinates: { lat: 0.3456, lng: 32.6089 } },
  
  // Kololo
  { id: '11', name: 'Kololo Airstrip', area: 'Kololo', fullAddress: 'Kololo Independence Grounds, Prince Charles Drive, Kololo', coordinates: { lat: 0.3289, lng: 32.5967 } },
  { id: '12', name: 'Kisementi', area: 'Kololo', fullAddress: 'Kisementi Shopping Area, Kololo', coordinates: { lat: 0.3356, lng: 32.5942 } },
  
  // Bugolobi
  { id: '13', name: 'Bugolobi Market', area: 'Bugolobi', fullAddress: 'Bugolobi Market, Luthuli Avenue, Bugolobi', coordinates: { lat: 0.3278, lng: 32.6089 } },
  { id: '14', name: 'Centenary Park', area: 'Bugolobi', fullAddress: 'Centenary Park, Luthuli Avenue, Bugolobi', coordinates: { lat: 0.3301, lng: 32.6112 } },
  
  // Wandegeya
  { id: '15', name: 'Makerere University', area: 'Wandegeya', fullAddress: 'Makerere University Main Gate, Wandegeya', coordinates: { lat: 0.3298, lng: 32.5689 } },
  { id: '16', name: 'Wandegeya Market', area: 'Wandegeya', fullAddress: 'Wandegeya Market, Sir Apollo Kaggwa Road', coordinates: { lat: 0.3312, lng: 32.5712 } },
  
  // Kabalagala
  { id: '17', name: 'Kabalagala Trading Centre', area: 'Kabalagala', fullAddress: 'Kabalagala Trading Centre, Ggaba Road', coordinates: { lat: 0.2978, lng: 32.5989 } },
  { id: '18', name: 'Club Amnesia', area: 'Kabalagala', fullAddress: 'Club Amnesia, Kabalagala, Kampala', coordinates: { lat: 0.2956, lng: 32.6001 } },
  
  // Ndeeba
  { id: '19', name: 'Quality Shopping Centre', area: 'Ndeeba', fullAddress: 'Quality Shopping Centre, Ndeeba', coordinates: { lat: 0.2889, lng: 32.5545 } },
  { id: '20', name: 'Ndeeba Taxi Park', area: 'Ndeeba', fullAddress: 'Ndeeba Taxi Park, Masaka Road', coordinates: { lat: 0.2901, lng: 32.5567 } },
  
  // Entebbe Road
  { id: '21', name: 'Entebbe Airport', area: 'Entebbe', fullAddress: 'Entebbe International Airport, Entebbe', coordinates: { lat: 0.0424, lng: 32.4435 } },
  { id: '22', name: 'Victoria Mall', area: 'Entebbe Road', fullAddress: 'Victoria Mall, Entebbe Road', coordinates: { lat: 0.2789, lng: 32.5234 } },
  
  // Kawempe
  { id: '23', name: 'Kawempe Market', area: 'Kawempe', fullAddress: 'Kawempe Market, Bombo Road', coordinates: { lat: 0.3678, lng: 32.5589 } },
  { id: '24', name: 'Kawempe Hospital', area: 'Kawempe', fullAddress: 'Kawempe General Hospital, Bombo Road', coordinates: { lat: 0.3712, lng: 32.5601 } },
  
  // Najjera
  { id: '25', name: 'Najjera Town', area: 'Najjera', fullAddress: 'Najjera Trading Centre, Kira Road', coordinates: { lat: 0.3689, lng: 32.6345 } },
  { id: '26', name: 'Najjera Market', area: 'Najjera', fullAddress: 'Najjera Market, Kira Road', coordinates: { lat: 0.3701, lng: 32.6378 } },
  
  // Naalya
  { id: '27', name: 'Naalya Estate', area: 'Naalya', fullAddress: 'Naalya Estate, Naalya Road', coordinates: { lat: 0.3734, lng: 32.6523 } },
  { id: '28', name: 'Naalya Market', area: 'Naalya', fullAddress: 'Naalya Market, Namugongo Road', coordinates: { lat: 0.3756, lng: 32.6545 } },
  
  // Lugogo
  { id: '29', name: 'Lugogo Mall', area: 'Lugogo', fullAddress: 'Lugogo Mall, Lugogo Bypass', coordinates: { lat: 0.3367, lng: 32.6034 } },
  { id: '30', name: 'Nakawa Market', area: 'Nakawa', fullAddress: 'Nakawa Market, Jinja Road', coordinates: { lat: 0.3278, lng: 32.6212 } },
];

export function searchLocations(query: string): Location[] {
  if (!query || query.length < 2) return [];
  
  const searchTerm = query.toLowerCase();
  return mockLocations.filter(location => 
    location.name.toLowerCase().includes(searchTerm) ||
    location.area.toLowerCase().includes(searchTerm) ||
    location.fullAddress.toLowerCase().includes(searchTerm)
  ).slice(0, 8); // Return max 8 results
}

export function getLocationById(id: string): Location | undefined {
  return mockLocations.find(loc => loc.id === id);
}
