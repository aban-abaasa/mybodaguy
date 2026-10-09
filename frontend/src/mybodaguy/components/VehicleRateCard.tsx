import { useEffect, useState } from 'react';
import { Info, Truck } from 'lucide-react';
import { quoteVehicleClasses, illustrativeFare, type VehicleClassQuote } from '../services/vehicleRateService';

// Any two points ~10 km apart: the quote returns each class's effective rates
// (a blank rate resolved to the platform default) whatever the trip is.
const REFERENCE_FROM = { lat: 0.3476, lng: 32.5825 };
const REFERENCE_TO = { lat: 0.4376, lng: 32.5825 };
const EXAMPLE_KM = [5, 20, 50, 100];

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString()}`;

// What this rider's vehicle class charges — so a driver knows the rates behind
// every request before it reaches them. It shows the TRIP price customers are
// quoted; what the rider takes home is on each request itself.
export default function VehicleRateCard({ vehicleType }: { vehicleType: string | null }) {
  const [quote, setQuote] = useState<VehicleClassQuote | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    if (!vehicleType) {
      setState('unavailable');
      return;
    }
    let cancelled = false;
    setState('loading');
    quoteVehicleClasses(REFERENCE_FROM, REFERENCE_TO)
      .then(rows => {
        if (cancelled) return;
        const mine = rows.find(r => r.vehicle_type === vehicleType) ?? null;
        setQuote(mine);
        setState(mine ? 'ready' : 'unavailable');
      })
      .catch(() => { if (!cancelled) setState('unavailable'); });
    return () => { cancelled = true; };
  }, [vehicleType]);

  if (state === 'loading') return <div className="p-4 text-sm text-slate-400">Loading your fare rates…</div>;
  if (state === 'unavailable' || !quote) return null;

  const hasLoading = quote.loading_fee > 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Truck size={18} className="text-orange-500" />
        <h4 className="font-semibold text-slate-800">Fare rates for your {quote.label}</h4>
      </div>

      <ul className="grid grid-cols-2 gap-2 text-sm">
        <li className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Base fare</p><p className="font-semibold text-slate-800">{ugx(quote.base_fare)}</p></li>
        <li className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Per km</p><p className="font-semibold text-slate-800">{ugx(quote.per_km_rate)}</p></li>
        <li className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Minimum trip</p><p className="font-semibold text-slate-800">{ugx(quote.min_fare)}</p></li>
        {hasLoading && (
          <li className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Loading &amp; handling</p><p className="font-semibold text-slate-800">{ugx(quote.loading_fee)}</p></li>
        )}
        {quote.long_haul_after_km != null && quote.long_haul_per_km_rate != null && (
          <li className="col-span-2 rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Long haul</p>
            <p className="font-semibold text-slate-800">Past {quote.long_haul_after_km} km: {ugx(quote.long_haul_per_km_rate)} per km</p>
          </li>
        )}
      </ul>

      <div>
        <p className="mb-1 text-xs font-medium text-slate-500">What a trip costs the customer (off-peak)</p>
        <div className="grid grid-cols-4 gap-2 text-center">
          {EXAMPLE_KM.map(km => (
            <div key={km} className="rounded-xl border border-slate-100 px-1 py-2">
              <p className="text-[11px] text-slate-500">{km} km</p>
              <p className="text-xs font-semibold text-slate-800">{ugx(illustrativeFare(quote, km))}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 rounded-xl bg-orange-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
        <Info size={14} className="mt-0.5 flex-shrink-0 text-orange-500" />
        <span>
          Rush hours (7–9am, 5–8pm) cost ×1.3 and late night (10pm–5am) ×1.2 on the trip part{hasLoading ? ' — the loading fee stays the same' : ''}.
          Your VIP / discount mode adjusts the price on top. If you drive for a company, any rates it has set replace these.
          The amount you take home is shown on every request before you accept it.
        </span>
      </div>
    </div>
  );
}
