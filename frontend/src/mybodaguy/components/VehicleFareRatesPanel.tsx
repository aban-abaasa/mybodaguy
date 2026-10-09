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
  usd_base_fare: number | null;
  usd_per_km: number | null;
  usd_per_ton_km: number | null;
  usd_min_fare: number | null;
  usd_loading_fee: number | null;
  default_capacity_kg: number | null;
  sort_order: number;
};

type Field =
  | 'rate_multiplier' | 'base_fare' | 'per_km_rate' | 'min_fare' | 'loading_fee' | 'long_haul_after_km' | 'long_haul_per_km_rate'
  | 'usd_base_fare' | 'usd_per_km' | 'usd_per_ton_km' | 'usd_min_fare' | 'usd_loading_fee' | 'default_capacity_kg';
type Draft = Record<Field, string>;

const LOCAL_FIELDS: { key: Field; label: string; hint: string }[] = [
  { key: 'rate_multiplier', label: 'Multiple of boda rate (×)', hint: '1' },
  { key: 'base_fare', label: 'Base fare (UGX)', hint: 'boda × multiple' },
  { key: 'per_km_rate', label: 'Per km (UGX)', hint: 'boda × multiple' },
  { key: 'min_fare', label: 'Minimum fare (UGX)', hint: 'boda × multiple' },
  { key: 'loading_fee', label: 'Loading fee (UGX)', hint: '0' },
  { key: 'long_haul_after_km', label: 'Long haul after (km)', hint: 'off' },
  { key: 'long_haul_per_km_rate', label: 'Long haul per km (UGX)', hint: 'off' },
  { key: 'default_capacity_kg', label: 'Default capacity (kg)', hint: 'unlimited' },
];

const FREIGHT_FIELDS: { key: Field; label: string; hint: string }[] = [
  { key: 'usd_per_km', label: 'Per km (USD)', hint: 'blank = not freight' },
  { key: 'usd_per_ton_km', label: 'Per tonne-km (USD)', hint: '0' },
  { key: 'usd_base_fare', label: 'Base fare (USD)', hint: '0' },
  { key: 'usd_min_fare', label: 'Minimum fare (USD)', hint: '0' },
  { key: 'usd_loading_fee', label: 'Loading fee (USD)', hint: '0' },
];

// Reference trips (due north of Kampala) so a developer sees what a change does,
// priced by the database exactly like a real quote.
const REF_FROM = { lat: 0.3476, lng: 32.5825 };
const REF_10KM = { lat: 0.4376, lng: 32.5825 };
const REF_100KM = { lat: 1.2469, lng: 32.5825 };
// A representative load per freight class for the loaded preview.
const PREVIEW_KG: Record<string, number> = { van: 500, truck: 5000 };

const toDraft = (row: RateRow): Draft => ({
  rate_multiplier: String(row.rate_multiplier ?? 1),
  base_fare: row.base_fare == null ? '' : String(row.base_fare),
  per_km_rate: row.per_km_rate == null ? '' : String(row.per_km_rate),
  min_fare: row.min_fare == null ? '' : String(row.min_fare),
  loading_fee: String(row.loading_fee ?? 0),
  long_haul_after_km: row.long_haul_after_km == null ? '' : String(row.long_haul_after_km),
  long_haul_per_km_rate: row.long_haul_per_km_rate == null ? '' : String(row.long_haul_per_km_rate),
  usd_base_fare: row.usd_base_fare == null ? '' : String(row.usd_base_fare),
  usd_per_km: row.usd_per_km == null ? '' : String(row.usd_per_km),
  usd_per_ton_km: row.usd_per_ton_km == null ? '' : String(row.usd_per_ton_km),
  usd_min_fare: row.usd_min_fare == null ? '' : String(row.usd_min_fare),
  usd_loading_fee: row.usd_loading_fee == null ? '' : String(row.usd_loading_fee),
  default_capacity_kg: row.default_capacity_kg == null ? '' : String(row.default_capacity_kg),
});

const parse = (s: string): number | null => (s.trim() === '' ? null : Number(s));
const money = (n?: number) => (n == null ? '—' : `UGX ${Math.round(n).toLocaleString()}`);

type CargoClassRow = { code: string; label: string; description: string | null; price_multiplier: number };
type FreightRider = { rider_id: string; full_name: string; vehicle_type: string; plate_number: string; rating: number; capacity_kg: number; business_name: string | null; tier: 'standard' | 'premium' };

