/**
 * Free, no-API-key geocoding (OpenStreetMap Nominatim) so a customer can
 * just type a pickup address instead of being asked for raw lat/lng —
 * nobody should ever have to know their own GPS coordinates to book a ride.
 * Fine for Phase 1's low volume; a production-scale rollout should move to
 * a paid provider (Google/Mapbox) with an API key and request caching.
 */
export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

async function geocodeWithGoogle(query: string): Promise<GeocodeResult | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.results?.[0];
    const lat = Number(result?.geometry?.location?.lat);
    const lng = Number(result?.geometry?.location?.lng);
    if (data?.status !== 'OK' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, displayName: result.formatted_address || query };
  } catch {
    return null;
  }
}

async function searchWithGoogle(query: string): Promise<AddressSuggestion[]> {
  if (!GOOGLE_MAPS_API_KEY) return [];

  try {
    const params = new URLSearchParams({
      address: query,
      key: GOOGLE_MAPS_API_KEY,
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
    if (!res.ok) return [];

    const data = await res.json();
    if (data?.status !== 'OK') return [];

    return (data.results || []).slice(0, 6).map((result: any) => ({
      name: result.address_components?.[0]?.long_name || result.formatted_address?.split(',')[0] || query,
      displayName: result.formatted_address || query,
      lat: Number(result.geometry?.location?.lat),
      lng: Number(result.geometry?.location?.lng),
    })).filter((result: AddressSuggestion) => Number.isFinite(result.lat) && Number.isFinite(result.lng));
  } catch {
    return [];
  }
}

/** Returns several real places for a typing field, rather than only the first geocode match. */
export async function searchAddressSuggestions(query: string, countryHint?: string): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const googleQuery = countryHint && !trimmed.toLowerCase().includes(countryHint.toLowerCase())
    ? `${trimmed}, ${countryHint}`
    : trimmed;
  const googleResults = await searchWithGoogle(googleQuery);
  if (googleResults.length > 0) return googleResults;

  try {
    const params = new URLSearchParams({ format: 'json', limit: '6', q: googleQuery });
    const res = await throttledFetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const results = await res.json();
    return (results || []).map((result: any) => ({
      name: result.name || result.display_name?.split(',')[0] || trimmed,
      displayName: result.display_name,
      lat: Number(result.lat),
      lng: Number(result.lon),
    })).filter((result: AddressSuggestion) => Number.isFinite(result.lat) && Number.isFinite(result.lng));
  } catch {
    return [];
  }
}

async function reverseGeocodeWithGoogle(lat: number, lng: number): Promise<string | null> {
  if (!GOOGLE_MAPS_API_KEY) return null;

  try {
    const params = new URLSearchParams({
      latlng: `${lat},${lng}`,
      key: GOOGLE_MAPS_API_KEY,
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
    if (!res.ok) return null;

    const data = await res.json();
    if (data?.status !== 'OK') return null;
    return data?.results?.[0]?.formatted_address || null;
  } catch {
    return null;
  }
}

// Nominatim's usage policy caps free public use at 1 request/second per
// client. This booking flow can fire several geocode calls close together
// (pickup address, city autocomplete, a dropped map pin's reverse lookup,
// its country lookup) — without this, those can silently collide and get
// rate-limited, which looks exactly like "no cities found" with no error.
// Serializing every Nominatim call through one throttled queue guarantees
// they're always spaced out, regardless of which function fired them.
const NOMINATIM_MIN_INTERVAL_MS = 1100;
let lastNominatimRequestAt = 0;
let nominatimQueue: Promise<void> = Promise.resolve();

function throttledFetch(url: string, init?: RequestInit): Promise<Response> {
  const run = async () => {
    const wait = Math.max(0, lastNominatimRequestAt + NOMINATIM_MIN_INTERVAL_MS - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastNominatimRequestAt = Date.now();
    return fetch(url, init);
  };
  const result = nominatimQueue.then(run);
  // Keep the queue alive even if this particular call fails, so one bad
  // request doesn't jam throttling for everything after it.
  nominatimQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/**
 * countryHint biases short/local place names (e.g. "Ntinda" — a Kampala
 * neighborhood with no country in the text) toward the right country,
 * since Nominatim's global index often can't resolve a bare neighborhood
 * name on its own. Tries with the hint first, then falls back to the raw
 * query in case the caller already typed a full address themselves.
 */
export async function geocodeAddress(query: string, countryHint?: string): Promise<GeocodeResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  const attempts = countryHint && !trimmed.toLowerCase().includes(countryHint.toLowerCase())
    ? [`${trimmed}, ${countryHint}`, trimmed]
    : [trimmed];

  for (const attempt of attempts) {
    const googleResult = await geocodeWithGoogle(attempt);
    if (googleResult) return googleResult;
  }

  for (const attempt of attempts) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(attempt)}`;
    const res = await throttledFetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) continue;

    const results = await res.json();
    if (results && results.length > 0) {
      return {
        lat: Number(results[0].lat),
        lng: Number(results[0].lon),
        displayName: results[0].display_name,
      };
    }
  }
  return null;
}

/**
 * The inverse of geocodeAddress — turns a map pin (lat/lng) back into a
 * human-readable address, so a customer who drops a pin on the map still
 * sees real text in the pickup/dropoff field instead of raw coordinates.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const googleResult = await reverseGeocodeWithGoogle(lat, lng);
  if (googleResult) return googleResult;

  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
  try {
    const res = await throttledFetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const result = await res.json();
    return result?.display_name || null;
  } catch {
    return null;
  }
}

export interface CountryLookup {
  name: string;
  iso2: string;
}

/**
 * Resolves just the country a pin sits in — used for cross-border
 * matching decisions. Always keyed off address.country_code (a stable
 * ISO2 code), never the localized address.country display string:
 * without &accept-language=en, Nominatim returns country names in the
 * local language (confirmed: DR Congo comes back as "République
 * démocratique du Congo" by default), which would silently break any
 * string-match against data/countries.ts's COUNTRIES list.
 */
export interface CitySuggestion {
  name: string;
  displayName: string;
  lat: number;
  lng: number;
}

export interface AddressSuggestion {
  name: string;
  displayName: string;
  lat: number;
  lng: number;
}

async function runCitySearch(trimmed: string, countryIso2: string | undefined, strict: boolean): Promise<CitySuggestion[]> {
  const params = new URLSearchParams({
    format: 'json',
    limit: '8',
    q: trimmed,
    addressdetails: '1',
    'accept-language': 'en',
  });
  // Nominatim's featureType=settlement bucket (city/town/village/hamlet)
  // covers most real places, but plenty of smaller or unusually-tagged
  // towns fall outside it and come back with zero results — not because
  // they don't exist, just because of how this one place happens to be
  // classified in OSM. Only used on the first, strict attempt.
  if (strict) params.set('featureType', 'settlement');
  if (countryIso2) params.set('countrycodes', countryIso2.toLowerCase());

  const res = await throttledFetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return [];

  const results = await res.json();
  return (results || []).map((r: any) => ({
    name: r.address?.city || r.address?.town || r.address?.village || r.name || r.display_name.split(',')[0],
    displayName: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
}

/**
 * Real city/town/village search worldwide — no country whitelist, works for
 * any of the ~195 real countries in data/countries.ts (or none at all, if
 * countryIso2 is omitted). Tries the tight settlement-only search first;
 * if that finds nothing, retries without the featureType filter so a
 * customer typing a real but loosely-tagged town still gets a result
 * instead of "no cities found."
 */
export async function searchCities(query: string, countryIso2?: string): Promise<CitySuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const strict = await runCitySearch(trimmed, countryIso2, true);
  if (strict.length > 0) return strict;
  return runCitySearch(trimmed, countryIso2, false);
}

/** Search hotels, lodges and street addresses within the selected country. */
export async function searchAddresses(query: string, countryIso2?: string, city?: string): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const params = new URLSearchParams({
    format: 'json',
    limit: '8',
    q: [trimmed, city].filter(Boolean).join(', '),
    addressdetails: '1',
    'accept-language': 'en',
  });
  if (countryIso2) params.set('countrycodes', countryIso2.toLowerCase());

  const res = await throttledFetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return [];
  const results = await res.json();
  return (results || []).map((r: any) => ({
    name: r.name || r.address?.hotel || r.address?.amenity || r.display_name.split(',')[0],
    displayName: r.display_name,
    lat: Number(r.lat),
    lng: Number(r.lon),
  }));
}

export async function reverseGeocodeCountry(lat: number, lng: number): Promise<CountryLookup | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=en`;
  try {
    const res = await throttledFetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const result = await res.json();
    const iso2 = result?.address?.country_code;
    if (!iso2) return null;
    return { name: result.address.country || iso2.toUpperCase(), iso2: iso2.toUpperCase() };
  } catch {
    return null;
  }
}
