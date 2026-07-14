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
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(attempt)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
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
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
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
export async function reverseGeocodeCountry(lat: number, lng: number): Promise<CountryLookup | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=en`;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const result = await res.json();
    const iso2 = result?.address?.country_code;
    if (!iso2) return null;
    return { name: result.address.country || iso2.toUpperCase(), iso2: iso2.toUpperCase() };
  } catch {
    return null;
  }
}
