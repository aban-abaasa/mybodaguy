import { supabase } from './supabaseClient';

// Restricted-zone gates, from the rider's side. The organisation that runs an area (estate, campus, hospital, market,
// port…) decides who is approved; at the gate it scans the QR on the rider's ID card. A rider who is approved passes free.
// Any other rider is asked for the entry fee, which they approve here with their PIN, and the same goes for an overstay
// balance that has to be paid before leaving. The database functions are in
// ICAN/supabase/migrations/20261110100000_restricted_zone_access.sql (RESTRICTED_ZONE_ACCESS_PASTE_INTO_SUPABASE.sql).

export type GateVisitStatus = 'awaiting_payment' | 'inside' | 'exited' | 'denied' | 'cancelled';

export interface GateVisit {
  id: string;
  zone_id: string;
  zone_name: string;
  status: GateVisitStatus;
  access_basis: 'member' | 'paid' | 'day_pass' | 'open' | null;
  reason: string | null;
  plate_number: string | null;
  vehicle_type: string | null;
  entry_fee_ugx: number;
  overstay_ugx: number;
  fee_due_ugx: number;
  fee_paid_ugx: number;
  balance_ugx: number;
  payment_method: 'wallet' | 'cash' | null;
  requested_at: string | null;
  pay_by: string | null;
  entered_at: string | null;
  exited_at: string | null;
}

// A fee the gate is waiting for: the entry fee (not inside yet) or a balance owed before leaving.
export interface GateRequest extends GateVisit {
  kind: 'entry' | 'balance';
  fee_ican: number;
}

export interface GateInside extends GateVisit {
  max_stay_minutes: number | null;
  minutes_inside: number;
}

// A zone that approved one of the rider's vehicles.
export interface GatePass {
  member_id: string;
  zone_id: string;
  zone_name: string;
  zone_kind: string;
  location: string | null;
  organisation: string | null;
  member_kind: string;
  status: 'active' | 'suspended' | 'revoked';
  // 'ok' or why the approval is not working right now (suspended, ended, outside hours…)
  state: string;
  valid_until: string | null;
  daily_start_time: string | null;
  daily_end_time: string | null;
  plate_number: string;
  vehicle_type: string;
}

export interface GateOverview {
  ugx_per_ican: number;
  passes: GatePass[];
  requests: GateRequest[];
  inside: GateInside[];
  recent: GateVisit[];
}

export const EMPTY_GATE_OVERVIEW: GateOverview = { ugx_per_ican: 5000, passes: [], requests: [], inside: [], recent: [] };

// "The database function isn't there": the zone SQL has not been run yet.
export const gateNotInstalled = (message?: string | null) =>
  !!message && /could not find the function|schema cache|does not exist|PGRST202|42883/i.test(message);

export const GATE_STATE_TEXT: Record<string, string> = {
  ok: 'Approved: you enter free',
  member_suspended: 'Suspended: you pay like anyone else',
  member_expired: 'Ended: you pay like anyone else',
  member_not_started: 'Not started yet',
  outside_hours: 'Not at this hour: you pay like anyone else',
};

export const ZONE_KIND_LABEL: Record<string, string> = {
  estate: 'Estate', campus: 'Campus', hospital: 'Hospital', market: 'Market', industrial: 'Industrial park',
  port: 'Port / depot', event: 'Event ground', other: 'Restricted area',
};

export interface GatePayResult {
  success: boolean;
  error?: string;
  alreadyPaid?: boolean;
}

export const zoneAccessService = {
  async getMyPasses(): Promise<{ overview: GateOverview; error?: string }> {
    const { data, error } = await supabase.rpc('mbg_my_gate_passes');
    if (error) return { overview: EMPTY_GATE_OVERVIEW, error: error.message };
    const res = data as (Partial<GateOverview> & { success?: boolean; error?: string }) | null;
    if (!res || res.success === false) return { overview: EMPTY_GATE_OVERVIEW, error: res?.error || 'Unexpected response' };
    return {
      overview: {
        ugx_per_ican: Number(res.ugx_per_ican) || 5000,
        passes: res.passes ?? [],
        requests: res.requests ?? [],
        inside: res.inside ?? [],
        recent: res.recent ?? [],
      },
    };
  },

  // Pays from the rider's own ICAN wallet. The PIN is checked by the caller first (like the rider ID card fee);
  // nothing is charged unless the whole payment, including the organisation's share, goes through.
  async payFee(visitId: string): Promise<GatePayResult> {
    const { data, error } = await supabase.rpc('mbg_rider_pay_gate_fee', { p_visit_id: visitId });
    if (error) return { success: false, error: error.message };
    const res = data as { success?: boolean; error?: string; already_paid?: boolean } | null;
    return res?.success ? { success: true, alreadyPaid: !!res.already_paid } : { success: false, error: res?.error || 'Payment failed' };
  },

  async declineFee(visitId: string): Promise<GatePayResult> {
    const { data, error } = await supabase.rpc('mbg_rider_decline_gate_fee', { p_visit_id: visitId });
    if (error) return { success: false, error: error.message };
    const res = data as { success?: boolean; error?: string } | null;
    return res?.success ? { success: true } : { success: false, error: res?.error || 'Could not decline' };
  },
};
