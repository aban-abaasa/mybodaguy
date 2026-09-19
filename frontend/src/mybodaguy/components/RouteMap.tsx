/**
 * RouteMap — pickup pin, drop-off pin, and the road route between them.
 * No live position (unlike LiveTrackingMap). Used to give a rider a real
 * visual of where a ride/delivery request is actually going, instead of
 * just the two address strings. Built on Leaflet + OpenStreetMap tiles —
 * no API key, unlike Google Maps.
 */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Loader2 } from 'lucide-react';
import { getRoute } from '../services/routingService';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function pinIcon(color: string): L.DivIcon {
  const svg = `<svg width="26" height="36" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
    <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.7 23.3 0 15 0z" fill="${color}"/>
    <circle cx="15" cy="15" r="6" fill="white"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [26, 36], iconAnchor: [13, 36] });
}

interface RouteMapProps {
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  height?: number;
}

export default function RouteMap({ pickup, dropoff, height = 220 }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(containerRef.current, { zoomControl: true }).setView([pickup.lat, pickup.lng], 13);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

    L.marker([pickup.lat, pickup.lng], { icon: pinIcon('#22c55e'), title: 'Pickup' }).addTo(map);
    L.marker([dropoff.lat, dropoff.lng], { icon: pinIcon('#ef4444'), title: 'Drop-off' }).addTo(map);

    const bounds = L.latLngBounds([[pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]]);
    map.fitBounds(bounds, { padding: [30, 30] });

    let cancelled = false;
    getRoute(pickup, dropoff).then((route) => {
      if (cancelled || !route) return;
      routeLineRef.current = L.polyline(route.path, { color: '#f97316', weight: 4, opacity: 0.8 }).addTo(map);
    });

    mapRef.current = map;
    setMapReady(true);

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
    };
  }, [pickup.lat, pickup.lng, dropoff.lat, dropoff.lng]);

  return (
    <div className="relative rounded-lg border-2 border-slate-200" style={{ height, width: '100%' }}>
      <div ref={containerRef} className="h-full w-full rounded-lg" />
      {!mapReady && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-50 text-slate-400 text-sm gap-2">
          <Loader2 className="animate-spin" size={18} /> Loading map…
        </div>
      )}
    </div>
  );
}
