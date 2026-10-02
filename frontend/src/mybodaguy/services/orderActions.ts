import { supabase } from '../../services/supabaseClient';

// Reasons offered in the cancel dialog. "Other" lets the person type their own.
export const CUSTOMER_CANCEL_REASONS = [
  'Booked by mistake',
  'Found another ride',
  'Waiting too long',
  'Wrong pickup or drop-off',
  'Change of plans',
  'Rider asked me to cancel',
];

export const RIDER_CANCEL_REASONS = [
  'Customer not at pickup',
  'Customer unreachable',
  'Customer asked me to cancel',
  'Bike or vehicle problem',
  'Too far / wrong location',
  'Emergency',
];

export const SUPERMARKET_CANCEL_REASONS = [
  'Ordered by mistake',
  'Items not available',
  'Delivery taking too long',
  'Wrong delivery address',
  'Change of plans',
];

/** Cancels a ride (customer or rider) — the reason is required and stored on the ride. */
export async function cancelRide(rideId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('mbg_cancel_ride', { p_ride_id: rideId, p_reason: reason });
  if (error) throw new Error(error.message || 'Could not cancel the ride.');
}

/**
 * Cancels an unfinished journey. Unfinished ground rides are cancelled and, when no
 * driver had accepted them yet, refunded; the air ticket is NOT refunded and stays valid.
 */
export async function cancelJourney(journeyId: string, reason: string): Promise<{ hasAirTicket: boolean; refundedIcan: number }> {
  const { data, error } = await supabase.rpc('mbg_cancel_journey', { p_journey_id: journeyId, p_reason: reason });
  if (error) {
    throw new Error(/mbg_cancel_journey/.test(error.message) ? 'Cancelling journeys is not switched on yet.' : error.message);
  }
  if (!data?.success) throw new Error(data?.error || 'Could not cancel the journey right now.');
  return { hasAirTicket: !!data.has_air_ticket, refundedIcan: Number(data.refunded_ican) || 0 };
}

/**
 * "Deletes" finished rides/orders from the caller's own history. The rides stay
 * on the server for earnings and wallet records — only this person's view hides them.
 */
export async function hideMyRides(rideIds: string[]): Promise<{ hiddenIds: string[]; skipped: Array<{ id: string; reason: string }> }> {
  const { data, error } = await supabase.rpc('mbg_hide_my_rides', { p_ride_ids: rideIds });
  if (error) {
    throw new Error(/mbg_hide_my_rides/.test(error.message) ? 'Deleting orders is not switched on yet.' : error.message);
  }
  if (!data?.success) throw new Error(data?.error || 'Could not delete the order right now.');
  return { hiddenIds: data.hidden_ids ?? [], skipped: data.skipped ?? [] };
}

export const isFinishedRideStatus = (status: string) => ['completed', 'cancelled', 'failed'].includes(status);
export const isCancellableRideStatus = (status: string) => ['pending', 'accepted', 'in_progress'].includes(status);
