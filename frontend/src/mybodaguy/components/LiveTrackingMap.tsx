/**
 * LiveTrackingMap — customer-facing live map for an accepted/in-progress
 * ride. Shows the pickup and drop-off pins plus the rider's real position,
 * pushed the instant it changes via a realtime subscription on
 * mbg_riders.current_lat/current_lng (the same column
 * useLiveLocationPing in RiderDashboard.tsx already keeps fresh every ~45s
 * while a rider is active) — same postgres_changes pattern already used
 * for chat and for pushing new ride requests to a rider instantly.
 */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Navigation } from 'lucide-react';
import type { Location } from '../data/mockLocations';
import { supabase } from '../services/supabaseClient';

function pinIcon(color: string) {
  return L.divIcon({
    html: `<svg width="26" height="36" viewBox="0 0 30 42" xmlns="http://www.w3.org/2000/svg">
      <path d="M15 0C6.7 0 0 6.7 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.7 23.3 0 15 0z" fill="${color}"/>
      <circle cx="15" cy="15" r="6" fill="white"/>
    </svg>`,
    className: '',
    iconSize: [26, 36],
    iconAnchor: [13, 36],
  });
}
const PICKUP_ICON = pinIcon('#22c55e');
const DROPOFF_ICON = pinIcon('#ef4444');

// A small rounded vehicle marker rather than a pin — reads as "this is the
// thing that moves" at a glance, distinct from the two fixed location pins.
const RIDER_ICON = L.divIcon({
  html: `<div style="width:22px;height:22px;border-radius:50%;background:#f97316;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
  className: '',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

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
  const [riderPos, setRiderPos] = useState<{ lat: number; lng: number } | null>(null);
  const [etaMin, setEtaMin] = useState<number | null>(null);

  const target = phase === 'to_pickup' ? pickup : dropoff;

  // Init the map once, with the static pickup/dropoff pins and the fixed
  // pickup->dropoff route (mirrors LocationPickerMap's own OSRM call).
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView(
      [pickup.coordinates.lat, pickup.coordinates.lng], 14
    );
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© OpenStreetMap, © CartoDB',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map);

    L.marker([pickup.coordinates.lat, pickup.coordinates.lng], { icon: PICKUP_ICON }).addTo(map).bindPopup('Pickup');
    L.marker([dropoff.coordinates.lat, dropoff.coordinates.lng], { icon: DROPOFF_ICON }).addTo(map).bindPopup('Drop-off');

    (async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${pickup.coordinates.lng},${pickup.coordinates.lat};${dropoff.coordinates.lng},${dropoff.coordinates.lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.code !== 'Ok') return;
        const coords = data.routes[0].geometry.coordinates.map((c: [number, number]) => [c[1], c[0]] as [number, number]);
        routeLineRef.current = L.polyline(coords, { color: '#94a3b8', weight: 4, opacity: 0.6, dashArray: '2 8' }).addTo(map);
      } catch {
        // Route line is a nice-to-have on top of the live position — skip silently.
      }
    })();

    mapRef.current = map;
    return () => {
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
    if (!map || !riderPos) return;
    const latlng: [number, number] = [riderPos.lat, riderPos.lng];

    if (!riderMarkerRef.current) {
      riderMarkerRef.current = L.marker(latlng, { icon: RIDER_ICON }).addTo(map).bindPopup('Your rider');
    } else {
      riderMarkerRef.current.setLatLng(latlng);
    }

    if (trackingLineRef.current) map.removeLayer(trackingLineRef.current);
    trackingLineRef.current = L.polyline(
      [latlng, [target.coordinates.lat, target.coordinates.lng]],
      { color: '#f97316', weight: 4, opacity: 0.85, dashArray: '1 10' }
    ).addTo(map);

    map.fitBounds(
      L.latLngBounds([latlng, [pickup.coordinates.lat, pickup.coordinates.lng], [dropoff.coordinates.lat, dropoff.coordinates.lng]]),
      { padding: [36, 36], animate: false }
    );

    let cancelled = false;
    (async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${riderPos.lng},${riderPos.lat};${target.coordinates.lng},${target.coordinates.lat}?overview=false`;
        const res = await fetch(url);
        const data = await res.json();
        if (!cancelled && data.code === 'Ok') setEtaMin(Math.max(1, Math.round(data.routes[0].duration / 60)));
      } catch {
        // ETA is a bonus on top of the live marker itself.
      }
    })();
    return () => { cancelled = true; };
  }, [riderPos, target.coordinates.lat, target.coordinates.lng, pickup.coordinates.lat, pickup.coordinates.lng, dropoff.coordinates.lat, dropoff.coordinates.lng]);

  return (
    <div className="space-y-2">
      {/* relative + z-0 (not just Leaflet's own position:relative, which has
          no z-index) is what actually gives this div its own CSS stacking
          context. Without a real one here, Leaflet's internal panes/controls
          (.leaflet-top/.leaflet-bottom go up to z-index:1000 — see
          leaflet.css) aren't contained by anything and leak straight past
          this whole component to compete directly with sibling overlays
          several components up (e.g. RideChatModal's z-[55] backdrop when
          this map is mounted inside RideTrackingModal), painting on top of
          them even though this component's own container sits "under" them
          by any z-index you give it further up the tree. */}
      <div ref={containerRef} className="relative z-0 rounded-lg border-2 border-slate-200" style={{ height: 260, width: '100%' }} />
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
