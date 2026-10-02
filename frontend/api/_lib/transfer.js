// The ride to the departure airport is part of the journey, not a normal ride
// booking: it is priced ONCE here, at quote time, paid with the journey's
// single ICAN payment, and dispatched at exactly this price (see
// ADD_JOURNEY_PREPAID_LEG_FARES.sql) — no time-of-day multiplier, no wallet
// surcharge, no second charge when the rider completes it.
//
// The ride from the arrival airport to the destination (the last mile) is priced
// the same way — real road distance, same base + per-km rate — see priceLastMileUgx.

const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1, lng1, lat2, lng2) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** The airport the first flight departs from, as Duffel describes it in the offer. */
export function originAirportOf(offer) {
  const origin = offer?.slices?.[0]?.segments?.[0]?.origin;
  if (!origin) return null;
  const lat = Number(origin.latitude);
  const lng = Number(origin.longitude);
  return {
    iataCode: origin.iata_code || null,
    name: origin.name || origin.city_name || origin.iata_code || 'Airport',
    countryCode: origin.iata_country_code || null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null
  };
}

/** The airport the last flight lands at, as Duffel describes it in the offer. */
export function arrivalAirportOf(offer) {
  const segments = offer?.slices?.[0]?.segments;
  const destination = segments?.[segments.length - 1]?.destination;
  if (!destination) return null;
  const lat = Number(destination.latitude);
  const lng = Number(destination.longitude);
  return {
    iataCode: destination.iata_code || null,
    name: destination.name || destination.city_name || destination.iata_code || 'Airport',
    countryCode: destination.iata_country_code || null,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null
  };
}

const isPoint = (p) => !!p && p.lat !== null && p.lng !== null && p.lat !== undefined && p.lng !== undefined
  && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng));

// A quote and the confirm that follows it must agree to the shilling, so the
// distance for a pair of points is worked out once and remembered for a while
// (OSRM is deterministic, but a lookup that timed out at quote time must not
// price differently at confirm time just because the router answered then).
const ROAD_CACHE_TTL_MS = 15 * 60 * 1000;
const roadCache = new Map();
const OSRM_TIMEOUT_MS = 4000;

/**
 * The real DRIVING distance between two points (km): OSRM's road route, the same
 * router the app's maps use. When the router can't answer in time, the straight
 * line is stretched by a road factor (default 1.3, the same factor the dispatch
 * planner assumes) — a straight line always under-prices a real road trip.
 * `source` says which one was used ('road' | 'estimate').
 */
