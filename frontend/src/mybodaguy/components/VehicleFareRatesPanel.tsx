import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../services/supabaseClient';
import { quoteVehicleClasses, type VehicleClassQuote } from '../services/vehicleRateService';

type RateRow = {
  vehicle_type: string;
  label: string;
  rate_multiplier: number;
  base_fare: number | null;
  per_km_rate: number | null;
  min_fare: number | null;
  loading_fee: number;
  long_haul_after_km: number | null;
  long_haul_per_km_rate: number | null;
  sort_order: number;
};

type Field = 'rate_multiplier' | 'base_fare' | 'per_km_rate' | 'min_fare' | 'loading_fee' | 'long_haul_after_km' | 'long_haul_per_km_rate';
type Draft = Record<Field, string>;

const FIELDS: { key: Field; label: string; hint: string }[] = [
  { key: 'rate_multiplier', label: 'Multiple of boda rate (×)', hint: '1' },
  { key: 'base_fare', label: 'Base fare (UGX)', hint: 'boda × multiple' },
  { key: 'per_km_rate', label: 'Per km (UGX)', hint: 'boda × multiple' },
  { key: 'min_fare', label: 'Minimum fare (UGX)', hint: 'boda × multiple' },
  { key: 'loading_fee', label: 'Loading fee (UGX)', hint: '0' },
  { key: 'long_haul_after_km', label: 'Long haul after (km)', hint: 'off' },
  { key: 'long_haul_per_km_rate', label: 'Long haul per km (UGX)', hint: 'off' },
];

// Two reference trips (≈10 km and ≈100 km due north of Kampala) so a developer
// sees what a rate change does, priced by the database exactly like a real quote.
const REF_FROM = { lat: 0.3476, lng: 32.5825 };
const REF_SHORT = { lat: 0.4376, lng: 32.5825 };
const REF_LONG = { lat: 1.2469, lng: 32.5825 };

const toDraft = (row: RateRow): Draft => ({
  rate_multiplier: String(row.rate_multiplier ?? 1),
  base_fare: row.base_fare == null ? '' : String(row.base_fare),
  per_km_rate: row.per_km_rate == null ? '' : String(row.per_km_rate),
  min_fare: row.min_fare == null ? '' : String(row.min_fare),
  loading_fee: String(row.loading_fee ?? 0),
  long_haul_after_km: row.long_haul_after_km == null ? '' : String(row.long_haul_after_km),
  long_haul_per_km_rate: row.long_haul_per_km_rate == null ? '' : String(row.long_haul_per_km_rate),
});

const parse = (s: string): number | null => (s.trim() === '' ? null : Number(s));

