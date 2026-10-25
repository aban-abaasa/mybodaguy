/**
 * The rider homepage's "smart" decisions, kept free of React and Supabase so
 * they can be unit-tested (tests/riderSmarts.test.js):
 *   - which busy places customers keep asking for that the rider hasn't
 *     added to "My areas" yet (so we can nudge them to add one), and
 *   - which work mode (Normal / VIP / Discount / Return) fits right now.
 *
 * Demand comes from mbg_rider_demand_snapshot (backend/database/
 * ADD_RIDER_DEMAND_INSIGHTS.sql): ~1 km cells of customer pickups/drop-offs
 * and registered customer areas, an hour-of-day histogram, how many requests
 * are waiting nearby and how many riders are online nearby.
 */

export type WorkMode = 'normal' | 'vip' | 'discount' | 'return';

// The matching engine treats a rider as "knowing" a destination when one of
// their areas is within 3 km of it — an area covers the same radius here.
export const AREA_RADIUS_KM = 3;

export interface DemandCell {
  lat: number;
  lng: number;
  label: string | null;
  requests: number;   // ride requests touching this cell in the window
  customers: number;  // distinct customers who rode here or saved it as an area
  recent: number;     // requests in the last 48 hours
  lastAt: string | null;
}

export interface DemandSnapshot {
  cells: DemandCell[];
  hourly: number[];        // 24 buckets, local hour of day
  pendingNearby: number;   // requests waiting for a rider right now
  ridersOnline: number;    // available riders nearby
}

export interface RiderArea {
  id?: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  is_home: boolean;
}

