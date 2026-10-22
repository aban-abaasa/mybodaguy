import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { formatUgx } from '../services/riderCardService';
import { zoneAccessService, type RideZoneCharges } from '../services/zoneAccessService';

interface Props {
  rideId: string;
  // Refreshed while the ride is on screen: the fee appears the moment the rider is let in at the gate.
  pollMs?: number;
}

// What this ride was charged for entering a zone, on the customer's and on the rider's ride screen. The customer sees the
// fee "added to your ride" (or the warning they were shown, until it is charged); the rider sees that the customer pays it,
// or, when they had to front it, that they are to collect it from the customer. Renders nothing when there is nothing to say.
export default function RideZoneChargesNote({ rideId, pollMs = 10000 }: Props) {
  const [data, setData] = useState<RideZoneCharges | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await zoneAccessService.getRideCharges(rideId);
      if (alive) setData(res);
    };
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, pollMs);
    return () => { alive = false; clearInterval(timer); };
  }, [rideId, pollMs]);

  if (!data || (data.charges.length === 0 && data.warnings.length === 0)) return null;
  const customer = data.role === 'customer';

  return (
    <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
      {data.charges.map((c) => (
        <p key={c.visit_id} className="flex items-start gap-1.5">
          <MapPin size={13} className="mt-0.5 flex-shrink-0 text-amber-600" />
          <span>
            <span className="font-semibold">Entry fee at {c.zone_name}: {formatUgx(c.fee_ugx)}</span>
            {customer
              ? c.payer === 'customer'
                ? c.status === 'awaiting_payment'
                  ? ' — the gate is taking it from you in cash.'
                  : ` — added to your ride and ${c.payment_method === 'cash' ? 'paid in cash at the gate' : 'taken from your wallet'}. Your rider paid nothing.`
                : c.passed_on_ugx > 0
                  ? ' — your rider paid the gate and it was added to your ride and taken from your wallet. Your rider has been paid back.'
                  : ' — your rider paid it at the gate. Please pay them back along with your fare.'
              : c.payer === 'customer'
                ? ' — your customer pays it. Nothing for you to pay.'
                : c.passed_on_ugx > 0
                  ? ' — you paid the gate and your customer has paid it back to your wallet.'
                  : ' — you paid it at the gate. Collect it from your customer in cash with the fare.'}
          </span>
        </p>
      ))}
      {data.warnings.map((w) => (
        <p key={w.zone_name} className="flex items-start gap-1.5">
          <MapPin size={13} className="mt-0.5 flex-shrink-0 text-amber-600" />
          <span>
            {customer
              ? `Entering ${w.zone_name} may add up to ${formatUgx(w.max_fee_ugx)} to your ride. You pay it, not your rider.`
              : `Your customer was told ${w.zone_name} may charge up to ${formatUgx(w.max_fee_ugx)} to enter. They pay it, not you.`}
          </span>
        </p>
      ))}
    </div>
  );
}
