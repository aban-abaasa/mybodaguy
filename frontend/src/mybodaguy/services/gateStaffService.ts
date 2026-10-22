import { supabase } from './supabaseClient';
import { gateNotInstalled } from './zoneAccessService';

// The gate, run from the rider's public card page. Whoever scans the QR on a rider's ID card with an ordinary phone camera lands on
// /rider-card/<code>; if they are signed in as staff of an organisation that runs a restricted zone (CMMS > Transport > gate),
// the page offers to check that vehicle in or out. Every call is a database function that checks the caller's CMMS role itself, so
// the page showing or hiding a button is never the only protection:
// ICAN/supabase/migrations/20261111100000_zone_gate_from_card_page.sql (ZONE_GATE_FROM_CARD_PAGE_PASTE_INTO_SUPABASE.sql) adds
// mbg_my_gate_zones and mbg_zone_gate_peek; the rest come from 20261110100000_restricted_zone_access.sql.

export interface GateZone {
  id: string;
  name: string;
  kind: string;
  location: string | null;
  status: 'active' | 'closed' | string;
  business_profile_id: string;
  business_name: string | null;
  entry_mode: 'members_only' | 'paid_entry';
  fee_basis: 'per_entry' | 'day_pass';
  accept_cash: boolean;
  fees: Record<string, number>;
  inside_count: number;
}

export interface GateVisitView {
  id: string;
  zone_id: string;
  status: 'awaiting_payment' | 'inside' | 'exited' | 'denied' | 'cancelled';
  access_basis: string | null;
  reason: string | null;
  entry_fee_ugx: number;
  overstay_ugx: number;
  fee_due_ugx: number;
  fee_paid_ugx: number;
  balance_ugx: number;
  payment_method: 'wallet' | 'cash' | null;
  payer: 'rider' | 'customer';
  passed_on_ugx: number;
  entered_at: string | null;
  pay_by: string | null;
}

// What scanning this card at this zone would do (nothing is written).
export interface GatePeek {
  found: boolean;
  card_state?: string;
  card_number?: string;
  outcome: 'inside' | 'awaiting' | 'free' | 'pay' | 'refused';
  // in: check in (free or after paying) | out: check out | wait: a fee was asked for | none: refused
  action: 'in' | 'out' | 'wait' | 'none';
  basis?: 'member' | 'open' | 'day_pass' | 'ride_pass';
  reason?: string;
  note?: string;
  message: string;
  fee_ugx?: number;
  fee_ican?: number;
  payer?: 'rider' | 'customer' | 'rider_then_customer';
  can_collect_cash?: boolean;
  member?: { kind: string; valid_until: string | null; note: string | null };
  rider?: { full_name: string | null; plate_number: string | null; vehicle_type: string | null; vehicle_model: string | null; vehicle_color: string | null };
  warnings?: string[];
  visit?: GateVisitView;
  zone?: { id: string; name: string; status: string; accept_cash: boolean; entry_mode: string };
}

export type GateVerdict = 'granted' | 'pay_required' | 'already_inside' | 'cleared' | 'balance_due' | 'not_checked_in' | 'denied';

export interface GateScanResult {
  verdict: GateVerdict;
  direction?: 'in' | 'out';
  message: string;
  reason?: string;
  payer?: 'rider' | 'customer';
  recover_from_customer?: boolean;
  can_collect_cash?: boolean;
  fee_ugx?: number;
  balance_ugx?: number;
  stay_minutes?: number;
  visit?: GateVisitView;
  warnings?: string[];
}

export interface GateCall<T> {
  data: T | null;
  error: string | null;
  // The SQL for the card page has not been run yet: nothing to show to anyone.
  notInstalled?: boolean;
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<GateCall<T>> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { data: null, error: error.message || 'Something went wrong', notInstalled: gateNotInstalled(`${error.code ?? ''} ${error.message ?? ''}`) };
    const res = data as (T & { success?: boolean; error?: string }) | null;
    if (!res || res.success === false) return { data: null, error: res?.error || 'Something went wrong' };
    return { data: res, error: null };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Something went wrong' };
  }
}

export const gateStaffService = {
  // Every zone the signed-in person may run the gate for, across all the businesses they work for. Empty for anyone else.
  async myZones(): Promise<GateCall<GateZone[]>> {
    const res = await call<{ zones: GateZone[] }>('mbg_my_gate_zones');
    return { data: res.data ? res.data.zones ?? [] : null, error: res.error, notInstalled: res.notInstalled };
  },

  peek: (zoneId: string, code: string) => call<GatePeek>('mbg_zone_gate_peek', { p_zone_id: zoneId, p_code: code }),

  // direction 'in' | 'out' is what the preview said, so a second tap on a vehicle that has just gone in cannot check it out by accident.
  scan: (zoneId: string, code: string, direction: 'in' | 'out', gate = '', plateSeen = '') =>
    call<GateScanResult>('mbg_zone_gate_scan', {
      p_zone_id: zoneId,
      p_code: code,
      p_direction: direction,
      p_gate: gate.trim() || null,
      p_plate_seen: plateSeen.trim() || null,
    }),

  visitStatus: (visitId: string) => call<{ visit: GateVisitView }>('mbg_zone_visit_status', { p_visit_id: visitId }),

  collectCash: (visitId: string) => call<{ visit: GateVisitView }>('mbg_zone_gate_collect_cash', { p_visit_id: visitId }),

  withdraw: (visitId: string) => call<Record<string, never>>('mbg_zone_gate_cancel', { p_visit_id: visitId }),
};
