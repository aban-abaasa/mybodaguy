/**
 * RideTrackingModal — full tracking view for a ride picked from the
 * customer's ride history (Overview/Orders lists). Those lists only ever
 * showed a static row; there was no way back into the live map + Call/
 * Video/Chat screen for a ride once the customer navigated away or
 * refreshed (EnhancedRideRequest's live tracking only exists in that
 * component's own in-memory state while actively booking). This re-derives
 * the same view from a ride row already in the database.
 */
import { useEffect, useState } from 'react';
import { X, MapPin, Navigation as NavigationIcon, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import LiveTrackingMap from './LiveTrackingMap';
import RideCommsBar from './RideCommsBar';
import DeliveryReceiptCard from './DeliveryReceiptCard';
import { supabase } from '../services/supabaseClient';
import type { Location } from '../data/mockLocations';

export interface TrackedRide {
  id: string;
  pickup_location: string;
  dropoff_location: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  status: string;
  fare: number;
  service_type: string;
  rider_id: string | null;
}

function toLocation(name: string, lat: number | null, lng: number | null): Location | null {
  if (lat == null || lng == null) return null;
  return { id: name, name, area: '', fullAddress: name, coordinates: { lat, lng } };
}

export default function RideTrackingModal({
  ride,
  contact: initialContact,
  customerId,
  customerName,
  onClose,
}: {
  ride: TrackedRide;
  /** Optional seed from the parent's own list fetch, so the comms bar can
   * paint immediately if that happened to already be fresh — always
   * re-fetched below regardless, since it commonly isn't. */
  contact?: { userId: string; name: string; phone: string | null } | null;
  customerId: string;
  customerName: string;
  onClose: () => void;
}) {
  const pickup = toLocation(ride.pickup_location, ride.pickup_lat, ride.pickup_lng);
  const dropoff = toLocation(ride.dropoff_location, ride.dropoff_lat, ride.dropoff_lng);
  const isLive = ['accepted', 'in_progress'].includes(ride.status) && !!ride.rider_id;
  const canShowMap = isLive && pickup && dropoff;

  const [contact, setContact] = useState(initialContact ?? null);
  // The same QR verification receipt the rider sees, surfaced to the
  // customer too — read straight from icanera_delivery_receipts, which RLS
  // already lets the customer on the row read (customer_user_id = auth.uid()).
  const [receipt, setReceipt] = useState<{ code: string; verifyUrl: string; storeName?: string | null } | null>(null);

  const viewReceipt = async () => {
    const { data, error } = await supabase
      .from('icanera_delivery_receipts')
      .select('verification_code, store_name')
      .eq('source_app', 'mybodaguy')
      .eq('reference_type', 'mbg_ride')
      .eq('reference_id', ride.id)
      .maybeSingle();
    if (error || !data) {
      toast.error('No digital receipt for this trip');
      return;
    }
    setReceipt({
      code: data.verification_code,
      verifyUrl: `https://bodagoera.icanera.space/verify/${data.verification_code}`,
      storeName: data.store_name,
    });
  };

  // Fetch the rider's contact fresh every time this modal opens, rather
  // than trusting the parent's activeRideContacts lookup — that runs once
  // when the customer dashboard first loads and never retries, so it goes
  // stale the moment a ride is accepted afterward. LiveTrackingMap already
  // does its own independent fetch for the rider's position for the same
  // reason; this mirrors that.
  useEffect(() => {
    if (!isLive || !ride.rider_id) return;
    let cancelled = false;
    supabase
      .from('mbg_riders')
      .select('user_id, mbg_users!user_id(phone, email, mbg_user_profiles(full_name))')
      .eq('id', ride.rider_id)
      .maybeSingle()
      .then(({ data: rider }) => {
        if (cancelled || !rider?.user_id) return;
        const rUser = (rider as any).mbg_users;
        const name = rUser?.mbg_user_profiles?.[0]?.full_name || rUser?.email?.split('@')[0] || 'Rider';
        setContact({ userId: rider.user_id, name, phone: rUser?.phone || null });
      });
    return () => { cancelled = true; };
  }, [isLive, ride.rider_id]);

  return (
    // Stays below RideCommsBar's own sub-modals (RideChatModal z-[55],
    // CallController/Send-money z-[60]) — this is the first screen to host
    // RideCommsBar while also carrying its own z-index; everywhere else it's
    // embedded (rider's card, customer's ride rows) sits at normal document
    // flow, so a sub-modal opened from inside it must never end up behind it.
    <div className="fixed inset-0 z-[50] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-100 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="text-lg font-bold text-slate-800">
            {ride.service_type === 'delivery' ? 'Delivery' : 'Ride'} Tracking
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={20} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {canShowMap ? (
            <LiveTrackingMap
              riderId={ride.rider_id as string}
              pickup={pickup as Location}
              dropoff={dropoff as Location}
              phase={ride.status === 'accepted' ? 'to_pickup' : 'to_dropoff'}
            />
          ) : (
            <div className="bg-slate-50 rounded-lg p-6 text-center text-sm text-slate-400">
              {isLive
                ? 'Live map needs pickup/drop-off coordinates, which this ride is missing.'
                : `This ${ride.status} ride is no longer being tracked live.`}
            </div>
          )}

          <div className="bg-slate-50 rounded-lg p-4 space-y-2">
            <div className="flex items-start gap-2">
              <MapPin size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-slate-400">Pickup</p>
                <p className="text-sm font-medium text-slate-700">{ride.pickup_location}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <NavigationIcon size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-slate-400">Drop-off</p>
                <p className="text-sm font-medium text-slate-700">{ride.dropoff_location}</p>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <span className="text-xs text-slate-400 capitalize">{ride.status}</span>
              <span className="text-lg font-bold text-slate-800">UGX {Number(ride.fare || 0).toLocaleString()}</span>
            </div>
          </div>

          {isLive && contact ? (
            <RideCommsBar
              rideId={ride.id}
              selfUserId={customerId}
              selfName={customerName}
              peerUserId={contact.userId}
              peerName={contact.name}
              peerPhone={contact.phone}
            />
          ) : isLive ? (
            <p className="text-center text-xs text-slate-400">Loading rider contact info…</p>
          ) : null}

          {ride.service_type === 'delivery' && (
            <button
              onClick={viewReceipt}
              className="w-full py-2.5 bg-white border-2 border-orange-300 text-orange-600 font-semibold rounded-lg hover:bg-orange-50 flex items-center justify-center gap-2 text-sm"
            >
              <Receipt size={16} /> Receipts
            </button>
          )}
        </div>
      </div>

      {receipt && (
        <DeliveryReceiptCard
          verificationCode={receipt.code}
          verifyUrl={receipt.verifyUrl}
          storeName={receipt.storeName}
          onClose={() => setReceipt(null)}
        />
      )}
    </div>
  );
}
