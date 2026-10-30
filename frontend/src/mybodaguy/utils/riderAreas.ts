/**
 * Small decisions behind the rider's Areas page, free of React and Supabase so they can
 * be unit-tested (tests/riderAreas.test.js).
 */
import { AREA_RADIUS_KM, haversineKm } from './riderSmarts';

export interface PlottedArea {
  id?: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * The saved area that already covers a pin: the nearest one within the matching radius
 * (the engine treats a rider as knowing any place within AREA_RADIUS_KM of an area).
 * Areas without coordinates can't cover anything. `ignoreId` lets a pin being moved skip itself.
 * `radiusKm` narrows the check (a customer's duplicate-spot warning uses a few hundred metres).
 */
export function coveringArea<T extends PlottedArea>(
  lat: number,
  lng: number,
  areas: readonly T[],
  ignoreId?: string,
  radiusKm: number = AREA_RADIUS_KM,
): { area: T; km: number } | null {
  let best: { area: T; km: number } | null = null;
  for (const area of areas) {
    if (area.id && area.id === ignoreId) continue;
    if (area.latitude == null || area.longitude == null) continue;
    const km = haversineKm(lat, lng, Number(area.latitude), Number(area.longitude));
    if (km <= radiusKm && (!best || km < best.km)) best = { area, km };
  }
  return best;
}

/** "350 m" under a kilometre (to the nearest 10 m), otherwise "1.2 km". */
export function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toFixed(1)} km`;
}
