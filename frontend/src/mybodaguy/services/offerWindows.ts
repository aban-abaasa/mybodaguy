/**
 * Timing of a ride/delivery request offered to riders.
 *
 * Every rider keeps an offer for OFFER_SECONDS from the moment they receive it.
 * A rider the customer picked by hand has that long, timed by the customer's own
 * countdown in EnhancedRideRequest.tsx (then mbg_withdraw_ride_offer).
 *
 * "Just Send" (auto-dispatch) shares one request with several riders at once: a
 * new rider is added every AUTO_DISPATCH_STAGGER_SECONDS while the earlier ones
 * still hold it, and whoever accepts first takes it. The server enforces both
 * numbers — change them together with the SQL in FIX_AUTO_DISPATCH_STAGGERED_OFFERS.sql
 * (v_window in mbg_make_ride_offer, v_stagger in mbg_sweep_auto_dispatch_cascade);
 * this file only draws the countdowns.
 */
export const OFFER_SECONDS = 30;
export const AUTO_DISPATCH_STAGGER_SECONDS = 7;
