import { useState, useEffect, useCallback } from 'react';
import { MapPin, Star, Phone, Check, X, Navigation, Package, Bike, Zap, Fuel, Umbrella, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';
import RideCommsBar from './RideCommsBar';

interface RideRow {
  id: string;
  customer_id: string;
  service_type: 'ride' | 'delivery';
  delivery_mode: 'supermarket' | 'normal' | null;
  pickup_location: string;
  dropoff_location: string;
  status: string;
  fare: number;
  rider_earning: number | null;
  distance_km: number | null;
  duration_minutes: number | null;
  power_type_requested: string | null;
  umbrella_requested: boolean;
  order_notes: string | null;
  created_at: string;
}

interface CustomerContact {
  userId: string;
  name: string;
}

export default function RiderRideRequests({ riderId }: { riderId: string }) {
  const [riderRowId, setRiderRowId] = useState<string | null>(null);
  const [pending, setPending] = useState<RideRow | null>(null);
  const [active, setActive] = useState<RideRow | null>(null);
  const [activeCustomer, setActiveCustomer] = useState<CustomerContact | null>(null);
  const [selfName, setSelfName] = useState('Rider');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    const { data: rider } = await supabase.from('mbg_riders').select('id').eq('user_id', riderId).maybeSingle();
    if (!rider?.id) {
      setLoading(false);
      return;
    }
    setRiderRowId(rider.id);

    const [{ data: pendingRow }, { data: activeRow }] = await Promise.all([
      supabase.from('mbg_rides').select('*').eq('rider_id', rider.id).eq('status', 'pending').maybeSingle(),
      supabase.from('mbg_rides').select('*').eq('rider_id', rider.id).in('status', ['accepted', 'in_progress']).maybeSingle(),
    ]);

    setPending(pendingRow || null);
    setActive(activeRow || null);

    if (activeRow?.customer_id) {
      const { data: customer } = await supabase
        .from('mbg_customers')
        .select('user_id, mbg_users(email, mbg_user_profiles(full_name))')
        .eq('id', activeRow.customer_id)
        .maybeSingle();
      const cUser = (customer as any)?.mbg_users;
      const name = cUser?.mbg_user_profiles?.[0]?.full_name || cUser?.email?.split('@')[0] || 'Customer';
      setActiveCustomer(customer ? { userId: (customer as any).user_id, name } : null);
    } else {
      setActiveCustomer(null);
    }
  }, [riderId]);

  useEffect(() => {
    supabase
      .from('mbg_users')
      .select('email, mbg_user_profiles(full_name)')
      .eq('id', riderId)
      .maybeSingle()
      .then(({ data }) => {
        const name = (data as any)?.mbg_user_profiles?.[0]?.full_name || data?.email?.split('@')[0] || 'Rider';
        setSelfName(name);
      });
  }, [riderId]);

  useEffect(() => {
    load().finally(() => setLoading(false));
    const interval = setInterval(load, 4000);
    return () => clearInterval(interval);
  }, [load]);

  const respond = async (accept: boolean) => {
    if (!pending) return;
    setActing(true);
    try {
      const { data, error } = await supabase.rpc('mbg_respond_to_ride', { p_ride_id: pending.id, p_accept: accept });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not respond');
      toast[accept ? 'success' : 'info'](accept ? 'Request accepted!' : 'Request declined');
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to respond');
    } finally {
      setActing(false);
    }
  };

  const startTrip = async () => {
    if (!active) return;
    setActing(true);
    try {
      const { data, error } = await supabase.rpc('mbg_start_ride', { p_ride_id: active.id });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not start trip');
      toast.success('Trip started');
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to start trip');
    } finally {
      setActing(false);
    }
  };

  const completeTrip = async () => {
    if (!active) return;
    setActing(true);
    try {
      const { data, error } = await supabase.rpc('mbg_complete_ride', { p_ride_id: active.id });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Could not complete trip');
      toast.success(`✅ Trip complete! You earned UGX ${Number(data.rider_earning || 0).toLocaleString()}`);
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Failed to complete trip');
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-10 text-center">
        <div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full mx-auto" />
      </div>
    );
  }

  if (!riderRowId) {
    return (
      <div className="bg-white rounded-xl shadow-lg p-10 text-center text-slate-500">
        Your rider profile isn't set up yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-slate-800">Ride &amp; Delivery Requests</h3>
        <button onClick={load} className="text-sm text-orange-600 hover:text-orange-700 flex items-center gap-1">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {pending && (
        <div className="border-2 border-orange-400 bg-orange-50 rounded-xl p-5 shadow-md animate-pulse-slow">
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-orange-500 text-white text-xs font-bold rounded-full">
              {pending.service_type === 'delivery' ? <Package size={12} /> : <Bike size={12} />}
              New {pending.service_type === 'delivery' ? 'Delivery' : 'Ride'} Request
            </span>
            <span className="text-xs text-slate-500">{new Date(pending.created_at).toLocaleTimeString()}</span>
          </div>

          <RideSummary ride={pending} />

          <div className="flex gap-3 mt-4">
            <button
              onClick={() => respond(true)}
              disabled={acting}
              className="flex-1 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Check size={18} /> Accept
            </button>
            <button
              onClick={() => respond(false)}
              disabled={acting}
              className="flex-1 py-3 bg-white border-2 border-red-300 text-red-600 font-bold rounded-lg hover:bg-red-50 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <X size={18} /> Decline
            </button>
          </div>
        </div>
      )}

      {active && (
        <div className="border-2 border-green-400 bg-green-50 rounded-xl p-5 shadow-md">
          <div className="flex items-center justify-between mb-3">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-600 text-white text-xs font-bold rounded-full capitalize">
              {active.status === 'accepted' ? 'Accepted — head to pickup' : 'Trip in progress'}
            </span>
          </div>

          <RideSummary ride={active} />

          {activeCustomer && (
            <RideCommsBar
              rideId={active.id}
              selfUserId={riderId}
              selfName={selfName}
              peerUserId={activeCustomer.userId}
              peerName={activeCustomer.name}
              className="mt-4"
            />
          )}

          {active.status === 'accepted' ? (
            <button
              onClick={startTrip}
              disabled={acting}
              className="w-full mt-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              Mark Picked Up — Start Trip
            </button>
          ) : (
            <button
              onClick={completeTrip}
              disabled={acting}
              className="w-full mt-4 py-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              Mark Delivered — Complete Trip
            </button>
          )}
        </div>
      )}

      {!pending && !active && (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400 shadow-sm">
          <p className="text-4xl mb-3">🛵</p>
          <p>No requests right now.</p>
          <p className="text-sm mt-1">Make sure you're available and your areas/vehicle info are up to date.</p>
        </div>
      )}
    </div>
  );
}

