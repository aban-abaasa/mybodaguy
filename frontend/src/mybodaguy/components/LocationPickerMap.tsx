import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Locate, Navigation, Search, Loader2 } from 'lucide-react';
import type { Location } from '../data/mockLocations';
import { geocodeAddress, reverseGeocode } from '../services/geocodeService';
import { getRoute } from '../services/routingService';

// Kampala city center — used only as a fallback when GPS is denied/unavailable.
const DEFAULT_CENTER: [number, number] = [0.3157, 32.5756];
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Self-contained colored pin (no external icon assets to fetch/bundle).
function pinIcon(color: string): L.DivIcon {
  const svg = `<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.7 23.3 0 15 0z" fill="${color}"/>
    <circle cx="15" cy="15" r="6" fill="white"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [30, 42], iconAnchor: [15, 42] });
}

async function toLocation(idPrefix: string, name: string, lat: number, lng: number): Promise<Location> {
  const address = (await reverseGeocode(lat, lng)) || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  return { id: `${idPrefix}_${lat.toFixed(5)}_${lng.toFixed(5)}`, name, area: name, fullAddress: address, coordinates: { lat, lng } };
}

interface LocationPickerMapProps {
  pickup: Location | null;
  dropoff: Location | null;
  onPickupChange: (location: Location) => void;
  onDropoffChange: (location: Location) => void;
  onRouteInfo?: (distanceKm: number, durationMin: number) => void;
  /** Locks the pickup pin — used when pickup was auto-filled from a
   * registered supermarket's own coordinates, same as the text input. */
  pickupLocked?: boolean;
  /** Off for confirming a destination that isn't where the customer
   * currently is (e.g. a journey's final address in another country) — the
   * device's own GPS position would be the wrong pin entirely there.
   * Defaults on, matching the "Book a Ride" pickup use case. */
  autoLocateGPS?: boolean;
  /** Controls whether map taps/search results select pickup or drop-off. */
  selectionMode?: 'pickup' | 'dropoff';
  /** Which field "Use my current location" (and the on-mount GPS auto-fill)
   * sets. Defaults to 'pickup' — the "Book a Ride" case, where the customer
   * is where the trip starts. For a store delivery, pickup is the store
   * (locked, GPS-irrelevant) and the customer's own device position is
   * what the DROP-OFF should default to instead. */
  gpsTarget?: 'pickup' | 'dropoff';
  /** Optional country hint for the map search. */
  searchCountry?: string;
}

export default function LocationPickerMap({
  pickup,
  dropoff,
  onPickupChange,
  onDropoffChange,
  onRouteInfo,
  pickupLocked,
  autoLocateGPS = true,
  selectionMode = 'dropoff',
  gpsTarget = 'pickup',
  searchCountry,
}: LocationPickerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const dropoffMarkerRef = useRef<L.Marker | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [routeSummary, setRouteSummary] = useState<{ distanceKm: number; durationMin: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Init the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView(DEFAULT_CENTER, 13);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    mapRef.current = map;
    setMapReady(true);
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Map click sets whichever field selectionMode targets.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const handler = async (e: L.LeafletMouseEvent) => {
      const loc = await toLocation('dropoff', 'Drop-off point', e.latlng.lat, e.latlng.lng);
      (selectionMode === 'pickup' ? onPickupChange : onDropoffChange)(loc);
    };
    map.on('click', handler);
    return () => {
      map.off('click', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, selectionMode]);

  // Auto-detect the customer's live GPS position as the initial pin for
  // whichever field GPS targets (pickup for a normal ride; drop-off for a
  // store delivery, where pickup is the store instead) — only if the
  // parent hasn't already supplied a value there (e.g. from a supermarket
  // auto-fill or a typed suggestion).
  useEffect(() => {
    const already = gpsTarget === 'dropoff' ? dropoff : pickup;
    if (already || !autoLocateGPS || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = await toLocation('gps', 'My Location', pos.coords.latitude, pos.coords.longitude);
        (gpsTarget === 'dropoff' ? onDropoffChange : onPickupChange)(loc);
        setLocating(false);
      },
      () => {
        setLocating(false);
        setLocationError('Location access was denied or unavailable. Search for your area or tap the map instead.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // Keep the pickup marker in sync with whatever the parent currently has
  // selected — from GPS, a typed suggestion, a supermarket auto-fill, or a
  // drag on this same map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !pickup) return;
    const position: [number, number] = [pickup.coordinates.lat, pickup.coordinates.lng];
    if (!pickupMarkerRef.current) {
      const marker = L.marker(position, { icon: pinIcon('#22c55e'), draggable: !pickupLocked, title: 'Pickup' }).addTo(map);
      marker.on('dragend', async () => {
        const pos = marker.getLatLng();
        const loc = await toLocation('pickup', 'Pickup point', pos.lat, pos.lng);
        onPickupChange(loc);
      });
      pickupMarkerRef.current = marker;
    } else {
      pickupMarkerRef.current.setLatLng(position);
      pickupMarkerRef.current.dragging?.[pickupLocked ? 'disable' : 'enable']();
    }
    if (!dropoff) map.setView(position);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pickup?.coordinates.lat, pickup?.coordinates.lng, pickupLocked]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !dropoff) return;
    const position: [number, number] = [dropoff.coordinates.lat, dropoff.coordinates.lng];
    if (!dropoffMarkerRef.current) {
      const marker = L.marker(position, { icon: pinIcon('#ef4444'), draggable: true, title: 'Drop-off' }).addTo(map);
      marker.on('dragend', async () => {
        const pos = marker.getLatLng();
        const loc = await toLocation('dropoff', 'Drop-off point', pos.lat, pos.lng);
        onDropoffChange(loc);
      });
      dropoffMarkerRef.current = marker;
    } else {
      dropoffMarkerRef.current.setLatLng(position);
    }
    if (!pickup) map.setView(position);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, dropoff?.coordinates.lat, dropoff?.coordinates.lng]);

  // Real road route via OSRM.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pickup || !dropoff) return;

    let cancelled = false;
    getRoute(pickup.coordinates, dropoff.coordinates).then((route) => {
      if (cancelled || !route) return;
      routeLineRef.current?.remove();
      routeLineRef.current = L.polyline(route.path, { color: '#f97316', weight: 5, opacity: 0.8 }).addTo(map);
      setRouteSummary({ distanceKm: route.distanceKm, durationMin: route.durationMin });
      onRouteInfo?.(route.distanceKm, route.durationMin);
    });
    return () => {
      cancelled = true;
    };
  }, [mapReady, pickup?.coordinates.lat, pickup?.coordinates.lng, dropoff?.coordinates.lat, dropoff?.coordinates.lng, onRouteInfo]);

  const useMyLocation = () => {
    if (!navigator.geolocation || (gpsTarget === 'pickup' && pickupLocked)) {
      setLocationError('GPS is unavailable. Search for your area or tap the map instead.');
      return;
    }
    setLocating(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = await toLocation('gps', 'My Location', pos.coords.latitude, pos.coords.longitude);
        (gpsTarget === 'dropoff' ? onDropoffChange : onPickupChange)(loc);
        setLocating(false);
      },
      () => {
        setLocating(false);
        setLocationError('Could not access your location. On a phone, allow location permission and use HTTPS, or search/tap the map.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const searchLocation = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setLocationError(null);
    try {
      const result = await geocodeAddress(searchQuery, searchCountry);
      if (!result) {
        setLocationError('No location found. Try a full address, landmark, neighborhood, or city.');
        return;
      }
      const loc = await toLocation(selectionMode, 'Selected location', result.lat, result.lng);
      (selectionMode === 'pickup' ? onPickupChange : onDropoffChange)(loc);
      mapRef.current?.setView([result.lat, result.lng], 16);
    } catch {
      setLocationError('Location search failed. Check your connection and try again.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchLocation()}
            placeholder="Search any address, landmark, neighborhood or city"
            className="w-full rounded-lg border-2 border-slate-200 bg-white py-3 pl-10 pr-3 text-sm text-slate-900 placeholder-slate-400"
          />
        </div>
        <button type="button" onClick={searchLocation} disabled={searching || !searchQuery.trim()} className="rounded-lg bg-orange-500 px-4 text-white disabled:bg-slate-300">
          {searching ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
        </button>
      </div>
      <div className="relative rounded-lg border-2 border-slate-200" style={{ height: 420, width: '100%' }}>
        <div ref={containerRef} className="h-full w-full rounded-lg" />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-50 text-slate-400 text-sm gap-2">
            <Loader2 className="animate-spin" size={18} /> Loading map…
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {autoLocateGPS && (
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating || (gpsTarget === 'pickup' && pickupLocked)}
            className="text-xs sm:text-sm text-orange-600 hover:text-orange-700 font-medium disabled:opacity-50 flex items-center gap-1"
          >
            <Locate size={14} />
            {locating ? 'Finding you…' : 'Use my current location'}
          </button>
        )}
        {routeSummary && (
          <span className="text-xs sm:text-sm text-slate-600 flex items-center gap-1">
            <Navigation size={14} className="text-orange-500" />
            {routeSummary.distanceKm.toFixed(1)} km • ~{Math.round(routeSummary.durationMin)} min by road
          </span>
        )}
      </div>
      {locationError && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{locationError}</p>}
      <p className="text-xs text-slate-500">Search precisely, use your current location, or tap the map to set your {selectionMode}. Drag the pin to fine-tune it.</p>
    </div>
  );
}
