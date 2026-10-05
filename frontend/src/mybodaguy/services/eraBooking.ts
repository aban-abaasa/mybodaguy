// Pure helpers for the customer-confirm page of an Era API booking request (/book/<code>).
// A business asks for a ride or delivery through the API; nothing is dispatched until the CUSTOMER opens the link,
// signs in and books it here with their own session. Kept free of React and Supabase so it can be unit tested
// (tests/eraBooking.test.js) and so the argument mapping is reviewed once.

export const BOOKING_CODE = /^BK[0-9A-Fa-f]{20}$/;

export interface BookingPoint { label: string | null; lat: number; lng: number }
export interface BookingIntent {
  code: string;
  status: 'awaiting_confirmation' | 'booked' | 'cancelled' | 'expired' | string;
  kind: 'ride' | 'delivery';
  requested_by: string | null;
  pickup: BookingPoint;
  dropoff: BookingPoint;
  notes: string | null;
  quote: { total_ugx?: number; distance_km?: number; duration_min?: number; time_multiplier?: number; multiplier_reason?: string | null; total_ican?: number | null } | null;
  expires_at: string;
  ride_id: string | null;
}
export type PaymentMethod = 'wallet' | 'cash';

export const isBookingCode = (s: unknown): s is string => typeof s === 'string' && BOOKING_CODE.test(s);

/** Arguments for mbg_find_available_riders: the same call the app's own "Just Send" makes. */
export function findRidersArgs(i: BookingIntent) {
  return {
    p_pickup_lat: i.pickup.lat, p_pickup_lng: i.pickup.lng,
    p_dropoff_lat: i.dropoff.lat, p_dropoff_lng: i.dropoff.lng,
    p_dropoff_area: null, p_power_type: null, p_require_umbrella: false,
    p_exclude_rider_ids: [] as string[], p_limit: 5, p_vehicle_types: null, p_business_profile_id: null,
  };
}

/** Arguments for mbg_request_ride. The price is decided by that function, never by the business that asked. */
export function rideRequestArgs(i: BookingIntent, riderId: string, payment: PaymentMethod) {
  const delivery = i.kind === 'delivery';
  const place = (p: BookingPoint, fallback: string) => (p.label && p.label.trim()) || fallback;
  return {
    p_service_type: i.kind,
    p_delivery_mode: delivery ? 'normal' : null,
    p_supermarket_id: null,
    p_rider_id: riderId,
    p_pickup_location: place(i.pickup, 'Pickup point'),
    p_pickup_lat: i.pickup.lat, p_pickup_lng: i.pickup.lng,
    p_dropoff_location: place(i.dropoff, 'Drop-off point'),
    p_dropoff_lat: i.dropoff.lat, p_dropoff_lng: i.dropoff.lng,
    p_power_type_requested: null,
    p_umbrella_requested: false,
    p_order_notes: i.notes ? `${i.requested_by ? i.requested_by + ': ' : ''}${i.notes}`.slice(0, 500) : (i.requested_by ? `Requested by ${i.requested_by}` : null),
    p_payment_method: payment,
    p_cart: null,
    p_max_delivery_hours: null,
    p_expense_classification: delivery ? 'personal_expense' : null,
    p_customer_business_profile_id: null,
  };
}

export function minutesLeft(expiresAt: string, now: Date = new Date()): number {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 60000)) : 0;
}

export function canBook(i: BookingIntent | null, now: Date = new Date()): boolean {
  return !!i && i.status === 'awaiting_confirmation' && minutesLeft(i.expires_at, now) > 0;
}

export function statusLine(i: BookingIntent, now: Date = new Date()): string {
  switch (i.status) {
    case 'booked': return 'Booked. Your rider is on the way, track it in the app.';
    case 'cancelled': return 'This request was cancelled.';
    case 'expired': return 'This link has expired. Ask the business to send a new one.';
    default: return minutesLeft(i.expires_at, now) > 0 ? `Waiting for you. This link works for ${minutesLeft(i.expires_at, now)} more minutes.` : 'This link has expired. Ask the business to send a new one.';
  }
}
