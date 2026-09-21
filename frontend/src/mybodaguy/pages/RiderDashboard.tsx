import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Bike, Settings, Map as MapIcon, ShoppingBag, User, Package, Bell, Car, Truck, Gift,
  Home, LayoutGrid, X, Star, ArrowRight, type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import RiderLocationManager from '../components/RiderLocationManager';
import RiderModeSelector from '../components/RiderModeSelector';
import SupermarketPartnership from '../components/SupermarketPartnership';
import ProfileModal from '../components/ProfileModal';
import RiderICANEarnings from '../components/RiderICANEarnings';
import IcanCoinCard from '../components/IcanCoinCard';
import RewardsPointsCard from '../components/RewardsPointsCard';
import RiderEarningsCard, { buildWeekEarnings, type DayEarning } from '../components/RiderEarningsCard';
import { SectionHeading, greetingForHour } from '../components/ClassicBits';
import RewardsHub from '../components/RewardsHub';
import SupermarketDeliveryPool from '../components/SupermarketDeliveryPool';
import RiderRideRequests from '../components/RiderRideRequests';
import RiderEscortRequests from '../components/RiderEscortRequests';
import { supabase } from '../services/supabaseClient';
import { computeOrderInsights, shortenLocation, type OrderInsights } from '../utils/orderInsights';
import InsightSlider, { type InsightSlide } from '../components/InsightSlider';

interface RiderDashboardProps {
  user: any;
  onSignOut: () => void;
  // Switches UnifiedDashboard's activeRole to 'ican-wallet' (this app has no
  // router, so the wallet is a role tab, not a URL). Without it the ICAN Coins
  // card on Overview still shows the balance but isn't tappable.
  onGoToWallet?: () => void;
}

type TabType = 'overview' | 'requests' | 'mode' | 'locations' | 'partnerships' | 'deliveries' | 'rewards';

// emoji drives the desktop tab strip; icon drives the phone section bar and
// menu sheet. 'requests' is deliberately not in NAV_TABS — it stays a card on
// Overview rather than permanent tab space — but still needs a label/icon for
// the phone section bar while it's the active view.
const TAB_META: Record<TabType, { label: string; emoji: string; icon: LucideIcon }> = {
  overview:     { label: 'Overview',   emoji: '🏠', icon: Home },
  requests:     { label: 'Requests',   emoji: '🔔', icon: Bell },
  mode:         { label: 'Work Mode',  emoji: '⚙️', icon: Settings },
  locations:    { label: 'Areas',      emoji: '📍', icon: MapIcon },
  partnerships: { label: 'Markets',    emoji: '🛒', icon: ShoppingBag },
  deliveries:   { label: 'Deliveries', emoji: '📦', icon: Package },
  rewards:      { label: 'Rewards',    emoji: '🎁', icon: Gift },
};
const NAV_TABS: TabType[] = ['overview', 'mode', 'locations', 'partnerships', 'deliveries', 'rewards'];

// True while this user has an active (accepted/in_progress) ride that is
// the dispatched vehicle for a journey's sea_leg — i.e. mid-voyage, departed
// but not yet docked. There's no phone signal to report out on open ocean
// anyway, so useLiveLocationPing below skips pinging entirely during this
// window instead of showing a stale/misleading last-known position.
// Resolves back to false the moment mbg_complete_ride marks that ride
// completed (docked), with no new status/column needed for it.
async function isOnActiveSeaLeg(userId: string): Promise<boolean> {
  const { data: riderRows } = await supabase.from('mbg_riders').select('id').eq('user_id', userId);
  const riderIds = (riderRows || []).map((r: any) => r.id);
  if (riderIds.length === 0) return false;

  const { data: activeRides } = await supabase
    .from('mbg_rides')
    .select('id')
    .in('rider_id', riderIds)
    .in('status', ['accepted', 'in_progress'])
    .limit(5);
  const activeRideIds = (activeRides || []).map((r: any) => r.id);
  if (activeRideIds.length === 0) return false;

  const { data: seaLegs } = await supabase
    .from('mbg_journey_legs')
    .select('id')
    .in('ride_id', activeRideIds)
    .eq('leg_type', 'sea_leg')
    .limit(1);
  return (seaLegs || []).length > 0;
}

// Keeps mbg_riders.current_lat/current_lng fresh so the real matching engine
// (mbg_find_available_riders) can rank this rider by actual live distance
// instead of only their static home-marked area.
function useLiveLocationPing(userId: string | undefined) {
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!userId || !navigator.geolocation) return;

    const ping = async () => {
      const now = Date.now();
      if (now - lastSentRef.current < 45000) return; // throttle to ~45s
      lastSentRef.current = now;

      if (await isOnActiveSeaLeg(userId)) return;

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          supabase
            .from('mbg_riders')
            .update({
              current_lat: pos.coords.latitude,
              current_lng: pos.coords.longitude,
              location_updated_at: new Date().toISOString(),
            })
            .eq('user_id', userId)
            .then(() => {});
        },
        () => {},
        { enableHighAccuracy: true, timeout: 8000 }
      );
    };

    ping();
    const interval = setInterval(ping, 60000);
    return () => clearInterval(interval);
  }, [userId]);
}

