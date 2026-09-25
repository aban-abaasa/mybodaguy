import { useEffect, useState } from 'react';
import { Car, Phone, Star, Ship, Plane, AlertTriangle } from 'lucide-react';
import { getMyJourneys, type Journey, type JourneyLeg } from '../services/journeyService';
import { legLabel } from './JourneyBookingFlow';
import AirTicketButton from './AirTicketButton';
import JourneyLegRideActions from './JourneyLegRideActions';

// A customer's past-booking view of getMyJourneys — it already existed
// (real query, nested legs + rider info) but was never wired into any
// screen; a customer could only ever see journey status right after
// booking, inside JourneyBookingFlow's own local 'tracking' step.
export default function JourneyTracker({ customerId }: { customerId: string }) {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const rows = await getMyJourneys(customerId);
        if (!cancelled) {
          setJourneys(rows);
          setLoadError(false);
        }
      } catch (err) {
        // Say so instead of rendering nothing — a booking that exists but
        // cannot be read must not look like a booking that was never made.
        console.error('JourneyTracker load error:', err);
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [customerId]);

  // A booked flight stays listed after the trip so its air ticket can still be
  // downloaded, and a failed booking stays listed when money was taken for it
  // (ican_journey_tx_id is only set once the wallet was actually debited) so the
  // customer is told to ask support for a refund instead of it silently vanishing.
  const hasTicket = (j: Journey) => j.legs.some((l) => l.leg_type === 'flight' && l.flight_booking);
  // Auto-refunded bookings (refunded_at set) need no action, so they drop off the list.
  const paidButFailed = (j: Journey) => j.status === 'failed' && !!j.ican_journey_tx_id && !j.refunded_at;
  const activeJourneys = journeys.filter((j) => {
    if (paidButFailed(j)) return true;
    if (j.status === 'cancelled' || j.status === 'failed') return false;
    return j.status !== 'completed' || hasTicket(j);
  });

  if (loading) return null;
  if (loadError && journeys.length === 0) {
    return (
      <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        We couldn't load your journeys right now. Your bookings are safe — please refresh in a moment.
      </div>
    );
  }
  if (activeJourneys.length === 0) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-slate-800">My Journeys</h3>
      {activeJourneys.map((journey) => (
        <div key={journey.id} className="bg-white rounded-xl shadow-sm border border-slate-100 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              {journey.legs.some((l) => l.leg_type === 'sea_leg') ? <Ship size={16} className="text-orange-500" /> : <Plane size={16} className="text-orange-500" />}
              To {journey.destination_city || journey.destination_country}
            </div>
            <span className="text-xs font-semibold uppercase text-orange-600">{journey.status.replace(/_/g, ' ')}</span>
          </div>
          {paidButFailed(journey) && (
            <div role="alert" className="flex items-start gap-2.5 rounded-lg border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
              <div className="space-y-1">
                <p className="font-bold">Your payment was taken but this booking did not complete — no ticket was issued.</p>
                <p>Please contact the support team to be refunded. Quote this reference: <span className="select-all font-mono font-semibold">{journey.id}</span></p>
              </div>
            </div>
          )}
          {hasTicket(journey) && (
            <AirTicketButton
              journeyId={journey.id}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60"
            />
          )}
          <div className="space-y-2">
            {[...journey.legs].sort((a, b) => a.leg_order - b.leg_order).map((leg) => (
              <JourneyLegRow key={leg.id} leg={leg} customerId={customerId} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function JourneyLegRow({ leg, customerId }: { leg: JourneyLeg; customerId: string }) {
  const rider = leg.ride?.rider;
  // A flight or sea crossing underway has no live position to show — no
  // phone signal mid-ocean/mid-flight, and a flight leg isn't fulfilled by
  // one of our own riders anyway. Fixed price was already charged upfront;
  // tracking resumes on its own once the next (on-land) leg starts, which
  // is exactly when this same view starts showing that leg's live rider.
  const isInTransitCrossing = (leg.leg_type === 'flight' || leg.leg_type === 'sea_leg') && (leg.status === 'dispatched' || leg.status === 'in_progress');

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex justify-between items-center">
        <div>
          <div className="font-medium text-sm text-slate-800">{legLabel[leg.leg_type] || leg.leg_type}</div>
          {leg.flight_booking?.pnr && <div className="text-xs text-slate-500">PNR: {leg.flight_booking.pnr}</div>}
        </div>
        <span className="text-xs font-semibold uppercase text-slate-500">{leg.status.replace(/_/g, ' ')}</span>
      </div>

      {isInTransitCrossing && (
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-3 text-sm text-violet-700">
          {leg.leg_type === 'sea_leg' ? '⛴️ At sea' : '✈️ In the air'} — fixed price already charged, tracking resumes on arrival.
        </div>
      )}

      {!isInTransitCrossing && rider && (
        <div className="bg-orange-50 rounded-lg p-3 flex items-center justify-between text-sm">
          <div>
            <div className="font-semibold text-slate-800">{rider.user?.profile?.full_name || 'Your driver'}</div>
            <div className="text-slate-500 flex items-center gap-1">
              <Car size={14} /> {rider.vehicle_type} · {rider.vehicle_color || ''} {rider.vehicle_model || ''} · {rider.plate_number}
            </div>
            {rider.location_updated_at && (
              <div className="text-xs text-slate-400 mt-1">Last seen {new Date(rider.location_updated_at).toLocaleTimeString()}</div>
            )}
          </div>
          <div className="text-right space-y-1">
            <div className="flex items-center gap-1 text-amber-600 font-semibold">
              <Star size={14} fill="currentColor" /> {Number(rider.rating || 0).toFixed(1)}
            </div>
            {rider.user?.phone && (
              <a href={`tel:${rider.user.phone}`} className="flex items-center gap-1 text-orange-600">
                <Phone size={14} /> Call
              </a>
            )}
          </div>
        </div>
      )}

      <JourneyLegRideActions leg={leg} customerId={customerId} />
    </div>
  );
}
