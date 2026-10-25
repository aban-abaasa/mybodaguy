import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crown, DollarSign, Tag, Home, MapPin, Flame, ChevronRight, Sparkles, Plus, Power, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';
import { reverseGeocode } from '../services/geocodeService';
import {
  type WorkMode, type RiderArea, type DemandCell, type DemandSnapshot, type Hotspot,
  findUncoveredHotspots, recommendMode, shouldAutoSwitch, nudgeIntervalMs, hourlyFromTimestamps,
  haversineKm, placeName, MANUAL_OVERRIDE_MS,
} from '../utils/riderSmarts';

/**
 * The rider homepage's two cards — Work mode and My areas — and the logic that
 * keeps them smart:
 *   - Work mode: one-tap switching, a suggestion from demand (see
 *     recommendMode) and an optional Auto switch that applies confident
 *     suggestions while the rider is online and not on a job.
 *   - My areas: a simple list of the places the rider knows, plus a nudge
 *     (card + toast + device notification when the app is in the background)
 *     whenever many customers keep asking for a place the rider doesn't cover.
 * Everything runs while the dashboard is open; there is no server-side push.
 */

const SNAPSHOT_REFRESH_MS = 10 * 60 * 1000;
const TICK_MS = 5 * 60 * 1000;

const readStore = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const writeStore = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / quota — the feature just forgets */ }
};

interface RiderRow {
  lat: number | null;
  lng: number | null;
  isAvailable: boolean;
  vip: number;
  discount: number;
  ret: number;
}

interface OwnRide { customer_id: string; pickup_lat: number; pickup_lng: number; pickup_location: string | null; requested_at: string }

// Used when the area-wide RPC isn't installed: the rider's own jobs still show
// which places keep coming up that they haven't added.
function cellsFromOwnRides(rides: OwnRide[]): DemandCell[] {
  const cells = new Map<string, { rides: OwnRide[]; customers: Set<string> }>();
  rides.forEach(r => {
    if (r.pickup_lat == null || r.pickup_lng == null) return;
    const key = `${Number(r.pickup_lat).toFixed(2)},${Number(r.pickup_lng).toFixed(2)}`;
    const cell = cells.get(key) || { rides: [], customers: new Set<string>() };
    cell.rides.push(r);
    cell.customers.add(r.customer_id);
    cells.set(key, cell);
  });
  const recentCutoff = Date.now() - 48 * 3600 * 1000;
  return [...cells.values()].map(({ rides: rs, customers }) => ({
    lat: rs.reduce((s, r) => s + Number(r.pickup_lat), 0) / rs.length,
    lng: rs.reduce((s, r) => s + Number(r.pickup_lng), 0) / rs.length,
    label: rs.find(r => r.pickup_location)?.pickup_location ?? null,
    requests: rs.length,
    customers: customers.size,
    recent: rs.filter(r => new Date(r.requested_at).getTime() >= recentCutoff).length,
    lastAt: rs[0]?.requested_at ?? null,
  }));
}

function parseSnapshot(data: any): DemandSnapshot {
  return {
    cells: (data?.cells || []).map((c: any) => ({
      lat: Number(c.lat), lng: Number(c.lng), label: c.label ?? null,
      requests: Number(c.requests) || 0, customers: Number(c.customers) || 0,
      recent: Number(c.recent) || 0, lastAt: c.last_at ?? null,
    })),
    hourly: Array.from({ length: 24 }, (_, h) => Number(data?.hourly?.[h]) || 0),
    pendingNearby: Number(data?.pending_nearby) || 0,
    ridersOnline: Number(data?.riders_online) || 0,
  };
}

interface AssistArgs {
  userId: string | undefined;
  riderId: string | null;
  vehicleType: string | null;
  mode: WorkMode | null;
  pendingCount: number;
  activeCount: number;
  /** Re-read the dashboard's rider stats after the mode changes. */
  onModeChanged: () => void | Promise<void>;
}

