import { useEffect, useState } from 'react';
import { Zap, Fuel, Umbrella, Building2 } from 'lucide-react';
import { supabase } from '../../services/supabaseClient';

/**
 * The same ride preferences "Book a Ride" offers — electric or fuel bike, an
 * umbrella, a specific transport company — for the ride to the airport. They
 * are matched exactly like a normal ride while a driver is available; after
 * 10 minutes with none, dispatch relaxes them so a paid journey never waits.
 */
export interface PickupPreferences {
  powerType: 'any' | 'electric' | 'fuel';
  umbrella: boolean;
  companyId: string; // '' = any driver
}

export const DEFAULT_PICKUP_PREFERENCES: PickupPreferences = { powerType: 'any', umbrella: false, companyId: '' };

/** What the server needs — bike-only options are dropped when a car is chosen. */
export function preferencesForApi(p: PickupPreferences, vehicleType: 'motorcycle' | 'car') {
  const bike = vehicleType === 'motorcycle';
  return {
    powerType: bike && p.powerType !== 'any' ? p.powerType : undefined,
    umbrella: bike && p.umbrella ? true : undefined,
    companyId: p.companyId || undefined,
  };
}

interface RideCompany {
  business_profile_id: string;
  business_name: string;
  available_vehicles: number;
}

export function describePreferences(p: PickupPreferences, vehicleType: 'motorcycle' | 'car', companyName?: string | null): string[] {
  const out: string[] = [];
  if (vehicleType === 'motorcycle' && p.powerType === 'electric') out.push('Electric bike');
  if (vehicleType === 'motorcycle' && p.powerType === 'fuel') out.push('Petrol bike');
  if (vehicleType === 'motorcycle' && p.umbrella) out.push('Umbrella');
  if (p.companyId) out.push(companyName || 'Chosen company');
  return out;
}

export default function JourneyRideOptions({
  vehicleType,
  country,
  value,
  onChange,
}: {
  vehicleType: 'motorcycle' | 'car';
  country?: string;
  value: PickupPreferences;
  onChange: (next: PickupPreferences) => void;
}) {
  const [companies, setCompanies] = useState<RideCompany[]>([]);

  // Only companies that really have this kind of vehicle free right now.
  useEffect(() => {
    let cancelled = false;
    supabase
      .rpc('mbg_list_ride_companies', { p_country: country || null, p_vehicle_type: vehicleType })
      .then(({ data, error }) => {
        if (cancelled || error) return;
        const list = (data || []) as RideCompany[];
        setCompanies(list);
        // A previously chosen company that no longer has this vehicle type is dropped.
        if (value.companyId && !list.some((c) => c.business_profile_id === value.companyId)) {
          onChange({ ...value, companyId: '' });
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleType, country]);

  const bike = vehicleType === 'motorcycle';
  if (!bike && companies.length === 0) return null;

  const chip = (active: boolean) =>
    `classic-tile flex items-center justify-center gap-1.5 p-2.5 text-[13px] font-semibold ${active ? 'is-active' : ''}`;

  return (
    <details className="classic-card group !rounded-2xl p-3.5" open={value.powerType !== 'any' || value.umbrella || !!value.companyId}>
      <summary className="cursor-pointer select-none text-sm font-semibold text-slate-700">
        Ride options <span className="font-normal text-slate-500">— same choices as booking a ride</span>
      </summary>
      <div className="mt-3 space-y-3">
        {bike && (
          <div>
            <span className="classic-label">Bike type</span>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Bike type">
              <button type="button" aria-pressed={value.powerType === 'any'} onClick={() => onChange({ ...value, powerType: 'any' })} className={chip(value.powerType === 'any')}>Any</button>
              <button type="button" aria-pressed={value.powerType === 'electric'} onClick={() => onChange({ ...value, powerType: 'electric' })} className={chip(value.powerType === 'electric')}><Zap size={14} /> Electric</button>
              <button type="button" aria-pressed={value.powerType === 'fuel'} onClick={() => onChange({ ...value, powerType: 'fuel' })} className={chip(value.powerType === 'fuel')}><Fuel size={14} /> Petrol</button>
            </div>
          </div>
        )}
        {bike && (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-700">
            <input type="checkbox" checked={value.umbrella} onChange={(e) => onChange({ ...value, umbrella: e.target.checked })} className="h-4 w-4 accent-[#a17c28]" />
            <Umbrella size={15} className="text-[#a17c28]" /> Rider brings an umbrella
          </label>
        )}
        {companies.length > 0 && (
          <div>
            <label className="classic-label flex items-center gap-1.5" htmlFor="jb-ride-company"><Building2 size={13} /> Transport company</label>
            <select id="jb-ride-company" className="classic-input" value={value.companyId} onChange={(e) => onChange({ ...value, companyId: e.target.value })}>
              <option value="">Any driver</option>
              {companies.map((c) => (
                <option key={c.business_profile_id} value={c.business_profile_id}>
                  {c.business_name} ({c.available_vehicles} available)
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="text-[11px] leading-snug text-slate-500">
          If no driver matching these is free 10 minutes after your ride is due, the nearest driver is sent instead so you are never left waiting.
        </p>
      </div>
    </details>
  );
}
