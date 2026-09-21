/**
 * Pure helpers for the "Book a full journey" flight step: turn raw Duffel
 * offers into something a customer can compare (airline, times, stops, bags),
 * group them by airline, filter by their preferences, and rank them.
 *
 * Everything here is derived from the `slices` the search endpoint already
 * returns, so it works against the deployed API as-is. The optional
 * `carrierIata` / `carrierLogoUrl` / `refundable` fields on FlightOffer are
 * used when the API sends them and fall back to the segment data otherwise.
 *
 * Duffel's departing_at / arriving_at are LOCAL wall-clock times at each
 * airport with no offset ("2026-10-01T08:30:00") — they are read as text here,
 * never through `new Date()`, so the browser's timezone can't shift them.
 */
import type { FlightOffer } from './journeyService';

export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';
export type SortKey = 'best' | 'cheapest' | 'fastest' | 'earliest';
export type StopsPref = 'any' | 'direct' | 'max1';
export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export const CABIN_LABELS: Record<CabinClass, string> = {
  economy: 'Economy',
  premium_economy: 'Premium economy',
  business: 'Business',
  first: 'First',
};

export const DAY_PART_LABELS: Record<DayPart, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  night: 'Night',
};

export const DAY_PART_HOURS: Record<DayPart, string> = {
  morning: '05:00–12:00',
  afternoon: '12:00–17:00',
  evening: '17:00–22:00',
  night: '22:00–05:00',
};

export interface FlightPrefs {
  sort: SortKey;
  stops: StopsPref;
  dayParts: DayPart[];
  checkedBagOnly: boolean;
}

export const DEFAULT_PREFS: FlightPrefs = { sort: 'best', stops: 'any', dayParts: [], checkedBagOnly: false };

export interface FlightSummary {
  offer: FlightOffer;
  airlineKey: string;
  airline: string;
  airlineCode: string | null;
  logoUrl: string | null;
  operatedBy: string | null;
  flightNumbers: string[];
  originIata: string;
  destinationIata: string;
  departClock: string;
  arriveClock: string;
  departDayLabel: string;
  /** Whole days between departure date and arrival date (overnight flights). */
  arriveDayOffset: number;
  departMinutes: number;
  durationMin: number | null;
  stops: number;
  viaIatas: string[];
  cabin: string | null;
  /** Checked bags included in the fare; null when the airline didn't say. */
  checkedBags: number | null;
  refundable: boolean | null;
  price: number;
  currency: string;
  /** The fare in ICAN at its live value (null: the price engine had none). */
  priceIcan: number | null;
  /** ...and in the customer's own currency. */
  priceLocal: number | null;
  localCurrency: string | null;
  /** When to be at the airport: a time, and whether that's the day before. */
  airportBy: { clock: string; previousDay: boolean };
  /** Airport check-in time before 04:00 — an unusually early start. */
  earlyStart: boolean;
  /** Lands between 23:00 and 05:00 local time. */
  landsLate: boolean;
}

// ---------------------------------------------------------------- parsing

/** ISO-8601 duration ("PT3H10M", "P1DT2H") to minutes; null when unparseable. */
export function parseIsoDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(value.trim());
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return (Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0);
}

interface LocalStamp { date: string; minutes: number; clock: string }

function parseLocalStamp(value: unknown): LocalStamp | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return { date: m[1], minutes: Number(m[2]) * 60 + Number(m[3]), clock: `${m[2]}:${m[3]}` };
}