// On/off slider for the rider's working time — toggles mbg_riders.is_available,
// the same flag the matching engine (mbg_find_available_riders) filters on.
// Scoped by vehicleType, not just userId — a person can hold more than one
// mbg_riders row now (multi-vehicle), and only the ACTIVE one should ever
// flip online; the inactive one(s) must stay offline regardless (enforced
// server-side too, by mbg_switch_active_vehicle).
function WorkingTimeToggle({ userId, vehicleType, children }: { userId: string; vehicleType: string | null; children?: React.ReactNode }) {
  const [isAvailable, setIsAvailable] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId || !vehicleType) return;
    supabase
      .from('mbg_riders')
      .select('is_available')
      .eq('user_id', userId)
      .eq('vehicle_type', vehicleType)
      .maybeSingle()
      .then(({ data }) => {
        setIsAvailable(!!data?.is_available);
        setLoaded(true);
      });
  }, [userId, vehicleType]);

  const toggle = async () => {
    if (!vehicleType) return;
    const next = !isAvailable;
    setIsAvailable(next);
    setSaving(true);
    const { error } = await supabase
      .from('mbg_riders')
      .update({ is_available: next, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('vehicle_type', vehicleType);
    setSaving(false);
    if (error) {
      setIsAvailable(!next);
      toast.error(error.message || 'Failed to update working status');
    } else {
      toast.success(next ? "You're online — customers can now request rides" : "You're offline — no new requests will come in");
    }
  };

  return (
    <div className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-[#231b12] via-[#2f2415] to-[#4a3418] p-4 text-white shadow-[0_18px_34px_-16px_rgba(0,0,0,0.65)] ring-1 ring-inset ring-[#c4a052]/40 min-[360px]:p-5">
      <span aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full border border-[#c4a052]/25" />
      <span aria-hidden className="pointer-events-none absolute -right-5 -top-5 h-28 w-28 rounded-full border border-[#c4a052]/20" />
      <span
        aria-hidden
        className={`pointer-events-none absolute -bottom-14 -left-10 h-40 w-40 rounded-full blur-2xl transition-colors duration-700 ${
          isAvailable ? 'bg-emerald-500/30' : 'bg-orange-500/20'
        }`}
      />

      <div className="relative flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#e6c980]">
            <span className={`h-1.5 w-1.5 rounded-full ${isAvailable ? 'animate-pulse bg-emerald-400' : 'bg-white/40'}`} />
            Working time
          </p>
          <p className="mt-1 font-classic-display text-[26px] font-bold leading-tight">
            {isAvailable ? "You're Online" : "You're Offline"}
          </p>
          <p className="mt-1 text-[13px] text-white/70">
            {isAvailable ? 'Customers can request you right now' : 'Switch on to start receiving requests'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={isAvailable}
          aria-label="Working status"
          onClick={toggle}
          disabled={!loaded || saving}
          className={`relative h-10 w-[68px] flex-shrink-0 rounded-full ring-1 ring-inset transition-colors active:scale-95 disabled:opacity-60 ${
            isAvailable ? 'bg-emerald-500 ring-emerald-300/60' : 'bg-white/15 ring-[#c4a052]/50'
          }`}
        >
          <span
            className={`absolute left-1 top-1 h-8 w-8 rounded-full bg-[#fffdf7] shadow-md transition-transform ${
              isAvailable ? 'translate-x-7' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {children && <div className="relative mt-4 border-t border-[#c4a052]/25 pt-4">{children}</div>}
    </div>
  );
}

// Compact "UGX 45k" style formatting for the greeting's insight slides.
function formatEarnings(amount: number): string {
  if (amount >= 1_000_000) return `UGX ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `UGX ${Math.round(amount / 1000)}k`;
  return `UGX ${Math.round(amount)}`;
}

// Registered role is only visible via mbg_riders.vehicle_type/operator_type
// (approved via "Become a Driver" -> dev panel review) — nothing in this
// dashboard surfaced it before, so a car/van/truck operator saw the exact
// same boda-branded screen as a motorcycle rider with no confirmation of
// which role they actually hold.
const VEHICLE_TYPE_META: Record<string, { label: string; icon: typeof Bike; use: string }> = {
  motorcycle: { label: 'Motorcycle', icon: Bike, use: 'Boda passenger rides' },
  bicycle:    { label: 'Bicycle',    icon: Bike, use: 'Short-distance passenger rides' },
  tuktuk:     { label: 'Tuktuk',     icon: Car,  use: 'Passenger rides for small groups' },
  car:        { label: 'Car',        icon: Car,  use: 'Passenger rides' },
  van:        { label: 'Van',        icon: Truck, use: 'Goods delivery for supermarkera/supplier orders' },
  truck:      { label: 'Truck',      icon: Truck, use: 'Larger goods delivery and cross-border cargo' },
};

interface RiderStats {
  ridesDone: number;
  rating: number;
  mode: string;
  vehicleType: string | null;
  operatorType: string | null;
  escortHasOwnTransport: boolean;
}

interface RiderVehicle {
  vehicleType: string;
  operatorType: string | null;
}

// Pulls real numbers for the overview cards straight from Supabase. (Earnings
// come from useRiderActivity's 7-day query instead, so today's headline figure
// and the chart beneath it can never disagree.)
// A person can hold more than one mbg_riders row now (multi-vehicle — see
// ADD_MULTI_VEHICLE_SUPPORT.sql), so this fetches ALL of them plus
// mbg_users.active_vehicle_type to know which one is currently live,
// instead of assuming exactly one row per user.
function useRiderStats(userId: string | undefined) {
  const [stats, setStats] = useState<RiderStats | null>(null);
  const [allVehicles, setAllVehicles] = useState<RiderVehicle[]>([]);
  const [activeVehicleType, setActiveVehicleType] = useState<string | null>(null);
  const [activeRiderId, setActiveRiderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!userId) return;
    setLoading(true);

    const [{ data: riderRows }, { data: mu }] = await Promise.all([
      supabase.from('mbg_riders').select('id, rating, completed_rides, mode, vehicle_type, operator_type, escort_has_own_transport').eq('user_id', userId),
      supabase.from('mbg_users').select('active_vehicle_type').eq('id', userId).maybeSingle(),
    ]);

    const rows = riderRows || [];
    setAllVehicles(rows.map((r: any) => ({ vehicleType: r.vehicle_type, operatorType: r.operator_type })));

    if (rows.length === 0) {
      setActiveVehicleType(null);
      setActiveRiderId(null);
      setStats({ ridesDone: 0, rating: 0, mode: 'normal', vehicleType: null, operatorType: null, escortHasOwnTransport: false });
      setLoading(false);
      return;
    }

    // Prefer mbg_users.active_vehicle_type; fall back to the only vehicle
    // they have (covers accounts from before this column was backfilled).
    const active = rows.find((r: any) => r.vehicle_type === mu?.active_vehicle_type) || rows[0];
    setActiveVehicleType(active.vehicle_type);
    setActiveRiderId(active.id);

    setStats({
      ridesDone: active.completed_rides || 0,
      rating: Number(active.rating) || 0,
      mode: active.mode || 'normal',
      vehicleType: active.vehicle_type || null,
      operatorType: active.operator_type || null,
      escortHasOwnTransport: !!active.escort_has_own_transport,
    });
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (!userId) return;

    // Without this, a ride completed elsewhere (e.g. the Requests tab)
    // leaves these Overview cards showing whatever was true at page load —
    // completed_rides/rating/mode only change via an UPDATE on this user's
    // mbg_riders row(s), so listening for that and re-querying covers
    // rides/rating/mode together in one place.
    const channel = supabase
      .channel(`mbg_rider_stats_${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'mbg_riders', filter: `user_id=eq.${userId}` },
        () => load()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { stats, loading, allVehicles, activeVehicleType, activeRiderId, reload: load };
}

// Everything the Overview shows about this rider's own work, kept live via
// realtime on their mbg_rides rows: demand pattern (total jobs, the hour and
// place requests come from most), the last 7 days of earnings, and how many
// requests are waiting / jobs in progress right now. Escort operators also
// receive add-on requests through mbg_ride_escort_requests, so those are
// counted too.
interface RiderActivity {
  totalCount: number | null;
  insights: OrderInsights | null;
  week: DayEarning[] | null;
  pendingCount: number;
  activeCount: number;
}

const NO_ACTIVITY: RiderActivity = { totalCount: null, insights: null, week: null, pendingCount: 0, activeCount: 0 };

function useRiderActivity(riderId: string | null, isEscort: boolean): RiderActivity {
  const [activity, setActivity] = useState<RiderActivity>(NO_ACTIVITY);

  useEffect(() => {
    if (!riderId) { setActivity(NO_ACTIVITY); return; }
    let cancelled = false;

    const load = async () => {
      const weekStart = new Date();
      weekStart.setHours(0, 0, 0, 0);
      weekStart.setDate(weekStart.getDate() - 6);

      const count = (status: string | string[]) => {
        const q = supabase.from('mbg_rides').select('id', { count: 'exact', head: true }).eq('rider_id', riderId);
        return Array.isArray(status) ? q.in('status', status) : q.eq('status', status);
      };
      const escortCount = (status: string) =>
        isEscort
          ? supabase.from('mbg_ride_escort_requests').select('id', { count: 'exact', head: true }).eq('escort_rider_id', riderId).eq('status', status)
          : Promise.resolve({ count: 0 });

      const [recent, total, weekRows, pending, active, escortPending, escortActive] = await Promise.all([
        supabase
          .from('mbg_rides')
          .select('created_at, pickup_location')
          .eq('rider_id', riderId)
          .order('created_at', { ascending: false })
          .limit(20),
        supabase.from('mbg_rides').select('id', { count: 'exact', head: true }).eq('rider_id', riderId),
        supabase
          .from('mbg_rides')
          .select('fare, rider_earning, completed_at')
          .eq('rider_id', riderId)
          .eq('status', 'completed')
          .gte('completed_at', weekStart.toISOString()),
        count('pending'),
        count(['accepted', 'in_progress']),
        escortCount('pending'),
        escortCount('accepted'),
      ]);
      if (cancelled) return;

      setActivity({
        totalCount: total.count ?? 0,
        insights: computeOrderInsights(recent.data || []),
        week: buildWeekEarnings(weekRows.data || []),
        pendingCount: (pending.count ?? 0) + (escortPending.count ?? 0),
        activeCount: (active.count ?? 0) + (escortActive.count ?? 0),
      });
    };
    load();

    let channel = supabase
      .channel(`mbg_rider_activity_${riderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mbg_rides', filter: `rider_id=eq.${riderId}` }, () => load());
    if (isEscort) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mbg_ride_escort_requests', filter: `escort_rider_id=eq.${riderId}` },
        () => load()
      );
    }
    channel.subscribe();

    // An Overview left open past midnight would otherwise keep showing
    // yesterday as "today" until the next ride event — refresh once the day
    // rolls over.
    let midnightTimer: ReturnType<typeof setTimeout>;
    const scheduleMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
      midnightTimer = setTimeout(() => { load(); scheduleMidnight(); }, nextMidnight - now.getTime() + 1000);
    };
    scheduleMidnight();

    return () => {
      cancelled = true;
      clearTimeout(midnightTimer);
      supabase.removeChannel(channel);
    };
  }, [riderId, isEscort]);

  return activity;
}

// Five small stars, filled to the nearest whole rating.
function RatingStars({ rating }: { rating: number }) {
  const filled = Math.round(rating);
  return (
    <span className="flex gap-0.5" aria-hidden>
      {[0, 1, 2, 3, 4].map(i => (
        <Star key={i} size={11} className={i < filled ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600'} />
      ))}
    </span>
  );
}

export default function RiderDashboard({ user, onGoToWallet }: RiderDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const { stats: riderStats, loading: riderStatsLoading, allVehicles, activeVehicleType, activeRiderId, reload: reloadRiderStats } = useRiderStats(user?.id);
  const { totalCount: totalJobsCount, insights: demandInsights, week, pendingCount, activeCount } =
    useRiderActivity(activeRiderId, riderStats?.operatorType === 'escort');
  const [switchingVehicle, setSwitchingVehicle] = useState(false);
  const [riderName, setRiderName] = useState('You');

  useLiveLocationPing(user?.id);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('mbg_users')
      .select('email, mbg_user_profiles(full_name)')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        const name = (data as any)?.mbg_user_profiles?.[0]?.full_name || data?.email?.split('@')[0] || 'You';
        setRiderName(name);
      });
  }, [user?.id]);

  // The phone menu is a bottom sheet: Escape closes it, and the page behind
  // it stops scrolling while it's up (tapping the scrim closes it too).
  useEffect(() => {
    if (!showMobileMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowMobileMenu(false); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [showMobileMenu]);

  // Each stat gets its own slide in the greeting's carousel — only real, live
  // data ever shows up here (a stat is simply omitted until it has one),
  // mirroring the same slider on the Customer Overview greeting.
  const insightSlides = useMemo<InsightSlide[]>(() => {
    const slides: InsightSlide[] = [];
    const today = week?.[6];
    const yesterday = week?.[5];
    if (today && yesterday && today.amount > 0 && yesterday.amount > 0) {
      const pct = Math.round((today.amount / yesterday.amount) * 100);
      slides.push(pct >= 100
        ? {
            key: 'trend', emoji: '📈', tint: 'bg-emerald-50 text-emerald-700',
            content: <>Today is <strong>{pct - 100}% ahead</strong> of yesterday</>,
          }
        : {
            key: 'trend', emoji: '🎯', tint: 'bg-emerald-50 text-emerald-700',
            content: <>You're at <strong>{pct}%</strong> of yesterday's earnings</>,
          });
    }
    const best = (week || []).reduce<DayEarning | null>((b, d) => (d.amount > 0 && (!b || d.amount > b.amount) ? d : b), null);
    if (best) {
      slides.push({
        key: 'best', emoji: '🏆', tint: 'bg-amber-50 text-amber-700',
        content: <>Best day this week: <strong>{best.date.toLocaleDateString(undefined, { weekday: 'long' })}</strong> — {formatEarnings(best.amount)}</>,
      });
    }
    if (totalJobsCount !== null && totalJobsCount > 0) {
      slides.push({
        key: 'jobs', emoji: '🏍️', tint: 'bg-orange-50 text-orange-700',
        content: <><strong>{totalJobsCount}</strong> jobs total</>,
      });
    }
    if (demandInsights?.peakHourLabel) {
      slides.push({
        key: 'peak', emoji: '⏰', tint: 'bg-blue-50 text-blue-700',
        content: <>Busiest <strong>{demandInsights.peakHourLabel}</strong></>,
      });
    }
    if (demandInsights?.topLocation) {
      slides.push({
        key: 'location', emoji: '📍', tint: 'bg-violet-50 text-violet-700',
        content: <>Mostly from <strong>{shortenLocation(demandInsights.topLocation)}</strong></>,
      });
    }
    return slides;
  }, [week, totalJobsCount, demandInsights]);

  const MODE_CYCLE = ['normal', 'vip', 'discount', 'return'] as const;
  const [cyclingMode, setCyclingMode] = useState(false);

  const cycleMode = async () => {
    if (cyclingMode || !activeVehicleType || !user?.id) return;
    const current = riderStats?.mode || 'normal';
    const nextMode = MODE_CYCLE[(MODE_CYCLE.indexOf(current as any) + 1) % MODE_CYCLE.length];
    setCyclingMode(true);
    try {
      const { error } = await supabase
        .from('mbg_riders')
        .update({ mode: nextMode, updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('vehicle_type', activeVehicleType);
      if (error) throw error;
      toast.success(`Switched to ${nextMode.replace(/^\w/, c => c.toUpperCase())} mode`);
      await reloadRiderStats();
    } catch (e: any) {
      toast.error(e.message || 'Failed to change mode');
    } finally {
      setCyclingMode(false);
    }
  };

  const switchVehicle = async (vehicleType: string) => {
    if (vehicleType === activeVehicleType || switchingVehicle) return;
    setSwitchingVehicle(true);
    try {
      const { data, error } = await supabase.rpc('mbg_switch_active_vehicle', { p_vehicle_type: vehicleType });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not switch vehicle');
      toast.success(`Switched to ${VEHICLE_TYPE_META[vehicleType]?.label || vehicleType} mode`);
      await reloadRiderStats();
    } catch (e: any) {
      toast.error(e.message || 'Failed to switch vehicle');
    } finally {
      setSwitchingVehicle(false);
    }
  };

  const switchTab = (id: TabType) => { setActiveTab(id); setShowMobileMenu(false); };

  const activeTabMeta = TAB_META[activeTab];
  const ActiveTabIcon = activeTabMeta.icon;
  const greeting = greetingForHour(new Date().getHours());
  const isEscort = riderStats?.operatorType === 'escort';
  const rating = riderStats?.rating ?? 0;
  // The week only loads once there's a vehicle row to query by; an account
  // with none should read as an empty week, not sit on "…" forever.
  const weekForCard = week ?? (riderStatsLoading || activeRiderId ? null : buildWeekEarnings([]));

  // Requests card copy follows what's actually happening right now.
  const requestsTitle = pendingCount > 0
    ? `${pendingCount} new request${pendingCount === 1 ? '' : 's'} waiting`
    : activeCount > 0
      ? 'Job in progress'
      : isEscort ? 'Escort Requests' : 'Ride Requests';
  const requestsCaption = pendingCount > 0
    ? 'Tap to review and accept'
    : activeCount > 0
      ? 'Tap to continue your current job'
      : 'Accept real requests near you';

  return (
    <div className="min-h-screen classic-page">
      {/* Content without brand header - that lives in UnifiedDashboard. This
          bar mirrors the customer dashboard's embedded navigation, sticking
          just below it. */}
      <header className="sticky top-12 z-40 shadow-md xs:top-14 sm:top-16">
        {/* Desktop / tablet tab strip */}
        <div className="hidden border-b border-[#c4a052]/25 bg-white dark:border-slate-700 sm:block">
          <div className="container mx-auto px-2">
            <nav className="scrollbar-hide flex gap-0.5 overflow-x-auto py-1">
              {NAV_TABS.map(id => (
                <button
                  key={id}
                  onClick={() => switchTab(id)}
                  className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                    activeTab === id
                      ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-orange-50 hover:text-orange-600'
                  }`}
                >
                  <span>{TAB_META[id].emoji}</span>{TAB_META[id].label}
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Phone section bar — current section in serif + the one menu
            trigger (opens the bottom sheet at the end of this component). */}
        <div className="border-b border-[#c4a052]/25 bg-white dark:border-slate-700 sm:hidden">
          <div className="flex h-12 items-center justify-between gap-3 px-4">
            <div className="flex min-w-0 items-center gap-2">
              <ActiveTabIcon size={17} className="flex-shrink-0 text-orange-500" />
              <h1 className="truncate font-classic-display text-[18px] font-semibold leading-none text-slate-800">
                {activeTabMeta.label}
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setShowMobileMenu(true)}
              aria-label="Open menu"
              aria-expanded={showMobileMenu}
              className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full border border-[#c4a052]/40 bg-[#faf8f3] px-3.5 text-xs font-semibold text-slate-700 shadow-sm transition-transform active:scale-95 dark:border-slate-600 dark:bg-slate-800"
            >
              <LayoutGrid size={14} className="text-orange-500" /> Menu
            </button>
          </div>
        </div>
      </header>

      {/* Generous bottom padding so the floating chat button never sits on
          top of the last card when scrolled to the end. */}
      <div className="container mx-auto px-4 pb-28 pt-5">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Greeting — live insights from this rider's own work: how today
                compares with yesterday, the best day of the week, total jobs,
                the hour requests come in most and where from. */}
            <div>
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 font-classic-display leading-tight">
                  <span className="block text-[18px] font-medium text-slate-500">{greeting},</span>
                  <span className="block break-words text-[30px] font-bold tracking-tight text-slate-900">{riderName}</span>
                </h2>
                {insightSlides.length > 0 && (
                  <span className="mt-1.5 flex flex-shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 ring-1 ring-inset ring-emerald-100">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> Live
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-500">Here's how your day is going.</p>
              <div className="landing-classic-divider mt-4" />
              {insightSlides.length > 0 && (
                <div className="mt-3">
                  <InsightSlider slides={insightSlides} />
                </div>
              )}
            </div>

            {/* Working time — the one switch that matters — with the vehicle
                this account was approved for (or a switcher when they hold
                more than one; see ADD_MULTI_VEHICLE_SUPPORT.sql) tucked
                underneath. */}
            <WorkingTimeToggle userId={user.id} vehicleType={activeVehicleType}>
              {riderStats?.vehicleType && (() => {
                const meta = VEHICLE_TYPE_META[riderStats.vehicleType] || { label: riderStats.vehicleType, icon: Bike, use: '' };
                const Icon = meta.icon;
                const detail = `${meta.use}${riderStats.operatorType === 'cargo' ? ' · Cargo operator' : ''}`;

                if (allVehicles.length <= 1) {
                  return (
                    <div className="flex items-center gap-3">
                      <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-white/10 text-[#e6c980] ring-1 ring-[#c4a052]/50">
                        <Icon size={18} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">Driving as {meta.label}</p>
                        <p className="text-xs text-white/60">{detail}</p>
                      </div>
                    </div>
                  );
                }

                return (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#e6c980]">Driving as</p>
                    <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${allVehicles.length}, minmax(0, 1fr))` }}>
                      {allVehicles.map((v) => {
                        const vMeta = VEHICLE_TYPE_META[v.vehicleType] || { label: v.vehicleType, icon: Bike, use: '' };
                        const VIcon = vMeta.icon;
                        const isActive = v.vehicleType === activeVehicleType;
                        return (
                          <button
                            key={v.vehicleType}
                            type="button"
                            onClick={() => switchVehicle(v.vehicleType)}
                            disabled={switchingVehicle}
                            aria-pressed={isActive}
                            className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50 ${
                              isActive
                                ? 'bg-gradient-to-r from-orange-500 to-amber-400 text-white shadow-md shadow-orange-950/30'
                                : 'bg-white/10 text-white/70 ring-1 ring-inset ring-white/15'
                            }`}
                          >
                            <VIcon size={14} /> {vMeta.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-xs text-white/60">{detail}</p>
                  </div>
                );
              })()}
            </WorkingTimeToggle>

            {/* Requests — was its own nav tab; lives here as a card so it
                doesn't take permanent tab space but stays one tap away. The
                copy and the badge follow what's actually waiting right now. */}
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className={`classic-card flex w-full items-center gap-4 p-4 text-left transition-all hover:border-orange-300 active:scale-[0.99] ${
                pendingCount > 0 ? '!border-orange-400 ring-2 ring-orange-200/70' : ''
              }`}
            >
              <span className="relative grid h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-orange-50 ring-1 ring-inset ring-orange-100">
                <Bell size={21} className="text-orange-500" />
                {pendingCount > 0 && (
                  <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-slate-800">
                    {pendingCount}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-classic-display text-lg font-semibold leading-tight text-slate-800">{requestsTitle}</span>
                <span className="mt-0.5 block text-xs text-slate-500">{requestsCaption}</span>
              </span>
              <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-500 to-amber-400 text-white shadow-md shadow-orange-500/30">
                <ArrowRight size={15} />
              </span>
            </button>

            {/* Earnings — today as the headline, the week as the shape of it */}
            <RiderEarningsCard week={weekForCard} loading={weekForCard === null} />

            {/* Standing — rides done, rating, and the work mode (tap to cycle) */}
            <div className="grid grid-cols-3 gap-3">
              <div className="classic-card p-3.5">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-sky-50 text-sky-600 ring-1 ring-inset ring-black/5">
                  <Bike size={15} />
                </span>
                <p className="classic-eyebrow mt-2.5 !tracking-[0.14em]">Rides done</p>
                <p className="mt-1 font-classic-display text-[22px] font-bold leading-none tabular-nums text-slate-900">
                  {riderStatsLoading ? '…' : (riderStats?.ridesDone ?? 0).toLocaleString()}
                </p>
              </div>
              <div className="classic-card p-3.5">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-inset ring-black/5">
                  <Star size={15} />
                </span>
                <p className="classic-eyebrow mt-2.5 !tracking-[0.14em]">Rating</p>
                <p className="mt-1 font-classic-display text-[22px] font-bold leading-none tabular-nums text-slate-900">
                  {riderStatsLoading ? '…' : rating > 0 ? rating.toFixed(1) : '—'}
                </p>
                <div className="mt-1.5">
                  {rating > 0 ? <RatingStars rating={rating} /> : <span className="text-[10px] text-slate-400">No ratings yet</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={cycleMode}
                disabled={cyclingMode || !activeVehicleType}
                className="classic-card p-3.5 text-left transition-all hover:border-orange-300 active:scale-[0.97] disabled:opacity-60"
              >
                <span className="grid h-8 w-8 place-items-center rounded-full bg-violet-50 text-violet-600 ring-1 ring-inset ring-black/5">
                  <Settings size={15} />
                </span>
                <p className="classic-eyebrow mt-2.5 !tracking-[0.14em]">Mode</p>
                <p className="mt-1 truncate font-classic-display text-[19px] font-bold leading-none text-slate-900">
                  {riderStatsLoading || cyclingMode ? '…' : (riderStats?.mode || 'normal').replace(/^\w/, c => c.toUpperCase())}
                </p>
                <p className="mt-1.5 text-[10px] text-slate-400">Tap to change</p>
              </button>
            </div>

            {/* Wallet + Rewards — both currencies at a glance, one tap to either */}
            <div className="grid grid-cols-2 gap-3">
              <IcanCoinCard variant="premium" userId={user?.id} onGoToWallet={onGoToWallet} />
              <RewardsPointsCard variant="premium" userId={user?.id} onOpen={() => setActiveTab('rewards')} />
            </div>

            {/* ICAN Wallet Earnings */}
            <RiderICANEarnings user={user} />

            {/* Quick actions */}
            <div className="space-y-3">
              <SectionHeading>Quick actions</SectionHeading>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {([
                  { label: 'Work Mode',  desc: 'VIP, Normal, Discount or Return', icon: Settings,    tile: 'bg-violet-50 text-violet-600',   tab: 'mode' },
                  { label: 'Areas',      desc: 'Mark places you know well',       icon: MapIcon,     tile: 'bg-sky-50 text-sky-600',         tab: 'locations' },
                  { label: 'Markets',    desc: 'Work for businesses',             icon: ShoppingBag, tile: 'bg-orange-50 text-orange-600',   tab: 'partnerships' },
                  { label: 'Deliveries', desc: 'Supermarket delivery jobs',       icon: Package,     tile: 'bg-emerald-50 text-emerald-600', tab: 'deliveries' },
                ] as { label: string; desc: string; icon: LucideIcon; tile: string; tab: TabType }[]).map(c => (
                  <button
                    key={c.tab}
                    type="button"
                    onClick={() => setActiveTab(c.tab)}
                    className="classic-card flex min-h-[128px] flex-col justify-between gap-3 p-4 text-left transition-all hover:border-orange-300 active:scale-[0.98]"
                  >
                    <span className={`grid h-11 w-11 place-items-center rounded-2xl ring-1 ring-inset ring-black/5 ${c.tile}`}>
                      <c.icon size={20} />
                    </span>
                    <span>
                      <span className="block text-[15px] font-semibold leading-tight text-slate-800">{c.label}</span>
                      <span className="mt-1 block text-xs leading-snug text-slate-500">{c.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Ride/escort request feeds — always mounted regardless of
            activeTab (rather than only once the rider taps into the
            Requests tab) so polling, the realtime subscription, and the
            full-screen ringing overlay for a brand-new request keep working
            no matter which tab the rider is currently looking at. Each
            component collapses its own visible list down to nothing (still
            showing the ringing overlay if a request comes in) until
            activeTab === 'requests'. */}
        {isEscort ? (
          <div className="space-y-4">
            {/* Escorts with their own vehicle can be booked directly as
                the ride (mbg_request_security's self-transport path,
                which assigns them via mbg_rides like any other rider) —
                RiderEscortRequests alone only watches the add-on table
                (mbg_ride_escort_requests) and would miss those offers. */}
            {riderStats?.escortHasOwnTransport && (
              <RiderRideRequests riderId={user.id} vehicleType={activeVehicleType} collapsed={activeTab !== 'requests'} />
            )}
            <RiderEscortRequests riderId={user.id} collapsed={activeTab !== 'requests'} />
          </div>
        ) : (
          <RiderRideRequests riderId={user.id} vehicleType={activeVehicleType} collapsed={activeTab !== 'requests'} />
        )}

        {activeTab === 'mode' && (
          <RiderModeSelector riderId={user.id} vehicleType={activeVehicleType} />
        )}

        {activeTab === 'locations' && (
          <RiderLocationManager riderId={user.id} />
        )}

        {activeTab === 'partnerships' && (
          <SupermarketPartnership riderId={user.id} vehicleType={activeVehicleType} />
        )}

        {/* Same always-mounted pattern as the ride/escort feeds above —
            polling + the realtime subscription for the pool and this
            rider's active deliveries keep running on every tab, so the
            pending/active counts are never stale by the time the rider
            taps into Deliveries. */}
        <SupermarketDeliveryPool user={user} collapsed={activeTab !== 'deliveries'} />

        {activeTab === 'rewards' && (
          <RewardsHub user={user} role="rider" onGoToWallet={onGoToWallet} />
        )}
      </div>

      {/* Phone menu — bottom sheet. Rendered outside <header> so its fixed
          positioning isn't affected by the sticky header's stacking context.
          z-[1000] clears the floating chat button (z-[999]). */}
      {showMobileMenu && (
        <div className="fixed inset-0 z-[1000] sm:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setShowMobileMenu(false)}
            className="animate-fade-soft absolute inset-0 h-full w-full cursor-default bg-black/50"
          />
          <div className="animate-sheet-up safe-bottom absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[28px] bg-white shadow-2xl">
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-300" />

            <div className="flex items-center gap-3 px-5 pb-4 pt-4">
              <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-amber-500 font-classic-display text-xl font-bold text-white ring-2 ring-[#e6c980] ring-offset-2 ring-offset-white dark:ring-offset-slate-800">
                {(user?.email?.[0] || 'U').toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-classic-display text-lg font-semibold leading-tight text-slate-800">{riderName}</p>
                <p className="truncate text-xs text-slate-500">{user?.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowMobileMenu(false)}
                aria-label="Close menu"
                className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 transition-transform active:scale-95"
              >
                <X size={16} />
              </button>
            </div>
            <div className="landing-classic-divider mx-5" />

            <div className="grid grid-cols-3 gap-2.5 px-4 pb-1 pt-4">
              {NAV_TABS.map(id => {
                const active = activeTab === id;
                const Icon = TAB_META[id].icon;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => switchTab(id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex flex-col items-center gap-2 rounded-2xl px-2 py-3.5 text-center transition-all active:scale-95 ${
                      active ? 'bg-orange-50 ring-1 ring-inset ring-orange-300' : 'bg-slate-50 ring-1 ring-inset ring-slate-100'
                    }`}
                  >
                    <span className={`grid h-11 w-11 place-items-center rounded-full ${
                      active
                        ? 'bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/30'
                        : 'bg-white text-orange-600 shadow-sm ring-1 ring-inset ring-slate-100'
                    }`}>
                      <Icon size={20} />
                    </span>
                    <span className={`text-[11px] leading-tight ${active ? 'font-bold text-orange-600' : 'font-medium text-slate-700'}`}>
                      {TAB_META[id].label}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => { setShowMobileMenu(false); setShowProfileModal(true); }}
                className="flex flex-col items-center gap-2 rounded-2xl bg-slate-50 px-2 py-3.5 text-center ring-1 ring-inset ring-slate-100 transition-all active:scale-95"
              >
                <span className="grid h-11 w-11 place-items-center rounded-full bg-white text-orange-600 shadow-sm ring-1 ring-inset ring-slate-100">
                  <User size={20} />
                </span>
                <span className="text-[11px] font-medium leading-tight text-slate-700">My Profile</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile Modal */}
      <ProfileModal
        user={user}
        userRole="rider"
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        onSaved={() => {
          // Optional: Reload rider data if needed
        }}
      />
    </div>
  );
}