export async function roadDistanceKm(from, to, roadFactor = 1.3) {
  const key = [from.lat, from.lng, to.lat, to.lng].map((n) => Number(n).toFixed(4)).join(',');
  const hit = roadCache.get(key);
  if (hit && Date.now() - hit.at < ROAD_CACHE_TTL_MS) return hit.value;

  let value;
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${Number(from.lng)},${Number(from.lat)};${Number(to.lng)},${Number(to.lat)}?overview=false`;
    const res = await fetch(url, { signal: AbortSignal.timeout(OSRM_TIMEOUT_MS) });
    const data = res.ok ? await res.json() : null;
    const meters = data?.code === 'Ok' ? data.routes?.[0]?.distance : null;
    if (Number.isFinite(meters) && meters > 0) value = { km: meters / 1000, source: 'road' };
  } catch {
    // fall through to the estimate
  }
  if (!value) {
    value = { km: haversineKm(Number(from.lat), Number(from.lng), Number(to.lat), Number(to.lng)) * roadFactor, source: 'estimate' };
  }
  roadCache.set(key, { at: Date.now(), value });
  return value;
}

async function rideRates(supabaseAdmin) {
  const setting = async (key, fallback) => {
    const { data } = await supabaseAdmin.rpc('mbg_get_setting_numeric', { p_key: key, p_default: fallback });
    const n = Number(data);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const [baseFare, perKm, minFare, roadFactor] = await Promise.all([
    setting('ride.base_fare', 1000),
    setting('ride.per_km_rate', 1000),
    setting('ride.minimum_fare', 2000),
    setting('journey.road_distance_factor', 1.3)
  ]);
  return { baseFare, perKm, minFare, roadFactor };
}

/**
 * Fare (UGX) for one ground leg of a journey between two points: the platform's
 * normal base + per-km rate over the real road distance, never below the minimum
 * fare, rounded to 100. `fareUgx` is null when either end has no coordinates —
 * the caller decides the fallback (first leg: minimum fare; last mile: a flat
 * estimate), because a missing end is not the same as a short trip.
 */
export async function priceGroundLegUgx(supabaseAdmin, from, to) {
  const rates = await rideRates(supabaseAdmin);
  if (!isPoint(from) || !isPoint(to)) return { fareUgx: null, distanceKm: null, source: null, minFare: rates.minFare };
  const { km, source } = await roadDistanceKm(from, to, rates.roadFactor);
  const fareUgx = Math.round(Math.max(rates.minFare, rates.baseFare + km * rates.perKm) / 100) * 100;
  return { fareUgx, distanceKm: Math.round(km * 10) / 10, source, minFare: rates.minFare };
}

/**
 * Fare (UGX) for the ride from the customer's pickup to the departure airport.
 * Falls back to the minimum fare when either end has no coordinates (the ride
 * still gets a sensible price, just not a distance one).
 */
export async function priceAirportTransferUgx(supabaseAdmin, pickup, airport) {
  const leg = await priceGroundLegUgx(supabaseAdmin, pickup, airport);
  if (leg.fareUgx === null) return { fareUgx: leg.minFare, distanceKm: null, source: null };
  return { fareUgx: leg.fareUgx, distanceKm: leg.distanceKm, source: leg.source };
}

/**
 * Fare (UGX) for the last mile: from the arrival airport to the customer's
 * destination, priced exactly like the first leg. When the destination has no
 * pin (or the airport has no coordinates) the distance is unknown, so the old
 * flat estimate is kept instead of guessing a distance.
 */
export async function priceLastMileUgx(supabaseAdmin, airport, destination, flatFallbackUgx) {
  const leg = await priceGroundLegUgx(supabaseAdmin, airport, destination);
  if (leg.fareUgx === null) return { fareUgx: flatFallbackUgx, distanceKm: null, source: null };
  return { fareUgx: leg.fareUgx, distanceKm: leg.distanceKm, source: leg.source };
}

/**
 * The instant a wall-clock time at an airport ("2026-10-01T08:30:00", no offset,
 * as Duffel reports departures) actually is, given that airport's IANA time
 * zone. Returns null when the zone is unknown so callers can fall back safely.
 */
export function zonedToUtc(localStamp, timeZone) {
  if (!localStamp || !timeZone) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localStamp);
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
    const offsetAt = (t) => {
      const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
    };
    let t = asUtc - offsetAt(asUtc);
    t = asUtc - offsetAt(t); // second pass settles a DST boundary
    return new Date(t);
  } catch {
    return null;
  }
}

const INTERNATIONAL_CHECKIN_MIN = 180;
const DOMESTIC_CHECKIN_MIN = 120;
const CITY_SPEED_KMH = 30;
const DISPATCH_LEAD_MIN = 30;

/**
 * When the ride to the airport should go out. A driver is not sent days ahead
 * for a future flight: the ride is dispatched (by the pg_cron dispatch job) about
 * DISPATCH_LEAD_MIN before the customer has to leave to reach the airport in time
 * for check-in. If that moment is close, or the flight time can't be read, the
 * ride goes out right away.
 */
export function planPickupDispatch(offer, distanceKm, now = new Date()) {
  const slice = offer?.slices?.[0];
  const first = slice?.segments?.[0];
  const last = slice?.segments?.[slice.segments.length - 1];
  const departure = zonedToUtc(first?.departing_at, first?.origin?.time_zone);
  if (!departure) return { immediate: true, dispatchAt: now, leaveBy: null };

  const domestic = !!first?.origin?.iata_country_code && first.origin.iata_country_code === last?.destination?.iata_country_code;
  const checkinMin = domestic ? DOMESTIC_CHECKIN_MIN : INTERNATIONAL_CHECKIN_MIN;
  const travelMin = Number.isFinite(distanceKm) ? Math.round((distanceKm * 1.3) / CITY_SPEED_KMH * 60) + 15 : 45;

  const leaveBy = new Date(departure.getTime() - (checkinMin + travelMin) * 60000);
  const dispatchAt = new Date(leaveBy.getTime() - DISPATCH_LEAD_MIN * 60000);
  const immediate = dispatchAt.getTime() <= now.getTime() + 15 * 60000;
  return { immediate, dispatchAt: immediate ? now : dispatchAt, leaveBy };
}
