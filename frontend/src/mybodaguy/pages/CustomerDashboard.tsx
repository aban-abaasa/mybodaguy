import { useState, useEffect, useRef } from 'react';
import {
  Bike, Clock, Star, Package, ShoppingBag, History,
  ShoppingCart, LayoutDashboard, Gift, User, Wallet, MoreVertical,
  X, TrendingUp, CheckCircle, ArrowDownLeft, ArrowUpRight, RefreshCw,
  ChevronDown, ChevronUp, MapPin, Calendar,
} from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { getBalance, getTransactions, type ICANBalance, type ICANTransaction } from '../services/icanWalletService';
import EnhancedRideRequest from '../components/EnhancedRideRequest';
import BecomeOperatorForm from '../components/BecomeOperatorForm';
import CustomerSelfCheckout from '../components/CustomerSelfCheckout';
import IcanCoinCard from '../components/IcanCoinCard';
import CustomerAreaManager from '../components/CustomerAreaManager';

interface CustomerDashboardProps {
  user: any;
  onSignOut: () => void;
}

// Delivery is its own tab, separate from Book a Ride — both render
// EnhancedRideRequest (the one real matching-engine implementation) but each
// locks it to a single fixedServiceType so Book a Ride never shows the
// delivery toggle and vice versa. Book a Journey is inbuilt into Book a
// Ride itself (a mode toggle inside EnhancedRideRequest, showJourneyOption)
// rather than its own tab.
type TabType = 'overview' | 'book-ride' | 'shop' | 'delivery' | 'orders' | 'areas' | 'rewards' | 'become-operator' | 'profile';

const ALL_TABS = [
  { id: 'overview'  as TabType, label: 'Overview',  emoji: '🏠' },
  { id: 'book-ride' as TabType, label: 'Book a Ride', emoji: '🏍️' },
  { id: 'shop'      as TabType, label: 'Shop',      emoji: '🛒' },
  { id: 'delivery'  as TabType, label: 'Delivery',  emoji: '📦' },
  { id: 'orders'    as TabType, label: 'Orders',    emoji: '📋' },
  { id: 'areas'     as TabType, label: 'My Areas',  emoji: '📍' },
  { id: 'rewards'   as TabType, label: 'Rewards',   emoji: '🎁' },
  { id: 'become-operator' as TabType, label: 'Become a Driver', emoji: '🚚' },
  { id: 'profile'   as TabType, label: 'Profile',   emoji: '👤' },
];

