import { useState, useEffect } from 'react';
import { supabase } from '../../../supabaseClient';

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

export default function SupermarketDeliveryPool({ user }: { user: any }) {
  const [deliveries, setDeliveries]   = useState<Delivery[]>([]);
  const [myActive, setMyActive]       = useState<Delivery[]>([]);
  const [loading, setLoading]         = useState(true);
  const [accepting, setAccepting]     = useState<string | null>(null);
  const [completing, setCompleting]   = useState<string | null>(null);
  const [tab, setTab]                 = useState<'pool' | 'mine'>('pool');

  const load = async () => {
    setLoading(true);
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
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-orange-400 to-yellow-400 rounded-2xl p-5 text-white">
        <h2 className="text-xl font-bold">🛵 Supermarket Deliveries</h2>
        <p className="text-orange-100 text-sm mt-1">
          Pick up deliveries from any supermarket on the platform. Earn ICAN per delivery.
        </p>
        <div className="flex gap-4 mt-3 text-sm">
          <span>📦 {deliveries.length} pending</span>
          <span>🏃 {myActive.length} active</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {[
          { id: 'pool', label: `📦 Available (${deliveries.length})` },
          { id: 'mine', label: `🛵 My Active (${myActive.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all
              ${tab === t.id ? 'bg-white text-orange-600 shadow' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">Loading deliveries…</div>
      ) : tab === 'pool' ? (
        <>
          {deliveries.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center text-slate-400 shadow-sm">
              <p className="text-4xl mb-3">🛵</p>
              <p>No pending deliveries right now.</p>
              <p className="text-sm mt-1">Check back soon — supermarkets post new deliveries regularly.</p>
              <button onClick={load} className="mt-4 px-4 py-2 text-sm text-orange-500 border border-orange-200 rounded-xl hover:bg-orange-50">
                Refresh
              </button>
            </div>
          ) : deliveries.map(d => (
            <DeliveryCard key={d.id} d={d}>
              <button
                onClick={() => accept(d.id)}
                disabled={accepting === d.id}
                className="w-full py-2.5 bg-gradient-to-r from-orange-400 to-yellow-400 text-white font-semibold rounded-xl hover:opacity-90 disabled:opacity-40 text-sm mt-3">
                {accepting === d.id ? 'Accepting…' : `Accept · Earn ${fmtIcan(d.delivery_fee_ican)}`}
              </button>
            </DeliveryCard>
          ))}
        </>
      ) : (
        <>
          {myActive.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center text-slate-400 shadow-sm">
              <p className="text-4xl mb-3">✅</p>
              <p>No active deliveries. Pick one from the pool!</p>
            </div>
          ) : myActive.map(d => (
            <DeliveryCard key={d.id} d={d}>
              {STATUS_NEXT[d.status] && (
                <button
                  onClick={() => updateStatus(d.id, STATUS_NEXT[d.status])}
                  disabled={completing === d.id}
                  className={`w-full py-2.5 font-semibold rounded-xl text-sm mt-3 disabled:opacity-40
                    ${STATUS_NEXT[d.status] === 'delivered'
                      ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                      : 'bg-blue-500 hover:bg-blue-600 text-white'}`}>
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
        <div>
          <p className="font-semibold text-slate-800 text-sm">🏪 {d.supermarket_name}</p>
          <p className="text-xs text-slate-400 mt-0.5">{d.pickup_address}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${STATUS_COLORS[d.status] || 'bg-slate-100 text-slate-500'}`}>
          {d.status.replace('_', ' ')}
        </span>
      </div>

      <div className="space-y-1 text-sm mb-3">
        <div className="flex gap-2">
          <span className="text-slate-400 w-20 shrink-0">Deliver to</span>
          <span className="text-slate-700 font-medium">{d.customer_name}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-slate-400 w-20 shrink-0">Phone</span>
          <a href={`tel:${d.customer_phone}`} className="text-blue-500">{d.customer_phone}</a>
        </div>
        <div className="flex gap-2">
          <span className="text-slate-400 w-20 shrink-0">Address</span>
          <span className="text-slate-600">{d.delivery_address}</span>
        </div>
        {d.items_summary && (
          <div className="flex gap-2">
            <span className="text-slate-400 w-20 shrink-0">Items</span>
            <span className="text-slate-500 text-xs">{d.items_summary}</span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between bg-orange-50 rounded-xl p-3">
        <div>
          <p className="text-xs text-slate-400">Order value</p>
          <p className="font-semibold text-slate-700 text-sm">{`UGX ${Number(d.total_ugx || 0).toLocaleString()}`}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Your earning</p>
          <p className="font-bold text-orange-600">{`UGX ${Number(d.delivery_fee_ugx || 0).toLocaleString()}`}</p>
          <p className="text-xs text-emerald-600">{Number(d.delivery_fee_ican || 0).toFixed(4)} ₡ ICAN</p>
        </div>
      </div>

      {children}
    </div>
  );
}
