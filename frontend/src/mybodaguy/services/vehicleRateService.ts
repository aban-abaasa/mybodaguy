import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

// Per-vehicle-class fare rates (boda / car / van / truck). The pricing itself
// lives in the database (mbg_vehicle_fare / mbg_price_ride_for_rider, see
// ADD_VEHICLE_CLASS_FARE_RATES.sql) — this file only reads the numbers back so
// customers, riders and developers can see them. Van and truck are freight:
// priced from USD freight yardsticks at the live icaneracoin price, by the
// cargo's weight and handling class.

export interface VehicleRates {
  base_fare: number;
  per_km_rate: number;
  min_fare: number;
  /** Flat handling fee for vehicles that carry loads (van, truck). */
  loading_fee: number;
  /** Past this many km the per-km rate becomes long_haul_per_km_rate. */
  long_haul_after_km: number | null;
  long_haul_per_km_rate: number | null;
}

/** What a freight class (van, truck) charges today, in UGX at the live coin price. Null for boda/car. */
export interface FreightRates {
  freight_priced: boolean;
  freight_base_ugx: number | null;
  freight_per_km_ugx: number | null;
  freight_per_ton_km_ugx: number | null;
  freight_min_ugx: number | null;
  freight_loading_ugx: number | null;
}

export interface VehicleClassQuote extends VehicleRates, FreightRates {
  vehicle_type: string;
  label: string;
  /** The same trip priced for this class (peak-hour multiplier and any cargo included, rider mode not). */
  fare: number;
  distance_km: number;
  time_multiplier: number;
  /** Online riders of this class (that can carry the declared cargo, when there is any). */
  available_riders: number;
  /** False when nothing of this class can carry the declared weight. */
  can_carry: boolean;
}

/** What is being moved. Weight matters for van and truck; the handling class is a freight accessorial. */
export interface CargoSpec {
  weightKg: number | null;
  cargoClass: CargoClass;
}

export type CargoClass = 'standard' | 'fragile' | 'refrigerated' | 'hazardous';

// The handling classes the database knows (mbg_cargo_classes). Labels and
// hints are shown to customers; how much each one costs is internal.
export const CARGO_CLASSES: { id: CargoClass; label: string; hint: string }[] = [
  { id: 'standard', label: 'Standard', hint: 'Boxed or palletised goods' },
  { id: 'fragile', label: 'Fragile', hint: 'Glass, electronics, furniture' },
  { id: 'refrigerated', label: 'Chilled', hint: 'Perishable, temperature-controlled' },
  { id: 'hazardous', label: 'Hazardous', hint: 'Fuel, chemicals, gas' },
];

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

export function toVehicleRates(row: any): VehicleRates {
  return {
    base_fare: num(row.base_fare),
    per_km_rate: num(row.per_km_rate),
    min_fare: num(row.min_fare),
    loading_fee: num(row.loading_fee),
    long_haul_after_km: numOrNull(row.long_haul_after_km),
    long_haul_per_km_rate: numOrNull(row.long_haul_per_km_rate),
  };
}

function toQuote(row: any): VehicleClassQuote {
  return {
    ...toVehicleRates(row),
    vehicle_type: row.vehicle_type,
    label: row.label,
    fare: num(row.fare),
    distance_km: num(row.distance_km),
    time_multiplier: num(row.time_multiplier),
    available_riders: num(row.available_riders),
    can_carry: row.can_carry !== false,
    freight_priced: !!row.freight_priced,
    freight_base_ugx: numOrNull(row.freight_base_ugx),
    freight_per_km_ugx: numOrNull(row.freight_per_km_ugx),
    freight_per_ton_km_ugx: numOrNull(row.freight_per_ton_km_ugx),
    freight_min_ugx: numOrNull(row.freight_min_ugx),
    freight_loading_ugx: numOrNull(row.freight_loading_ugx),
  };
}

export interface LatLng { lat: number; lng: number }

