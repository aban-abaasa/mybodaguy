/**
 * Forgiving device-location lookup for the map pickers.
 *
 * A bare getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 })
 * reports "denied or unavailable" for very different situations — the user
 * said no, the page is on plain HTTP, a laptop has no GPS chip, or a phone
 * indoors just couldn't get a satellite fix in 10s. Only the first one is
 * final. Everything else can usually still be answered by the network
 * (Wi-Fi / cell) position, so this tries that before giving up, remembers
 * the last good fix, and tells the caller *why* it failed so the UI can say
 * something useful instead of one generic sentence.
 */

export type GeoFailure = 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout';

export interface GeoFix {
  lat: number;
  lng: number;
  /** Metres. Network fixes are often hundreds of metres to kilometres off. */
  accuracy: number;
  source: 'gps' | 'network';
}

export type GeoResult = { ok: true; fix: GeoFix } | { ok: false; failure: GeoFailure };

const CACHE_KEY = 'mbg_last_known_location';
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface CachedLocation {
  lat: number;
  lng: number;
  savedAt: number;
}

export function rememberLocation(lat: number, lng: number): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ lat, lng, savedAt: Date.now() } satisfies CachedLocation));
  } catch {
    // Private mode / storage blocked — remembering is only a convenience.
  }
}

/** The last place a fix or a pin came from, if it is recent enough to still mean something. */
export function getRememberedLocation(): CachedLocation | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedLocation;
    if (!Number.isFinite(parsed.lat) || !Number.isFinite(parsed.lng)) return null;
    if (Date.now() - parsed.savedAt > CACHE_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 'prompt' | 'granted' | 'denied', or 'unknown' where the Permissions API is missing (older iOS Safari). */
export async function getGeolocationPermission(): Promise<PermissionState | 'unknown'> {
  try {
    if (!navigator.permissions?.query) return 'unknown';
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

function getPosition(options: PositionOptions): Promise<GeolocationPosition | GeolocationPositionError> {
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(resolve, resolve, options);
  });
}

function isPosition(value: GeolocationPosition | GeolocationPositionError): value is GeolocationPosition {
  return 'coords' in value;
}

function failureFromCode(code: number): GeoFailure {
  // 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT
  if (code === 1) return 'denied';
  if (code === 3) return 'timeout';
  return 'unavailable';
}

export async function locateDevice(): Promise<GeoResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return { ok: false, failure: 'unsupported' };
  // Browsers refuse geolocation outside HTTPS (localhost excepted) with the same
  // error code as a user's "Block" — surface the real reason.
  if (typeof window !== 'undefined' && window.isSecureContext === false) return { ok: false, failure: 'insecure' };

  const accurate = await getPosition({ enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 });
  if (isPosition(accurate)) {
    const fix: GeoFix = { lat: accurate.coords.latitude, lng: accurate.coords.longitude, accuracy: accurate.coords.accuracy, source: 'gps' };
    rememberLocation(fix.lat, fix.lng);
    return { ok: true, fix };
  }
  // A "no" from the user is final — asking again only re-triggers the same denial.
  if (accurate.code === 1) return { ok: false, failure: 'denied' };

  // No GPS fix (indoors, laptop, desktop) — the network position is far better than nothing.
  const coarse = await getPosition({ enableHighAccuracy: false, timeout: 15_000, maximumAge: 5 * 60_000 });
  if (isPosition(coarse)) {
    const fix: GeoFix = { lat: coarse.coords.latitude, lng: coarse.coords.longitude, accuracy: coarse.coords.accuracy, source: 'network' };
    rememberLocation(fix.lat, fix.lng);
    return { ok: true, fix };
  }
  return { ok: false, failure: failureFromCode(coarse.code) };
}

/** What to tell the person, and what they can do instead — one line each, no jargon. */
export function describeGeoFailure(failure: GeoFailure): string {
  switch (failure) {
    case 'denied':
      return 'Location is blocked for this site. Allow it from the lock icon in your browser\'s address bar, or search for your area or tap the map instead.';
    case 'insecure':
      return 'Your phone only shares its location on a secure (https) page. Search for your area or tap the map instead.';
    case 'unsupported':
      return 'This device can\'t share its location. Search for your area or tap the map instead.';
    case 'timeout':
      return 'Couldn\'t get a location fix in time — you may be indoors or have a weak signal. Try again, or search for your area or tap the map.';
    default:
      return 'Your location isn\'t available right now. Search for your area or tap the map instead.';
  }
}
