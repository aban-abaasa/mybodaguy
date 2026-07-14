import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Locate, Navigation } from 'lucide-react';
import type { Location } from '../data/mockLocations';
import { reverseGeocode } from '../services/geocodeService';

// Kampala city center — used only as a fallback when GPS is denied/unavailable.
const DEFAULT_CENTER: [number, number] = [0.3157, 32.5756];

// Self-contained colored pin (no external icon assets to fetch/bundle).
function pinIcon(color: string) {
  return L.divIcon({
    html: `<svg width="30" height="42" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.7 23.3 0 15 0z" fill="${color}"/>
      <circle cx="15" cy="15" r="6" fill="white"/>
    </svg>`,
    className: '',
    iconSize: [30, 42],
    iconAnchor: [15, 42],
    popupAnchor: [0, -40],
  });
}
const PICKUP_ICON = pinIcon('#22c55e');
const DROPOFF_ICON = pinIcon('#ef4444');

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
}

export default function LocationPickerMap({
  pickup,
  dropoff,
  onPickupChange,
  onDropoffChange,
  onRouteInfo,
  pickupLocked,
  autoLocateGPS = true,
}: LocationPickerMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const pickupMarkerRef = useRef<L.Marker | null>(null);
  const dropoffMarkerRef = useRef<L.Marker | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const [locating, setLocating] = useState(false);
  const [routeSummary, setRouteSummary] = useState<{ distanceKm: number; durationMin: number } | null>(null);

  // Init the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView(DEFAULT_CENTER, 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap, © CartoDB',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map);

    map.on('click', async (e: L.LeafletMouseEvent) => {
      const loc = await toLocation('dropoff', 'Drop-off point', e.latlng.lat, e.latlng.lng);
      onDropoffChange(loc);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-detect the customer's live GPS position as the initial pickup pin,
  // only if the parent hasn't already supplied one (e.g. from a supermarket
  // auto-fill or a typed suggestion).
  useEffect(() => {
    if (pickup || !autoLocateGPS || !navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = await toLocation('gps', 'My Location', pos.coords.latitude, pos.coords.longitude);
        onPickupChange(loc);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the pickup marker in sync with whatever the parent currently has
  // selected — from GPS, a typed suggestion, a supermarket auto-fill, or a
  // drag on this same map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pickup) return;
    const latlng: [number, number] = [pickup.coordinates.lat, pickup.coordinates.lng];
    if (!pickupMarkerRef.current) {
      pickupMarkerRef.current = L.marker(latlng, { icon: PICKUP_ICON, draggable: !pickupLocked })
        .addTo(map)
        .bindPopup(`<b>Pickup</b><br>${pickup.fullAddress}`);
      pickupMarkerRef.current.on('dragend', async () => {
        const pos = pickupMarkerRef.current!.getLatLng();
        const loc = await toLocation('pickup', 'Pickup point', pos.lat, pos.lng);
        onPickupChange(loc);
      });
    } else {
      pickupMarkerRef.current.setLatLng(latlng);
      pickupMarkerRef.current.setPopupContent(`<b>Pickup</b><br>${pickup.fullAddress}`);
      pickupMarkerRef.current.dragging?.[pickupLocked ? 'disable' : 'enable']();
    }
    if (!dropoff) map.setView(latlng, 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickup?.coordinates.lat, pickup?.coordinates.lng, pickupLocked]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !dropoff) return;
    const latlng: [number, number] = [dropoff.coordinates.lat, dropoff.coordinates.lng];
    if (!dropoffMarkerRef.current) {
      dropoffMarkerRef.current = L.marker(latlng, { icon: DROPOFF_ICON, draggable: true }).addTo(map);
      dropoffMarkerRef.current.on('dragend', async () => {
        const pos = dropoffMarkerRef.current!.getLatLng();
        const loc = await toLocation('dropoff', 'Drop-off point', pos.lat, pos.lng);
        onDropoffChange(loc);
      });
    } else {
      dropoffMarkerRef.current.setLatLng(latlng);
    }
    dropoffMarkerRef.current.setPopupContent(`<b>Drop-off</b><br>${dropoff.fullAddress}`);
    if (!pickup) map.setView(latlng, 14);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropoff?.coordinates.lat, dropoff?.coordinates.lng]);

  // Real road route (OSRM's public demo server — fine for low volume, not
  // production-scale; self-host OSRM or use a paid routing API at scale).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !pickup || !dropoff) return;

    let cancelled = false;
    (async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${pickup.coordinates.lng},${pickup.coordinates.lat};${dropoff.coordinates.lng},${dropoff.coordinates.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        if (cancelled || data.code !== 'Ok') return;

        const route = data.routes[0];
        const distanceKm = route.distance / 1000;
        const durationMin = route.duration / 60;
        setRouteSummary({ distanceKm, durationMin });
        onRouteInfo?.(distanceKm, durationMin);

        const coords = route.geometry.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
        if (routeLineRef.current) map.removeLayer(routeLineRef.current);
        routeLineRef.current = L.polyline(coords, { color: '#f97316', weight: 5, opacity: 0.8 }).addTo(map);
        map.fitBounds(routeLineRef.current.getBounds(), { padding: [30, 30] });
      } catch {
        // Routing is a nice-to-have on top of the pins — pickup/dropoff
        // selection still works fine without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickup?.coordinates.lat, pickup?.coordinates.lng, dropoff?.coordinates.lat, dropoff?.coordinates.lng, onRouteInfo]);

  const useMyLocation = () => {
    if (!navigator.geolocation || pickupLocked) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const loc = await toLocation('gps', 'My Location', pos.coords.latitude, pos.coords.longitude);
        onPickupChange(loc);
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  return (
    <div className="space-y-2">
      <div ref={containerRef} className="rounded-lg border-2 border-slate-200" style={{ height: 320, width: '100%' }} />
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {autoLocateGPS && (
          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating || pickupLocked}
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
      <p className="text-[11px] text-slate-400">Tap the map to set your drop-off, or drag either pin to fine-tune it.</p>
    </div>
  );
}
