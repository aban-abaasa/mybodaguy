import { useState, useEffect, useRef } from 'react';
import {
  Bike, Clock, Star, LogOut, Package, ShoppingBag, History,
  ShoppingCart, LayoutDashboard, Gift, User, Wallet, MoreVertical,
  X, TrendingUp, CheckCircle, ArrowDownLeft, ArrowUpRight, RefreshCw,
  MapPin, Phone, ChevronRight, DollarSign, Navigation,
} from 'lucide-react';
import { supabase } from '../../services/supabaseClient';
import { getBalance, getTransactions, type ICANBalance, type ICANTransaction } from '../services/icanWalletService';
import EnhancedRideRequest from '../components/EnhancedRideRequest';
import CustomerSelfCheckout from '../components/CustomerSelfCheckout';
import IcanCoinCard from '../components/IcanCoinCard';

interface CustomerDashboardProps {
  user: any;
  onSignOut: () => void;
}

type TabType = 'overview' | 'book-ride' | 'delivery' | 'shop' | 'orders' | 'rewards' | 'profile';

const ALL_TABS = [
  { id: 'profile'   as TabType, label: 'Profile',   emoji: '👤' },
  { id: 'overview'  as TabType, label: 'Overview',  emoji: '🏠' },
  { id: 'book-ride' as TabType, label: 'Book Ride', emoji: '🏍️' },
  { id: 'delivery'  as TabType, label: 'Delivery',  emoji: '📦' },
  { id: 'shop'      as TabType, label: 'Shop',      emoji: '🛒' },
  { id: 'orders'    as TabType, label: 'Orders',    emoji: '📋' },
  { id: 'rewards'   as TabType, label: 'Rewards',   emoji: '🎁' },
];

// ── Delivery request form ─────────────────────────────────────────────────────
const STORES = [
  { name: 'Shoprite', emoji: '🛒', color: 'from-red-500 to-red-600' },
  { name: 'Carrefour', emoji: '🏪', color: 'from-blue-500 to-blue-600' },
  { name: 'Quality Supermarket', emoji: '🏬', color: 'from-green-500 to-green-600' },
  { name: 'Game', emoji: '🎮', color: 'from-purple-500 to-purple-600' },
  { name: 'Capital Shoppers', emoji: '🛍️', color: 'from-orange-500 to-orange-600' },
  { name: 'Uchumi', emoji: '🏪', color: 'from-teal-500 to-teal-600' },
];

