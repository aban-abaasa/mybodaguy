/**
 * How long a rider has to answer a ride/delivery offer before it moves on.
 *
 * "Just Send" (auto-dispatch): the server offers the ride to one rider at a
 * time and gives each only a few seconds, so a request never sits with someone
 * who is not looking at their phone. The timing is enforced in
 * mbg_sweep_auto_dispatch_cascade (FIX_AUTO_DISPATCH_7S_CASCADE.sql,
 * v_offer_window) — change both together; this copy only draws the countdown.
 *
 * A rider the customer picked by hand gets longer: the customer chose them
 * deliberately and is waiting on that one person. That timeout is the
 * customer's own countdown in EnhancedRideRequest.tsx, after which the offer is
 * withdrawn (mbg_withdraw_ride_offer).
 */
export const AUTO_DISPATCH_OFFER_SECONDS = 7;
export const DIRECT_OFFER_SECONDS = 30;
