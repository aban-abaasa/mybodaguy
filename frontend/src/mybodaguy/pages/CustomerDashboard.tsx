import { useState, useEffect, useRef } from 'react';
import {
  Bike, Clock, Star, LogOut, Package, ShoppingBag, History,
  ShoppingCart, LayoutDashboard, Gift, User, Wallet, MoreVertical,
  X, TrendingUp, CheckCircle, ArrowDownLeft, ArrowUpRight, RefreshCw,
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
  { id: 'overview'  as TabType, label: 'Overview',  emoji: '🏠' },
  { id: 'book-ride' as TabType, label: 'Book Ride', emoji: '🏍️' },
  { id: 'delivery'  as TabType, label: 'Delivery',  emoji: '📦' },
  { id: 'shop'      as TabType, label: 'Shop',      emoji: '🛒' },
  { id: 'orders'    as TabType, label: 'Orders',    emoji: '📋' },
  { id: 'rewards'   as TabType, label: 'Rewards',   emoji: '🎁' },
  { id: 'profile'   as TabType, label: 'Profile',   emoji: '👤' },
];

// ── Delivery request form ─────────────────────────────────────────────────────
const STORES = ['Shoprite', 'Carrefour', 'Quality Supermarket', 'Game', 'Capital Shoppers', 'Uchumi'];