// Developer Dashboard (Commissions tab): each vehicle class's own fare rates.
// Blank base / per-km / minimum = use the platform-wide ride.* setting; a blank
// long-haul pair turns the long-haul tier off.
export default function VehicleFareRatesPanel() {
  const [rows, setRows] = useState<RateRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [short, setShort] = useState<Record<string, VehicleClassQuote>>({});
  const [long, setLong] = useState<Record<string, VehicleClassQuote>>({});
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    try {
      const [s, l] = await Promise.all([quoteVehicleClasses(REF_FROM, REF_SHORT), quoteVehicleClasses(REF_FROM, REF_LONG)]);
      setShort(Object.fromEntries(s.map(q => [q.vehicle_type, q])));
      setLong(Object.fromEntries(l.map(q => [q.vehicle_type, q])));
    } catch {
      // The preview is a nicety; the editor works without it.
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('mbg_dev_get_vehicle_fare_rates');
      if (error) throw error;
      const list = (data || []) as RateRow[];
      setRows(list);
      setDrafts(Object.fromEntries(list.map(r => [r.vehicle_type, toDraft(r)])));
      await loadPreview();
    } catch (err: any) {
      console.error('Error loading vehicle fare rates:', err);
      toast.error(err?.message || 'Failed to load vehicle fare rates');
    } finally {
      setLoading(false);
    }
  }, [loadPreview]);

  useEffect(() => { load(); }, [load]);

  const save = async (row: RateRow) => {
    const d = drafts[row.vehicle_type];
    const values = Object.fromEntries(FIELDS.map(f => [f.key, parse(d[f.key])])) as Record<Field, number | null>;
    if (Object.values(values).some(v => v != null && (!Number.isFinite(v) || v < 0))) {
      toast.error('Enter numbers of 0 or more, or leave a field blank');
      return;
    }
    if (values.rate_multiplier == null || values.rate_multiplier <= 0) {
      toast.error('The multiple of the boda rate must be more than 0');
      return;
    }
    if ((values.long_haul_after_km == null) !== (values.long_haul_per_km_rate == null)) {
      toast.error('Set both long-haul fields, or leave both blank');
      return;
    }
    if (values.long_haul_after_km != null && values.long_haul_after_km <= 0) {
      toast.error('Long haul must start after more than 0 km');
      return;
    }
    setSavingType(row.vehicle_type);
    try {
      const { data, error } = await supabase.rpc('mbg_dev_set_vehicle_fare_rate', {
        p_vehicle_type: row.vehicle_type,
        p_rate_multiplier: values.rate_multiplier,
        p_base_fare: values.base_fare,
        p_per_km_rate: values.per_km_rate,
        p_min_fare: values.min_fare,
        p_loading_fee: values.loading_fee ?? 0,
        p_long_haul_after_km: values.long_haul_after_km,
        p_long_haul_per_km_rate: values.long_haul_per_km_rate,
      });
      if (error) throw error;
      const saved = data as RateRow;
      setRows(prev => prev.map(r => (r.vehicle_type === row.vehicle_type ? { ...r, ...saved } : r)));
      setDrafts(prev => ({ ...prev, [row.vehicle_type]: toDraft({ ...row, ...saved }) }));
      await loadPreview();
      toast.success(`${row.label} fare rates updated`);
    } catch (err: any) {
      console.error('Error saving vehicle fare rate:', err);
      toast.error(err?.message || 'Failed to save fare rates');
    } finally {
      setSavingType(null);
    }
  };

  const money = (n?: number) => (n == null ? '—' : `UGX ${Math.round(n).toLocaleString()}`);

  return (
    <div className="mt-10">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Fare rates by vehicle</h2>
          <p className="text-sm text-slate-600 mt-1">
            Boda, car, van and truck each price from their own rate card. By default a class charges a multiple of the boda rate
            (the <span className="font-mono">ride.*</span> settings × the multiple, e.g. car 2.5×, van 5×, truck 10×), so changing the boda rate moves every class.
            Type an amount in base / per-km / minimum to override it with a fixed UGX figure. A loading fee is a flat handling charge added to every trip; long haul drops the
            per-km rate past a distance, so a 200 km run isn't priced like 200 short hops. A transport company's own rates still win over these.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-yellow-500 text-white font-semibold rounded-lg disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-slate-500">Loading fare rates...</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm text-slate-600">
          No vehicle fare rates found — run ADD_VEHICLE_CLASS_FARE_RATES.sql in Supabase first.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(row => {
            const d = drafts[row.vehicle_type] ?? toDraft(row);
            const dirty = JSON.stringify(d) !== JSON.stringify(toDraft(row));
            return (
              <div key={row.vehicle_type} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <p className="font-semibold text-slate-800">{row.label}</p>
                    <p className="text-xs text-slate-500 font-mono">{row.vehicle_type}</p>
                  </div>
                  <p className="text-xs text-slate-500">
                    10 km: <span className="font-semibold text-slate-700">{money(short[row.vehicle_type]?.fare)}</span>
                    {' · '}100 km: <span className="font-semibold text-slate-700">{money(long[row.vehicle_type]?.fare)}</span>
                    {short[row.vehicle_type] && short[row.vehicle_type].time_multiplier !== 1 && ` (now ×${short[row.vehicle_type].time_multiplier})`}
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {FIELDS.map(f => (
                    <label key={f.key} className="block">
                      <span className="block text-xs font-medium text-slate-500 mb-1">{f.label}</span>
                      <input
                        type="number"
                        min={0}
                        value={d[f.key]}
                        placeholder={f.hint}
                        onChange={e => setDrafts(prev => ({ ...prev, [row.vehicle_type]: { ...d, [f.key]: e.target.value } }))}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => save(row)}
                    disabled={!dirty || savingType === row.vehicle_type}
                    className="px-4 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
                  >
                    {savingType === row.vehicle_type ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
