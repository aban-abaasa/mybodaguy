// The ride to the departure airport is part of the journey, not a normal ride
// booking: it is priced ONCE here, at quote time, paid with the journey's
// single ICAN payment, and dispatched at exactly this price (see
// ADD_JOURNEY_PREPAID_LEG_FARES.sql) — no time-of-day multiplier, no wallet
// surcharge, no second charge when the rider completes it.

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

/**
 * Fare (UGX) for the ride from the customer's pickup to the departure airport:
 * the platform's normal base + per-km rate over the real distance, never below
 * the minimum fare. Falls back to the minimum fare when either end has no
 * coordinates (the ride still gets a sensible price, just not a distance one).
 */
export async function priceAirportTransferUgx(supabaseAdmin, pickup, airport) {
  const setting = async (key, fallback) => {
    const { data } = await supabaseAdmin.rpc('mbg_get_setting_numeric', { p_key: key, p_default: fallback });
    const n = Number(data);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const [baseFare, perKm, minFare] = await Promise.all([
    setting('ride.base_fare', 1000),
    setting('ride.per_km_rate', 1000),
    setting('ride.minimum_fare', 2000)
  ]);

  const havePoints = [pickup?.lat, pickup?.lng, airport?.lat, airport?.lng].every((v) => Number.isFinite(Number(v)) && v !== null);
  if (!havePoints) return { fareUgx: minFare, distanceKm: null };

  const distanceKm = haversineKm(Number(pickup.lat), Number(pickup.lng), airport.lat, airport.lng);
  const fareUgx = Math.round(Math.max(minFare, baseFare + distanceKm * perKm) / 100) * 100;
  return { fareUgx, distanceKm: Math.round(distanceKm * 10) / 10 };
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
