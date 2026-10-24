// Asking a rider for a ride by scanning the QR on their ID card — no account needed.
// Database side: backend/database/ADD_RIDER_CARD_QR_RIDE.sql (mbg_card_ride_quote / _request / _status / _cancel).
//
// Paying: mobile money, card and cash are settled between customer and rider and carry the platform's
// transaction fee on top of the fare; paying from the ICAN wallet needs an account and carries no fee.

import { supabase } from './supabaseClient';

export type CardRidePayChannel = 'mobile_money' | 'card' | 'cash' | 'wallet';

export const PAY_CHANNELS: Array<{ id: CardRidePayChannel; label: string; hint: string; needsAccount: boolean }> = [
  { id: 'mobile_money', label: 'Mobile money', hint: 'MTN or Airtel, paid to the rider', needsAccount: false },
  { id: 'card', label: 'Card', hint: 'Paid to the rider', needsAccount: false },
  { id: 'cash', label: 'Cash', hint: 'Paid to the rider', needsAccount: false },
  { id: 'wallet', label: 'ICAN wallet', hint: 'Needs an account · no transaction fee', needsAccount: true },
];

export interface CardRideQuote {
  available: boolean;
  reason?: string;
  fare?: number;
  distance_km?: number;
  duration_min?: number;
  time_multiplier?: number;
  /** The platform charge added on top of the fare for every way of paying except the ICAN wallet. */
  transaction_fee?: number;
  fee_pct?: number;
}

export interface CardRideRequest {
  code: string;
  pickup: { label: string; lat: number; lng: number };
  dropoff: { label: string; lat: number; lng: number };
  channel: CardRidePayChannel;
  guestName?: string;
  guestPhone?: string;
  notes?: string;
}

export interface CardRideBooked {
  ride_id: string;
  token: string;
  fare: number;
  platform_charge: number;
  customer_total: number;
  fee_waived: boolean;
  payment_channel: CardRidePayChannel;
}

export type CardRideStatusName = 'pending' | 'accepted' | 'in_progress' | 'completed' | 'cancelled' | 'failed';

export interface CardRideStatus {
  status: CardRideStatusName;
  fare: number;
  platform_charge: number;
  customer_total: number;
  fee_waived: boolean;
  payment_channel: CardRidePayChannel | null;
  pickup_location: string;
  dropoff_location: string;
  cancelled_by: string | null;
  cancellation_reason: string | null;
}

/** What the customer pays in all for a way of paying: the ICAN wallet is the fare alone, the rest add the fee. */
export function cardRideTotal(fare: number, transactionFee: number, channel: CardRidePayChannel): number {
  return channel === 'wallet' ? fare : fare + transactionFee;
}

export const channelLabel = (channel: CardRidePayChannel | null | undefined) =>
  PAY_CHANNELS.find((c) => c.id === channel)?.label ?? 'Cash';

// The guest's handle on a ride they booked without an account lives on this device only.
const RIDE_KEY = 'bodagoera_card_ride';
export interface RememberedCardRide { code: string; rideId: string; token: string }

export function rememberCardRide(ride: RememberedCardRide): void {
  try { localStorage.setItem(RIDE_KEY, JSON.stringify(ride)); } catch { /* private mode: the ride just is not remembered */ }
}
export function recallCardRide(code: string): RememberedCardRide | null {
  try {
    const raw = localStorage.getItem(RIDE_KEY);
    const parsed = raw ? (JSON.parse(raw) as RememberedCardRide) : null;
    return parsed && parsed.code === code && parsed.rideId && parsed.token ? parsed : null;
  } catch { return null; }
}
export function forgetCardRide(): void {
  try { localStorage.removeItem(RIDE_KEY); } catch { /* nothing to forget */ }
}

export const isOpenStatus = (s: CardRideStatusName) => s === 'pending' || s === 'accepted' || s === 'in_progress';

export const cardRideService = {
  async quote(
    code: string,
    pickup?: { lat: number; lng: number } | null,
    dropoff?: { lat: number; lng: number } | null,
  ): Promise<{ quote: CardRideQuote | null; error: string | null }> {
    const { data, error } = await supabase.rpc('mbg_card_ride_quote', {
      p_code: code,
      p_pickup_lat: pickup?.lat ?? null,
      p_pickup_lng: pickup?.lng ?? null,
      p_dropoff_lat: dropoff?.lat ?? null,
      p_dropoff_lng: dropoff?.lng ?? null,
    });
    if (error) return { quote: null, error: error.message };
    return { quote: data as CardRideQuote, error: null };
  },

  async request(req: CardRideRequest): Promise<{ ride: CardRideBooked | null; error: string | null }> {
    const { data, error } = await supabase.rpc('mbg_card_ride_request', {
      p_code: req.code,
      p_pickup_location: req.pickup.label,
      p_pickup_lat: req.pickup.lat,
      p_pickup_lng: req.pickup.lng,
      p_dropoff_location: req.dropoff.label,
      p_dropoff_lat: req.dropoff.lat,
      p_dropoff_lng: req.dropoff.lng,
      p_pay_channel: req.channel,
      p_guest_name: req.guestName?.trim() || null,
      p_guest_phone: req.guestPhone?.trim() || null,
      p_notes: req.notes?.trim() || null,
    });
    if (error) return { ride: null, error: error.message };
    if (!data?.success) return { ride: null, error: data?.error || 'Could not send the request' };
    return { ride: data as CardRideBooked, error: null };
  },

  async status(rideId: string, token: string | null): Promise<{ status: CardRideStatus | null; error: string | null }> {
    const { data, error } = await supabase.rpc('mbg_card_ride_status', { p_ride_id: rideId, p_token: token });
    if (error) return { status: null, error: error.message };
    return { status: data as CardRideStatus, error: null };
  },

  async cancel(rideId: string, token: string | null, reason?: string): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('mbg_card_ride_cancel', { p_ride_id: rideId, p_token: token, p_reason: reason ?? null });
    return { error: error ? error.message : null };
  },
};
