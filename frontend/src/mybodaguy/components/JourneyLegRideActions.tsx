import { useState } from 'react';
import { Navigation, Loader2, Clock, Search } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../../services/supabaseClient';
import type { JourneyLeg } from '../services/journeyService';
import RideTrackingModal, { type TrackedRide } from './RideTrackingModal';

/**
 * The ground legs of a journey are real rides, so the customer gets the same
 * live experience as a booked ride: live map, call, video, chat and sending the
 * driver a tip — plus, before a driver is sent, when one will be assigned.
 */
export default function JourneyLegRideActions({ leg, customerId }: { leg: JourneyLeg; customerId: string }) {
  const [opening, setOpening] = useState(false);
  const [tracked, setTracked] = useState<{ ride: TrackedRide; customerName: string } | null>(null);

  const isGroundLeg = leg.leg_type === 'local_pickup' || leg.leg_type === 'local_dropoff';
  if (!isGroundLeg) return null;

  const awaitingDispatch = !leg.ride && ['pending', 'ready_to_dispatch', 'awaiting_flight_update'].includes(leg.status);
  if (awaitingDispatch) {
    const due = leg.dispatch_after ? new Date(leg.dispatch_after) : null;
    const inFuture = !!due && due.getTime() > Date.now() + 2 * 60_000;
    return (
      <div className="flex items-start gap-2 rounded-xl border border-[#c4a052]/30 bg-[#fdf8ea] p-3 text-xs text-slate-600">
        {inFuture ? <Clock size={14} className="mt-0.5 shrink-0 text-[#a17c28]" /> : <Search size={14} className="mt-0.5 shrink-0 text-[#a17c28]" />}
        <span>
          {inFuture
            ? leg.leg_type === 'local_pickup'
              ? `Your driver will be assigned around ${due!.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} — timed so you reach the airport in good time.`
              : `Your driver will be assigned around ${due!.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}, after your flight lands.`
            : 'Finding the nearest available driver for you…'}
        </span>
      </div>
    );
  }

  const ride = leg.ride;
  if (!ride) return null;

  if (ride.status === 'pending') {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-[#c4a052]/30 bg-[#fdf8ea] p-3 text-xs text-slate-600">
        <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-[#a17c28]" />
        <span>A driver has been asked to take this ride — if they don't accept quickly, it moves to the next nearest driver automatically.</span>
      </div>
    );
  }

  if (!['accepted', 'in_progress'].includes(ride.status)) return null;

  const open = async () => {
    setOpening(true);
    try {
      const [{ data: row }, { data: me }] = await Promise.all([
        supabase
          .from('mbg_rides')
          .select('id, pickup_location, dropoff_location, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status, fare, service_type, rider_id')
          .eq('id', ride.id)
          .maybeSingle(),
        supabase.from('mbg_users').select('email, mbg_user_profiles(full_name)').eq('id', customerId).maybeSingle(),
      ]);
      if (!row) {
        toast.error('Could not load this ride right now');
        return;
      }
      const name = (me as any)?.mbg_user_profiles?.[0]?.full_name || (me as any)?.email?.split('@')[0] || 'Customer';
      setTracked({ ride: row as TrackedRide, customerName: name });
    } finally {
      setOpening(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={open}
        disabled={opening}
        className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-xl border border-[#c4a052]/50 bg-white px-3 text-sm font-semibold text-[#7a5a12] hover:bg-[#fbf3dc] disabled:opacity-60"
      >
        {opening ? <Loader2 size={15} className="animate-spin" /> : <Navigation size={15} />}
        Live map, call &amp; chat with your driver
      </button>
      {tracked && (
        <RideTrackingModal
          ride={tracked.ride}
          customerId={customerId}
          customerName={tracked.customerName}
          onClose={() => setTracked(null)}
        />
      )}
    </>
  );
}