/** The same trip (and cargo) priced for every vehicle class. Empty if the quote can't be had. */
export async function quoteVehicleClasses(pickup: LatLng, dropoff: LatLng, cargo?: CargoSpec | null): Promise<VehicleClassQuote[]> {
  const { data, error } = await supabase.rpc('mbg_quote_vehicle_classes', {
    p_pickup_lat: pickup.lat,
    p_pickup_lng: pickup.lng,
    p_dropoff_lat: dropoff.lat,
    p_dropoff_lng: dropoff.lng,
    p_cargo_weight_kg: cargo?.weightKg && cargo.weightKg > 0 ? cargo.weightKg : null,
    p_cargo_class: cargo?.cargoClass ?? null,
  });
  if (error) throw error;
  return ((data as any[]) || []).map(toQuote);
}

/**
 * Quotes for the trip between two points, refreshed when either point or the
 * cargo changes. `null` until there is a route, and also when the quote can't
 * be fetched (e.g. the fare-rates migration hasn't been applied yet) — callers
 * just show no prices.
 */
export function useVehicleClassQuotes(pickup: LatLng | null, dropoff: LatLng | null, cargo?: CargoSpec | null) {
  const [quotes, setQuotes] = useState<VehicleClassQuote[] | null>(null);
  const [loading, setLoading] = useState(false);

  const pLat = pickup?.lat, pLng = pickup?.lng, dLat = dropoff?.lat, dLng = dropoff?.lng;
  const weightKg = cargo?.weightKg ?? null;
  const cargoClass = cargo?.cargoClass ?? null;
  useEffect(() => {
    if (pLat == null || pLng == null || dLat == null || dLng == null) {
      setQuotes(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    // Typing a weight should not fire a request per keystroke.
    const timer = setTimeout(() => {
      quoteVehicleClasses({ lat: pLat, lng: pLng }, { lat: dLat, lng: dLng }, cargoClass ? { weightKg, cargoClass } : null)
        .then((rows) => { if (!cancelled) setQuotes(rows.length ? rows : null); })
        .catch((err) => {
          console.warn('Could not load vehicle fare quotes:', err?.message || err);
          if (!cancelled) setQuotes(null);
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pLat, pLng, dLat, dLng, weightKg, cargoClass]);

  return { quotes, loading };
}

/** 18000 -> "18k", 318700 -> "319k", 1250000 -> "1.3M". For tight spaces. */
export function formatUgxShort(n: number): string {
  const trim = (x: number, digits: number) => x.toFixed(digits).replace(/\.0+$/, '');
  if (n >= 1_000_000) return `${trim(n / 1_000_000, n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${trim(n / 1_000, n >= 100_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString()}`;

/**
 * A rate card as short plain-language lines. Boda / car: base + per km, minimum.
 * Van / truck: the freight rates at today's live coin price — base, per km, per
 * tonne-km of cargo, minimum, loading — with the long-haul drop.
 */
export function describeRates(q: VehicleRates & Partial<FreightRates>): string[] {
  const lines: string[] = [];
  if (q.freight_priced && q.freight_per_km_ugx != null) {
    lines.push(`${ugx(q.freight_base_ugx ?? 0)} base + ${ugx(q.freight_per_km_ugx)}/km`);
    if ((q.freight_per_ton_km_ugx ?? 0) > 0) lines.push(`+ ${ugx(q.freight_per_ton_km_ugx!)} per tonne-km of cargo`);
    if ((q.freight_min_ugx ?? 0) > 0) lines.push(`minimum ${ugx(q.freight_min_ugx!)}`);
    if ((q.freight_loading_ugx ?? 0) > 0) lines.push(`${ugx(q.freight_loading_ugx!)} loading & handling`);
    if (q.long_haul_after_km != null) lines.push(`cheaper per km past ${q.long_haul_after_km} km`);
    return lines;
  }
  lines.push(`${ugx(q.base_fare)} base + ${ugx(q.per_km_rate)}/km`, `minimum ${ugx(q.min_fare)}`);
  if (q.loading_fee > 0) lines.push(`${ugx(q.loading_fee)} loading & handling`);
  if (q.long_haul_after_km != null && q.long_haul_per_km_rate != null) {
    lines.push(`past ${q.long_haul_after_km} km just ${ugx(q.long_haul_per_km_rate)}/km`);
  }
  return lines;
}