function daysBetween(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function formatDayLabel(isoDate: string): string {
  const t = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(t)) return isoDate;
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// International check-in typically closes 60 min out but airlines advise ~3h;
// domestic ~2h. Only a recommendation shown to the customer — nothing books off it.
const INTERNATIONAL_BUFFER_MIN = 180;
const DOMESTIC_BUFFER_MIN = 120;

export function summarizeOffer(offer: FlightOffer): FlightSummary | null {
  const slice = offer.slices?.[0];
  const segments: any[] = slice?.segments ?? [];
  if (segments.length === 0) return null;

  const first = segments[0];
  const last = segments[segments.length - 1];
  const dep = parseLocalStamp(first.departing_at);
  const arr = parseLocalStamp(last.arriving_at);
  if (!dep || !arr) return null;

  const airline: string = offer.carrier || first.marketing_carrier?.name || 'Airline';
  const airlineCode: string | null = offer.carrierIata || first.marketing_carrier?.iata_code || null;
  const operating: string | undefined = first.operating_carrier?.name;
  const operatedBy = operating && operating !== airline && operating !== first.marketing_carrier?.name ? operating : null;

  const durationMin =
    parseIsoDuration(slice.duration) ??
    (segments.every((s) => parseIsoDuration(s.duration) !== null)
      ? segments.reduce((sum, s) => sum + (parseIsoDuration(s.duration) as number), 0)
      : null);

  const pax = first.passengers?.[0];
  const checked = (pax?.baggages as Array<{ type: string; quantity: number }> | undefined)?.find((b) => b.type === 'checked');
  const checkedBags = pax?.baggages ? (checked?.quantity ?? 0) : null;

  const originCountry: string | undefined = first.origin?.iata_country_code;
  const destCountry: string | undefined = last.destination?.iata_country_code;
  const domestic = !!originCountry && !!destCountry && originCountry === destCountry;
  const buffer = domestic ? DOMESTIC_BUFFER_MIN : INTERNATIONAL_BUFFER_MIN;
  const rawAirportBy = dep.minutes - buffer;
  const previousDay = rawAirportBy < 0;
  const airportMinutes = (rawAirportBy + 1440) % 1440;

  return {
    offer,
    airlineKey: airlineCode || airline,
    airline,
    airlineCode,
    logoUrl: offer.carrierLogoUrl || first.marketing_carrier?.logo_symbol_url || null,
    operatedBy,
    flightNumbers: segments.map((s) => `${s.marketing_carrier?.iata_code ?? ''}${s.marketing_carrier_flight_number ?? ''}`).filter(Boolean),
    originIata: first.origin?.iata_code ?? '',
    destinationIata: last.destination?.iata_code ?? '',
    departClock: dep.clock,
    arriveClock: arr.clock,
    departDayLabel: formatDayLabel(dep.date),
    arriveDayOffset: Math.max(0, daysBetween(dep.date, arr.date)),
    departMinutes: dep.minutes,
    durationMin,
    stops: segments.length - 1,
    viaIatas: segments.slice(0, -1).map((s) => s.destination?.iata_code).filter(Boolean),
    cabin: pax?.cabin_class_marketing_name || (pax?.cabin_class ? CABIN_LABELS[pax.cabin_class as CabinClass] ?? pax.cabin_class : null),
    checkedBags,
    refundable: typeof offer.refundable === 'boolean' ? offer.refundable : null,
    price: Number(offer.totalAmount),
    currency: offer.totalCurrency,
    priceIcan: typeof offer.priceIcan === 'number' ? offer.priceIcan : null,
    priceLocal: typeof offer.priceLocal === 'number' ? offer.priceLocal : null,
    localCurrency: offer.localCurrency ?? null,
    airportBy: { clock: `${pad(Math.floor(airportMinutes / 60))}:${pad(airportMinutes % 60)}`, previousDay },
    earlyStart: previousDay || airportMinutes < 4 * 60,
    landsLate: arr.minutes >= 23 * 60 || arr.minutes < 5 * 60,
  };
}

export function summarizeOffers(offers: FlightOffer[]): FlightSummary[] {
  return offers.map(summarizeOffer).filter((s): s is FlightSummary => s !== null);
}

// ---------------------------------------------------------------- filtering

export function dayPartOf(departMinutes: number): DayPart {
  const h = departMinutes / 60;
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 22) return 'evening';
  return 'night';
}

export function applyPrefs(flights: FlightSummary[], prefs: FlightPrefs): FlightSummary[] {
  return flights.filter((f) => {
    if (prefs.stops === 'direct' && f.stops > 0) return false;
    if (prefs.stops === 'max1' && f.stops > 1) return false;
    if (prefs.dayParts.length > 0 && !prefs.dayParts.includes(dayPartOf(f.departMinutes))) return false;
    if (prefs.checkedBagOnly && !(f.checkedBags !== null && f.checkedBags > 0)) return false;
    return true;
  });
}

// ---------------------------------------------------------------- airlines

export interface AirlineGroup {
  key: string;
  name: string;
  logoUrl: string | null;
  count: number;
  cheapest: number;
  currency: string;
  cheapestIcan: number | null;
  cheapestLocal: number | null;
  localCurrency: string | null;
  hasDirect: boolean;
}

