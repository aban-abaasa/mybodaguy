import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

// Per-vehicle-class fare rates (boda / car / van / truck). The pricing itself
// lives in the database (mbg_vehicle_fare / mbg_price_ride_for_rider, see
// ADD_VEHICLE_CLASS_FARE_RATES.sql) — this file only reads the numbers back so
// customers, riders and developers can see them.

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

export interface VehicleClassQuote extends VehicleRates {
  vehicle_type: string;
  label: string;
  /** The same trip priced for this class (peak-hour multiplier included, rider mode not). */
  fare: number;
  distance_km: number;
  time_multiplier: number;
  available_riders: number;
}

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
  };
}

export interface LatLng { lat: number; lng: number }

/** The same trip priced for every vehicle class, cheapest class first. Empty if the quote can't be had. */
export async function quoteVehicleClasses(pickup: LatLng, dropoff: LatLng): Promise<VehicleClassQuote[]> {
  const { data, error } = await supabase.rpc('mbg_quote_vehicle_classes', {
    p_pickup_lat: pickup.lat,
    p_pickup_lng: pickup.lng,
    p_dropoff_lat: dropoff.lat,
    p_dropoff_lng: dropoff.lng,
  });
  if (error) throw error;
  return ((data as any[]) || []).map(toQuote);
}

/**
 * Quotes for the trip between two points, refreshed when either point moves.
 * `null` until there is a route, and also when the quote can't be fetched
 * (e.g. the fare-rates migration hasn't been applied yet) — callers just show no prices.
 */
export function useVehicleClassQuotes(pickup: LatLng | null, dropoff: LatLng | null) {
  const [quotes, setQuotes] = useState<VehicleClassQuote[] | null>(null);
  const [loading, setLoading] = useState(false);

  const pLat = pickup?.lat, pLng = pickup?.lng, dLat = dropoff?.lat, dLng = dropoff?.lng;
  useEffect(() => {
    if (pLat == null || pLng == null || dLat == null || dLng == null) {
      setQuotes(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    quoteVehicleClasses({ lat: pLat, lng: pLng }, { lat: dLat, lng: dLng })
      .then((rows) => { if (!cancelled) setQuotes(rows.length ? rows : null); })
      .catch((err) => {
        console.warn('Could not load vehicle fare quotes:', err?.message || err);
        if (!cancelled) setQuotes(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pLat, pLng, dLat, dLng]);

  return { quotes, loading };
}

/**
 * Fare for a distance from a rate card, off-peak (multiplier 1), no rider mode,
 * no company rates. For ILLUSTRATING a rate card only — the price a customer is
 * actually charged always comes from the database. Mirrors mbg_vehicle_fare.
 */
export function illustrativeFare(rates: VehicleRates, km: number): number {
  const { long_haul_after_km: after, long_haul_per_km_rate: longRate } = rates;
  const distanceCharge = after != null && longRate != null && km > after
    ? after * rates.per_km_rate + (km - after) * longRate
    : km * rates.per_km_rate;
  return Math.round((Math.max(rates.min_fare, rates.base_fare + distanceCharge) + rates.loading_fee) / 100) * 100;
}

/** 18000 -> "18k", 318700 -> "319k", 1250000 -> "1.3M". For tight spaces. */
export function formatUgxShort(n: number): string {
  const trim = (x: number, digits: number) => x.toFixed(digits).replace(/\.0+$/, '');
  if (n >= 1_000_000) return `${trim(n / 1_000_000, n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${trim(n / 1_000, n >= 100_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString()}`;

/** A rate card as short plain-language lines ("UGX 8,000 base + UGX 2,500/km", "UGX 5,000 loading & handling"…). */
export function describeRates(r: VehicleRates): string[] {
  const lines = [`${ugx(r.base_fare)} base + ${ugx(r.per_km_rate)}/km`, `minimum ${ugx(r.min_fare)}`];
  if (r.loading_fee > 0) lines.push(`${ugx(r.loading_fee)} loading & handling`);
  if (r.long_haul_after_km != null && r.long_haul_per_km_rate != null) {
    lines.push(`past ${r.long_haul_after_km} km just ${ugx(r.long_haul_per_km_rate)}/km`);
  }
  return lines;
}