// ── Rewards (ICAN wallet history) ─────────────────────────────────────────────
function RewardsTab({ user }: { user: any }) {
  const [balance, setBalance] = useState<ICANBalance | null>(null);
  const [txs, setTxs]         = useState<ICANTransaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    const load = async () => {
      try {
        const [bal, transactions] = await Promise.all([
          getBalance(user.id),
          getTransactions(user.id, 20),
        ]);
        setBalance(bal);
        setTxs(transactions);
      } catch (_) {}
      setLoading(false);
    };
    load();
  }, [user?.id]);

  const TX_TYPE_LABEL: Record<string, string> = {
    earn: 'Earned', transfer_in: 'Received', transfer_out: 'Sent',
    tithe: 'Tithe', purchase: 'Purchase', sale: 'Sale',
    cashback: 'Cashback', refund: 'Refund',
  };

  return (
    <div className="space-y-4">
      {/* ICAN balance card */}
      <div className="bg-gradient-to-br from-violet-600 to-purple-700 rounded-2xl p-5 text-white">
        <p className="text-violet-200 text-sm mb-1">ICAN Balance</p>
        <p className="text-4xl font-bold">{loading ? '…' : (balance?.ican ?? 0).toFixed(4)} <span className="text-2xl">₡</span></p>
        <p className="text-violet-200 text-xs mt-1">≈ UGX {loading ? '…' : Number(balance?.ugx ?? 0).toLocaleString()}</p>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          {[
            { label: 'Earned', value: balance?.totalEarned },
            { label: 'Spent',  value: balance?.totalSpent },
            { label: 'Tithe',  value: balance?.totalTithe },
          ].map(s => (
            <div key={s.label} className="bg-white/10 rounded-xl p-2">
              <p className="text-xs text-violet-200">{s.label}</p>
              <p className="font-bold text-sm">{loading ? '…' : (s.value ?? 0).toFixed(2)} ₡</p>
            </div>
          ))}
        </div>
        <button onClick={() => (window.location.href = '/ican-wallet')}
          className="mt-4 w-full py-2 bg-white/20 hover:bg-white/30 rounded-xl text-sm font-semibold transition-colors">
          Open Full Wallet →
        </button>
      </div>

      {/* Ride stats */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <TrendingUp size={16} className="text-orange-500" /> Ride Stats
        </h4>
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Earn on rides', icon: '🏍️', value: 'Every ride' },
            { label: 'Delivery cashback', icon: '📦', value: 'Per delivery' },
            { label: 'Shop with ICAN', icon: '🛒', value: 'Pay at checkout' },
          ].map(s => (
            <div key={s.label} className="bg-orange-50 rounded-xl p-3 text-center">
              <p className="text-xl mb-1">{s.icon}</p>
              <p className="text-xs font-medium text-slate-700">{s.value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Transaction history */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
        <h4 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <History size={16} className="text-orange-500" /> Recent Transactions
        </h4>
        {loading ? (
          <p className="text-slate-400 text-sm text-center py-4">Loading…</p>
        ) : txs.length === 0 ? (
          <p className="text-slate-400 text-sm text-center py-4">No transactions yet. Start using ICAN coins!</p>
        ) : (
          <div className="space-y-2">
            {txs.map(tx => (
              <div key={tx.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div className="flex items-center gap-2">
                  {tx.direction === 'in'
                    ? <ArrowDownLeft size={16} className="text-emerald-500" />
                    : <ArrowUpRight size={16} className="text-red-400" />}
                  <div>
                    <p className="text-sm text-slate-700 font-medium">{TX_TYPE_LABEL[tx.transaction_type] || tx.transaction_type}</p>
                    <p className="text-xs text-slate-400">{new Date(tx.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
                <p className={`font-bold text-sm ${tx.direction === 'in' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {tx.direction === 'in' ? '+' : '-'}{tx.ican_amount.toFixed(4)} ₡
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function CustomerDashboard({ user, onSignOut }: CustomerDashboardProps) {
  const [activeTab, setActiveTab]       = useState<TabType>('overview');
  const [mobileMenuOpen, setMobileMenu] = useState(false);
  const [rides, setRides]               = useState<any[]>([]);
  const [ridesLoading, setRidesLoading] = useState(false);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [recentRidesExpanded, setRecentRidesExpanded] = useState(false);
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
    const load = async () => {
      const { data: cr } = await supabase.from('mbg_customers').select('id').eq('user_id', user.id).maybeSingle();
      if (!cr?.id) { setRidesLoading(false); return; }
      const { data } = await supabase
        .from('mbg_rides')
        .select('id, created_at, pickup_location, dropoff_location, status, fare, service_type')
        .eq('customer_id', cr.id)
        .order('created_at', { ascending: false })
        .limit(20);
      setRides(data || []);
      setRidesLoading(false);
    };
    load();
  }, [user?.id]);

  const statusColor = (s: string) => {
    if (s === 'completed') return 'bg-green-100 text-green-700';
    if (s === 'cancelled') return 'bg-red-100 text-red-700';
    if (s === 'pending')   return 'bg-yellow-100 text-yellow-700';
    return 'bg-blue-100 text-blue-700';
  };

  const switchTab = (id: TabType) => { setActiveTab(id); setMobileMenu(false); };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50">

      {/* ── Tab Navigation (Desktop & Mobile) ── */}
      <div className="sticky top-0 z-40 bg-white border-b border-orange-100 shadow-sm">
        {/* Desktop Tabs */}
        <div className="hidden sm:block">
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
            </nav>
          </div>
        </div>

        {/* Mobile Tab Selector */}
        <div className="sm:hidden px-4 py-2 flex items-center justify-between relative" ref={menuRef}>
          <span className="text-sm font-semibold text-slate-700">
            {ALL_TABS.find(t => t.id === activeTab)?.emoji}{' '}
            {ALL_TABS.find(t => t.id === activeTab)?.label}
          </span>
          <button onClick={() => setMobileMenu(o => !o)}
            className="text-xs text-orange-500 font-medium flex items-center gap-1">
            {mobileMenuOpen ? <X size={14} /> : <MoreVertical size={14} />} Menu
          </button>

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
            </div>
          )}
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div className="container mx-auto px-4 py-5">

        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <IcanCoinCard userId={user?.id} onGoToWallet={() => (window.location.href = '/ican-wallet')} />
              {[
                { label: 'Book a Ride', desc: 'Boda ride or a delivery', emoji: '🏍️', tab: 'book-ride' as TabType },
                { label: 'Scan & Checkout',  desc: 'POS · Pay with ICAN',     emoji: '🛒', tab: 'shop' as TabType },
                { label: 'My Orders',       desc: 'Track rides & deliveries', emoji: '📋', tab: 'orders' as TabType },
              ].map(c => (
                <button key={c.tab} onClick={() => setActiveTab(c.tab)}
                  className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 text-left hover:shadow-md hover:border-orange-200 transition-all">
                  <p className="text-3xl mb-2">{c.emoji}</p>
                  <p className="font-semibold text-slate-800 text-sm">{c.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{c.desc}</p>
                </button>
              ))}
            </div>

            {/* Recent rides - COLLAPSIBLE SECTION */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              {/* Section Header - Click to Expand/Collapse */}
              <button
                onClick={() => setRecentRidesExpanded(!recentRidesExpanded)}
                className="w-full flex items-center justify-between p-3 md:p-5 text-left hover:bg-slate-50 transition-colors border-b border-slate-100"
              >
                <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm md:text-base">
                  <History size={16} className="text-orange-500" /> Recent Rides
                  {rides.length > 0 && (
                    <span className="bg-orange-100 text-orange-600 text-xs md:text-sm font-bold px-2 py-0.5 rounded-full">
                      {rides.length}
                    </span>
                  )}
                </h3>
                <div className="flex items-center gap-2">
                  {ridesLoading && <RefreshCw size={14} className="text-slate-400 animate-spin" />}
                  {recentRidesExpanded ? 
                    <ChevronUp size={20} className="text-slate-400" /> : 
                    <ChevronDown size={20} className="text-slate-400" />
                  }
                </div>
              </button>

              {/* Expanded Content */}
              {recentRidesExpanded && (
                <div className="p-3 md:p-5">
                  {ridesLoading ? (
                    <div className="flex items-center justify-center py-8 gap-2">
                      <RefreshCw size={20} className="text-orange-500 animate-spin" />
                      <p className="text-slate-400 text-sm">Loading rides...</p>
                    </div>
                  ) : rides.length === 0 ? (
                    <div className="text-center py-8">
                      <Bike className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                      <p className="text-slate-400 text-sm mb-3">No rides yet — book your first one!</p>
                      <button 
                        onClick={() => setActiveTab('book-ride')}
                        className="px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-lg text-sm font-medium hover:shadow-lg transition-all"
                      >
                        Book a Ride
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {rides.slice(0, 5).map(r => {
                        const isExpanded = expandedOrderId === r.id;
                        return (
                          <div key={r.id} className="border border-slate-200 rounded-lg overflow-hidden hover:border-orange-300 transition-all">
                            {/* Collapsed View */}
                            <button
                              onClick={() => setExpandedOrderId(isExpanded ? null : r.id)}
                              className="w-full flex items-center justify-between p-2 md:p-3 text-left hover:bg-slate-50 transition-colors"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-xs md:text-sm font-medium text-slate-700 truncate flex items-center gap-1.5">
                                  {r.service_type === 'delivery' ? 
                                    <Package size={12} className="text-blue-500 flex-shrink-0" /> : 
                                    <Bike size={12} className="text-orange-500 flex-shrink-0" />
                                  }
                                  {r.pickup_location} → {r.dropoff_location}
                                </p>
                                <p className="text-[10px] md:text-xs text-slate-400 mt-0.5">{new Date(r.created_at).toLocaleDateString()}</p>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                <div className="text-right">
                                  <p className="text-xs md:text-sm font-bold text-slate-800 leading-none">UGX {(r.fare || 0).toLocaleString()}</p>
                                  <span className={`text-[10px] md:text-xs px-1.5 py-0.5 rounded-full font-medium mt-0.5 inline-block ${statusColor(r.status)}`}>
                                    {r.status}
                                  </span>
                                </div>
                                {isExpanded ? 
                                  <ChevronUp size={14} className="text-slate-400" /> : 
                                  <ChevronDown size={14} className="text-slate-400" />
                                }
                              </div>
                            </button>

                            {/* Expanded Details */}
                            {isExpanded && (
                              <div className="border-t border-slate-200 bg-slate-50 p-2 md:p-3 space-y-2">
                                <div className="flex items-center gap-3 text-[10px] md:text-xs">
                                  <div className="flex items-center gap-1">
                                    {r.service_type === 'delivery' ? 
                                      <Package size={12} className="text-blue-500" /> : 
                                      <Bike size={12} className="text-orange-500" />
                                    }
                                    <span className="font-medium text-slate-700 capitalize">{r.service_type}</span>
                                  </div>
                                  <div className="flex items-center gap-1 text-slate-500">
                                    <Calendar size={12} />
                                    {new Date(r.created_at).toLocaleString()}
                                  </div>
                                </div>
                                <div className="pt-2 border-t border-slate-200">
                                  <p className="text-[9px] md:text-[10px] text-slate-400 font-mono">
                                    Order ID: {r.id.slice(0, 8)}...
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {rides.length > 5 && (
                        <button
                          onClick={() => setActiveTab('orders')}
                          className="w-full py-2 text-sm text-orange-600 hover:text-orange-700 font-medium hover:bg-orange-50 rounded-lg transition-colors"
                        >
                          View All {rides.length} Orders →
                        </button>
                      )}
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
            to delivery so the two never mix */}
        {activeTab === 'delivery' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <EnhancedRideRequest customerId={user?.id} fixedServiceType="delivery" />
          </div>
        )}

        {/* Become a transport service provider — self-service application,
            reviewed by a developer in DeveloperDashboard's Applications tab */}
        {activeTab === 'become-operator' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <BecomeOperatorForm userId={user?.id} />
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
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-3 md:p-5">
            <h3 className="font-bold text-slate-800 mb-3 md:mb-4 flex items-center gap-2 text-sm md:text-base">
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
              <div className="space-y-2">
                {rides.map(r => {
                  const isExpanded = expandedOrderId === r.id;
                  return (
                    <div key={r.id} className="border border-slate-200 rounded-lg md:rounded-xl overflow-hidden bg-slate-50 hover:border-orange-300 transition-all">
                      {/* Collapsed Header - Tap to Expand */}
                      <button
                        onClick={() => setExpandedOrderId(isExpanded ? null : r.id)}
                        className="w-full flex items-center justify-between p-2 md:p-3 text-left hover:bg-slate-100 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-800 text-xs md:text-sm flex items-center gap-1.5 mb-0.5">
                            {r.service_type === 'delivery' ? 
                              <Package size={14} className="text-blue-500 flex-shrink-0" /> : 
                              <Bike size={14} className="text-orange-500 flex-shrink-0" />
                            }
                            <span className="truncate">{r.pickup_location} → {r.dropoff_location}</span>
                          </p>
                          <p className="text-[10px] md:text-xs text-slate-400 leading-none">{new Date(r.created_at).toLocaleDateString()}</p>
                        </div>
                        <div className="flex items-center gap-2 md:gap-3 flex-shrink-0 ml-2">
                          <div className="text-right">
                            <p className="font-bold text-slate-800 text-xs md:text-sm leading-none">UGX {(r.fare || 0).toLocaleString()}</p>
                            <span className={`text-[10px] md:text-xs px-1.5 md:px-2 py-0.5 rounded-full font-medium mt-0.5 inline-block ${statusColor(r.status)}`}>
                              {r.status}
                            </span>
                          </div>
                          {isExpanded ? 
                            <ChevronUp size={16} className="text-slate-400" /> : 
                            <ChevronDown size={16} className="text-slate-400" />
                          }
                        </div>
                      </button>

                      {/* Expanded Details */}
                      {isExpanded && (
                        <div className="border-t border-slate-200 bg-white p-3 md:p-4 space-y-3">
                          {/* Service Type & Date */}
                          <div className="flex items-center gap-4 text-xs md:text-sm">
                            <div className="flex items-center gap-1.5">
                              {r.service_type === 'delivery' ? 
                                <Package size={14} className="text-blue-500" /> : 
                                <Bike size={14} className="text-orange-500" />
                              }
                              <span className="font-medium text-slate-700 capitalize">{r.service_type}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-slate-500">
                              <Calendar size={14} />
                              {new Date(r.created_at).toLocaleString()}
                            </div>
                          </div>

                          {/* Locations */}
                          <div className="space-y-2">
                            <div className="flex items-start gap-2">
                              <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                <MapPin className="text-green-600" size={12} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] md:text-xs text-slate-500 leading-none">Pickup</p>
                                <p className="font-medium text-slate-800 text-xs md:text-sm leading-none mt-0.5">{r.pickup_location}</p>
                              </div>
                            </div>

                            <div className="ml-3 border-l-2 border-dashed border-slate-300 h-4"></div>

                            <div className="flex items-start gap-2">
                              <div className="w-6 h-6 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                                <MapPin className="text-red-600" size={12} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] md:text-xs text-slate-500 leading-none">Drop-off</p>
                                <p className="font-medium text-slate-800 text-xs md:text-sm leading-none mt-0.5">{r.dropoff_location}</p>
                              </div>
                            </div>
                          </div>

                          {/* Status & Fare */}
                          <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                            <div>
                              <p className="text-[10px] md:text-xs text-slate-500 leading-none mb-1">Status</p>
                              <span className={`text-xs md:text-sm px-2 md:px-3 py-1 rounded-full font-medium ${statusColor(r.status)}`}>
                                {r.status}
                              </span>
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] md:text-xs text-slate-500 leading-none mb-1">Fare</p>
                              <p className="text-lg md:text-xl font-bold text-slate-800 leading-none">
                                UGX {(r.fare || 0).toLocaleString()}
                              </p>
                            </div>
                          </div>

                          {/* Order ID */}
                          <div className="pt-2 border-t border-slate-100">
                            <p className="text-[9px] md:text-[10px] text-slate-400 font-mono">
                              Order ID: {r.id.slice(0, 8)}...
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Delivery — Shop-For-Me supermarket delivery orders (separate from ride Orders) */}
        {/* My Areas */}
        {activeTab === 'areas' && <CustomerAreaManager customerId={user?.id} />}

        {/* Rewards */}
        {activeTab === 'rewards' && <RewardsTab user={user} />}

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
                <p className="text-sm text-slate-500 flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> BodaGo Customer</p>
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
              <button onClick={() => (window.location.href = '/ican-wallet')}
                className="flex-1 py-2.5 bg-gradient-to-r from-violet-500 to-purple-600 text-white rounded-xl text-sm font-semibold hover:opacity-90">
                ₡ My Wallet
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