export function groupByAirline(flights: FlightSummary[]): AirlineGroup[] {
  const groups = new Map<string, AirlineGroup>();
  for (const f of flights) {
    const g = groups.get(f.airlineKey);
    if (!g) {
      groups.set(f.airlineKey, {
        key: f.airlineKey, name: f.airline, logoUrl: f.logoUrl, count: 1,
        cheapest: f.price, currency: f.currency, hasDirect: f.stops === 0,
        cheapestIcan: f.priceIcan, cheapestLocal: f.priceLocal, localCurrency: f.localCurrency,
      });
    } else {
      g.count += 1;
      if (f.price < g.cheapest) {
        g.cheapest = f.price; g.currency = f.currency;
        g.cheapestIcan = f.priceIcan; g.cheapestLocal = f.priceLocal; g.localCurrency = f.localCurrency;
      }
      if (f.stops === 0) g.hasDirect = true;
    }
  }
  return [...groups.values()].sort((a, b) => a.cheapest - b.cheapest || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- ranking

export type Badge = 'cheapest' | 'fastest' | 'best';

function spread(values: number[]): { min: number; range: number } {
  const min = Math.min(...values);
  return { min, range: Math.max(...values) - min };
}

/**
 * Lower is better. Price and travel time dominate; each connection and an
 * awkward hour (leaving 00:00–05:00 or landing 23:00–05:00, when nobody wants
 * to be riding to/from an airport) add a penalty.
 */
export function rankScores(flights: FlightSummary[]): Map<string, number> {
  const scores = new Map<string, number>();
  if (flights.length === 0) return scores;
  const p = spread(flights.map((f) => f.price));
  const known = flights.map((f) => f.durationMin).filter((d): d is number => d !== null);
  const d = known.length > 0 ? spread(known) : { min: 0, range: 0 };
  for (const f of flights) {
    const priceNorm = p.range > 0 ? (f.price - p.min) / p.range : 0;
    const durNorm = f.durationMin === null ? 1 : d.range > 0 ? (f.durationMin - d.min) / d.range : 0;
    const awkward = (f.departMinutes < 5 * 60 ? 0.08 : 0) + (f.landsLate ? 0.08 : 0);
    scores.set(f.offer.offerId, 0.5 * priceNorm + 0.35 * durNorm + Math.min(f.stops, 3) * 0.12 + awkward);
  }
  return scores;
}

export function computeBadges(flights: FlightSummary[]): Map<string, Badge[]> {
  const badges = new Map<string, Badge[]>();
  if (flights.length < 2) return badges;
  const add = (id: string, b: Badge) => badges.set(id, [...(badges.get(id) ?? []), b]);

  const cheapest = flights.reduce((a, b) => (b.price < a.price ? b : a));
  add(cheapest.offer.offerId, 'cheapest');

  const timed = flights.filter((f) => f.durationMin !== null);
  if (timed.length > 0) {
    const fastest = timed.reduce((a, b) => ((b.durationMin as number) < (a.durationMin as number) ? b : a));
    add(fastest.offer.offerId, 'fastest');
  }

  const scores = rankScores(flights);
  const best = flights.reduce((a, b) => (scores.get(b.offer.offerId)! < scores.get(a.offer.offerId)! ? b : a));
  add(best.offer.offerId, 'best');
  return badges;
}

export function sortFlights(flights: FlightSummary[], sort: SortKey): FlightSummary[] {
  const scores = rankScores(flights);
  const byBest = (a: FlightSummary, b: FlightSummary) => scores.get(a.offer.offerId)! - scores.get(b.offer.offerId)!;
  const dur = (f: FlightSummary) => f.durationMin ?? Number.POSITIVE_INFINITY;
  const compare: Record<SortKey, (a: FlightSummary, b: FlightSummary) => number> = {
    best: byBest,
    cheapest: (a, b) => a.price - b.price || byBest(a, b),
    fastest: (a, b) => dur(a) - dur(b) || a.price - b.price,
    earliest: (a, b) => a.departMinutes - b.departMinutes || a.price - b.price,
  };
  return [...flights].sort(compare[sort]);
}

// ---------------------------------------------------------------- money

/** ICAN amount: two decimals from 10 up, up to four below (small amounts matter). */
export function formatIcan(n: number): string {
  return n.toLocaleString(undefined, n >= 10 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

/** An amount in a real currency, with that currency's own symbol and decimals. */
export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    // Not a code Intl knows — still show something honest.
    return `${currency} ${Math.round(amount).toLocaleString()}`;
  }
}

/**
 * How a fare is shown: ICAN first, then the customer's own currency. Falls back
 * to the airline's own price when no ICAN price could be worked out.
 */
export function fareDisplay(f: Pick<FlightSummary, 'price' | 'currency' | 'priceIcan' | 'priceLocal' | 'localCurrency'>): { primary: string; secondary: string | null } {
  if (f.priceIcan === null) {
    return { primary: `${f.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${f.currency}`, secondary: null };
  }
  return {
    primary: `${formatIcan(f.priceIcan)} ICAN`,
    secondary: f.priceLocal !== null && f.localCurrency ? `≈ ${formatMoney(f.priceLocal, f.localCurrency)}` : null,
  };
}

// ---------------------------------------------------------------- dates

/** Today as YYYY-MM-DD in the browser's own calendar (for the date input's `min`). */
export function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