// Developer Dashboard (Commissions tab): each vehicle class's own fare rates.
// Blank base / per-km / minimum = the platform-wide ride.* setting times the
// class's multiple; a blank long-haul pair turns the long-haul tier off. Van and
// truck are freight: a USD per-km rate switches the class to the freight model
// (USD yardsticks converted at the live icaneracoin price, by cargo weight and
// handling class). Also the handling-class multipliers and the premium-truck list.
export default function VehicleFareRatesPanel() {
  const [rows, setRows] = useState<RateRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [short, setShort] = useState<Record<string, VehicleClassQuote>>({});
  const [long, setLong] = useState<Record<string, VehicleClassQuote>>({});
  const [loaded, setLoaded] = useState<Record<string, VehicleClassQuote>>({});
  const [cargoClasses, setCargoClasses] = useState<CargoClassRow[]>([]);
  const [classDrafts, setClassDrafts] = useState<Record<string, string>>({});
  const [riders, setRiders] = useState<FreightRider[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<string | null>(null);
  const [savingClass, setSavingClass] = useState<string | null>(null);
  const [savingRider, setSavingRider] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    try {
      const [s, l, light, heavy] = await Promise.all([
        quoteVehicleClasses(REF_FROM, REF_10KM),
        quoteVehicleClasses(REF_FROM, REF_100KM),
        quoteVehicleClasses(REF_FROM, REF_100KM, { weightKg: PREVIEW_KG.van, cargoClass: 'standard' }),
        quoteVehicleClasses(REF_FROM, REF_100KM, { weightKg: PREVIEW_KG.truck, cargoClass: 'standard' }),
      ]);
      const by = (qs: VehicleClassQuote[]) => Object.fromEntries(qs.map(q => [q.vehicle_type, q]));
      setShort(by(s));
      setLong(by(l));
      setLoaded({ van: by(light).van, truck: by(heavy).truck });
    } catch {
      // The preview is a nicety; the editors work without it.
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ratesRes, classesRes, ridersRes] = await Promise.all([
        supabase.rpc('mbg_dev_get_vehicle_fare_rates'),
        supabase.rpc('mbg_dev_get_cargo_classes'),
        supabase.rpc('mbg_dev_list_freight_riders'),
      ]);
      if (ratesRes.error) throw ratesRes.error;
      const list = (ratesRes.data || []) as RateRow[];
      setRows(list);
      setDrafts(Object.fromEntries(list.map(r => [r.vehicle_type, toDraft(r)])));
      // The freight pieces arrive with the freight migration; if they're missing the rate editor still works.
      const classes = (classesRes.error ? [] : classesRes.data || []) as CargoClassRow[];
      setCargoClasses(classes);
      setClassDrafts(Object.fromEntries(classes.map(c => [c.code, String(c.price_multiplier)])));
      setRiders((ridersRes.error ? [] : ridersRes.data || []) as FreightRider[]);
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
    const values = Object.fromEntries(
      [...LOCAL_FIELDS, ...FREIGHT_FIELDS].map(f => [f.key, parse(d[f.key])]),
    ) as Record<Field, number | null>;
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
    if (values.default_capacity_kg != null && values.default_capacity_kg <= 0) {
      toast.error('Capacity must be more than 0 kg, or blank');
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
        p_usd_base_fare: values.usd_base_fare,
        p_usd_per_km: values.usd_per_km,
        p_usd_per_ton_km: values.usd_per_ton_km,
        p_usd_min_fare: values.usd_min_fare,
        p_usd_loading_fee: values.usd_loading_fee,
        p_default_capacity_kg: values.default_capacity_kg,
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

  const saveClass = async (c: CargoClassRow) => {
    const value = Number(classDrafts[c.code]);
    if (!Number.isFinite(value) || value < 1 || value > 5) {
      toast.error('A handling multiple is between 1 and 5');
      return;
    }
    setSavingClass(c.code);
    try {
      const { data, error } = await supabase.rpc('mbg_dev_set_cargo_class', { p_code: c.code, p_price_multiplier: value });
      if (error) throw error;
      setCargoClasses(prev => prev.map(x => (x.code === c.code ? { ...x, ...(data as CargoClassRow) } : x)));
      setClassDrafts(prev => ({ ...prev, [c.code]: String((data as CargoClassRow).price_multiplier) }));
      toast.success(`${c.label} handling updated`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save handling multiple');
    } finally {
      setSavingClass(null);
    }
  };

  const setTier = async (rider: FreightRider, tier: 'standard' | 'premium') => {
    if (tier === rider.tier) return;
    setSavingRider(rider.rider_id);
    try {
      const { error } = await supabase.rpc('mbg_dev_set_rider_tier', { p_rider_id: rider.rider_id, p_tier: tier });
      if (error) throw error;
      setRiders(prev => prev.map(r => (r.rider_id === rider.rider_id ? { ...r, tier } : r)));
      toast.success(`${rider.full_name} is now ${tier}`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to change the vehicle tier');
    } finally {
      setSavingRider(null);
    }
  };

  // The live conversion in use: UGX per USD, read back from a freight class's quote.
  const sample = Object.values(short).find(q => q.freight_priced && (q.freight_per_km_ugx ?? 0) > 0);
  const sampleRow = sample ? rows.find(r => r.vehicle_type === sample.vehicle_type) : null;
  const liveRate = sample && sampleRow?.usd_per_km ? Math.round((sample.freight_per_km_ugx ?? 0) / sampleRow.usd_per_km) : null;

  const input = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <input
      type="number"
      min={0}
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
    />
  );

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
          <p className="text-sm text-slate-600 mt-2">
            <span className="font-semibold">Van and truck are freight.</span> Give a class a USD per-km rate and it is priced the way freight is: USD per km plus USD per tonne-km for the
            weight carried, converted to UGX at the <span className="font-semibold">live icaneracoin price</span>
            {liveRate ? <> (right now ≈ UGX {liveRate.toLocaleString()} per USD)</> : null}, then the handling class, premium tier and driver rating are applied. The UGX figures
            above become that class's minimum fare. Leave per-km (USD) blank to price a class the plain way.
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
            const heavy = loaded[row.vehicle_type];
            return (
              <div key={row.vehicle_type} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div>
                    <p className="font-semibold text-slate-800">{row.label}</p>
                    <p className="text-xs text-slate-500 font-mono">{row.vehicle_type}{row.usd_per_km != null ? ' · freight' : ''}</p>
                  </div>
                  <p className="text-xs text-slate-500">
                    10 km: <span className="font-semibold text-slate-700">{money(short[row.vehicle_type]?.fare)}</span>
                    {' · '}100 km: <span className="font-semibold text-slate-700">{money(long[row.vehicle_type]?.fare)}</span>
                    {heavy && <>{' · '}100 km with {PREVIEW_KG[row.vehicle_type] >= 1000 ? `${PREVIEW_KG[row.vehicle_type] / 1000} t` : `${PREVIEW_KG[row.vehicle_type]} kg`}: <span className="font-semibold text-slate-700">{money(heavy.fare)}</span></>}
                    {short[row.vehicle_type] && short[row.vehicle_type].time_multiplier !== 1 && ` (now ×${short[row.vehicle_type].time_multiplier})`}
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {LOCAL_FIELDS.map(f => (
                    <label key={f.key} className="block">
                      <span className="block text-xs font-medium text-slate-500 mb-1">{f.label}</span>
                      {input(d[f.key], v => setDrafts(prev => ({ ...prev, [row.vehicle_type]: { ...d, [f.key]: v } })), f.hint)}
                    </label>
                  ))}
                </div>
                <p className="mt-3 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Freight benchmark (USD, converted at the live coin price)</p>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {FREIGHT_FIELDS.map(f => (
                    <label key={f.key} className="block">
                      <span className="block text-xs font-medium text-slate-500 mb-1">{f.label}</span>
                      {input(d[f.key], v => setDrafts(prev => ({ ...prev, [row.vehicle_type]: { ...d, [f.key]: v } })), f.hint)}
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

      {!loading && cargoClasses.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-bold text-slate-800">Cargo handling</h3>
          <p className="text-sm text-slate-600 mt-1">
            What the customer is moving multiplies the van / truck fare, like freight accessorials (refrigerated, hazardous, fragile). Standard stays at 1.
          </p>
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {cargoClasses.map(c => {
              const dirty = classDrafts[c.code] !== String(c.price_multiplier);
              return (
                <div key={c.code} className="rounded-xl border border-slate-200 p-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800">{c.label}</p>
                    <p className="text-xs text-slate-500">{c.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-20">{input(classDrafts[c.code] ?? '', v => setClassDrafts(prev => ({ ...prev, [c.code]: v })), '1')}</div>
                    <span className="text-sm text-slate-500">×</span>
                    <button
                      onClick={() => saveClass(c)}
                      disabled={!dirty || savingClass === c.code || c.code === 'standard'}
                      className="px-3 py-2 bg-slate-800 text-white text-sm font-semibold rounded-lg disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
                    >
                      {savingClass === c.code ? '...' : 'Save'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && riders.length > 0 && (
        <div className="mt-8">
          <h3 className="text-lg font-bold text-slate-800">Truck &amp; van quality tier</h3>
          <p className="text-sm text-slate-600 mt-1">
            Mark premium vehicles (newer, covered or box body, tracked) — they earn a surcharge set in the percentages above (Commissions list). Drivers cannot change their own tier. Driver rating premiums apply automatically.
          </p>
          <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {riders.map(r => (
              <div key={r.rider_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800">{r.full_name} <span className="font-mono text-xs font-normal text-slate-500">{r.plate_number}</span></p>
                  <p className="text-xs text-slate-500">
                    {r.vehicle_type} · rating {Number(r.rating).toFixed(1)} · carries {Number(r.capacity_kg).toLocaleString()} kg{r.business_name ? ` · ${r.business_name}` : ''}
                  </p>
                </div>
                <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm font-semibold">
                  {(['standard', 'premium'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setTier(r, t)}
                      disabled={savingRider === r.rider_id}
                      className={`px-3 py-1.5 capitalize disabled:opacity-50 ${r.tier === t ? 'bg-orange-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
