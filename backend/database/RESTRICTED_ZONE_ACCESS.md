# Restricted zones: the rider's side (Gate Passes)

Organisations that control an area (estate, campus, hospital, market, port…) approve vehicles by rider ID card and scan it at
the gate. An approved vehicle enters free; any other vehicle must pay the entry fee, which the rider approves in
**BodaGoEra → Gate Passes** with their PIN. On the way out the card is scanned again and the vehicle must have paid everything.
IcanEra keeps 3% of every fee the organisation sets.

The database objects live in the ICAN repository (they join CMMS, the business wallet and the rider cards):

    ICAN/supabase/migrations/20261110100000_restricted_zone_access.sql
    ICAN/RESTRICTED_ZONE_ACCESS_PASTE_INTO_SUPABASE.sql      (the same file, to paste into the SQL editor)
    ICAN/RESTRICTED_ZONE_ACCESS_DEPLOY.md                    (how it works, deploy order, tests)

Run it after `ADD_RIDER_ID_CARDS.sql` and `ADD_RIDER_CARD_EXPIRY_AND_KIN.sql` in this folder.

Rider-side functions (all `authenticated`): `mbg_my_gate_passes()`, `mbg_rider_pay_gate_fee(visit)`, `mbg_rider_decline_gate_fee(visit)`.
Screen: `frontend/src/mybodaguy/components/RiderGatePasses.tsx` (tab on the rider dashboard and an Overview tile that appears
only while a gate is waiting for the rider).
