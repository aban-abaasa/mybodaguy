/**
 * NearbyRidersMap — live "riders near me" map for the customer Overview.
 * Uses Google Maps when VITE_GOOGLE_MAPS_API_KEY is set (loaded lazily),
 * otherwise falls back to Leaflet + OpenStreetMap so the card still works.
 * The customer's position comes from the browser GPS; rider pins are the
 * anonymous positions returned by mbg_get_nearby_riders.
 */
import { useEffect, useRef } from 'react';
import L from 'leaflet';

export interface NearbyRider { lat: number; lng: number; km: number }
interface Props {
  me: { lat: number; lng: number };
  riders: NearbyRider[];
  stage?: { name: string; lat: number; lng: number } | null;
}

const KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
let googlePromise: Promise<any> | null = null;

function loadGoogle(): Promise<any> {
  const w = window as any;
  if (w.google?.maps) return Promise.resolve(w.google);
  if (!googlePromise) {
    googlePromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(KEY!)}`;
      s.async = true;
      s.onload = () => resolve(w.google);
      s.onerror = () => { googlePromise = null; reject(new Error('Google Maps failed to load')); };
      document.head.appendChild(s);
    });
  }
  return googlePromise;
}

const dot = (color: string) => L.divIcon({
  html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25)"></div>`,
  className: '', iconSize: [16, 16], iconAnchor: [8, 8],
});

export default function NearbyRidersMap({ me, riders, stage }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const api = useRef<{ update: (p: Props) => void; destroy: () => void } | null>(null);
  const latest = useRef<Props>({ me, riders, stage });
  latest.current = { me, riders, stage };

  useEffect(() => {
    let cancelled = false;
    const el = ref.current;
    if (!el) return;

    const initLeaflet = () => {
      const map = L.map(el, { zoomControl: false, attributionControl: true }).setView([me.lat, me.lng], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      const layer = L.layerGroup().addTo(map);
      let fitted = false;
      api.current = {
        update: ({ me: m, riders: rs, stage: st }) => {
          layer.clearLayers();
          L.marker([m.lat, m.lng], { icon: dot('#2563eb') }).bindTooltip('You').addTo(layer);
          rs.forEach(r => L.marker([r.lat, r.lng], { icon: dot('#f97316') }).addTo(layer));
          if (st) L.marker([st.lat, st.lng], { icon: dot('#10b981') }).bindTooltip(st.name).addTo(layer);
          if (!fitted) {
            fitted = true;
            const pts: L.LatLngTuple[] = [[m.lat, m.lng], ...rs.map(r => [r.lat, r.lng] as L.LatLngTuple)];
            if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 });
          }
        },
        destroy: () => map.remove(),
      };
      api.current.update(latest.current);
    };

    const initGoogle = (google: any) => {
      const map = new google.maps.Map(el, {
        center: me, zoom: 14, disableDefaultUI: true, gestureHandling: 'cooperative',
      });
      const markers: any[] = [];
      let fitted = false;
      const icon = (color: string) => ({
        path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: color, fillOpacity: 1,
        strokeColor: '#fff', strokeWeight: 3,
      });
      api.current = {
        update: ({ me: m, riders: rs, stage: st }) => {
          markers.splice(0).forEach(mk => mk.setMap(null));
          markers.push(new google.maps.Marker({ map, position: m, icon: icon('#2563eb'), title: 'You' }));
          rs.forEach(r => markers.push(new google.maps.Marker({ map, position: { lat: r.lat, lng: r.lng }, icon: icon('#f97316'), title: 'Rider' })));
          if (st) markers.push(new google.maps.Marker({ map, position: { lat: st.lat, lng: st.lng }, icon: icon('#10b981'), title: st.name }));
          if (!fitted) {
            fitted = true;
            if (rs.length) {
              const b = new google.maps.LatLngBounds(m);
              rs.forEach(r => b.extend({ lat: r.lat, lng: r.lng }));
              map.fitBounds(b, 30);
            }
          }
        },
        destroy: () => { markers.forEach(mk => mk.setMap(null)); },
      };
      api.current.update(latest.current);
    };

    if (KEY) {
      loadGoogle().then(g => { if (!cancelled) initGoogle(g); }).catch(() => { if (!cancelled) initLeaflet(); });
    } else {
      initLeaflet();
    }
    return () => { cancelled = true; api.current?.destroy(); api.current = null; };
    // Map is created once; position/rider changes flow through update().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { api.current?.update({ me, riders, stage }); }, [me, riders, stage]);

  return <div ref={ref} className="h-48 w-full overflow-hidden rounded-xl ring-1 ring-slate-200" role="img" aria-label="Map of riders near you" />;
}
