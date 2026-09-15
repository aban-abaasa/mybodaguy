import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Bike, Clock, Star, LogOut, Package, ShoppingBag, History,
  ShoppingCart, LayoutDashboard, Gift, User, Wallet,
  X, CheckCircle, RefreshCw, ChevronDown,
} from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import EnhancedRideRequest from '../components/EnhancedRideRequest';
import BecomeOperatorForm from '../components/BecomeOperatorForm';
import CustomerSelfCheckout from '../components/CustomerSelfCheckout';
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
type TabType = 'overview' | 'book-ride' | 'shop' | 'delivery' | 'orders' | 'areas' | 'rewards' | 'become-operator' | 'manage-business' | 'profile';

const ALL_TABS = [
  { id: 'overview'  as TabType, label: 'Overview',  emoji: '🏠' },
  { id: 'book-ride' as TabType, label: 'Book a Ride', emoji: '🏍️' },
  { id: 'shop'      as TabType, label: 'Shop',      emoji: '🛒' },
  { id: 'delivery'  as TabType, label: 'Delivery',  emoji: '📦' },
  { id: 'orders'    as TabType, label: 'Orders',    emoji: '📋' },
  { id: 'areas'     as TabType, label: 'My Areas',  emoji: '📍' },
  { id: 'rewards'   as TabType, label: 'Rewards',   emoji: '🎁' },
  { id: 'become-operator' as TabType, label: 'Become a Driver', emoji: '🚚' },
  { id: 'manage-business' as TabType, label: 'Manage Your Business', emoji: '🏢' },
  { id: 'profile'   as TabType, label: 'Profile',   emoji: '👤' },
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
    <div className="border-b border-slate-50 last:border-0">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-2 py-2 px-2 -mx-2 rounded-lg hover:bg-slate-50 transition-colors text-left"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700 truncate flex items-center gap-1.5">
            {serviceIcon}{ride.pickup_location} → {ride.dropoff_location}
          </p>
          <p className="text-xs text-slate-400">{new Date(ride.created_at).toLocaleDateString()}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            contact ? 'bg-emerald-100 text-emerald-700 animate-pulse' : statusColor(ride.status)
          }`}>
            {contact ? '🟢 Active' : ride.status}
          </span>
          <ChevronDown size={14} className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>
      {expanded && (
        <div className="pb-3 px-2 -mx-2">
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
                className="w-full mt-1 mb-2 py-1.5 text-xs font-semibold text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-50 transition-colors"
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
  const menuRef                         = useRef<HTMLDivElement>(null);

  // Close mobile menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMobileMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50">

      {/* ── Sticky 2-row Header ── */}
      {/* When embedded, stick below UnifiedDashboard's own header instead of at top-0 (matches ChairpersonDashboard's same offset) */}
      <header className={`sticky z-40 shadow-md ${embedded ? 'top-12 xs:top-14 sm:top-16' : 'top-0'}`}>

        {/* Row 1 — brand + user + mobile 3-dot (skipped when embedded — UnifiedDashboard already shows this) */}
        {!embedded && (
          <div className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white">
            <div className="container mx-auto px-4">
              <div className="flex items-center justify-between h-14">
                <div className="flex items-center gap-2">
                  <Bike size={22} />
                  <div>
                    <p className="font-bold leading-none text-sm">BodaGoEra</p>
                    <p className="text-[10px] opacity-75">Your Trusted Partner</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden sm:block text-xs opacity-85 bg-white/20 px-2 py-1 rounded-full truncate max-w-[160px]">
                    {user?.email}
                  </span>
                  <button onClick={onSignOut}
                    className="flex items-center gap-1 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm transition-colors">
                    <LogOut size={14} />
                    <span className="hidden sm:inline text-sm">Sign Out</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Row 2 — nav tabs (hidden on mobile, shown via 3-dot) */}
        <div className="hidden sm:block bg-white border-b border-orange-100">
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

        {/* Mobile active-tab indicator bar — the one and only mobile menu trigger.
            When embedded, UnifiedDashboard already shows the real profile
            avatar above this header, so this row uses a plain chevron
            instead of a second avatar-look button that would read as a
            duplicate account icon (see screenshot feedback). Standalone
            (not embedded — no other icon on the page), the trigger doubles
            as the profile icon itself. */}
        <div className="sm:hidden bg-white border-b border-orange-100 relative" ref={menuRef}>
          {embedded ? (
            <button type="button" onClick={() => setMobileMenu(o => !o)}
              className="w-full px-4 py-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">
                {ALL_TABS.find(t => t.id === activeTab)?.emoji}{' '}
                {ALL_TABS.find(t => t.id === activeTab)?.label}
              </span>
              <ChevronDown size={16} className={`text-orange-500 transition-transform flex-shrink-0 ${mobileMenuOpen ? 'rotate-180' : ''}`} />
            </button>
          ) : (
            <div className="px-4 py-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">
                {ALL_TABS.find(t => t.id === activeTab)?.emoji}{' '}
                {ALL_TABS.find(t => t.id === activeTab)?.label}
              </span>
              <button onClick={() => setMobileMenu(o => !o)}
                aria-label="Open menu"
                className="relative flex items-center justify-center w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-yellow-500 text-white text-xs font-bold shadow-sm flex-shrink-0">
                {mobileMenuOpen ? <X size={14} /> : (user?.email?.[0] || 'U').toUpperCase()}
              </button>
            </div>
          )}

          {mobileMenuOpen && (
            <div className="absolute right-4 top-full mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-50">
              {ALL_TABS.map(tab => (
                <button key={tab.id} onClick={() => switchTab(tab.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors text-left
                    ${activeTab === tab.id ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'}`}>
                  <span>{tab.emoji}</span>
                  {tab.label}
                  {activeTab === tab.id && <CheckCircle size={14} className="ml-auto text-orange-500" />}
                </button>
              ))}
              <button onClick={() => { goToWallet(); setMobileMenu(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-violet-600 hover:bg-violet-50 border-t border-slate-100">
                <span>₡</span> ICAN Wallet
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ── Tab Content ── */}
      <div className="container mx-auto px-4 py-5">

        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* Greeting — live traffic/peak-time/location insights update as
                rides come in (realtime) and every 45s for the rider/stock
                hotspots, cycling through an animated slider one at a time */}
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-800">Hi, {customerName} 👋</h2>
                {insightSlides.length > 0 && (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" /> Live
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-500">Here's what's happening with your account today.</p>
              {insightSlides.length > 0 && (
                <div className="mt-2 max-w-sm">
                  <InsightSlider slides={insightSlides} />
                </div>
              )}
            </div>

            {/* Wallet + Rewards — both currencies at a glance, one tap to either */}
            <div className="grid grid-cols-2 gap-3">
              <IcanCoinCard userId={user?.id} onGoToWallet={goToWallet} />
              <RewardsPointsCard userId={user?.id} onOpen={() => setActiveTab('rewards')} />
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
              {[
                { label: 'Book a Ride', desc: 'Boda, car, van or truck', emoji: '🏍️', tab: 'book-ride' as TabType },
                { label: 'Delivery',    desc: 'From a store or a normal pickup', emoji: '📦', tab: 'delivery' as TabType },
                { label: 'Scan & Checkout',  desc: 'POS · Pay with ICAN',     emoji: '🛒', tab: 'shop' as TabType },
                { label: 'My Orders',       desc: 'Track rides & deliveries', emoji: '📋', tab: 'orders' as TabType },
                { label: 'Rewards',       desc: 'Earn & redeem points', emoji: '🎁', tab: 'rewards' as TabType },
              ].map(c => (
                <button key={c.tab} onClick={() => setActiveTab(c.tab)}
                  className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 text-left hover:shadow-md hover:border-orange-200 transition-all">
                  <p className="text-3xl mb-2">{c.emoji}</p>
                  <p className="font-semibold text-slate-800 text-sm">{c.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{c.desc}</p>
                </button>
              ))}
            </div>

            {/* Recent rides — collapsed by default, tap the header to reveal */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <button
                type="button"
                onClick={() => setRecentRidesOpen(o => !o)}
                className="w-full flex items-center justify-between p-5"
              >
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <History size={16} className="text-orange-500" /> Recent Rides
                </h3>
                <ChevronDown size={18} className={`text-slate-400 transition-transform ${recentRidesOpen ? 'rotate-180' : ''}`} />
              </button>
              {recentRidesOpen && (
                <div className="px-5 pb-5">
                  {ridesLoading ? (
                    <p className="text-slate-400 text-sm">Loading…</p>
                  ) : rides.length === 0 ? (
                    <p className="text-slate-400 text-sm text-center py-6">No rides yet — book your first one!</p>
                  ) : (
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
                        />
                      ))}
                    </div>
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
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <EnhancedRideRequest customerId={user?.id} fixedServiceType="ride" showJourneyOption />
          </div>
        )}

        {/* Delivery — same real matching-engine flow as Book a Ride, locked
            to delivery so the two never mix. showJourneyOption also lets a
            cross-bloc delivery (e.g. Uganda -> USA) reach ship-cargo journey
            booking, same as the ride tab already does for flights. */}
        {activeTab === 'delivery' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <EnhancedRideRequest customerId={user?.id} fixedServiceType="delivery" showJourneyOption />
          </div>
        )}

        {/* Become a transport service provider — self-service application,
            reviewed by a developer in DeveloperDashboard's Applications tab */}
        {activeTab === 'become-operator' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <BecomeOperatorForm userId={user?.id} />
          </div>
        )}

        {/* Manage Your Business — register/run a Transport Company or a
            Security Escort service. Each is its own business_profile in the
            shared ICAN business system (icanera.space); this panel only adds
            the BodaGoEra-specific pieces (driver/escort roster, pricing) —
            see ManageBusinessPanel.tsx. */}
        {activeTab === 'manage-business' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <ManageBusinessPanel />
          </div>
        )}

        {/* Shop / Scan + POS */}
        {activeTab === 'shop' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <CustomerSelfCheckout user={user} />
          </div>
        )}

        {/* Orders — real mbg_rides history (rides booked via Book a Ride) */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
          {user?.id && <RefundableDeliveries customerId={user.id} />}
          {user?.id && <JourneyTracker customerId={user.id} />}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Bike size={16} className="text-orange-500" /> Rides &amp; Deliveries
            </h3>
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
                    serviceIcon={r.service_type === 'delivery' ? <Package size={14} className="text-blue-500" /> : <Bike size={14} className="text-orange-500" />}
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
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
            <h3 className="font-bold text-slate-800 mb-5 flex items-center gap-2">
              <User size={16} className="text-orange-500" /> My Profile
            </h3>
            <div className="flex items-center gap-4 mb-5 p-4 bg-orange-50 rounded-xl">
              <div className="w-16 h-16 bg-gradient-to-br from-orange-400 to-yellow-500 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                {(user?.email?.[0] || 'U').toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-slate-800">{user?.email}</p>
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
    </div>
  );
}
