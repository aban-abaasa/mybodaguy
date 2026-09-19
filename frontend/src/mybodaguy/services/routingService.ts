/**
 * Free, no-API-key road routing (OSRM's public demo server) — the driving
 * distance/duration/path between two points, same job Google's Directions
 * API did before the map components moved to Leaflet. Fine for Phase 1's
 * low volume; a production-scale rollout should move to a paid/self-hosted
 * OSRM instance (the public demo server has no uptime/rate-limit SLA).
 */
export interface RouteResult {
  distanceKm: number;
  durationMin: number;
  /** [lat, lng] pairs, in travel order — ready to hand straight to Leaflet's L.polyline. */
  path: [number, number][];
}

export async function getRoute(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number }
): Promise<RouteResult | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const route = data?.routes?.[0];
    if (data?.code !== 'Ok' || !route) return null;
    // OSRM returns [lng, lat] pairs (GeoJSON order) — flip for Leaflet.
    const path: [number, number][] = (route.geometry?.coordinates || []).map(
      ([lng, lat]: [number, number]) => [lat, lng]
    );
    return {
      distanceKm: route.distance / 1000,
      durationMin: route.duration / 60,
      path,
    };
  } catch {
    return null;
  }
}
