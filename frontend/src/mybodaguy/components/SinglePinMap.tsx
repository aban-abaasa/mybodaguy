/**
 * SinglePinMap — a real map with one draggable pin. Tap anywhere (or drag
 * the pin, or use current GPS) to pick a spot; the parent gets the lat/lng
 * back. Used wherever someone needs to place a single point on a map
 * instead of typing coordinates blind (e.g. a rider adding an area they
 * know well). Built on Leaflet + OpenStreetMap tiles — no API key, unlike
 * Google Maps.
 */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Loader2, Locate, Search } from 'lucide-react';
import { geocodeAddress } from '../services/geocodeService';

const DEFAULT_CENTER: [number, number] = [0.3157, 32.5756];
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function pinIcon(): L.DivIcon {
  const svg = `<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.7 23.3 0 15 0z" fill="#f97316"/>
    <circle cx="15" cy="15" r="6" fill="white"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [30, 42], iconAnchor: [15, 42] });
}

interface SinglePinMapProps {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number, lng: number) => void;
  height?: number;
  /** Optional country hint for the search box, same as LocationPickerMap. */
  searchCountry?: string;
}

export default function SinglePinMap({ lat, lng, onChange, height = 260, searchCountry }: SinglePinMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [mapReady, setMapReady] = useState(false);
  const [locating, setLocating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const center: [number, number] = lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER;
    const map = L.map(containerRef.current, { zoomControl: true }).setView(center, lat != null && lng != null ? 15 : 12);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

    const placeMarker = (position: [number, number]) => {
      if (!markerRef.current) {
        const marker = L.marker(position, { icon: pinIcon(), draggable: true }).addTo(map);
        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          onChangeRef.current(pos.lat, pos.lng);
        });
        markerRef.current = marker;
      } else {
        markerRef.current.setLatLng(position);
      }
    };

    if (lat != null && lng != null) placeMarker([lat, lng]);

    map.on('click', (e: L.LeafletMouseEvent) => {
      placeMarker([e.latlng.lat, e.latlng.lng]);
      onChangeRef.current(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    setMapReady(true);

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the pin/center in sync if the parent sets a position some other way
  // (e.g. the "Use my current GPS location" button below).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || lat == null || lng == null) return;
    const position: [number, number] = [lat, lng];
    if (!markerRef.current) {
      const marker = L.marker(position, { icon: pinIcon(), draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        onChangeRef.current(pos.lat, pos.lng);
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng(position);
    }
    map.setView(position, 15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, lat, lng]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChangeRef.current(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const searchLocation = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const result = await geocodeAddress(searchQuery, searchCountry);
      if (!result) {
        setSearchError('No location found. Try a full address, landmark, neighborhood, or city.');
        return;
      }
      onChangeRef.current(result.lat, result.lng);
      mapRef.current?.setView([result.lat, result.lng], 16);
    } catch {
      setSearchError('Location search failed. Check your connection and try again.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchLocation())}
            placeholder="Search any address, landmark, neighborhood or city"
            className="w-full rounded-lg border-2 border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400"
          />
        </div>
        <button type="button" onClick={searchLocation} disabled={searching || !searchQuery.trim()} className="rounded-lg bg-orange-500 px-3 text-white disabled:bg-slate-300">
          {searching ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
        </button>
      </div>
      {searchError && <p className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{searchError}</p>}
      <div className="relative rounded-lg border-2 border-slate-200" style={{ height, width: '100%' }}>
        <div ref={containerRef} className="h-full w-full rounded-lg" />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-50 text-slate-400 text-sm gap-2">
            <Loader2 className="animate-spin" size={18} /> Loading map…
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={useMyLocation}
        disabled={locating}
        className="flex items-center gap-1.5 text-xs font-medium text-orange-600 hover:text-orange-700 disabled:opacity-50"
      >
        <Locate size={14} className={locating ? 'animate-spin' : ''} />
        {locating ? 'Finding you…' : 'Use my current location'}
      </button>
      <p className="text-xs text-slate-500">Tap the map to drop a pin, or drag it to fine-tune.</p>
    </div>
  );
}
