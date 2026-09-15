import { useState, useEffect, useCallback, useRef } from 'react';
import { MapPin, Navigation, Check, X, ShieldCheck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';
import { startJobRingLoop, stopJobRingLoop } from '../services/notificationSound';

interface EscortRequestRow {
  id: string;
  ride_id: string;
  status: string;
  fee: number;
  requested_at: string;
  mbg_rides: {
    pickup_location: string;
    dropoff_location: string;
    service_type: 'ride' | 'delivery';
  } | null;
}

export default function RiderEscortRequests({ riderId, collapsed = false }: { riderId: string; collapsed?: boolean }) {
  const [escortRowId, setEscortRowId] = useState<string | null>(null);
  const [pending, setPending] = useState<EscortRequestRow | null>(null);
  const [active, setActive] = useState<EscortRequestRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const lastChimedId = useRef<string | null>(null);

  const load = useCallback(async () => {
    const { data: rider } = await supabase.from('mbg_riders').select('id').eq('user_id', riderId).eq('operator_type', 'escort').maybeSingle();
    if (!rider?.id) {
      setLoading(false);
      return;
    }
    setEscortRowId(rider.id);

    const [{ data: pendingRow }, { data: activeRow }] = await Promise.all([
      supabase.from('mbg_ride_escort_requests').select('*, mbg_rides(pickup_location, dropoff_location, service_type)').eq('escort_rider_id', rider.id).eq('status', 'pending').maybeSingle(),
      supabase.from('mbg_ride_escort_requests').select('*, mbg_rides(pickup_location, dropoff_location, service_type)').eq('escort_rider_id', rider.id).eq('status', 'accepted').maybeSingle(),
    ]);

    if (pendingRow && pendingRow.id !== lastChimedId.current) {
      startJobRingLoop();
      lastChimedId.current = pendingRow.id;
    } else if (!pendingRow) {
      stopJobRingLoop();
      lastChimedId.current = null;
    }

    setPending((pendingRow as any) || null);
    setActive((activeRow as any) || null);
  }, [riderId]);

  useEffect(() => stopJobRingLoop, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load]);

  const respond = async (accept: boolean) => {
    if (!pending) return;
    stopJobRingLoop();
    setActing(true);
    try {
      const { data, error } = await supabase.rpc('mbg_respond_to_escort_request', { p_request_id: pending.id, p_accept: accept });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not respond');
      toast[accept ? 'success' : 'info'](accept ? 'Escort request accepted!' : 'Request declined');
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to respond');
    } finally {
      setActing(false);
    }
  };

  const completeEscort = async () => {
    if (!active) return;
    setActing(true);
    try {
      const { data, error } = await supabase.rpc('mbg_complete_escort_request', { p_request_id: active.id });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not complete');
      toast.success(`✅ Escort complete! Fee: UGX ${Number(active.fee || 0).toLocaleString()}`);
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to complete');
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    if (collapsed) return null;
    return (
      <div className="bg-white rounded-xl shadow-lg p-10 text-center">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  if (!escortRowId) {
    if (collapsed) return null;
    return (
      <div className="bg-white rounded-xl shadow-lg p-10 text-center text-slate-500">
        Your escort profile isn't set up yet.
      </div>
    );
  }

  const Summary = ({ row }: { row: EscortRequestRow }) => (
    <div className="bg-white rounded-lg p-4 space-y-2">
      <div className="flex items-start gap-2">
        <MapPin size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs text-slate-400">Pickup</p>
          <p className="text-sm font-medium text-slate-700">{row.mbg_rides?.pickup_location}</p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Navigation size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs text-slate-400">Drop-off</p>
          <p className="text-sm font-medium text-slate-700">{row.mbg_rides?.dropoff_location}</p>
        </div>
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <span className="text-xs text-slate-400">Escort fee</span>
        <span className="text-lg font-bold text-orange-600">UGX {Number(row.fee ?? 0).toLocaleString()}</span>
      </div>
    </div>
  );

  return (
    <>
      {/* Always rendered (even while `collapsed`) so a new escort request
          rings the instant it arrives instead of waiting for the rider to
          tap into the Requests tab — see RiderRideRequests for the same
          pattern. */}
      {pending && (
        <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden p-8 text-center">
            <div className="w-24 h-24 mx-auto rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white mb-4 animate-pulse">
              <ShieldCheck size={36} />
            </div>
            <h3 className="text-lg font-bold text-slate-800">New Escort Request</h3>
            <p className="text-sm text-slate-500 mb-4">Ringing…</p>
            <Summary row={pending} />
            <div className="flex justify-center gap-6 mt-6">
              <button onClick={() => respond(false)} disabled={acting} className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg disabled:opacity-50">
                <X size={22} />
              </button>
              <button onClick={() => respond(true)} disabled={acting} className="w-14 h-14 rounded-full bg-green-500 hover:bg-green-600 text-white flex items-center justify-center shadow-lg disabled:opacity-50">
                <Check size={22} />
              </button>
            </div>
          </div>
        </div>
      )}

      {!collapsed && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-slate-800">Escort Requests</h3>
            <button onClick={load} className="text-sm text-orange-600 hover:text-orange-700 flex items-center gap-1">
              <RefreshCw size={14} /> Refresh
            </button>
          </div>

          {pending && (
            <div className="border-2 border-violet-400 bg-violet-50 rounded-xl p-5 shadow-md">
              <div className="flex items-center justify-between mb-3">
                <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-violet-500 text-white text-xs font-bold rounded-full">
                  <ShieldCheck size={12} /> New Escort Request
                </span>
                <span className="text-xs text-slate-500">{new Date(pending.requested_at).toLocaleTimeString()}</span>
              </div>
              <Summary row={pending} />
              <div className="flex gap-3 mt-4">
                <button onClick={() => respond(true)} disabled={acting} className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2">
                  <Check size={18} /> Accept
                </button>
                <button onClick={() => respond(false)} disabled={acting} className="flex-1 py-3 bg-white border-2 border-red-300 text-red-600 font-bold rounded-lg hover:bg-red-50 disabled:opacity-50 flex items-center justify-center gap-2">
                  <X size={18} /> Decline
                </button>
              </div>
            </div>
          )}

          {active && (
            <div className="border-2 border-green-400 bg-green-50 rounded-xl p-5 shadow-md">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-full mb-3">
                Accepted — escorting
              </span>
              <Summary row={active} />
              <button onClick={completeEscort} disabled={acting} className="w-full mt-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-lg hover:opacity-90 disabled:opacity-50">
                Mark Escort Complete
              </button>
            </div>
          )}

          {!pending && !active && (
            <div className="bg-white rounded-2xl p-12 text-center text-slate-400 shadow-sm">
              <p className="text-4xl mb-3">🛡️</p>
              <p>No escort requests right now.</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}
