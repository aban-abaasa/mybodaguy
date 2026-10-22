import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { formatUgx } from '../services/riderCardService';
import { NO_TRIP_CHARGES, zoneAccessService, type TripCharge, type TripCharges } from '../services/zoneAccessService';

interface Props {
  pickup: { lat: number; lng: number } | null;
  dropoff: { lat: number; lng: number } | null;
  // 'any' (or null) while the customer has not chosen a vehicle type.
  vehicleType: string | null;
  paymentMethod: 'wallet' | 'cash' | 'company';
  // One line, for beside the list of riders; the full note sits above the request buttons.
  compact?: boolean;
}

const where = (c: TripCharge) =>
  c.applies_at === 'both' ? 'pickup and drop-off' : c.applies_at === 'pickup' ? 'pickup' : 'drop-off';

const feeText = (c: TripCharge) => {
  if (c.fee_ugx != null) return formatUgx(c.fee_ugx);
  if (c.fee_min_ugx === c.fee_max_ugx) return formatUgx(c.fee_max_ugx);
  return `${formatUgx(c.fee_min_ugx)} – ${formatUgx(c.fee_max_ugx)}`;
};

// Some places charge vehicles to enter (an estate, a campus, a hospital, a port…). A rider on their own pays it
// themselves, but a rider carrying a customer should not be left to face it alone: the customer is told here, before
// they book, that it is added to their trip, and the fee is then charged to them (not the rider) at the gate.
// Shown only when the trip really starts or ends inside such a place; free for a rider the place has approved.
export default function ZoneChargeNotice({ pickup, dropoff, vehicleType, paymentMethod, compact = false }: Props) {
  const [found, setFound] = useState<TripCharges>(NO_TRIP_CHARGES);
  const type = vehicleType && vehicleType !== 'any' ? vehicleType : null;
  const key = pickup && dropoff ? `${pickup.lat},${pickup.lng}|${dropoff.lat},${dropoff.lng}|${type ?? ''}` : '';

  useEffect(() => {
    if (!pickup || !dropoff) { setFound(NO_TRIP_CHARGES); return undefined; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await zoneAccessService.getTripCharges(pickup, dropoff, type);
      if (!cancelled) setFound(result);
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const charges = found.charges.filter((c) => !c.waived);
  if (charges.length === 0) return null;

  const total = type ? found.total_ugx : found.total_max_ugx;

  if (compact) {
    return (
      <p role="note" className="flex items-start gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
        <MapPin size={13} className="mt-0.5 flex-shrink-0 text-amber-600" />
        <span>
          Entry fee at {charges.map((c) => c.zone_name).join(' and ')}{total > 0 ? ` (${type ? '' : 'up to '}${formatUgx(total)})` : ''} is added to your trip:
          you pay it, not your rider.
        </span>
      </p>
    );
  }
  const anyCashGate = charges.some((c) => c.accepts_cash);
  const howItIsCharged =
    paymentMethod === 'wallet'
      ? 'It is taken from your IcanEra wallet when your rider reaches the gate.'
      : anyCashGate
        ? 'Your rider will not pay it: the gate takes it from you in cash.'
        : 'The gate does not take cash, so your rider pays it for you and you pay them back along with your fare.';

  return (
    <div role="note" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
      <p className="flex items-center gap-2 text-sm font-bold">
        <MapPin size={16} className="flex-shrink-0 text-amber-600" />
        {charges.length === 1 ? 'This place charges an entry fee' : 'These places charge an entry fee'}
      </p>
      <ul className="mt-2 space-y-1.5">
        {charges.map((c) => (
          <li key={c.zone_id} className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="font-semibold">{c.zone_name}</span>
              <span className="text-amber-800"> · your {where(c)}</span>
              {c.organisation ? <span className="block truncate text-xs text-amber-800">{c.organisation}</span> : null}
            </span>
            <span className="flex-shrink-0 font-bold tabular-nums">{feeText(c)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs leading-relaxed text-amber-900">
        {type ? 'Added to your trip' : 'Added to your trip (the amount depends on the vehicle)'}
        {total > 0 ? `: ${type ? '' : 'up to '}${formatUgx(total)} on top of the fare shown. ` : '. '}
        You pay it, not your rider. {howItIsCharged} It is free if your rider is approved there.
      </p>
    </div>
  );
}
