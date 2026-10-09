/**
 * Forgiving device-location lookup for the map pickers.
 *
 * A bare getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 })
 * reports "denied or unavailable" for very different situations — the user
 * said no, the page is on plain HTTP, a laptop has no GPS chip, or a phone
 * indoors just couldn't get a satellite fix in 10s. Only the first one is
 * final. Everything else can usually still be answered by the network
 * (Wi-Fi / cell) position, so this asks for both at once, falls back to the
 * last good fix, and tells the caller *why* it failed so the UI can say
 * something useful instead of one generic sentence.
 */

export type GeoFailure = 'unsupported' | 'insecure' | 'denied' | 'unavailable' | 'timeout';

export interface GeoFix {
  lat: number;
  lng: number;
  /** Metres. Network fixes are often hundreds of metres to kilometres off. */
  accuracy: number;
  source: 'gps' | 'network' | 'cached';
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

/** How long the GPS lookup gets to improve on a network fix that has already arrived. */
const GPS_GRACE_MS = 3000;
/** Accuracy reported for a remembered location, so callers show the "approximate" hint. */
const CACHED_ACCURACY_M = 5000;

function toFix(position: GeolocationPosition, source: 'gps' | 'network'): GeoFix {
  return { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, source };
}

export async function locateDevice(): Promise<GeoResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return { ok: false, failure: 'unsupported' };
  // Browsers refuse geolocation outside HTTPS (localhost excepted) with the same
  // error code as a user's "Block" — surface the real reason.
  if (typeof window !== 'undefined' && window.isSecureContext === false) return { ok: false, failure: 'insecure' };

  // Ask for the satellite and the Wi-Fi / cell position at the same time instead of
  // one after the other: indoors the GPS lookup can burn its whole timeout, and the
  // network answer is usually back in a second or two.
  const gpsRequest = getPosition({ enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 });
  const networkRequest = getPosition({ enableHighAccuracy: false, timeout: 20_000, maximumAge: 10 * 60_000 });

  const gps = gpsRequest.then((r) => (isPosition(r) ? toFix(r, 'gps') : r));
  const network = networkRequest.then((r) => (isPosition(r) ? toFix(r, 'network') : r));

  // First answer wins; a network fix gets a short wait for a better GPS one.
  const first = await Promise.race([gps, network]);
  let fix: GeoFix | null = null;
  let error: GeolocationPositionError | null = null;
  if ('lat' in first) {
    fix = first;
    if (first.source === 'network') {
      const better = await Promise.race([gps, new Promise<null>((resolve) => setTimeout(() => resolve(null), GPS_GRACE_MS))]);
      if (better && 'lat' in better && better.accuracy < first.accuracy) fix = better;
    }
  } else {
    // The faster request failed — the other one may still succeed.
    const [g, n] = await Promise.all([gps, network]);
    if ('lat' in g) fix = g;
    else if ('lat' in n) fix = n;
    else error = g.code === 1 || n.code === 1 ? (g.code === 1 ? g : n) : n;
  }

  if (fix) {
    rememberLocation(fix.lat, fix.lng);
    return { ok: true, fix };
  }
  // A "no" from the user is final — asking again only re-triggers the same denial.
  if (error && error.code === 1) return { ok: false, failure: 'denied' };

  // Nothing live (deep indoors, weak signal) — the last place this device was
  // located is still a far better starting pin than an error; the caller shows
  // the "approximate, drag the pin" hint because of the large accuracy.
  const remembered = getRememberedLocation();
  if (remembered) {
    return { ok: true, fix: { lat: remembered.lat, lng: remembered.lng, accuracy: CACHED_ACCURACY_M, source: 'cached' } };
  }
  return { ok: false, failure: failureFromCode(error?.code ?? 2) };
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