function RideSummary({ ride }: { ride: RideRow }) {
  return (
    <div className="bg-white rounded-lg p-4 space-y-2">
      <div className="flex items-start gap-2">
        <MapPin size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs text-slate-400">Pickup</p>
          <p className="text-sm font-medium text-slate-700">{ride.pickup_location}</p>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Navigation size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs text-slate-400">Drop-off</p>
          <p className="text-sm font-medium text-slate-700">{ride.dropoff_location}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 flex-wrap pt-1">
        {ride.distance_km != null && (
          <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">
            {Number(ride.distance_km).toFixed(1)} km
          </span>
        )}
        {ride.duration_minutes != null && (
          <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded-full font-medium">
            ~{ride.duration_minutes} min
          </span>
        )}
        {ride.power_type_requested && (
          <span className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full font-medium flex items-center gap-1">
            {ride.power_type_requested === 'electric' ? <Zap size={12} /> : <Fuel size={12} />}
            {ride.power_type_requested}
          </span>
        )}
        {ride.umbrella_requested && (
          <span className="text-xs px-2 py-1 bg-sky-100 text-sky-700 rounded-full font-medium flex items-center gap-1">
            <Umbrella size={12} /> Rain cover
          </span>
        )}
      </div>
      {ride.order_notes && (
        <div className="flex items-start gap-2 pt-1">
          <Package size={16} className="text-orange-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-xs text-slate-400">Items to buy</p>
            <p className="text-sm font-medium text-slate-700">{ride.order_notes}</p>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <span className="text-xs text-slate-400">Your earning</span>
        <span className="text-lg font-bold text-orange-600">
          UGX {Number(ride.rider_earning ?? 0).toLocaleString()}
        </span>
      </div>
    </div>
  );
}
