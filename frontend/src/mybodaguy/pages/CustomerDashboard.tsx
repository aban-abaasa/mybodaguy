import { useState, useEffect, useMemo } from 'react';
import {
  Bike, Clock, LogOut, Package, History, Gift, User, Wallet,
  X, CheckCircle, ChevronDown, ArrowRight, Home, ClipboardList, MapPin,
  CalendarDays, Truck, Building2, LayoutGrid, ScanLine,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import EnhancedRideRequest from '../components/EnhancedRideRequest';
import BecomeOperatorForm from '../components/BecomeOperatorForm';
import CustomerSelfCheckout from '../components/CustomerSelfCheckout';
import BrowseServicesAndBook from '../components/booking/BrowseServicesAndBook';
import IcanCoinCard from '../components/IcanCoinCard';
import RewardsPointsCard from '../components/RewardsPointsCard';
import RewardsHub from '../components/RewardsHub';
import CustomerAreaManager from '../components/CustomerAreaManager';
import RideCommsBar from '../components/RideCommsBar';
import RideTrackingModal from '../components/RideTrackingModal';
import ManageBusinessPanel from '../components/ManageBusinessPanel';
import JourneyTracker from '../components/JourneyTracker';
import RefundableDeliveries from '../components/RefundableDeliveries';
import { computeOrderInsights, shortenLocation } from '../utils/orderInsights';
import InsightSlider, { type InsightSlide } from '../components/InsightSlider';
import { SectionHeading, greetingForHour } from '../components/ClassicBits';
import { ThemeToggle } from '../../components/ThemeToggle';

interface CustomerDashboardProps {
  user: any;
  onSignOut: () => void;
  // Set when rendered inside UnifiedDashboard's role-tab view, which already
  // shows its own brand/avatar header above this one — skips this
  // component's own <header> so a multi-role account doesn't get two.
  embedded?: boolean;
  // Switches UnifiedDashboard's internal activeRole to 'ican-wallet'. This
  // app has no router (no path ever gets registered for it), so the old
  // `window.location.href = '/ican-wallet'` on every wallet button here was
  // a hard navigation to a URL nothing serves — the SPA just remounted and
  // fell back to the default role/tab, which looked like "the wallet button
  // bounces back to Overview". Falls back to that same broken href only if
  // no callback was supplied (shouldn't happen — UnifiedDashboard always
  // passes one).
  onGoToWallet?: () => void;
}

// Delivery is its own tab, separate from Book a Ride — both render
// EnhancedRideRequest (the one real matching-engine implementation) but each
// locks it to a single fixedServiceType so Book a Ride never shows the
// delivery toggle and vice versa. Book a Journey is inbuilt into Book a
// Ride itself (a mode toggle inside EnhancedRideRequest, showJourneyOption)
// rather than its own tab.
type TabType = 'overview' | 'book-ride' | 'shop' | 'book-service' | 'delivery' | 'orders' | 'areas' | 'rewards' | 'become-operator' | 'manage-business' | 'profile';

// emoji drives the desktop tab strip; icon drives the phone header + menu
// sheet, where crisp line icons read as more refined than mixed-font emoji.
const ALL_TABS: { id: TabType; label: string; emoji: string; icon: LucideIcon }[] = [
  { id: 'overview',  label: 'Overview',  emoji: '🏠', icon: Home },
  { id: 'book-ride', label: 'Book a Ride', emoji: '🏍️', icon: Bike },
  { id: 'shop',      label: 'Shop',      emoji: '🛒', icon: ScanLine },
  { id: 'book-service', label: 'Book', emoji: '📅', icon: CalendarDays },
  { id: 'delivery',  label: 'Delivery',  emoji: '📦', icon: Package },
  { id: 'orders',    label: 'Orders',    emoji: '📋', icon: ClipboardList },
  { id: 'areas',     label: 'My Areas',  emoji: '📍', icon: MapPin },
  { id: 'rewards',   label: 'Rewards',   emoji: '🎁', icon: Gift },
  { id: 'become-operator', label: 'Become a Driver', emoji: '🚚', icon: Truck },
  { id: 'manage-business', label: 'Manage Your Business', emoji: '🏢', icon: Building2 },
  { id: 'profile',   label: 'Profile',   emoji: '👤', icon: User },
];

// ── Ride/delivery row — collapsed to one line, expands in place on click ──────
// Shared by Overview's "Recent Rides" and the Orders tab's "Rides &
// Deliveries" list so both behave the same way instead of duplicating this
// markup. Live map tracking still opens via onOpenTracking from inside the
// expanded row, rather than firing straight from a row tap.
function RideListItem({
  ride, expanded, onToggle, selfUserId, selfName, contact, escortStatus, onOpenTracking, statusColor, serviceIcon,
}: {
  ride: any;
  expanded: boolean;
  onToggle: () => void;
  selfUserId: string;
  selfName: string;
  contact?: { userId: string; name: string; phone: string | null };
  escortStatus?: string;
  onOpenTracking: () => void;
  statusColor: (s: string) => string;
  serviceIcon?: React.ReactNode;
}) {
  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-3 py-3 px-2 -mx-2 rounded-xl hover:bg-slate-50 active:bg-slate-50 transition-colors text-left"
      >
        <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-orange-50 ring-1 ring-inset ring-orange-100">
          {serviceIcon ?? <Bike size={16} className="text-orange-500" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800 line-clamp-2 break-words">{ride.pickup_location}</p>
          <p className="text-xs text-slate-400 line-clamp-2 break-words">to {ride.dropoff_location}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold capitalize ${
              contact ? 'bg-emerald-100 text-emerald-700' : statusColor(ride.status)
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full bg-current ${contact ? 'animate-pulse' : ''}`} />
              {contact ? 'Active' : String(ride.status).replace(/_/g, ' ')}
            </span>
            <span className="text-[11px] text-slate-400">{new Date(ride.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <ChevronDown size={16} className={`flex-shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="mb-3 rounded-xl bg-slate-50 px-3 py-2">
          <div className="flex items-center justify-between text-sm py-1">
            <span className="text-slate-500">Fare</span>
            <span className="font-bold text-slate-800">UGX {(ride.fare || 0).toLocaleString()}</span>
          </div>
          {escortStatus && (
            <div className="flex items-center justify-between text-sm py-1">
              <span className="text-slate-500">Escort</span>
              <span className="text-violet-700 font-medium">🛡️ {escortStatus}</span>
            </div>
          )}
          {contact && (
            <>
              <button
                onClick={onOpenTracking}
                className="w-full mt-1 mb-2 py-2 text-xs font-semibold text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-50 transition-colors"
              >
                View live tracking →
              </button>
              <RideCommsBar
                rideId={ride.id}
                selfUserId={selfUserId}
                selfName={selfName}
                peerUserId={contact.userId}
                peerName={contact.name}
                peerPhone={contact.phone}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function CustomerDashboard({ user, onSignOut, embedded = false, onGoToWallet }: CustomerDashboardProps) {
  const goToWallet = onGoToWallet ?? (() => { window.location.href = '/ican-wallet'; });
  const [activeTab, setActiveTab]       = useState<TabType>('overview');
  const [mobileMenuOpen, setMobileMenu] = useState(false);
  const [rides, setRides]               = useState<any[]>([]);
  const [ridesLoading, setRidesLoading] = useState(false);
  const [customerName, setCustomerName] = useState('You');
  // Contact info for whichever rider is on a still-in-progress ride, keyed
  // by ride id — lets "Recent Rides"/"Orders" offer Call/Video/Chat/Send
  // Money right from the list, not just from the live tracking screen.
  const [activeRideContacts, setActiveRideContacts] = useState<Record<string, { userId: string; name: string; phone: string | null }>>({});
  // Security-escort request status per ride id (mbg_ride_escort_requests),
  // for the "🛡️ Escort" badge on Overview/Orders ride cards.
  const [escortStatusByRideId, setEscortStatusByRideId] = useState<Record<string, string>>({});
  // Which ride's tracking view is currently open (Overview/Orders row click)
  // — re-opens the live map + Call/Video/Chat for a ride that's already in
  // progress, since EnhancedRideRequest's own live tracking only exists in
  // that component's in-memory state while actively booking, and is lost on
  // navigation or refresh.
  const [trackedRide, setTrackedRide] = useState<any>(null);
  // "Recent Rides" (Overview) starts collapsed — it's a summary card, not
  // the primary content of that tab, so it shouldn't eat vertical space
  // until someone actually wants to look at it.
  const [recentRidesOpen, setRecentRidesOpen] = useState(false);
  // Each ride row (Overview + Orders) is collapsed to a single line by
  // default; clicking it expands just that row in place instead of jumping
  // straight to the live-tracking modal. Shared across both lists since
  // only one row makes sense open at a time.
  const [expandedRideId, setExpandedRideId] = useState<string | null>(null);
  // All-time order count for the greeting's "traffic" stat — the `rides`
  // list itself is capped at 20 (most recent), so it undercounts a
  // long-time customer's real total.
  const [totalOrderCount, setTotalOrderCount] = useState<number | null>(null);
  // Stage with the most currently-online riders — a live hint for customers
  // on where to expect the fastest (and, thanks to more riders competing
  // for the same jobs, often cheapest) pickup.
  const [busiestStage, setBusiestStage] = useState<{ stage_name: string; available_riders: number } | null>(null);
  // Best-stocked shop right now — the same "live availability" idea as
  // busiestStage, but for goods instead of riders.
  const [bestStockedStore, setBestStockedStore] = useState<{ store_name: string; location: string | null; available_stock: number } | null>(null);

  // The phone menu is a bottom sheet: Escape closes it, and the page behind
  // it stops scrolling while it's up (tapping the scrim closes it too).
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMobileMenu(false); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [mobileMenuOpen]);

  // Fetch ride history: mbg_users → mbg_customers → mbg_rides
  useEffect(() => {
    if (!user?.id) return;
    setRidesLoading(true);
    let channel: ReturnType<typeof supabase.channel> | null = null;
    const load = async () => {
      const { data: cr } = await supabase.from('mbg_customers').select('id').eq('user_id', user.id).maybeSingle();
      if (!cr?.id) { setRidesLoading(false); return; }
      const { data } = await supabase
        .from('mbg_rides')
        .select('id, created_at, pickup_location, dropoff_location, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status, fare, service_type, rider_id')
        .eq('customer_id', cr.id)
        .order('created_at', { ascending: false })
        .limit(20);
      setRides(data || []);
      setRidesLoading(false);

      // All-time count for the greeting's traffic stat (the list above is
      // capped at 20, so it isn't a reliable "total orders" number).
      const { count } = await supabase
        .from('mbg_rides')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', cr.id);
      setTotalOrderCount(count ?? 0);

      // Live updates — a new order, or any status change on an existing
      // one, refreshes the list and the greeting's traffic/peak-time/
      // top-location stats without the customer having to reload.
      if (!channel) {
        // supabase.channel() reuses an existing channel object if one with
        // this topic is already registered on the client — if a previous
        // run of this effect left one behind (e.g. cleanup racing the async
        // load() above), that stale channel is already subscribed and
        // calling .on() on it throws. Clear it out first so we always get
        // a fresh, not-yet-subscribed channel to attach the listener to.
        const topic = `realtime:mbg_customer_rides_${cr.id}`;
        const stale = supabase.getChannels().find(c => c.topic === topic);
        if (stale) supabase.removeChannel(stale);

        channel = supabase
          .channel(`mbg_customer_rides_${cr.id}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'mbg_rides', filter: `customer_id=eq.${cr.id}` },
            () => load()
          )
          .subscribe();
      }

      const rideIds = (data || []).map(r => r.id);
      if (rideIds.length > 0) {
        const { data: escortRows } = await supabase
          .from('mbg_ride_escort_requests')
          .select('ride_id, status')
          .in('ride_id', rideIds);
        const byId: Record<string, string> = {};
        (escortRows || []).forEach((e: any) => { byId[e.ride_id] = e.status; });
        setEscortStatusByRideId(byId);
      } else {
        setEscortStatusByRideId({});
      }

      // Resolve contact info only for rides still actually in progress —
      // that's the whole point: Call/Video/Chat/Send Money only make
      // sense while there's a real rider to reach on the other end.
      const activeRows = (data || []).filter(r => ['accepted', 'in_progress'].includes(r.status) && r.rider_id);
      const contacts: Record<string, { userId: string; name: string; phone: string | null }> = {};
      await Promise.all(activeRows.map(async (r) => {
        const { data: rider } = await supabase
          .from('mbg_riders')
          .select('user_id, mbg_users!user_id(phone, email, mbg_user_profiles(full_name))')
          .eq('id', r.rider_id)
          .maybeSingle();
        const rUser = (rider as any)?.mbg_users;
        if (rider?.user_id) {
          contacts[r.id] = {
            userId: rider.user_id,
            name: rUser?.mbg_user_profiles?.[0]?.full_name || rUser?.email?.split('@')[0] || 'Rider',
            phone: rUser?.phone || null,
          };
        }
      }));
      setActiveRideContacts(contacts);
    };
    load();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, [user?.id]);

  // Live "where are riders plentiful" + "which shop is best stocked" hints
  // for the greeting slider — polled rather than subscribed, since both
  // source tables churn far more often (every rider going on/offline, every
  // sale anywhere) than these two aggregates need to move.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const load = () => {
      supabase.rpc('mbg_get_busiest_rider_stage').then(({ data }) => {
        if (!cancelled) setBusiestStage(data ?? null);
      });
      supabase.rpc('mbg_get_best_stocked_store').then(({ data }) => {
        if (!cancelled) setBestStockedStore(data ?? null);
      });
    };
    load();
    const interval = setInterval(load, 45000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('mbg_users')
      .select('email, mbg_user_profiles(full_name)')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        const name = (data as any)?.mbg_user_profiles?.[0]?.full_name || data?.email?.split('@')[0] || 'You';
        setCustomerName(name);
      });
  }, [user?.id]);

  const statusColor = (s: string) => {
    if (s === 'completed') return 'bg-green-100 text-green-700';
    if (s === 'cancelled') return 'bg-red-100 text-red-700';
    if (s === 'pending')   return 'bg-yellow-100 text-yellow-700';
    return 'bg-blue-100 text-blue-700';
  };

  // Greeting insights — "traffic" (total orders), peak ordering hour, and
  // top pickup location — derived from this customer's own recent rides.
  // Recomputes live as `rides` updates via the realtime subscription above.
  const orderInsights = useMemo(() => computeOrderInsights(rides), [rides]);

  // Each stat gets its own slide in the greeting's carousel instead of all
  // of them wrapping into one cramped, unreadable line — only real, live
  // data ever appears here (a stat is simply omitted until it has one).
  const insightSlides = useMemo<InsightSlide[]>(() => {
    const slides: InsightSlide[] = [];
    if (totalOrderCount !== null && totalOrderCount > 0) {
      slides.push({
        key: 'orders', emoji: '📦', tint: 'bg-orange-50 text-orange-700',
        content: <><strong>{totalOrderCount}</strong> orders total</>,
      });
    }
    if (orderInsights?.peakHourLabel) {
      slides.push({
        key: 'peak', emoji: '⏰', tint: 'bg-blue-50 text-blue-700',
        content: <>You mostly order <strong>{orderInsights.peakHourLabel}</strong></>,
      });
    }
    if (orderInsights?.topLocation) {
      slides.push({
        key: 'location', emoji: '📍', tint: 'bg-violet-50 text-violet-700',
        content: <>Mostly from <strong>{shortenLocation(orderInsights.topLocation)}</strong></>,
      });
    }
    if (busiestStage) {
      slides.push({
        key: 'riders', emoji: '🏍️', tint: 'bg-emerald-50 text-emerald-700',
        content: <><strong>{busiestStage.available_riders}</strong> riders online near <strong>{busiestStage.stage_name}</strong> — fastest pickup</>,
      });
    }
    if (bestStockedStore) {
      slides.push({
        key: 'stock', emoji: '🏬', tint: 'bg-pink-50 text-pink-700',
        content: <><strong>{bestStockedStore.store_name}</strong> is well stocked right now</>,
      });
    }
    return slides;
  }, [totalOrderCount, orderInsights, busiestStage, bestStockedStore]);

  const switchTab = (id: TabType) => { setActiveTab(id); setMobileMenu(false); };

  const activeTabMeta = ALL_TABS.find(t => t.id === activeTab) ?? ALL_TABS[0];
  const ActiveTabIcon = activeTabMeta.icon;
  const greeting = greetingForHour(new Date().getHours());

  return (
    <div className="min-h-screen classic-page">

      {/* ── Sticky 2-row Header ── */}
      {/* When embedded, stick below UnifiedDashboard's own header instead of at top-0 (matches ChairpersonDashboard's same offset) */}
      <header className={`sticky z-40 shadow-md ${embedded ? 'top-12 xs:top-14 sm:top-16' : 'top-0'}`}>

        {/* Row 1 — brand + user (skipped when embedded — UnifiedDashboard already shows this).
            safe-top keeps the brand clear of the notch / status bar when installed as a PWA
            (index.html sets a black-translucent status bar). */}
        {!embedded && (
          <div className="safe-top bg-gradient-to-br from-orange-600 via-orange-500 to-amber-500 text-white">
            <div className="container mx-auto px-4">
              <div className="flex items-center justify-between h-16">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-white/15 ring-1 ring-[#f5dfa0]/70 shadow-inner">
                    <Bike size={20} />
                  </span>
                  <div className="min-w-0">
                    <p className="font-classic-display text-[20px] font-bold leading-none tracking-tight">BodaGoEra</p>
                    <p className="mt-1.5 whitespace-nowrap text-[8px] font-medium uppercase leading-none tracking-[0.14em] text-white/80 min-[360px]:text-[9px] min-[360px]:tracking-[0.24em]">Your Trusted Partner</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="hidden sm:block text-xs opacity-85 bg-white/20 px-2 py-1 rounded-full truncate max-w-[160px]">
                    {user?.email}
                  </span>
                  <ThemeToggle className="!h-10 !w-10 !rounded-full !p-0 !bg-white/15 hover:!bg-white/25 !text-white ring-1 ring-white/25" />
                  <button onClick={onSignOut} aria-label="Sign out"
                    className="flex h-10 items-center justify-center gap-1.5 rounded-full bg-white/15 px-0 w-10 sm:w-auto sm:px-4 ring-1 ring-white/25 hover:bg-white/25 text-sm font-medium transition-colors">
                    <LogOut size={16} />
                    <span className="hidden sm:inline">Sign Out</span>
                  </button>
                </div>
              </div>
            </div>
            <div className="h-px bg-gradient-to-r from-transparent via-[#f5dfa0] to-transparent" />
          </div>
        )}

        {/* Row 2 — nav tabs (hidden on mobile, shown via 3-dot) */}
        <div className="hidden sm:block bg-white border-b border-[#c4a052]/25 dark:border-slate-700">
          <div className="container mx-auto px-2">
            <nav className="flex overflow-x-auto scrollbar-hide gap-0.5 py-1">
              {ALL_TABS.map(tab => (
                <button key={tab.id} onClick={() => switchTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                    activeTab === tab.id
                      ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-orange-50 hover:text-orange-600'
                  }`}>
                  <span>{tab.emoji}</span>{tab.label}
                </button>
              ))}
              <button onClick={goToWallet}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap text-violet-600 hover:bg-violet-50 transition-all flex-shrink-0">
                <Wallet size={14} /> ₡ ICAN Wallet
              </button>
            </nav>
          </div>
        </div>

        {/* Mobile section bar — current section in serif + the one menu
            trigger (opens the bottom sheet rendered at the end of this
            component). Same bar whether standalone or embedded in
            UnifiedDashboard, which already shows its own avatar above. */}
        <div className="sm:hidden bg-white border-b border-[#c4a052]/25 dark:border-slate-700">
          <div className="px-4 h-12 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <ActiveTabIcon size={17} className="flex-shrink-0 text-orange-500" />
              <h1 className="font-classic-display text-[18px] font-semibold leading-none text-slate-800 truncate">
                {activeTabMeta.label}
              </h1>
            </div>
            <button type="button" onClick={() => setMobileMenu(true)}
              aria-label="Open menu" aria-expanded={mobileMenuOpen}
              className="flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full border border-[#c4a052]/40 bg-[#faf8f3] px-3.5 text-xs font-semibold text-slate-700 shadow-sm active:scale-95 transition-transform dark:border-slate-600 dark:bg-slate-800">
              <LayoutGrid size={14} className="text-orange-500" /> Menu
            </button>
          </div>
        </div>
      </header>

      {/* ── Tab Content ── */}
      {/* Generous bottom padding so the floating chat button never sits on
          top of the last card when scrolled to the end. */}
      <div className="container mx-auto px-4 pt-5 pb-28">

        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Greeting — live traffic/peak-time/location insights update as
                rides come in (realtime) and every 45s for the rider/stock
                hotspots, cycling through an animated slider one at a time */}
            <div>
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 font-classic-display leading-tight">
                  <span className="block text-[18px] font-medium text-slate-500">{greeting},</span>
                  <span className="block break-words text-[30px] font-bold tracking-tight text-slate-900">{customerName}</span>
                </h2>
                {insightSlides.length > 0 && (
                  <span className="mt-1.5 flex flex-shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 ring-1 ring-inset ring-emerald-100">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" /> Live
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-500">Here's what's happening with your account today.</p>
              <div className="landing-classic-divider mt-4" />
              {insightSlides.length > 0 && (
                <div className="mt-3">
                  <InsightSlider slides={insightSlides} />
                </div>
              )}
            </div>

            {/* Wallet + Rewards — both currencies at a glance, one tap to either */}
            <div className="grid grid-cols-2 gap-3">
              <IcanCoinCard variant="premium" userId={user?.id} onGoToWallet={goToWallet} />
              <RewardsPointsCard variant="premium" userId={user?.id} onOpen={() => setActiveTab('rewards')} />
            </div>

            {/* Quick actions — Book a Ride gets the hero treatment (it's the
                thing most people open the app to do), the rest sit in a 2-up grid */}
            <div className="space-y-3">
              <SectionHeading>Quick actions</SectionHeading>

              <button type="button" onClick={() => setActiveTab('book-ride')}
                className="group relative w-full overflow-hidden rounded-[22px] bg-gradient-to-br from-[#231b12] via-[#2f2415] to-[#4a3418] p-4 min-[360px]:p-5 text-left text-white shadow-[0_18px_34px_-16px_rgba(0,0,0,0.65)] ring-1 ring-inset ring-[#c4a052]/40 transition-transform active:scale-[0.99]">
                <span aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full border border-[#c4a052]/25" />
                <span aria-hidden className="pointer-events-none absolute -right-5 -top-5 h-28 w-28 rounded-full border border-[#c4a052]/20" />
                <span aria-hidden className="pointer-events-none absolute -bottom-14 -left-10 h-40 w-40 rounded-full bg-orange-500/20 blur-2xl" />
                <div className="relative flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#e6c980]">Get moving</p>
                    <p className="mt-1 font-classic-display text-[26px] font-bold leading-tight">Book a Ride</p>
                    <p className="mt-1 text-[13px] text-white/70">Boda, car, van or truck</p>
                    <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-orange-500 to-amber-400 px-4 py-2 text-xs font-bold text-white shadow-lg shadow-orange-950/30">
                      Book now <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                  <span className="grid h-16 w-16 flex-shrink-0 place-items-center rounded-full bg-white/5 ring-1 ring-[#c4a052]/50 min-[360px]:h-20 min-[360px]:w-20">
                    <Bike size={36} strokeWidth={1.4} className="text-[#e6c980]" />
                  </span>
                </div>
              </button>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  { label: 'Delivery',        desc: 'From a store or a normal pickup', icon: Package,       tile: 'bg-sky-50 text-sky-600',         tab: 'delivery' as TabType },
                  { label: 'Scan & Checkout', desc: 'POS · Pay with ICAN',             icon: ScanLine,      tile: 'bg-emerald-50 text-emerald-600', tab: 'shop' as TabType },
                  { label: 'My Orders',       desc: 'Track rides & deliveries',        icon: ClipboardList, tile: 'bg-orange-50 text-orange-600',   tab: 'orders' as TabType },
                  { label: 'Rewards',         desc: 'Earn & redeem points',            icon: Gift,          tile: 'bg-amber-50 text-amber-600',     tab: 'rewards' as TabType },
                ].map(c => (
                  <button key={c.tab} type="button" onClick={() => setActiveTab(c.tab)}
                    className="classic-card flex min-h-[128px] flex-col justify-between gap-3 p-4 text-left transition-all active:scale-[0.98] hover:border-orange-300">
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

            {/* Recent rides — collapsed by default, tap the header to reveal */}
            <div className="classic-card overflow-hidden">
              <button
                type="button"
                onClick={() => setRecentRidesOpen(o => !o)}
                aria-expanded={recentRidesOpen}
                className="w-full flex items-center justify-between gap-3 p-4"
              >
                <span className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-orange-50 ring-1 ring-inset ring-orange-100">
                    <History size={17} className="text-orange-500" />
                  </span>
                  <span className="text-left">
                    <span className="block font-classic-display text-lg font-semibold leading-tight text-slate-800">Recent Rides</span>
                    <span className="block text-xs text-slate-400">
                      {ridesLoading ? 'Loading…' : rides.length === 0 ? 'Nothing yet' : `Your last ${Math.min(rides.length, 5)} trip${Math.min(rides.length, 5) === 1 ? '' : 's'}`}
                    </span>
                  </span>
                </span>
                <ChevronDown size={18} className={`flex-shrink-0 text-slate-400 transition-transform ${recentRidesOpen ? 'rotate-180' : ''}`} />
              </button>
              {recentRidesOpen && (
                <div className="px-4 pb-4">
                  <div className="landing-classic-divider mb-1" />
                  {ridesLoading ? (
                    <p className="text-slate-400 text-sm py-3">Loading…</p>
                  ) : rides.length === 0 ? (
                    <p className="text-slate-400 text-sm text-center py-6">No rides yet — book your first one!</p>
                  ) : (
                    <>
                      <div>
                        {rides.slice(0, 5).map(r => (
                          <RideListItem
                            key={r.id}
                            ride={r}
                            expanded={expandedRideId === r.id}
                            onToggle={() => setExpandedRideId(id => id === r.id ? null : r.id)}
                            selfUserId={user.id}
                            selfName={customerName}
                            contact={activeRideContacts[r.id]}
                            escortStatus={escortStatusByRideId[r.id]}
                            onOpenTracking={() => setTrackedRide(r)}
                            statusColor={statusColor}
                            serviceIcon={r.service_type === 'delivery' ? <Package size={16} className="text-blue-500" /> : undefined}
                          />
                        ))}
                      </div>
                      <button type="button" onClick={() => setActiveTab('orders')}
                        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold text-orange-600 hover:bg-orange-50 transition-colors">
                        See all orders <ArrowRight size={13} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Book Ride — Book a Journey (multi-leg: boda to airport, real
            flight, driver at destination) is inbuilt here as a mode toggle,
            not a separate tab */}
        {activeTab === 'book-ride' && (
          <EnhancedRideRequest customerId={user?.id} fixedServiceType="ride" showJourneyOption />
        )}

        {/* Delivery — same real matching-engine flow as Book a Ride, locked
            to delivery so the two never mix. showJourneyOption also lets a
            cross-bloc delivery (e.g. Uganda -> USA) reach ship-cargo journey
            booking, same as the ride tab already does for flights. */}
        {activeTab === 'delivery' && (
          <EnhancedRideRequest customerId={user?.id} fixedServiceType="delivery" showJourneyOption />
        )}

        {/* Become a transport service provider — self-service application,
            reviewed by a developer in DeveloperDashboard's Applications tab */}
        {activeTab === 'become-operator' && (
          <div className="classic-card overflow-hidden">
            <BecomeOperatorForm userId={user?.id} />
          </div>
        )}

        {/* Manage Your Business — register/run a Transport Company or a
            Security Escort service. Each is its own business_profile in the
            shared ICAN business system (icanera.space); this panel only adds
            the BodaGoEra-specific pieces (driver/escort roster, pricing) —
            see ManageBusinessPanel.tsx. */}
        {activeTab === 'manage-business' && (
          <div className="classic-card p-5">
            <ManageBusinessPanel />
          </div>
        )}

        {/* Shop / Scan + POS */}
        {activeTab === 'shop' && (
          <div className="classic-card overflow-hidden">
            <CustomerSelfCheckout user={user} />
          </div>
        )}

        {/* Book — appointment-style service bookings against the same
            shared service_bookings tables digital-city-era's Book tab uses,
            reusing chatService/useDirectCall for follow-up with the store */}
        {activeTab === 'book-service' && (
          <div className="classic-card overflow-hidden">
            <BrowseServicesAndBook
              identity={{
                userId: user?.id,
                name: user?.user_metadata?.full_name || user?.email || 'Customer',
                email: user?.email,
                phone: '',
              }}
            />
          </div>
        )}

        {/* Orders — real mbg_rides history (rides booked via Book a Ride) */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
          {user?.id && <RefundableDeliveries customerId={user.id} />}
          {user?.id && <JourneyTracker customerId={user.id} />}
          <div className="classic-card p-5">
            <div className="mb-3">
              <SectionHeading>Rides &amp; Deliveries</SectionHeading>
            </div>
            {ridesLoading ? (
              <p className="text-slate-400 text-sm">Loading…</p>
            ) : rides.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-400 text-sm">No rides or deliveries yet.</p>
                <button onClick={() => setActiveTab('book-ride')}
                  className="mt-3 px-5 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-lg text-sm font-medium">
                  Book a Ride or Delivery
                </button>
              </div>
            ) : (
              <div>
                {rides.map(r => (
                  <RideListItem
                    key={r.id}
                    ride={r}
                    expanded={expandedRideId === r.id}
                    onToggle={() => setExpandedRideId(id => id === r.id ? null : r.id)}
                    selfUserId={user.id}
                    selfName={customerName}
                    contact={activeRideContacts[r.id]}
                    escortStatus={escortStatusByRideId[r.id]}
                    onOpenTracking={() => setTrackedRide(r)}
                    statusColor={statusColor}
                    serviceIcon={r.service_type === 'delivery' ? <Package size={16} className="text-blue-500" /> : <Bike size={16} className="text-orange-500" />}
                  />
                ))}
              </div>
            )}
          </div>
          </div>
        )}

        {/* Delivery — Shop-For-Me supermarket delivery orders (separate from ride Orders) */}
        {/* My Areas */}
        {activeTab === 'areas' && <CustomerAreaManager customerId={user?.id} />}

        {/* Rewards */}
        {activeTab === 'rewards' && <RewardsHub user={user} role="customer" onGoToWallet={goToWallet} />}

        {/* Profile */}
        {activeTab === 'profile' && (
          <div className="classic-card p-5">
            <div className="mb-4">
              <SectionHeading>My Profile</SectionHeading>
            </div>
            <div className="flex items-center gap-4 mb-5 p-4 bg-orange-50 rounded-2xl">
              <div className="w-16 h-16 flex-shrink-0 bg-gradient-to-br from-orange-400 to-amber-500 rounded-full flex items-center justify-center text-white font-classic-display text-2xl font-bold ring-2 ring-[#e6c980] ring-offset-2 ring-offset-orange-50">
                {(user?.email?.[0] || 'U').toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-slate-800 truncate">{user?.email}</p>
                <p className="text-sm text-slate-500 flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> BodaGoEra Customer</p>
              </div>
            </div>
            <div className="space-y-2 text-sm">
              {[
                { label: 'Email', value: user?.email },
                { label: 'User ID', value: user?.id?.slice(0, 16) + '…', mono: true },
                { label: 'Member since', value: user?.created_at ? new Date(user.created_at).toLocaleDateString() : '—' },
                { label: 'Total rides', value: rides.length },
              ].map(r => (
                <div key={r.label} className="flex justify-between py-2 border-b border-slate-100 last:border-0">
                  <span className="text-slate-500">{r.label}</span>
                  <span className={`font-medium text-slate-800 ${r.mono ? 'font-mono text-xs' : ''}`}>{r.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-3">
              <button className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
                Edit Profile
              </button>
              <button onClick={goToWallet}
                className="flex-1 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl text-sm font-semibold hover:opacity-90">
                ₡ My Wallet
              </button>
            </div>
          </div>
        )}
      </div>

      {trackedRide && (
        <RideTrackingModal
          ride={trackedRide}
          contact={activeRideContacts[trackedRide.id] || null}
          customerId={user.id}
          customerName={customerName}
          onClose={() => setTrackedRide(null)}
        />
      )}

      {/* ── Phone menu — bottom sheet. Rendered here, outside <header>, so its
          fixed positioning isn't affected by the sticky header's stacking
          context. z-[1000] clears the floating chat button (z-[999]). ── */}
      {mobileMenuOpen && (
        <div className="sm:hidden fixed inset-0 z-[1000]" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" aria-label="Close menu" onClick={() => setMobileMenu(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-black/50 animate-fade-soft" />
          <div className="animate-sheet-up safe-bottom absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[28px] bg-white shadow-2xl">
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-300" />

            <div className="flex items-center gap-3 px-5 pb-4 pt-4">
              <span className="grid h-12 w-12 flex-shrink-0 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-amber-500 font-classic-display text-xl font-bold text-white ring-2 ring-[#e6c980] ring-offset-2 ring-offset-white dark:ring-offset-slate-800">
                {(user?.email?.[0] || 'U').toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-classic-display text-lg font-semibold leading-tight text-slate-800">{customerName}</p>
                <p className="truncate text-xs text-slate-500">{user?.email}</p>
              </div>
              <button type="button" onClick={() => setMobileMenu(false)} aria-label="Close menu"
                className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-full bg-slate-100 text-slate-500 active:scale-95 transition-transform">
                <X size={16} />
              </button>
            </div>
            <div className="landing-classic-divider mx-5" />

            <div className="grid grid-cols-3 gap-2.5 px-4 pb-1 pt-4">
              {ALL_TABS.map(tab => {
                const active = activeTab === tab.id;
                return (
                  <button key={tab.id} type="button" onClick={() => switchTab(tab.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex flex-col items-center gap-2 rounded-2xl px-2 py-3.5 text-center transition-all active:scale-95 ${
                      active
                        ? 'bg-orange-50 ring-1 ring-inset ring-orange-300'
                        : 'bg-slate-50 ring-1 ring-inset ring-slate-100'
                    }`}>
                    <span className={`grid h-11 w-11 place-items-center rounded-full ${
                      active
                        ? 'bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-md shadow-orange-500/30'
                        : 'bg-white text-orange-600 shadow-sm ring-1 ring-inset ring-slate-100'
                    }`}>
                      <tab.icon size={20} />
                    </span>
                    <span className={`text-[11px] leading-tight ${active ? 'font-bold text-orange-600' : 'font-medium text-slate-700'}`}>
                      {tab.label}
                    </span>
                  </button>
                );
              })}
              <button type="button" onClick={() => { goToWallet(); setMobileMenu(false); }}
                className="flex flex-col items-center gap-2 rounded-2xl bg-violet-50 px-2 py-3.5 text-center ring-1 ring-inset ring-violet-100 transition-all active:scale-95">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-violet-600 to-indigo-800 text-white shadow-md shadow-violet-500/30">
                  <Wallet size={20} />
                </span>
                <span className="text-[11px] font-semibold leading-tight text-violet-700">ICAN Wallet</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
