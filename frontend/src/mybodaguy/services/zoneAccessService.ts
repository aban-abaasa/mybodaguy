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
  access_basis: 'member' | 'paid' | 'day_pass' | 'open' | 'ride_pass' | null;
  reason: string | null;
  plate_number: string | null;
  vehicle_type: string | null;
  entry_fee_ugx: number;
  overstay_ugx: number;
  fee_due_ugx: number;
  fee_paid_ugx: number;
  balance_ugx: number;
  payment_method: 'wallet' | 'cash' | null;
  // Who the fee is charged to: the rider, or the customer of a live ride that goes to or from the zone.
  payer: 'rider' | 'customer';
  ride_id: string | null;
  // What was passed on to the customer's wallet (and paid back to the rider) for a fee the rider fronted.
  passed_on_ugx: number;
  passed_on_at: string | null;
  requested_at: string | null;
  pay_by: string | null;
  entered_at: string | null;
  exited_at: string | null;
}

// A fee the gate is waiting for: the entry fee (not inside yet) or a balance owed before leaving.
export interface GateRequest extends GateVisit {
  kind: 'entry' | 'balance';
  fee_ican: number;
  // The rider has to front it, but a customer's ride carries it: collect it from the customer.
  recover_from_customer: boolean;
}

// An entry fee the customer of the rider's ride pays (the gate takes it from the customer; nothing for the rider to do).
export interface GateCustomerPays extends GateVisit {
  zone_name: string;
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
  customer_pays: GateCustomerPays[];
  inside: GateInside[];
  recent: GateVisit[];
}

export const EMPTY_GATE_OVERVIEW: GateOverview = { ugx_per_ican: 5000, passes: [], requests: [], customer_pays: [], inside: [], recent: [] };

// ── the customer's side: told before booking, charged with the ride ─────────────────────────────────────────────

// One zone a trip would meet: where it starts or ends inside an area that charges vehicles to enter.
export interface TripCharge {
  zone_id: string;
  zone_name: string;
  organisation: string | null;
  location: string | null;
  applies_at: 'pickup' | 'dropoff' | 'both';
  vehicle_type: string | null;
  // The fee for the chosen vehicle type; null while the type is not chosen (then fee_min_ugx..fee_max_ugx is the range).
  fee_ugx: number | null;
  fee_min_ugx: number;
  fee_max_ugx: number;
  // An approved rider pays nothing, so neither does the customer.
  waived: boolean;
  accepts_cash: boolean;
}

export interface TripCharges {
  charges: TripCharge[];
  total_ugx: number;
  total_max_ugx: number;
}

export const NO_TRIP_CHARGES: TripCharges = { charges: [], total_ugx: 0, total_max_ugx: 0 };

// What a ride was charged for entering zones (customer's and rider's ride screens).
export interface RideZoneCharge {
  visit_id: string;
  zone_name: string;
  organisation: string | null;
  fee_ugx: number;
  paid_ugx: number;
  status: GateVisitStatus;
  payer: 'rider' | 'customer';
  payment_method: 'wallet' | 'cash' | null;
  entered_at: string | null;
  // The rider paid it at the gate and it was taken from the customer's wallet and paid back to the rider.
  passed_on_ugx: number;
  // The rider paid it and has not been paid back: they collect it from the customer.
  recover_from_customer: boolean;
}

// A warning the customer was shown when booking that has not been charged (yet).
export interface RideZoneWarning {
  zone_name: string;
  organisation: string | null;
  max_fee_ugx: number;
}

export interface RideZoneCharges {
  role: 'customer' | 'rider';
  charges: RideZoneCharge[];
  warnings: RideZoneWarning[];
}

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
  // A fee fronted for a customer's ride: already taken from the customer and paid back, or still to collect from them.
  passedOn?: boolean;
  recoverFromCustomer?: boolean;
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
        customer_pays: res.customer_pays ?? [],
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
    const res = data as { success?: boolean; error?: string; already_paid?: boolean; passed_on?: boolean; recover_from_customer?: boolean } | null;
    return res?.success
      ? { success: true, alreadyPaid: !!res.already_paid, passedOn: !!res.passed_on, recoverFromCustomer: !!res.recover_from_customer }
      : { success: false, error: res?.error || 'Payment failed' };
  },

  async declineFee(visitId: string): Promise<GatePayResult> {
    const { data, error } = await supabase.rpc('mbg_rider_decline_gate_fee', { p_visit_id: visitId });
    if (error) return { success: false, error: error.message };
    const res = data as { success?: boolean; error?: string } | null;
    return res?.success ? { success: true } : { success: false, error: res?.error || 'Could not decline' };
  },

  // The warning before booking: the entry fees a trip would meet. Empty when nothing applies, and also when gate passes
  // are not switched on yet, so the booking screen simply shows nothing.
  async getTripCharges(
    pickup: { lat: number; lng: number },
    dropoff: { lat: number; lng: number },
    vehicleType: string | null,
  ): Promise<TripCharges> {
    const { data, error } = await supabase.rpc('mbg_zone_charges_for_trip', {
      p_pickup_lat: pickup.lat,
      p_pickup_lng: pickup.lng,
      p_dropoff_lat: dropoff.lat,
      p_dropoff_lng: dropoff.lng,
      p_vehicle_type: vehicleType,
    });
    const res = data as (Partial<TripCharges> & { success?: boolean }) | null;
    if (error || !res || res.success === false) return NO_TRIP_CHARGES;
    return { charges: res.charges ?? [], total_ugx: Number(res.total_ugx) || 0, total_max_ugx: Number(res.total_max_ugx) || 0 };
  },

  // Called right after the ride is booked: records that the customer was shown these fees, which is what lets the gate
  // charge the customer (and not the rider) for them. Never blocks or fails a booking.
  async ackRideCharges(rideId: string, vehicleType: string | null): Promise<void> {
    try {
      await supabase.rpc('mbg_ack_ride_zone_charges', { p_ride_id: rideId, p_vehicle_type: vehicleType });
    } catch { /* the ride is already booked; the gate falls back to the rider paying */ }
  },

  // What a ride was charged for zone entry, for the customer's and the rider's ride screen.
  async getRideCharges(rideId: string): Promise<RideZoneCharges | null> {
    const { data, error } = await supabase.rpc('mbg_ride_zone_charges', { p_ride_id: rideId });
    const res = data as (Partial<RideZoneCharges> & { success?: boolean }) | null;
    if (error || !res || res.success === false) return null;
    return { role: res.role === 'rider' ? 'rider' : 'customer', charges: res.charges ?? [], warnings: res.warnings ?? [] };
  },
};
