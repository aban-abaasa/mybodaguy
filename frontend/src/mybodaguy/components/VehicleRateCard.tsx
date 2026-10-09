import { useEffect, useState } from 'react';
import { Info, Truck } from 'lucide-react';
import { quoteVehicleClasses, type VehicleClassQuote } from '../services/vehicleRateService';

// Any point to measure example trips from; the quote returns each class's
// effective rates whatever the trip is.
const REFERENCE_FROM = { lat: 0.3476, lng: 32.5825 };
const KM_PER_DEGREE_LAT = 111.19;
const EXAMPLE_KM = [20, 50, 100, 200];
// A representative load per freight class for the example trips.
const EXAMPLE_KG: Record<string, number> = { van: 500, truck: 5000 };

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString()}`;
const dropoffAt = (km: number) => ({ lat: REFERENCE_FROM.lat + km / KM_PER_DEGREE_LAT, lng: REFERENCE_FROM.lng });

// What this rider's vehicle class charges — so a driver knows the rates behind
// every request before it reaches them. The example prices come from the same
// server pricing customers are quoted, so they can't drift from it. It shows
// the TRIP price customers are quoted; what the rider takes home is on each
// request itself.
export default function VehicleRateCard({ vehicleType }: { vehicleType: string | null }) {
  const [quote, setQuote] = useState<VehicleClassQuote | null>(null);
  const [examples, setExamples] = useState<{ km: number; fare: number }[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  const exampleKg = vehicleType ? EXAMPLE_KG[vehicleType] ?? null : null;

  useEffect(() => {
    if (!vehicleType) {
      setState('unavailable');
      return;
    }
    let cancelled = false;
    setState('loading');
    const cargo = exampleKg ? { weightKg: exampleKg, cargoClass: 'standard' as const } : null;
    Promise.all(EXAMPLE_KM.map(km => quoteVehicleClasses(REFERENCE_FROM, dropoffAt(km), cargo)))
      .then(results => {
        if (cancelled) return;
        const rows = results.map(r => r.find(q => q.vehicle_type === vehicleType) ?? null);
        const first = rows[0];
        if (!first) {
          setState('unavailable');
          return;
        }
        setQuote(first);
        setExamples(rows.map((r, i) => ({ km: EXAMPLE_KM[i], fare: r?.fare ?? 0 })));
        setState('ready');
      })
      .catch(() => { if (!cancelled) setState('unavailable'); });
    return () => { cancelled = true; };
  }, [vehicleType, exampleKg]);

  if (state === 'loading') return <div className="p-4 text-sm text-slate-400">Loading your fare rates…</div>;
  if (state === 'unavailable' || !quote) return null;

  const freight = quote.freight_priced && quote.freight_per_km_ugx != null;
  const base = freight ? quote.freight_base_ugx ?? 0 : quote.base_fare;
  const perKm = freight ? quote.freight_per_km_ugx ?? 0 : quote.per_km_rate;
  const minimum = freight ? quote.freight_min_ugx ?? 0 : quote.min_fare;
  const loading = freight ? quote.freight_loading_ugx ?? 0 : quote.loading_fee;
  const perTonKm = freight ? quote.freight_per_ton_km_ugx ?? 0 : 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Truck size={18} className="text-orange-500" />
        <h4 className="font-semibold text-slate-800">Fare rates for your {quote.label}</h4>
      </div>

      <ul className="grid grid-cols-2 gap-2 text-sm">
        <li className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Base fare</p><p className="font-semibold text-slate-800">{ugx(base)}</p></li>
        <li className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Per km</p><p className="font-semibold text-slate-800">{ugx(perKm)}</p></li>
        {perTonKm > 0 && (
          <li className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Per tonne-km of cargo</p><p className="font-semibold text-slate-800">{ugx(perTonKm)}</p></li>
        )}
        <li className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Minimum trip</p><p className="font-semibold text-slate-800">{ugx(minimum)}</p></li>
        {loading > 0 && (
          <li className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-xs text-slate-500">Loading &amp; handling</p><p className="font-semibold text-slate-800">{ugx(loading)}</p></li>
        )}
        {quote.long_haul_after_km != null && (
          <li className="col-span-2 rounded-xl bg-slate-50 px-3 py-2">
            <p className="text-xs text-slate-500">Long haul</p>
            <p className="font-semibold text-slate-800">
              {freight
                ? `Cheaper per km past ${quote.long_haul_after_km} km`
                : `Past ${quote.long_haul_after_km} km: ${ugx(quote.long_haul_per_km_rate ?? 0)} per km`}
            </p>
          </li>
        )}
      </ul>

      <div>
        <p className="mb-1 text-xs font-medium text-slate-500">
          What a trip costs the customer{exampleKg ? ` carrying ${exampleKg >= 1000 ? `${exampleKg / 1000} t` : `${exampleKg} kg`}` : ''}
          {quote.time_multiplier !== 1 ? ` (right now ×${quote.time_multiplier})` : ''}
        </p>
        <div className="grid grid-cols-4 gap-2 text-center">
          {examples.map(e => (
            <div key={e.km} className="rounded-xl border border-slate-100 px-1 py-2">
              <p className="text-[11px] text-slate-500">{e.km} km</p>
              <p className="text-xs font-semibold text-slate-800">{ugx(e.fare)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 rounded-xl bg-orange-50 px-3 py-2 text-[11px] leading-relaxed text-slate-600">
        <Info size={14} className="mt-0.5 flex-shrink-0 text-orange-500" />
        <span>
          {freight && 'Freight is priced from real-world rates at the live icaneracoin value, so these move with the exchange rate. The weight and kind of cargo (fragile, chilled, hazardous) add to the price, and top-rated drivers and premium trucks earn a little more. '}
          Rush hours (7–9am, 5–8pm) cost ×1.3 and late night (10pm–5am) ×1.2 on the trip part{loading > 0 ? ' — the loading fee stays the same' : ''}.
          Your VIP / discount mode adjusts the price on top. If you drive for a company, any rates it has set replace these.
          The amount you take home is shown on every request before you accept it.
        </span>
      </div>
    </div>
  );
}
