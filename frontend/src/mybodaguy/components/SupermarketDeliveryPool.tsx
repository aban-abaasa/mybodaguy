import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { supabase } from '../services/supabaseClient';

interface Delivery {
  id: string;
  supermarket_name: string;
  pickup_address: string;
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  delivery_notes: string | null;
  items_summary: string | null;
  total_ugx: number;
  delivery_fee_ugx: number;
  delivery_fee_ican: number;
  status: string;
  rider_id: string | null;
  rider_name: string | null;
  created_at: string;
}

const fmtUGX = (n: number) => 'UGX ' + Number(n || 0).toLocaleString();
const fmtIcan = (n: number) => Number(n || 0).toFixed(4) + ' ₡';

// `collapsed` mirrors RiderRideRequests/RiderEscortRequests: this component
// is mounted for the whole dashboard session (not just while the Deliveries
// tab is open) so the pending pool and this rider's active jobs keep polling
// + listening for realtime changes in the background — switching tabs never
// shows stale counts, and the tab badge is always current.
export default function SupermarketDeliveryPool({ user, collapsed = false }: { user: any; collapsed?: boolean }) {
  const [deliveries, setDeliveries]   = useState<Delivery[]>([]);
  const [myActive, setMyActive]       = useState<Delivery[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [accepting, setAccepting]     = useState<string | null>(null);
  const [completing, setCompleting]   = useState<string | null>(null);
  const [tab, setTab]                 = useState<'pool' | 'mine'>('pool');
  const isFirstLoad = useRef(true);

  const load = useCallback(async () => {
    if (isFirstLoad.current) setLoading(true);
    else setRefreshing(true);
    const [{ data: pool }, { data: mine }] = await Promise.all([
      supabase
        .from('mybodaguy_delivery_requests')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(30),
      supabase
        .from('mybodaguy_delivery_requests')
        .select('*')
        .eq('rider_id', user.id)
        .in('status', ['assigned', 'picked_up', 'in_transit'])
        .order('updated_at', { ascending: false }),
    ]);
    setDeliveries(pool || []);
    setMyActive(mine || []);
    setLastLoadedAt(new Date());
    setLoading(false);
    setRefreshing(false);
    isFirstLoad.current = false;
  }, [user.id]);

  useEffect(() => {
    load();
    // Safety net in case the realtime channel below ever drops — matches
    // the polling interval RiderRideRequests uses for the same reason.
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load]);

  // Instant push the moment any delivery is posted, accepted, or updated —
  // so a new pool job (or a change to this rider's active job) shows up
  // without waiting for the next poll tick. Unfiltered: a new pending job
  // from any supermarket, and a status change moving a job in/out of "mine",
  // both need to be caught, which a single-column filter can't cover.
  useEffect(() => {
    const channel = supabase
      .channel('mybodaguy_delivery_requests_pool')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mybodaguy_delivery_requests' },
        () => load()
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  const accept = async (id: string) => {
    setAccepting(id);
    try {
      const { data, error } = await supabase.rpc('rider_accept_delivery', { p_delivery_id: id });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Already taken');
      load();
    } catch (e: any) {
      alert(e.message || 'Could not accept delivery');
    } finally {
      setAccepting(null);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    setCompleting(id);
    try {
      if (status === 'delivered') {
        const { data, error } = await supabase.rpc('complete_mbg_delivery', { p_delivery_id: id });
        if (error) throw error;
        if (data?.ican_earned?.net_credited) {
          alert(`✅ Delivery complete! You earned ${fmtIcan(data.ican_earned.net_credited)} ICAN`);
        }
      } else {
        await supabase
          .from('mybodaguy_delivery_requests')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', id);
      }
      load();
    } catch (e: any) {
      alert(e.message || 'Update failed');
    } finally {
      setCompleting(null);
    }
  };

  const STATUS_NEXT: Record<string, string> = {
    assigned: 'picked_up',
    picked_up: 'in_transit',
    in_transit: 'delivered',
  };
  const STATUS_LABEL: Record<string, string> = {
    assigned: 'Mark Picked Up',
    picked_up: 'Mark In Transit',
    in_transit: 'Mark Delivered',
  };

  // Still mounted while collapsed (polling/realtime above keep running) —
  // just nothing to paint until the rider is actually on this tab.
  if (collapsed) return null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-400 to-yellow-400 rounded-2xl p-4 sm:p-5 text-white">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold flex items-center gap-2">
              🛵 Supermarket Deliveries
              {/* Pulses while live-connected — a quiet cue that this list
                  updates itself, so riders stop reflexively hammering Refresh. */}
              <span className="relative flex h-2 w-2 shrink-0" title="Live updates on">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
              </span>
            </h2>
            <p className="text-orange-100 text-xs sm:text-sm mt-1">
              Pick up deliveries from any supermarket on the platform. Earn ICAN per delivery.
            </p>
          </div>
          <button
            onClick={load}
            disabled={refreshing}
            aria-label="Refresh deliveries"
            className="shrink-0 w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 flex items-center justify-center disabled:opacity-60"
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="flex gap-4 mt-3 text-sm">
          <span>📦 {deliveries.length} pending</span>
          <span>🏃 {myActive.length} active</span>
        </div>
      </div>

      {/* Tabs — taller touch targets for thumbs on a phone */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {[
          { id: 'pool', label: `📦 Available (${deliveries.length})` },
          { id: 'mine', label: `🛵 My Active (${myActive.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`flex-1 py-3 sm:py-2 rounded-lg text-sm font-semibold transition-all
              ${tab === t.id ? 'bg-white text-orange-600 shadow' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {lastLoadedAt && !loading && (
        <p className="text-center text-[11px] text-slate-400 -mt-2">
          Updated {lastLoadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading deliveries…</div>
      ) : tab === 'pool' ? (
        <>
          {deliveries.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 sm:p-12 text-center text-slate-400 shadow-sm">
              <p className="text-4xl mb-3">🛵</p>
              <p>No pending deliveries right now.</p>
              <p className="text-sm mt-1">Check back soon — supermarkets post new deliveries regularly.</p>
              <button
                onClick={load}
                disabled={refreshing}
                className="mt-4 px-5 py-2.5 text-sm font-medium text-orange-500 border border-orange-200 rounded-xl hover:bg-orange-50 active:bg-orange-100 disabled:opacity-60"
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          ) : deliveries.map(d => (
            <DeliveryCard key={d.id} d={d}>
              <button
                onClick={() => accept(d.id)}
                disabled={accepting === d.id}
                className="w-full py-3 sm:py-2.5 bg-gradient-to-r from-orange-400 to-yellow-400 text-white font-semibold rounded-xl hover:opacity-90 active:opacity-80 disabled:opacity-40 text-sm mt-3">
                {accepting === d.id ? 'Accepting…' : `Accept · Earn ${fmtIcan(d.delivery_fee_ican)}`}
              </button>
            </DeliveryCard>
          ))}
        </>
      ) : (
        <>
          {myActive.length === 0 ? (
            <div className="bg-white rounded-2xl p-10 sm:p-12 text-center text-slate-400 shadow-sm">
              <p className="text-4xl mb-3">✅</p>
              <p>No active deliveries. Pick one from the pool!</p>
            </div>
          ) : myActive.map(d => (
            <DeliveryCard key={d.id} d={d}>
              {STATUS_NEXT[d.status] && (
                <button
                  onClick={() => updateStatus(d.id, STATUS_NEXT[d.status])}
                  disabled={completing === d.id}
                  className={`w-full py-3 sm:py-2.5 font-semibold rounded-xl text-sm mt-3 disabled:opacity-40
                    ${STATUS_NEXT[d.status] === 'delivered'
                      ? 'bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white'
                      : 'bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white'}`}>
                  {completing === d.id ? 'Updating…' : STATUS_LABEL[d.status]}
                </button>
              )}
            </DeliveryCard>
          ))}
        </>
      )}
    </div>
  );
}

function DeliveryCard({ d, children }: { d: Delivery; children?: React.ReactNode }) {
  const STATUS_COLORS: Record<string, string> = {
    pending:    'bg-yellow-100 text-yellow-700',
    assigned:   'bg-blue-100 text-blue-700',
    picked_up:  'bg-cyan-100 text-cyan-700',
    in_transit: 'bg-indigo-100 text-indigo-700',
    delivered:  'bg-emerald-100 text-emerald-700',
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 text-sm truncate">🏪 {d.supermarket_name}</p>
          <p className="text-xs text-slate-400 mt-0.5 break-words">{d.pickup_address}</p>
        </div>
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${STATUS_COLORS[d.status] || 'bg-slate-100 text-slate-500'}`}>
          {d.status.replace('_', ' ')}
        </span>
      </div>

      <div className="space-y-1.5 text-sm mb-3">
        <div className="flex gap-2">
          <span className="text-slate-400 w-20 shrink-0">Deliver to</span>
          <span className="text-slate-700 font-medium break-words">{d.customer_name}</span>
        </div>
        <div className="flex gap-2 items-center">
          <span className="text-slate-400 w-20 shrink-0">Phone</span>
          <a href={`tel:${d.customer_phone}`} className="text-blue-500 py-1 -my-1">{d.customer_phone}</a>
        </div>
        <div className="flex gap-2">
          <span className="text-slate-400 w-20 shrink-0">Address</span>
          <span className="text-slate-600 break-words">{d.delivery_address}</span>
        </div>
        {d.items_summary && (
          <div className="flex gap-2">
            <span className="text-slate-400 w-20 shrink-0">Items</span>
            <span className="text-slate-500 text-xs break-words">{d.items_summary}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between bg-orange-50 rounded-xl p-3 gap-2">
        <div className="min-w-0">
          <p className="text-xs text-slate-400">Order value</p>
          <p className="font-semibold text-slate-700 text-sm truncate">{fmtUGX(d.total_ugx)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-slate-400">Your earning</p>
          <p className="font-bold text-orange-600">{fmtUGX(d.delivery_fee_ugx)}</p>
          <p className="text-xs text-emerald-600">{fmtIcan(d.delivery_fee_ican)} ICAN</p>
        </div>
      </div>

      {children}
    </div>
  );
}
