/**
 * The platform charge added ON TOP of a ride/delivery fare.
 *
 * The fare is the exact transport fee and it is what the rider always
 * receives. The customer pays the fare plus this charge — the same amount
 * whether they pay by wallet or cash — and the server settles it
 * (ADD_EXACT_FARE_AND_CHARGES_ON_TOP.sql): wallet debits fare + charge from the
 * customer; cash has the customer hand over fare + charge and takes the charge
 * back from the rider's wallet.
 *
 * The percentage is the public developer-editable setting
 * commission.icanera_platform_fee_percentage, read live; the default only covers
 * the moment before it loads. Rounding matches the server (ROUND(fare * pct / 100)).
 */
import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

export const DEFAULT_PLATFORM_CHARGE_PCT = 8;
let cachedPlatformChargePct: number | null = null;

export function usePlatformChargePct(): number {
  const [pct, setPct] = useState(cachedPlatformChargePct ?? DEFAULT_PLATFORM_CHARGE_PCT);
  useEffect(() => {
    if (cachedPlatformChargePct !== null) return;
    supabase
      .from('mbg_platform_settings')
      .select('value')
      .eq('key', 'commission.icanera_platform_fee_percentage')
      .maybeSingle()
      .then(({ data }) => {
        const fee = Number(data?.value);
        if (Number.isFinite(fee) && fee >= 0) {
          cachedPlatformChargePct = fee;
          setPct(fee);
        }
      });
  }, []);
  return pct;
}

/** The charge, in UGX, added on top of this fare. */
export function platformCharge(fare: number, pct: number): number {
  return Math.round((Number(fare) || 0) * pct / 100);
}

/** What the customer pays in all: the exact fare plus the charge. */
export function customerTotal(fare: number, pct: number): number {
  return (Number(fare) || 0) + platformCharge(fare, pct);
}