export function useRiderSmartAssist({ userId, riderId, vehicleType, mode, pendingCount, activeCount, onModeChanged }: AssistArgs) {
  const storeKey = userId ? `mbg_smart_${userId}` : '';
  const [row, setRow] = useState<RiderRow | null>(null);
  const [areas, setAreas] = useState<RiderArea[]>([]);
  const [areasLoaded, setAreasLoaded] = useState(false);
  const [snapshot, setSnapshot] = useState<DemandSnapshot | null>(null);
  const [ownRides, setOwnRides] = useState<OwnRide[]>([]);
  const [auto, setAutoState] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [switching, setSwitching] = useState(false);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  // Bumped whenever a nudge is snoozed/dismissed so the card re-derives.
  const [nudgeVersion, setNudgeVersion] = useState(0);
  const [onlineSince, setOnlineSince] = useState(0);
  const [togglingOnline, setTogglingOnline] = useState(false);

  const autoSetRef = useRef<WorkMode | null>(null);
  const prevModeRef = useRef<WorkMode | null>(null);
  const prevVehicleRef = useRef<string | null>(null);
  const busyRef = useRef(false);

  const state = () => readStore<{ auto: boolean; lastAutoAt: number; overrideUntil: number; nudges: Record<string, number>; onlineSince: number }>(
    storeKey, { auto: false, lastAutoAt: 0, overrideUntil: 0, nudges: {}, onlineSince: 0 });
  const patchState = (patch: Partial<ReturnType<typeof state>>) => writeStore(storeKey, { ...state(), ...patch });

  useEffect(() => {
    if (!storeKey) return;
    const s = state();
    setAutoState(s.auto);
    setOnlineSince(s.onlineSince || 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey]);

  const markOnline = (online: boolean) => {
    // Keep the original start when something else (the other switch) confirms we're already online.
    const since = online ? state().onlineSince || Date.now() : 0;
    patchState({ onlineSince: since });
    setOnlineSince(since);
  };

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const loadRow = useCallback(async () => {
    if (!userId || !vehicleType) return;
    const { data } = await supabase
      .from('mbg_riders')
      .select('current_lat, current_lng, is_available, vip_surcharge_pct, discount_pct, return_discount_pct')
      .eq('user_id', userId)
      .eq('vehicle_type', vehicleType)
      .maybeSingle();
    if (!data) return;
    if (!data.is_available && state().onlineSince) markOnline(false);
    setRow({
      lat: data.current_lat != null ? Number(data.current_lat) : null,
      lng: data.current_lng != null ? Number(data.current_lng) : null,
      isAvailable: !!data.is_available,
      vip: Number(data.vip_surcharge_pct ?? 10),
      discount: Number(data.discount_pct ?? 10),
      ret: Number(data.return_discount_pct ?? 30),
    });
  }, [userId, vehicleType]);

  const loadAreas = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('mbg_rider_locations')
      .select('id, name, address, latitude, longitude, is_home')
      .eq('rider_user_id', userId)
      .order('is_home', { ascending: false })
      .order('created_at', { ascending: true });
    setAreas((data || []).map((a: any) => ({
      id: a.id, name: a.name, is_home: !!a.is_home,
      latitude: a.latitude != null ? Number(a.latitude) : null,
      longitude: a.longitude != null ? Number(a.longitude) : null,
    })));
    setAreasLoaded(true);
  }, [userId]);

  useEffect(() => { loadRow(); }, [loadRow, mode]);
  useEffect(() => { loadAreas(); }, [loadAreas]);

  // The rider's own recent jobs: an hour-of-day profile and, when the
  // area-wide RPC isn't installed, a fallback for finding uncovered places.
  useEffect(() => {
    if (!riderId) { setOwnRides([]); return; }
    let cancelled = false;
    supabase
      .from('mbg_rides')
      .select('customer_id, pickup_lat, pickup_lng, pickup_location, requested_at')
      .eq('rider_id', riderId)
      .order('requested_at', { ascending: false })
      .limit(150)
      .then(({ data }) => { if (!cancelled) setOwnRides((data as OwnRide[]) || []); });
    return () => { cancelled = true; };
  }, [riderId, activeCount, pendingCount]);

  // Where the rider is: live position, else the home area, else any saved area.
  const center = useMemo(() => {
    if (row?.lat != null && row?.lng != null) return { lat: row.lat, lng: row.lng };
    const withCoords = areas.find(a => a.is_home && a.latitude != null) || areas.find(a => a.latitude != null);
    return withCoords ? { lat: withCoords.latitude as number, lng: withCoords.longitude as number } : null;
  }, [row?.lat, row?.lng, areas]);
  const centerKey = center ? `${center.lat.toFixed(2)},${center.lng.toFixed(2)}` : '';

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = async () => {
      const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } })();
      const { data, error } = await supabase.rpc('mbg_rider_demand_snapshot', {
        p_lat: center?.lat ?? null, p_lng: center?.lng ?? null, p_radius_km: 15, p_days: 14, p_tz: tz ?? 'Africa/Kampala',
      });
      if (cancelled) return;
      // Not installed yet (or not allowed) — fall back to the rider's own history.
      setSnapshot(error || !data ? null : parseSnapshot(data));
    };
    load();
    const t = setInterval(load, SNAPSHOT_REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, centerKey]);

  const home = areas.find(a => a.is_home && a.latitude != null);
  const kmFromHome = center && home ? haversineKm(center.lat, center.lng, home.latitude as number, home.longitude as number) : null;
  const ownHourly = useMemo(() => hourlyFromTimestamps(ownRides.map(r => r.requested_at)), [ownRides]);

  const rec = useMemo(
    () => mode
      ? recommendMode({ now: new Date(now), currentMode: mode, snapshot, ownHourly, ownPending: pendingCount, ownActive: activeCount, kmFromHome })
      : null,
    [mode, snapshot, ownHourly, pendingCount, activeCount, kmFromHome, now],
  );

  const hotspots = useMemo(
    () => (areasLoaded ? findUncoveredHotspots(snapshot ? snapshot.cells : cellsFromOwnRides(ownRides), areas) : []),
    [areasLoaded, snapshot, ownRides, areas],
  );
  // The card shows a place until the rider says "Later" ('card:' key); the
  // interrupting toast has its own schedule ('toast:' key) so showing it never
  // hides the card.
  const dueHotspots = useMemo(() => {
    const nudges = state().nudges;
    return hotspots.filter(h => (nudges[`card:${h.key}`] ?? 0) <= now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotspots, now, nudgeVersion, storeKey]);
  const toastHotspot = useMemo(() => {
    const nudges = state().nudges;
    return hotspots.find(h => h.level === 'hot' && (nudges[`toast:${h.key}`] ?? 0) <= now && (nudges[`card:${h.key}`] ?? 0) <= now);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hotspots, now, nudgeVersion, storeKey]);

  const setOnline = useCallback(async (next: boolean) => {
    if (!userId || !vehicleType || togglingOnline) return;
    setTogglingOnline(true);
    setRow(r => (r ? { ...r, isAvailable: next } : r));
    markOnline(next);
    const { error } = await supabase
      .from('mbg_riders')
      .update({ is_available: next, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('vehicle_type', vehicleType);
    setTogglingOnline(false);
    if (error) {
      setRow(r => (r ? { ...r, isAvailable: !next } : r));
      markOnline(!next);
      toast.error(error.message || 'Failed to update working status');
      return;
    }
    toast.success(next ? "You're online — customers can now request rides" : "You're offline — no new requests will come in");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, vehicleType, togglingOnline, storeKey]);

  const setMode = useCallback(async (next: WorkMode, source: 'manual' | 'suggestion' | 'auto') => {
    if (!userId || !vehicleType || busyRef.current) return false;
    busyRef.current = true;
    setSwitching(true);
    // Suggestion and auto changes are ours, not a rider's own choice — mark them
    // so the manual-override detector below leaves them alone.
    if (source !== 'manual') autoSetRef.current = next;
    try {
      const { error } = await supabase
        .from('mbg_riders')
        .update({ mode: next, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('vehicle_type', vehicleType);
      if (error) throw error;
      if (source === 'auto') patchState({ lastAutoAt: Date.now() });
      await onModeChanged();
      return true;
    } catch (e: any) {
      autoSetRef.current = null;
      toast.error(e?.message || 'Failed to change mode');
      return false;
    } finally {
      busyRef.current = false;
      setSwitching(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, vehicleType, onModeChanged, storeKey]);

  // A mode that changed and wasn't ours (the Mode tile, the Work Mode tab) is
  // the rider taking the wheel: leave Auto alone for a couple of hours.
  useEffect(() => {
    if (!mode) return;
    if (prevVehicleRef.current !== vehicleType) {
      prevVehicleRef.current = vehicleType;
      prevModeRef.current = mode;
      return;
    }
    if (prevModeRef.current !== null && prevModeRef.current !== mode) {
      if (autoSetRef.current === mode) autoSetRef.current = null;
      else patchState({ overrideUntil: Date.now() + MANUAL_OVERRIDE_MS });
    }
    prevModeRef.current = mode;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, vehicleType]);

  // Auto: act on a confident suggestion while online and between jobs.
  useEffect(() => {
    if (!auto || !mode || !rec || !row?.isAvailable || activeCount > 0 || busyRef.current) return;
    const s = state();
    if (!shouldAutoSwitch({ rec, currentMode: mode, now: Date.now(), lastAutoAt: s.lastAutoAt, overrideUntil: s.overrideUntil })) return;
    setMode(rec.mode, 'auto').then(ok => {
      if (ok) toast.success(`Smart mode switched you to ${MODE_META[rec.mode].label}`, { description: rec.reason });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, mode, rec, row?.isAvailable, activeCount]);

  const setAuto = (on: boolean) => {
    setAutoState(on);
    // Turning it on is a fresh instruction: clear any earlier manual hold.
    patchState({ auto: on, ...(on ? { overrideUntil: 0 } : {}) });
    toast.success(on ? 'Auto mode on — we will adjust your mode to demand' : 'Auto mode off');
  };

  const snoozeAt = useCallback((scope: 'card' | 'toast', h: Hotspot, ms: number) => {
    patchState({ nudges: { ...state().nudges, [`${scope}:${h.key}`]: Date.now() + ms } });
    setNudgeVersion(v => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey]);
  // "Later": hide this place from the card and the toast for a day.
  const snooze = useCallback((h: Hotspot) => {
    snoozeAt('card', h, 24 * 3600 * 1000);
    snoozeAt('toast', h, 24 * 3600 * 1000);
  }, [snoozeAt]);

  const addHotspot = useCallback(async (h: Hotspot) => {
    if (!userId || addingKey) return;
    setAddingKey(h.key);
    try {
      const address = (await reverseGeocode(h.lat, h.lng)) || h.label;
      const { error } = await supabase.from('mbg_rider_locations').insert({
        rider_user_id: userId, name: h.label, address, latitude: h.lat, longitude: h.lng, is_home: false,
      });
      if (error) throw error;
      toast.success(`${h.label} added to your areas`);
      await loadAreas();
    } catch (e: any) {
      toast.error(e?.message || 'Could not add that area');
    } finally {
      setAddingKey(null);
    }
  }, [userId, addingKey, loadAreas]);

  // "Keep notifying": every so often bring up the strongest uncovered place —
  // as a toast with an Add button, and as a device notification when the app
  // is in the background. Hot places repeat every 3 h until added, warm ones
  // stay a quiet card. Never while the rider is on a job.
  const addRef = useRef(addHotspot);
  addRef.current = addHotspot;
  useEffect(() => {
    if (!userId || activeCount > 0 || !toastHotspot) return;
    const hot = toastHotspot;
    snoozeAt('toast', hot, nudgeIntervalMs('hot'));
    const message = `${hot.customers} customers keep asking for ${hot.label}`;
    const detail = `${hot.requests} requests in 2 weeks — add it to your areas to get matched there first.`;
    toast(message, {
      description: detail,
      duration: 15000,
      icon: '🔥',
      action: { label: 'Add area', onClick: () => { addRef.current(hot); } },
      cancel: { label: 'Later', onClick: () => snooze(hot) },
    });
    if (typeof document !== 'undefined' && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      navigator.serviceWorker?.getRegistration().then(reg => reg?.showNotification(message, { body: detail, tag: `mbg-area-${hot.key}` })).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toastHotspot, activeCount, userId]);

  return {
    mode, rec, auto, setAuto, switching, setMode,
    rates: { vip: row?.vip ?? 10, discount: row?.discount ?? 10, ret: row?.ret ?? 30 },
    isOnline: !!row?.isAvailable,
    rowLoaded: row !== null,
    setOnline, togglingOnline, onlineSince,
    areas, areasLoaded,
    hotspots: dueHotspots, snooze, addHotspot, addingKey,
    hasLiveDemand: snapshot !== null,
    waiting: Math.max(pendingCount, snapshot?.pendingNearby ?? 0),
    ridersOnline: snapshot?.ridersOnline ?? null,
  };
}

export type RiderSmartAssist = ReturnType<typeof useRiderSmartAssist>;

// Full class names (not interpolated) so Tailwind keeps them.
const MODE_META: Record<WorkMode, { label: string; icon: LucideIcon; idle: string; active: string; badge: string }> = {
  normal:   { label: 'Normal',   icon: DollarSign, idle: 'bg-white text-slate-600 ring-slate-200',        active: 'bg-slate-800 text-white ring-slate-800',           badge: 'bg-slate-100 text-slate-700' },
  vip:      { label: 'VIP',      icon: Crown,      idle: 'bg-white text-purple-600 ring-purple-200',      active: 'bg-purple-600 text-white ring-purple-600',         badge: 'bg-purple-100 text-purple-700' },
  discount: { label: 'Discount', icon: Tag,        idle: 'bg-white text-orange-600 ring-orange-200',      active: 'bg-orange-500 text-white ring-orange-500',         badge: 'bg-orange-100 text-orange-700' },
  return:   { label: 'Return',   icon: Home,       idle: 'bg-white text-emerald-600 ring-emerald-200',    active: 'bg-emerald-600 text-white ring-emerald-600',       badge: 'bg-emerald-100 text-emerald-700' },
};
const MODE_ORDER: WorkMode[] = ['normal', 'vip', 'discount', 'return'];

function effectLabel(mode: WorkMode, rates: RiderSmartAssist['rates']): string {
  if (mode === 'vip') return `+${rates.vip}% fares`;
  if (mode === 'discount') return `−${rates.discount}% off`;
  if (mode === 'return') return `−${rates.ret}% off`;
  return 'Standard fares';
}

function formatOnlineFor(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

// The inline on/off: a full-width pill the rider slides (or taps). Online it glows
// green with a radar ripple round the knob and counts how long they've been out;
// offline it rests dark with an invitation to start.
function OnlineSwitch({ assist }: { assist: RiderSmartAssist }) {
  const { isOnline, setOnline, togglingOnline, onlineSince, mode } = assist;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!isOnline || !onlineSince) return;
    const t = setInterval(() => tick(n => n + 1), 30000);
    return () => clearInterval(t);
  }, [isOnline, onlineSince]);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOnline}
      aria-label="Working status"
      disabled={togglingOnline || !mode}
      onClick={() => setOnline(!isOnline)}
      className={`relative mt-3 flex h-[52px] w-full items-center overflow-hidden rounded-full p-1 text-left ring-1 ring-inset transition-colors duration-500 active:scale-[0.99] disabled:opacity-70 ${
        isOnline
          ? 'bg-gradient-to-r from-emerald-500 to-teal-400 ring-emerald-300/70 shadow-[0_8px_20px_-10px_rgba(16,185,129,0.8)]'
          : 'bg-gradient-to-r from-[#2a2118] to-[#3b2c1a] ring-[#c4a052]/40'
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-1 z-10 grid h-11 w-11 place-items-center rounded-full bg-[#fffdf7] shadow-md transition-[left] duration-500 ease-out ${
          isOnline ? 'left-[calc(100%-2.75rem)]' : 'left-1'
        }`}
      >
        {isOnline && <span className="absolute inset-0 animate-ping rounded-full bg-white/70" />}
        <Power size={18} className={`relative ${isOnline ? 'text-emerald-600' : 'text-slate-500'}`} />
      </span>
      <span className={`flex min-w-0 flex-1 flex-col leading-tight text-white transition-[padding] duration-500 ${isOnline ? 'pl-3 pr-14' : 'pl-14 pr-3'}`}>
        <span className="truncate font-classic-display text-base font-bold min-[360px]:text-lg">
          {togglingOnline ? '…' : isOnline ? "You're online" : "You're offline"}
        </span>
        <span className="truncate text-[11px] text-white/75 min-[360px]:text-xs">
          {isOnline
            ? onlineSince ? `Taking requests · online ${formatOnlineFor(Date.now() - onlineSince)}` : 'Customers can request you now'
            : 'Tap to go online and start earning'}
        </span>
      </span>
    </button>
  );
}

export function WorkModeCard({ assist, onOpenSettings }: { assist: RiderSmartAssist; onOpenSettings: () => void }) {
  const { mode, rec, auto, setAuto, switching, setMode, rates, isOnline, waiting, ridersOnline, hasLiveDemand } = assist;
  const showSuggestion = !!mode && !!rec && rec.mode !== mode && rec.confidence >= 0.5;
  const demandLine = hasLiveDemand
    ? `${waiting} waiting${ridersOnline != null ? ` · ${ridersOnline} rider${ridersOnline === 1 ? '' : 's'} online nearby` : ''}`
    : null;

  return (
    <section className="classic-card p-3.5 min-[360px]:p-4" aria-label="Work mode">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="classic-eyebrow !text-[9px] min-[360px]:!text-[10px]">Work mode</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="font-classic-display text-xl font-bold leading-none text-slate-900 min-[360px]:text-2xl">
              {mode ? MODE_META[mode].label : '…'}
            </p>
            {mode && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold min-[360px]:text-[11px] ${MODE_META[mode].badge}`}>
                {effectLabel(mode, rates)}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={auto}
          onClick={() => setAuto(!auto)}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-slate-50 py-1 pl-2.5 pr-1.5 text-[11px] font-semibold text-slate-600 ring-1 ring-inset ring-slate-200 transition-transform active:scale-95"
        >
          <Sparkles size={12} className={auto ? 'text-amber-500' : 'text-slate-400'} />
          Auto
          <span className={`relative h-4 w-7 rounded-full transition-colors ${auto ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className={`absolute left-0 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${auto ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </span>
        </button>
      </div>

      <OnlineSwitch assist={assist} />

      <div className={`mt-3 grid grid-cols-4 gap-1.5 transition-opacity min-[360px]:gap-2 ${isOnline ? '' : 'opacity-70'}`}>
        {MODE_ORDER.map(id => {
          const meta = MODE_META[id];
          const Icon = meta.icon;
          const selected = id === mode;
          return (
            <button
              key={id}
              type="button"
              disabled={switching || !mode}
              aria-pressed={selected}
              onClick={() => { if (!selected) setMode(id, 'manual').then(ok => ok && toast.success(`Switched to ${meta.label} mode`)); }}
              className={`relative flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-semibold ring-1 ring-inset transition-all active:scale-95 disabled:opacity-60 min-[360px]:text-[11px] ${selected ? meta.active : meta.idle}`}
            >
              <Icon size={15} />
              {meta.label}
              {rec && !selected && rec.mode === id && rec.confidence >= 0.5 && (
                <span aria-label="Suggested" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-amber-400 ring-2 ring-white" />
              )}
            </button>
          );
        })}
      </div>

      {showSuggestion && rec ? (
        <div className="mt-3 flex items-center gap-2.5 rounded-xl bg-amber-50 p-2.5 ring-1 ring-inset ring-amber-200">
          <span className="text-base" aria-hidden>💡</span>
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-amber-900 min-[360px]:text-xs">
            <strong>{MODE_META[rec.mode].label} fits right now.</strong> {rec.reason}
          </p>
          <button
            type="button"
            disabled={switching}
            onClick={() => setMode(rec.mode, 'suggestion').then(ok => ok && toast.success(`Switched to ${MODE_META[rec.mode].label} mode`))}
            className="flex-shrink-0 rounded-full bg-amber-500 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition-transform active:scale-95 disabled:opacity-60"
          >
            Switch
          </button>
        </div>
      ) : (
        <p className="mt-3 text-[11px] leading-snug text-slate-500 min-[360px]:text-xs">
          {auto
            ? <>Auto is on — {rec?.reason ?? 'watching demand.'}{!isOnline && ' It acts once you are online.'}</>
            : <>{rec && mode && rec.mode === mode ? `${rec.reason} ` : ''}Turn on <strong>Auto</strong> and we will move you between modes as demand changes.</>}
        </p>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2 text-[10px] text-slate-400 min-[360px]:text-[11px]">
        <span className="truncate">{demandLine ?? 'Suggestions use your own ride history'}</span>
        <button type="button" onClick={onOpenSettings} className="flex flex-shrink-0 items-center gap-0.5 font-semibold text-orange-600">
          Set rates <ChevronRight size={12} />
        </button>
      </div>
    </section>
  );
}

export function MyAreasCard({ assist, onOpenAreas }: { assist: RiderSmartAssist; onOpenAreas: () => void }) {
  const { areas, areasLoaded, hotspots, addHotspot, addingKey, snooze } = assist;
  const top = hotspots[0];
  const shown = areas.slice(0, 4);

  return (
    <section className="classic-card p-3.5 min-[360px]:p-4" aria-label="My areas">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="classic-eyebrow !text-[9px] min-[360px]:!text-[10px]">My areas</p>
          <p className="mt-1 font-classic-display text-xl font-bold leading-none text-slate-900 min-[360px]:text-2xl">
            {areasLoaded ? areas.length : '…'}
            <span className="ml-1.5 text-xs font-medium text-slate-500">{areas.length === 1 ? 'place' : 'places'} you know</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenAreas}
          className="flex flex-shrink-0 items-center gap-1 rounded-full bg-sky-50 px-3 py-1.5 text-[11px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-100 transition-transform active:scale-95"
        >
          <Plus size={12} /> Manage
        </button>
      </div>

      {areasLoaded && areas.length === 0 ? (
        <p className="mt-3 text-[11px] leading-snug text-slate-500 min-[360px]:text-xs">
          Add the places you know well — customers going there are matched to you first.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {shown.map(a => (
            <span key={a.id ?? a.name} className="inline-flex max-w-full items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
              {a.is_home ? <Home size={11} className="flex-shrink-0 text-emerald-600" /> : <MapPin size={11} className="flex-shrink-0 text-sky-600" />}
              <span className="truncate">{placeName(a.name)}</span>
            </span>
          ))}
          {areas.length > shown.length && (
            <button type="button" onClick={onOpenAreas} className="rounded-full px-2 py-1 text-[11px] font-semibold text-sky-700">
              +{areas.length - shown.length} more
            </button>
          )}
        </div>
      )}

      {top && (
        <div className="mt-3 rounded-xl bg-gradient-to-br from-orange-50 to-amber-50 p-3 ring-1 ring-inset ring-orange-200">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 grid h-7 w-7 flex-shrink-0 place-items-center rounded-full bg-orange-500 text-white">
              <Flame size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold leading-snug text-slate-800 min-[360px]:text-[13px]">
                {top.customers} customers keep asking for <span className="text-orange-700">{top.label}</span>
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                {top.requests} requests in 2 weeks and you don't cover it yet.
              </p>
            </div>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              disabled={addingKey === top.key}
              onClick={() => addHotspot(top)}
              className="flex-1 rounded-full bg-gradient-to-r from-orange-500 to-amber-400 py-2 text-xs font-bold text-white shadow-sm shadow-orange-500/30 transition-transform active:scale-95 disabled:opacity-60"
            >
              {addingKey === top.key ? 'Adding…' : `Add ${top.label}`}
            </button>
            <button
              type="button"
              onClick={() => snooze(top)}
              className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-500 ring-1 ring-inset ring-slate-200 transition-transform active:scale-95"
            >
              Later
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