function CustomerDeliveryTab({ user }: { user: any }) {
  const [view, setView]               = useState<'form' | 'list'>('list');
  const [deliveries, setDeliveries]   = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [submitting, setSubmitting]   = useState(false);
  const [form, setForm]               = useState({
    store: STORES[0], name: user?.email?.split('@')[0] || '',
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
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
          <Package size={20} className="text-blue-500" /> Supermarket Delivery
        </h3>
        <div className="flex gap-2">
          <button onClick={() => setView('list')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${view === 'list' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            My Orders
          </button>
          <button onClick={() => setView('form')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${view === 'form' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            + New Order
          </button>
        </div>
      </div>

      {view === 'form' ? (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 space-y-4">
          <h4 className="font-semibold text-slate-700">Place Delivery Order</h4>
          <div>
            <label className="text-xs text-slate-500 font-medium mb-1 block">Store</label>
            <select value={form.store} onChange={e => setForm(f => ({ ...f, store: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
              {STORES.map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 font-medium mb-1 block">Your Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Full name" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium mb-1 block">Phone *</label>
              <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+256..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium mb-1 block">Delivery Address *</label>
            <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Street, area, landmark" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium mb-1 block">Items Needed *</label>
            <textarea value={form.items} onChange={e => setForm(f => ({ ...f, items: e.target.value }))}
              rows={3} placeholder="e.g. 2x milk 1L, 1x bread loaf, 3x eggs..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none" />
          </div>
          <div>
            <label className="text-xs text-slate-500 font-medium mb-1 block">Estimated Total (UGX)</label>
            <input type="number" value={form.total} onChange={e => setForm(f => ({ ...f, total: e.target.value }))}
              placeholder="0" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </div>
          <div className="flex gap-3">
            <button onClick={() => setView('list')} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={submit} disabled={submitting}
              className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-xl text-sm hover:opacity-90 disabled:opacity-50">
              {submitting ? 'Placing…' : '🏍️ Place Order'}
            </button>
          </div>
          <p className="text-xs text-center text-slate-400">Delivery fee: 5% of order total (min UGX 3,000) · Paid in ICAN coins</p>
        </div>
      ) : (
        <>
          <button onClick={loadMyOrders} className="text-xs text-orange-500 flex items-center gap-1 hover:opacity-80">
            <RefreshCw size={12} /> Refresh
          </button>
          {loading ? (
            <p className="text-slate-500 text-sm text-center py-8">Loading your orders…</p>
          ) : deliveries.length === 0 ? (
            <div className="bg-white rounded-xl p-10 text-center shadow-sm border border-slate-100">
              <Package className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No delivery orders yet.</p>
              <button onClick={() => setView('form')}
                className="mt-4 px-5 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-lg text-sm font-medium">
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
  const [activeTab, setActiveTab]       = useState<TabType>('overview');
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

      {/* ── Sticky 2-row Header ── */}
      <header className="sticky top-0 z-50 shadow-md">

        {/* Row 1 — brand + user + mobile 3-dot */}
        <div className="bg-gradient-to-r from-orange-500 to-yellow-500 text-white">
          <div className="container mx-auto px-4">
            <div className="flex items-center justify-between h-14">
              <div className="flex items-center gap-2">
                <Bike size={22} />
                <div>
                  <p className="font-bold leading-none text-sm">My Boda Guy</p>
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
                {/* 3-dot mobile menu trigger */}
                <div className="relative sm:hidden" ref={menuRef}>
                  <button onClick={() => setMobileMenu(o => !o)}
                    className="p-2 bg-white/20 hover:bg-white/30 rounded-lg transition-colors">
                    {mobileMenuOpen ? <X size={18} /> : <MoreVertical size={18} />}
                  </button>

                  {mobileMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden z-50">
                      {ALL_TABS.map(tab => (
                        <button key={tab.id} onClick={() => switchTab(tab.id)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors text-left
                            ${activeTab === tab.id ? 'bg-orange-50 text-orange-600' : 'text-slate-700 hover:bg-slate-50'}`}>
                          <span>{tab.emoji}</span>
                          {tab.label}
                          {activeTab === tab.id && <CheckCircle size={14} className="ml-auto text-orange-500" />}
                        </button>
                      ))}
                      <button onClick={() => { window.location.href = '/ican-wallet'; setMobileMenu(false); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm font-medium text-violet-600 hover:bg-violet-50 border-t border-slate-100">
                        <span>₡</span> ICAN Wallet
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

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
              <button onClick={() => (window.location.href = '/ican-wallet')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap text-violet-600 hover:bg-violet-50 transition-all flex-shrink-0">
                <Wallet size={14} /> ₡ ICAN Wallet
              </button>
            </nav>
          </div>
        </div>

        {/* Mobile active-tab indicator bar */}
        <div className="sm:hidden bg-white border-b border-orange-100 px-4 py-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">
            {ALL_TABS.find(t => t.id === activeTab)?.emoji}{' '}
            {ALL_TABS.find(t => t.id === activeTab)?.label}
          </span>
          <button onClick={() => setMobileMenu(o => !o)}
            className="text-xs text-orange-500 font-medium flex items-center gap-1">
            <MoreVertical size={14} /> Menu
          </button>
        </div>
      </header>

      {/* ── Tab Content ── */}
      <div className="container mx-auto px-4 py-5">

        {/* Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <IcanCoinCard userId={user?.id} onGoToWallet={() => (window.location.href = '/ican-wallet')} />
              {[
                { label: 'Book a Ride',     desc: 'Get a boda in minutes',  emoji: '🏍️', tab: 'book-ride' as TabType },
                { label: 'Delivery',         desc: 'Supermarket to your door', emoji: '📦', tab: 'delivery' as TabType },
                { label: 'Scan & Checkout',  desc: 'POS · Pay with ICAN',     emoji: '🛒', tab: 'shop' as TabType },
              ].map(c => (
                <button key={c.tab} onClick={() => setActiveTab(c.tab)}
                  className="bg-white rounded-xl shadow-sm border border-slate-100 p-5 text-left hover:shadow-md hover:border-orange-200 transition-all">
                  <p className="text-3xl mb-2">{c.emoji}</p>
                  <p className="font-semibold text-slate-800 text-sm">{c.label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{c.desc}</p>
                </button>
              ))}
            </div>

            {/* Recent rides */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                <History size={16} className="text-orange-500" /> Recent Rides
              </h3>
              {ridesLoading ? (
                <p className="text-slate-400 text-sm">Loading…</p>
              ) : rides.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-6">No rides yet — book your first one!</p>
              ) : (
                <div className="space-y-2">
                  {rides.slice(0, 5).map(r => (
                    <div key={r.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                      <div>
                        <p className="text-sm font-medium text-slate-700">{r.pickup_location} → {r.dropoff_location}</p>
                        <p className="text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-800">UGX {(r.fare || 0).toLocaleString()}</p>
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
                <p className="text-sm text-slate-500 flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> My Boda Guy Customer</p>
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
