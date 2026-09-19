/**
 * LiveTrackingMap — customer-facing live map for an accepted/in-progress
 * ride. Shows the pickup and drop-off pins plus the rider's real position,
 * pushed the instant it changes via a realtime subscription on
 * mbg_riders.current_lat/current_lng (the same column
 * useLiveLocationPing in RiderDashboard.tsx already keeps fresh every ~45s
 * while a rider is active) — same postgres_changes pattern already used
 * for chat and for pushing new ride requests to a rider instantly. Built on
 * Leaflet + OpenStreetMap tiles — no API key, unlike Google Maps.
 */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Loader2, Navigation } from 'lucide-react';
import type { Location } from '../data/mockLocations';
import { supabase } from '../services/supabaseClient';
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

// A small rounded vehicle marker rather than a pin — reads as "this is the
// thing that moves" at a glance, distinct from the two fixed location pins.
function riderIcon(): L.DivIcon {
  const svg = `<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
    <circle cx="11" cy="11" r="8.5" fill="#f97316" stroke="white" stroke-width="3"/>
  </svg>`;
  return L.divIcon({ html: svg, className: '', iconSize: [22, 22], iconAnchor: [11, 11] });
}

interface LiveTrackingMapProps {
  riderId: string;
  pickup: Location;
  dropoff: Location;
  /** Which leg the rider is currently driving — determines which pin the
   * live tracking line is drawn to. */
  phase: 'to_pickup' | 'to_dropoff';
}

export default function LiveTrackingMap({ riderId, pickup, dropoff, phase }: LiveTrackingMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const riderMarkerRef = useRef<L.Marker | null>(null);
  const trackingLineRef = useRef<L.Polyline | null>(null);
  const routeLineRef = useRef<L.Polyline | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number } | null>(null);
  const [etaMin, setEtaMin] = useState<number | null>(null);

  const target = phase === 'to_pickup' ? pickup : dropoff;

  // Init the map once, with the static pickup/dropoff pins and the fixed
  // pickup->dropoff route (mirrors LocationPickerMap's own routing call).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView(
      [pickup.coordinates.lat, pickup.coordinates.lng],
      14
    );
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);

    L.marker([pickup.coordinates.lat, pickup.coordinates.lng], { icon: pinIcon('#22c55e'), title: 'Pickup' }).addTo(map);
    L.marker([dropoff.coordinates.lat, dropoff.coordinates.lng], { icon: pinIcon('#ef4444'), title: 'Drop-off' }).addTo(map);

    let cancelled = false;
    getRoute(pickup.coordinates, dropoff.coordinates).then((route) => {
      if (cancelled || !route) return;
      routeLineRef.current = L.polyline(route.path, { color: '#94a3b8', weight: 4, opacity: 0.6 }).addTo(map);
    });

    mapRef.current = map;
    setMapReady(true);

    return () => {
      cancelled = true;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial fetch + realtime subscription for the rider's live position.
  useEffect(() => {
    let cancelled = false;
    supabase.from('mbg_riders').select('current_lat, current_lng').eq('id', riderId).maybeSingle().then(({ data }) => {
      if (cancelled || data?.current_lat == null || data?.current_lng == null) return;
      setRiderPos({ lat: Number(data.current_lat), lng: Number(data.current_lng) });
    });

    const channel = supabase
      .channel(`mbg_rider_live_position_${riderId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mbg_riders', filter: `id=eq.${riderId}` },
        (payload: any) => {
          const lat = payload.new?.current_lat;
          const lng = payload.new?.current_lng;
          if (lat != null && lng != null) setRiderPos({ lat: Number(lat), lng: Number(lng) });
        }
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [riderId]);

  // Move the rider marker, redraw the dashed tracking line to whichever pin
  // is next, refit bounds, and refresh the ETA whenever the position (or
  // which leg we're tracking) changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !riderPos) return;
    const position: [number, number] = [riderPos.lat, riderPos.lng];

    if (!riderMarkerRef.current) {
      riderMarkerRef.current = L.marker(position, { icon: riderIcon(), title: 'Your rider' }).addTo(map);
    } else {
      riderMarkerRef.current.setLatLng(position);
    }

    trackingLineRef.current?.remove();
    trackingLineRef.current = L.polyline(
      [position, [target.coordinates.lat, target.coordinates.lng]],
      { color: '#f97316', weight: 4, opacity: 0.85 }
    ).addTo(map);

    const bounds = L.latLngBounds([
      position,
      [pickup.coordinates.lat, pickup.coordinates.lng],
      [dropoff.coordinates.lat, dropoff.coordinates.lng],
    ]);
    map.fitBounds(bounds, { padding: [36, 36] });

    let cancelled = false;
    getRoute(riderPos, target.coordinates).then((route) => {
      if (cancelled || !route) return;
      setEtaMin(Math.max(1, Math.round(route.durationMin)));
    });
    return () => { cancelled = true; };
  }, [mapReady, riderPos, target.coordinates.lat, target.coordinates.lng, pickup.coordinates.lat, pickup.coordinates.lng, dropoff.coordinates.lat, dropoff.coordinates.lng]);

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg border-2 border-slate-200" style={{ height: 260, width: '100%' }}>
        <div ref={containerRef} className="h-full w-full rounded-lg" />
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-slate-50 text-slate-400 text-sm gap-2">
            <Loader2 className="animate-spin" size={18} /> Loading map…
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{phase === 'to_pickup' ? 'Heading to your pickup point' : 'Heading to your drop-off'}</span>
        {etaMin != null && (
          <span className="flex items-center gap-1 font-semibold text-orange-600">
            <Navigation size={13} /> ~{etaMin} min away
          </span>
        )}
        {!riderPos && <span className="text-slate-400">Waiting for the rider's live location…</span>}
      </div>
    </div>
  );
}