export interface Hotspot {
  key: string;
  lat: number;
  lng: number;
  label: string;
  requests: number;
  customers: number;
  recent: number;
  /** 'hot' = worth interrupting the rider about; 'warm' = a quiet card hint only. */
  level: 'hot' | 'warm';
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// "Ntinda Shopping Centre, Ntinda Road, Kampala" -> "Ntinda Shopping Centre"
export function placeName(label: string | null | undefined): string {
  return (label || '').split(',')[0].trim();
}

function isCovered(lat: number, lng: number, label: string, areas: RiderArea[]): boolean {
  const name = placeName(label).toLowerCase();
  return areas.some(a => {
    if (a.latitude != null && a.longitude != null && haversineKm(a.latitude, a.longitude, lat, lng) <= AREA_RADIUS_KM) return true;
    // The engine also matches areas by name, so "Ntinda" covers "Ntinda Market".
    const areaName = a.name.trim().toLowerCase();
    return !!name && areaName.length >= 3 && (name.includes(areaName) || areaName.includes(name));
  });
}

const MERGE_KM = 2;

/**
 * Busy places the rider doesn't cover. Neighbouring ~1 km cells are merged
 * into one place (strongest cell first) so one neighbourhood becomes one
 * suggestion, then anything an existing area already covers is dropped.
 *
 * "Many customers" = at least 3 distinct customers and 4 requests; it only
 * interrupts ('hot') when it's both broad (6+ customers) and current (3+
 * requests in the last 48 hours), otherwise it's a quiet 'warm' hint.
 */
export function findUncoveredHotspots(cells: DemandCell[], areas: RiderArea[]): Hotspot[] {
  const weight = (c: DemandCell) => c.requests + c.customers * 2 + c.recent * 2;
  const pool = [...cells].sort((a, b) => weight(b) - weight(a));
  const used = new Set<DemandCell>();
  const merged: Hotspot[] = [];

  for (const seed of pool) {
    if (used.has(seed)) continue;
    const group = pool.filter(c => !used.has(c) && haversineKm(seed.lat, seed.lng, c.lat, c.lng) <= MERGE_KM);
    group.forEach(c => used.add(c));

    const total = group.reduce((s, c) => s + weight(c), 0) || 1;
    const lat = group.reduce((s, c) => s + c.lat * weight(c), 0) / total;
    const lng = group.reduce((s, c) => s + c.lng * weight(c), 0) / total;
    const label = placeName(group.find(c => c.label)?.label) || 'this area';
    const requests = group.reduce((s, c) => s + c.requests, 0);
    // Customers can repeat across neighbouring cells; summing slightly overcounts,
    // which only matters near the thresholds — be conservative and take the max
    // when a single cell already carries the group.
    const customers = Math.max(seed.customers, Math.round(group.reduce((s, c) => s + c.customers, 0) * 0.8));
    const recent = group.reduce((s, c) => s + c.recent, 0);

    if (customers < 3 || requests < 4) continue;
    if (isCovered(lat, lng, label, areas)) continue;

    merged.push({
      key: `${lat.toFixed(2)},${lng.toFixed(2)}`,
      lat, lng, label, requests, customers, recent,
      level: customers >= 6 && recent >= 3 ? 'hot' : 'warm',
    });
  }
  return merged.sort((a, b) => (b.level === 'hot' ? 1 : 0) - (a.level === 'hot' ? 1 : 0) || b.customers - a.customers || b.requests - a.requests);
}

// ───────────────────────────── work mode ─────────────────────────────

export interface ModeInputs {
  now: Date;
  currentMode: WorkMode;
  snapshot: DemandSnapshot | null;
  /** Hour-of-day request counts from the rider's own jobs, used when the area-wide snapshot isn't available. */
  ownHourly?: number[] | null;
  ownPending: number;
  ownActive: number;
  /** Straight-line km from the rider to their home area, when both are known. */
  kmFromHome: number | null;
}

export interface ModeRecommendation {
  mode: WorkMode;
  /** 0–1. Auto-switch only acts at >= AUTO_MIN_CONFIDENCE; below that it's just a suggestion. */
  confidence: number;
  reason: string;
}

export const AUTO_MIN_CONFIDENCE = 0.6;
export const AUTO_COOLDOWN_MS = 45 * 60 * 1000;
export const MANUAL_OVERRIDE_MS = 2 * 60 * 60 * 1000;

// Smooth each hour with its neighbours so one lucky ride doesn't make a "peak".
function smoothHourly(hourly: number[]): number[] {
  return hourly.map((_, h) => (hourly[(h + 23) % 24] + 2 * hourly[h] + hourly[(h + 1) % 24]) / 4);
}

export function recommendMode(input: ModeInputs): ModeRecommendation {
  const { now, currentMode, snapshot, ownHourly, ownPending, ownActive, kmFromHome } = input;
  const hour = now.getHours();

  // Mid-job: never change anything under the rider.
  if (ownActive > 0) return { mode: currentMode, confidence: 1, reason: 'You are on a job — mode stays as it is.' };

  const waiting = Math.max(ownPending, snapshot?.pendingNearby ?? 0);
  const online = snapshot?.ridersOnline ?? 0;

  // 1. Requests are waiting and few riders share them: demand beats supply.
  if (waiting >= 2 && waiting / Math.max(online, 1) >= 1.5) {
    return { mode: 'vip', confidence: 0.85, reason: `${waiting} request${waiting === 1 ? '' : 's'} waiting${online > 0 ? ` and only ${online} rider${online === 1 ? '' : 's'} online nearby` : ''}.` };
  }

  // 2. Heading home in the evening, far from home: take people going that way, cheaper.
  if (kmFromHome != null && kmFromHome > AREA_RADIUS_KM && (hour >= 17 || hour < 5)) {
    return { mode: 'return', confidence: 0.75, reason: `You are ${kmFromHome.toFixed(1)} km from home — earn on the way back.` };
  }

  // 3. Where this hour sits against the area's usual day.
  const hourly = snapshot && snapshot.hourly.reduce((s, n) => s + n, 0) >= 20 ? snapshot.hourly
    : ownHourly && ownHourly.reduce((s, n) => s + n, 0) >= 10 ? ownHourly
    : null;
  if (hourly) {
    const smooth = smoothHourly(hourly);
    const mean = smooth.reduce((s, n) => s + n, 0) / 24;
    const ratio = mean > 0 ? smooth[hour] / mean : 1;
    const crowded = online >= 4 && waiting === 0;
    if (ratio >= 1.6) return { mode: 'vip', confidence: 0.7, reason: 'This is one of your busiest hours.' };
    if (ratio <= 0.5 && hour >= 6 && hour < 21) {
      return { mode: 'discount', confidence: crowded ? 0.75 : 0.65, reason: crowded ? 'Quiet hour and several riders are online — a discount wins the next ride.' : 'Quiet hour — a discount brings customers in.' };
    }
    return { mode: 'normal', confidence: 0.6, reason: 'Demand is steady — normal pricing fits.' };
  }

  // 4. No history yet: only the well-known commute rush, and only as a hint.
  if ((hour >= 7 && hour < 9) || (hour >= 17 && hour < 19)) {
    return { mode: 'vip', confidence: 0.4, reason: 'Rush hour — riders usually get more requests now.' };
  }
  return { mode: 'normal', confidence: 0.4, reason: 'Not enough ride history yet to suggest more.' };
}

export interface AutoSwitchState {
  rec: ModeRecommendation;
  currentMode: WorkMode;
  now: number;
  lastAutoAt: number;
  overrideUntil: number;
}

/** Auto only acts on a confident recommendation, after the cooldown, and never fights a recent manual choice. */
export function shouldAutoSwitch(s: AutoSwitchState): boolean {
  return (
    s.rec.mode !== s.currentMode &&
    s.rec.confidence >= AUTO_MIN_CONFIDENCE &&
    s.now - s.lastAutoAt >= AUTO_COOLDOWN_MS &&
    s.now >= s.overrideUntil
  );
}

/** How often to bring the same hotspot up again: hot ones every 3 h, warm ones once a day. */
export function nudgeIntervalMs(level: Hotspot['level']): number {
  return level === 'hot' ? 3 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

export function hourlyFromTimestamps(timestamps: string[]): number[] {
  const hourly = new Array(24).fill(0);
  timestamps.forEach(t => { const d = new Date(t); if (!Number.isNaN(d.getTime())) hourly[d.getHours()] += 1; });
  return hourly;
}