function CustomerDeliveryTab({ user }: { user: any }) {
  const [view, setView]               = useState<'stores' | 'form' | 'list'>('stores');
  const [deliveries, setDeliveries]   = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [submitting, setSubmitting]   = useState(false);
  const [form, setForm]               = useState({
    store: STORES[0].name, name: user?.email?.split('@')[0] || '',
    phone: '', address: '', items: '', total: '',
  });

  const UID_TAG = `uid:${user?.id}`;

  const loadMyOrders = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('mybodaguy_delivery_requests')
      .select('id, supermarket_name, delivery_address, status, total_ugx, delivery_fee_ican, created_at')
      .ilike('delivery_notes', `%${UID_TAG}%`)
      .order('created_at', { ascending: false })
      .limit(20);
    setDeliveries(data || []);
    setLoading(false);
  };

  useEffect(() => { loadMyOrders(); }, [user?.id]);

  const submit = async () => {
    if (!form.phone || !form.address || !form.items) {
      alert('Please fill in phone, address and items.'); return;
    }
    setSubmitting(true);
    try {
      const total = Number(form.total) || 0;
      const fee   = Math.max(3000, total * 0.05); // 5% delivery fee, min 3k UGX
      const { error } = await supabase.from('mybodaguy_delivery_requests').insert({
        supermarket_name:  form.store,
        pickup_address:    form.store + ', Kampala',
        customer_name:     form.name,
        customer_phone:    form.phone,
        delivery_address:  form.address,
        delivery_notes:    UID_TAG,
        items_summary:     form.items,
        total_ugx:         total,
        delivery_fee_ugx:  fee,
        delivery_fee_ican: fee / 5000,
        status:            'pending',
      });
      if (error) throw error;
      setView('list');
      setForm(f => ({ ...f, phone: '', address: '', items: '', total: '' }));
      loadMyOrders();
    } catch (e: any) {
      alert(e.message || 'Could not place order');
    } finally {
      setSubmitting(false);
    }
  };

  const STATUS_COLOR: Record<string, string> = {
    pending:    'bg-yellow-100 text-yellow-700',
    assigned:   'bg-blue-100 text-blue-700',
    picked_up:  'bg-cyan-100 text-cyan-700',
    in_transit: 'bg-indigo-100 text-indigo-700',
    delivered:  'bg-emerald-100 text-emerald-700',
    cancelled:  'bg-red-100 text-red-700',
  };

  return (
    <div className="space-y-4">
      {/* Header with Navigation */}
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
          <Package size={20} className="text-emerald-500" /> Delivery
        </h3>
        <div className="flex gap-2">
          <button onClick={() => setView('stores')}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${view === 'stores' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            Stores
          </button>
          <button onClick={() => setView('list')}
            className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-all ${view === 'list' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            Orders
          </button>
        </div>
      </div>

      {/* Store Selection Grid */}
      {view === 'stores' && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {STORES.map(store => (
            <button key={store.name}
              onClick={() => {
                setForm(f => ({ ...f, store: store.name }));
                setView('form');
              }}
              className={`bg-gradient-to-br ${store.color} rounded-2xl shadow-lg p-5 text-white hover:scale-105 transition-transform active:scale-95`}
            >
              <div className="flex flex-col items-center gap-2">
                <span className="text-4xl">{store.emoji}</span>
                <span className="text-xs sm:text-sm font-bold text-center leading-tight">{store.name}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {view === 'form' && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-slate-700 flex items-center gap-2">
              <ShoppingBag size={18} className="text-emerald-500" />
              Order from {form.store}
            </h4>
            <button onClick={() => setView('stores')}
              className="text-slate-400 hover:text-slate-600">
              <X size={20} />
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 font-medium mb-1 flex items-center gap-1">
                <User size={12} /> Your Name
              </label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Full name" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium mb-1 flex items-center gap-1">
                <Phone size={12} /> Phone *
              </label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+256..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium mb-1 flex items-center gap-1">
              <MapPin size={12} /> Delivery Address *
            </label>
            <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Street, area, landmark" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium mb-1 flex items-center gap-1">
              <ShoppingCart size={12} /> Items Needed *
            </label>
            <textarea value={form.items} onChange={e => setForm(f => ({ ...f, items: e.target.value }))}
              rows={3} placeholder="e.g. 2x milk 1L, 1x bread loaf, 3x eggs..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none" />
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium mb-1 flex items-center gap-1">
              <DollarSign size={12} /> Estimated Total (UGX)
            </label>
            <input type="number" value={form.total} onChange={e => setForm(f => ({ ...f, total: e.target.value }))}
              placeholder="0" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <p className="text-xs text-emerald-700">
              📦 Delivery fee: 5% of order total (min UGX 3,000) · Paid in ICAN coins
            </p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setView('stores')} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={submit} disabled={submitting}
              className="flex-1 py-2.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-semibold rounded-xl text-sm hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
              {submitting ? 'Placing…' : <><Package size={16} /> Place Order</>}
            </button>
          </div>
        </div>
      )}

      {view === 'list' && (
        <>
          <button onClick={loadMyOrders} className="text-xs text-emerald-500 flex items-center gap-1 hover:opacity-80">
            <RefreshCw size={12} /> Refresh
          </button>
          {loading ? (
            <p className="text-slate-500 text-sm text-center py-8">Loading your orders…</p>
          ) : deliveries.length === 0 ? (
            <div className="bg-white rounded-xl p-10 text-center shadow-sm border border-slate-100">
              <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No delivery orders yet.</p>
              <button onClick={() => setView('stores')}
                className="mt-4 px-5 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg text-sm font-medium">
                Place Your First Order
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {deliveries.map(d => (
                <div key={d.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-semibold text-slate-800 text-sm">🏪 {d.supermarket_name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{d.delivery_address}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${STATUS_COLOR[d.status] || 'bg-slate-100 text-slate-500'}`}>
                      {d.status.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{new Date(d.created_at).toLocaleDateString()}</span>
                    <span className="font-medium text-slate-700">UGX {Number(d.total_ugx || 0).toLocaleString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

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
  const [activeTab, setActiveTab]       = useState<TabType>('profile');
  const [mobileMenuOpen, setMobileMenu] = useState(false);
  const [rides, setRides]               = useState<any[]>([]);
  const [ridesLoading, setRidesLoading] = useState(false);
  const menuRef                         = useRef<HTMLDivElement>(null);

  // Close mobile menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMobileMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch ride history: users → customers → rides
  useEffect(() => {
    if (!user?.id) return;
    setRidesLoading(true);
    const load = async () => {
      const { data: cr } = await supabase.from('customers').select('id').eq('user_id', user.id).maybeSingle();
      if (!cr?.id) { setRidesLoading(false); return; }
      const { data } = await supabase
        .from('rides')
        .select('id, created_at, pickup_location, dropoff_location, status, fare')
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

      {/* ── Sticky Header ── */}
      <header className="sticky top-0 z-50 shadow-md">

        {/* Row 1 — brand + user */}
        <div className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white">
          <div className="px-3">
            <div className="flex items-center justify-between h-12">
              <div className="flex items-center gap-2">
                <Bike size={20} />
                <div>
                  <p className="font-bold leading-none text-sm">My Boda Guy</p>
                  <p className="text-[9px] opacity-75">Your Trusted Partner</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={onSignOut}
                  className="flex items-center gap-1 px-2 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs transition-colors">
                  <LogOut size={12} />
                  <span className="hidden sm:inline text-xs">Out</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Row 2 — Minimal nav tabs with visible scrollbar */}
        <div className="bg-white border-b border-orange-100 relative">
          <div className="px-2">
            <nav 
              className="flex overflow-x-auto gap-1 py-1.5 pb-3"
              style={{ 
                scrollbarWidth: 'thin',
                scrollbarColor: '#f97316 #f3f4f6'
              }}
            >
              {ALL_TABS.map(tab => (
                <button key={tab.id} onClick={() => switchTab(tab.id)}
                  className={`px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-all flex-shrink-0 border ${
                    activeTab === tab.id
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'text-slate-600 border-slate-200 hover:border-orange-300'
                  }`}>
                  {tab.label}
                </button>
              ))}
              <button onClick={() => (window.location.href = '/ican-wallet')}
                className="px-2 py-1 rounded-md text-xs font-medium whitespace-nowrap text-violet-600 border border-violet-200 hover:border-violet-400 transition-all flex-shrink-0">
                ₡ Wallet
              </button>
            </nav>
          </div>
          {/* Fade indicator on right side */}
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent pointer-events-none"></div>
        </div>
        
        <style jsx>{`
          nav::-webkit-scrollbar {
            height: 4px;
          }
          nav::-webkit-scrollbar-track {
            background: #f3f4f6;
            border-radius: 10px;
          }
          nav::-webkit-scrollbar-thumb {
            background: #f97316;
            border-radius: 10px;
          }
          nav::-webkit-scrollbar-thumb:hover {
            background: #ea580c;
          }
        `}</style>
      </header>

      {/* ── Tab Content - No extra padding ── */}
      <div className="px-2 py-2">

        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-2">
            {/* Quick Actions Grid */}
            <div className="grid grid-cols-3 gap-2">
              {/* ICAN Wallet */}
              <button
                onClick={() => (window.location.href = '/ican-wallet')}
                className="bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl shadow-lg p-3 text-white hover:scale-105 transition-transform active:scale-95"
              >
                <div className="flex flex-col items-center gap-1">
                  <Wallet className="w-7 h-7 sm:w-8 sm:h-8" />
                  <span className="text-xs font-bold">ICAN</span>
                </div>
              </button>

              {/* Book Ride */}
              <button
                onClick={() => setActiveTab('book-ride')}
                className="bg-gradient-to-br from-orange-500 to-red-600 rounded-xl shadow-lg p-3 text-white hover:scale-105 transition-transform active:scale-95"
              >
                <div className="flex flex-col items-center gap-1">
                  <Bike className="w-7 h-7 sm:w-8 sm:h-8" />
                  <span className="text-xs font-bold">Ride</span>
                </div>
              </button>

              {/* Delivery */}
              <button
                onClick={() => setActiveTab('delivery')}
                className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl shadow-lg p-3 text-white hover:scale-105 transition-transform active:scale-95"
              >
                <div className="flex flex-col items-center gap-1">
                  <Package className="w-7 h-7 sm:w-8 sm:h-8" />
                  <span className="text-xs font-bold">Delivery</span>
                </div>
              </button>

              {/* Shop / POS */}
              <button
                onClick={() => setActiveTab('shop')}
                className="bg-gradient-to-br from-blue-500 to-cyan-600 rounded-xl shadow-lg p-3 text-white hover:scale-105 transition-transform active:scale-95"
              >
                <div className="flex flex-col items-center gap-1">
                  <ShoppingCart className="w-7 h-7 sm:w-8 sm:h-8" />
                  <span className="text-xs font-bold">Shop</span>
                </div>
              </button>

              {/* Orders History */}
              <button
                onClick={() => setActiveTab('orders')}
                className="bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl shadow-lg p-3 text-white hover:scale-105 transition-transform active:scale-95"
              >
                <div className="flex flex-col items-center gap-1">
                  <History className="w-7 h-7 sm:w-8 sm:h-8" />
                  <span className="text-xs font-bold">Orders</span>
                </div>
              </button>

              {/* Rewards */}
              <button
                onClick={() => setActiveTab('rewards')}
                className="bg-gradient-to-br from-pink-500 to-rose-600 rounded-xl shadow-lg p-3 text-white hover:scale-105 transition-transform active:scale-95"
              >
                <div className="flex flex-col items-center gap-1">
                  <Gift className="w-7 h-7 sm:w-8 sm:h-8" />
                  <span className="text-xs font-bold">Rewards</span>
                </div>
              </button>
            </div>

            {/* Quick Stats Banner */}
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-xl p-3 text-white shadow-lg">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Bike className="w-3 h-3" />
                    <span className="text-[10px] opacity-75">Rides</span>
                  </div>
                  <p className="text-base font-bold">{rides.length}</p>
                </div>
                <div>
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Package className="w-3 h-3" />
                    <span className="text-[10px] opacity-75">Deliveries</span>
                  </div>
                  <p className="text-base font-bold">0</p>
                </div>
                <div>
                  <div className="flex items-center justify-center gap-1 mb-1">
                    <Star className="w-3 h-3" />
                    <span className="text-[10px] opacity-75">Points</span>
                  </div>
                  <p className="text-base font-bold">0</p>
                </div>
              </div>
            </div>

            {/* Recent rides */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-3">
              <h3 className="font-bold text-slate-800 text-sm mb-2 flex items-center gap-1">
                <History size={14} className="text-orange-500" /> Recent Rides
              </h3>
              {ridesLoading ? (
                <p className="text-slate-400 text-xs">Loading…</p>
              ) : rides.length === 0 ? (
                <p className="text-slate-400 text-xs text-center py-4">No rides yet — book your first one!</p>
              ) : (
                <div className="space-y-1">
                  {rides.slice(0, 5).map(r => (
                    <div key={r.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                      <div className="flex-1 min-w-0 pr-2">
                        <p className="text-xs font-medium text-slate-700 truncate">{r.pickup_location} → {r.dropoff_location}</p>
                        <p className="text-[10px] text-slate-400">{new Date(r.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-bold text-slate-800">{(r.fare || 0).toLocaleString()}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(r.status)}`}>{r.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Book Ride */}
        {activeTab === 'book-ride' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <EnhancedRideRequest customerId={user?.id} />
          </div>
        )}

        {/* Delivery */}
        {activeTab === 'delivery' && <CustomerDeliveryTab user={user} />}

        {/* Shop / Scan + POS */}
        {activeTab === 'shop' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <CustomerSelfCheckout user={user} />
          </div>
        )}

        {/* Orders — rides + deliveries */}
        {activeTab === 'orders' && (
          <div className="space-y-5">
            {/* Rides */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Bike size={16} className="text-orange-500" /> Ride History
              </h3>
              {ridesLoading ? (
                <p className="text-slate-400 text-sm">Loading…</p>
              ) : rides.length === 0 ? (
                <div className="text-center py-8">
                  <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-400 text-sm">No rides yet.</p>
                  <button onClick={() => setActiveTab('book-ride')}
                    className="mt-3 px-5 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-lg text-sm font-medium">
                    Book a Ride
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {rides.map(r => (
                    <div key={r.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                      <div>
                        <p className="font-medium text-slate-800 text-sm">{r.pickup_location} → {r.dropoff_location}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{new Date(r.created_at).toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-slate-800 text-sm">UGX {(r.fare || 0).toLocaleString()}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(r.status)}`}>{r.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Deliveries (reuse DeliveryTab in list-only mode) */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Package size={16} className="text-blue-500" /> Delivery Orders
              </h3>
              <CustomerDeliveryTab user={user} />
            </div>
          </div>
        )}

        {/* Rewards */}
        {activeTab === 'rewards' && <RewardsTab user={user} />}

        {/* Profile */}
        {activeTab === 'profile' && (
          <ProfilePage user={user} rides={rides} onSignOut={onSignOut} />
        )}
      </div>
    </div>
  );
}

// Separate Profile Page Component with Expandable Sections
function ProfilePage({ user, rides, onSignOut }: { user: any; rides: any[]; onSignOut: () => void }) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className="space-y-4">
      {/* Profile Header Card - Always Visible */}
      <div className="bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 rounded-3xl shadow-2xl overflow-hidden">
        <div className="p-6 text-center">
          {/* Large Profile Picture */}
          <div className="flex justify-center mb-4">
            <div className="relative">
              <div className="w-32 h-32 bg-gradient-to-br from-orange-400 via-pink-500 to-red-500 rounded-full flex items-center justify-center text-white text-5xl font-bold shadow-2xl ring-4 ring-white">
                {(user?.email?.[0] || 'U').toUpperCase()}
              </div>
              <div className="absolute bottom-0 right-0 w-10 h-10 bg-green-500 rounded-full border-4 border-white flex items-center justify-center">
                <CheckCircle size={20} className="text-white" />
              </div>
            </div>
          </div>

          {/* User Info */}
          <h2 className="text-2xl font-bold text-white mb-1">
            {user?.email?.split('@')[0] || 'User'}
          </h2>
          <p className="text-purple-200 text-sm mb-1">{user?.email}</p>
          <div className="inline-flex items-center gap-1.5 bg-white/20 backdrop-blur-sm rounded-full px-3 py-1 text-white text-xs font-medium">
            <Star size={12} className="text-yellow-300 fill-yellow-300" />
            My Boda Guy Customer
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-px bg-white/10 backdrop-blur-sm">
          <div className="bg-white/5 backdrop-blur-sm p-4 text-center">
            <div className="text-2xl font-bold text-white">{rides.length}</div>
            <div className="text-xs text-purple-200">Rides</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm p-4 text-center">
            <div className="text-2xl font-bold text-white">0</div>
            <div className="text-xs text-purple-200">Deliveries</div>
          </div>
          <div className="bg-white/5 backdrop-blur-sm p-4 text-center">
            <div className="text-2xl font-bold text-white">★ 5.0</div>
            <div className="text-xs text-purple-200">Rating</div>
          </div>
        </div>
      </div>

      {/* Account Information - Expandable */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <button
          onClick={() => toggleSection('account')}
          className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 px-5 py-4 flex items-center justify-between hover:from-blue-600 hover:to-cyan-600 transition-all"
        >
          <div className="flex items-center gap-2 text-white">
            <User size={18} />
            <span className="font-bold">Account Information</span>
          </div>
          <ChevronRight 
            size={20} 
            className={`text-white transition-transform ${expandedSection === 'account' ? 'rotate-90' : ''}`}
          />
        </button>
        
        {expandedSection === 'account' && (
          <div className="p-5 space-y-3 animate-slideDown">
            {[
              { icon: '📧', label: 'Email Address', value: user?.email, color: 'from-blue-500 to-cyan-500' },
              { icon: '🆔', label: 'User ID', value: user?.id?.slice(0, 20) + '...', color: 'from-purple-500 to-pink-500', mono: true },
              { icon: '📅', label: 'Member Since', value: user?.created_at ? new Date(user.created_at).toLocaleDateString('en-UG', { day: 'numeric', month: 'long', year: 'numeric' }) : '—', color: 'from-green-500 to-emerald-500' },
              { icon: '🎯', label: 'Total Rides', value: rides.length.toString(), color: 'from-orange-500 to-red-500' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <div className={`w-10 h-10 bg-gradient-to-br ${item.color} rounded-full flex items-center justify-center text-xl flex-shrink-0`}>
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-500 font-medium">{item.label}</p>
                  <p className={`font-semibold text-slate-800 truncate ${item.mono ? 'font-mono text-xs' : 'text-sm'}`}>
                    {item.value}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions - Expandable */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <button
          onClick={() => toggleSection('actions')}
          className="w-full bg-gradient-to-r from-purple-500 to-pink-500 px-5 py-4 flex items-center justify-between hover:from-purple-600 hover:to-pink-600 transition-all"
        >
          <div className="flex items-center gap-2 text-white">
            <LayoutDashboard size={18} />
            <span className="font-bold">Quick Actions</span>
          </div>
          <ChevronRight 
            size={20} 
            className={`text-white transition-transform ${expandedSection === 'actions' ? 'rotate-90' : ''}`}
          />
        </button>
        
        {expandedSection === 'actions' && (
          <div className="p-4 grid grid-cols-2 gap-3 animate-slideDown">
            <button className="flex flex-col items-center gap-2 p-4 bg-gradient-to-br from-blue-50 to-cyan-50 hover:from-blue-100 hover:to-cyan-100 rounded-xl border-2 border-blue-200 transition-all active:scale-95">
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center text-white">
                <User size={20} />
              </div>
              <span className="text-sm font-semibold text-blue-800">Edit Profile</span>
            </button>

            <button 
              onClick={() => (window.location.href = '/ican-wallet')}
              className="flex flex-col items-center gap-2 p-4 bg-gradient-to-br from-purple-50 to-pink-50 hover:from-purple-100 hover:to-pink-100 rounded-xl border-2 border-purple-200 transition-all active:scale-95"
            >
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full flex items-center justify-center text-white">
                <Wallet size={20} />
              </div>
              <span className="text-sm font-semibold text-purple-800">₡ Wallet</span>
            </button>

            <button className="flex flex-col items-center gap-2 p-4 bg-gradient-to-br from-green-50 to-emerald-50 hover:from-green-100 hover:to-emerald-100 rounded-xl border-2 border-green-200 transition-all active:scale-95">
              <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-emerald-500 rounded-full flex items-center justify-center text-white">
                <History size={20} />
              </div>
              <span className="text-sm font-semibold text-green-800">History</span>
            </button>

            <button className="flex flex-col items-center gap-2 p-4 bg-gradient-to-br from-orange-50 to-red-50 hover:from-orange-100 hover:to-red-100 rounded-xl border-2 border-orange-200 transition-all active:scale-95">
              <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-red-500 rounded-full flex items-center justify-center text-white">
                <Gift size={20} />
              </div>
              <span className="text-sm font-semibold text-orange-800">Rewards</span>
            </button>
          </div>
        )}
      </div>

      {/* Settings & Support - Expandable */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <button
          onClick={() => toggleSection('settings')}
          className="w-full bg-gradient-to-r from-slate-700 to-slate-900 px-5 py-4 flex items-center justify-between hover:from-slate-800 hover:to-black transition-all"
        >
          <div className="flex items-center gap-2 text-white">
            <User size={18} />
            <span className="font-bold">Settings & Support</span>
          </div>
          <ChevronRight 
            size={20} 
            className={`text-white transition-transform ${expandedSection === 'settings' ? 'rotate-90' : ''}`}
          />
        </button>
        
        {expandedSection === 'settings' && (
          <div className="p-3 animate-slideDown">
            {[
              { icon: '🔔', label: 'Notifications', color: 'text-blue-600' },
              { icon: '🔒', label: 'Privacy & Security', color: 'text-green-600' },
              { icon: '💳', label: 'Payment Methods', color: 'text-purple-600' },
              { icon: '❓', label: 'Help & Support', color: 'text-orange-600' },
              { icon: 'ℹ️', label: 'About My Boda Guy', color: 'text-slate-600' },
            ].map(item => (
              <button key={item.label} className="w-full flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{item.icon}</span>
                  <span className="font-medium text-slate-800 text-sm">{item.label}</span>
                </div>
                <ChevronRight size={18} className="text-slate-400" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Sign Out Button - Always Visible */}
      <button 
        onClick={onSignOut}
        className="w-full py-4 bg-gradient-to-r from-red-500 to-pink-500 text-white font-bold rounded-2xl shadow-lg hover:shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2"
      >
        <LogOut size={20} />
        Sign Out
      </button>
    </div>
  );
}
