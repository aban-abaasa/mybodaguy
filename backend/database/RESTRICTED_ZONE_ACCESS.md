# Restricted zones: the rider's side (Gate Passes)

Organisations that control an area (estate, campus, hospital, market, port…) approve vehicles by rider ID card and scan it at
the gate. An approved vehicle enters free; any other vehicle must pay the entry fee, which the rider approves in
**BodaGoEra → Gate Passes** with their PIN. On the way out the card is scanned again and the vehicle must have paid everything.
IcanEra keeps 3% of every fee the organisation sets.

**With a customer on the ride, the customer pays.** The booking screen (`ZoneChargeNotice.tsx`) warns the customer before they book
that a place charges an entry fee, that it is added to their trip, and that they pay it, not their rider. At the gate the fee is
charged to the customer (wallet ride) or taken in cash from the passenger; if the customer was not warned, the rider pays so nothing
is held up and the whole fee is then passed on to the customer and paid back to the rider. A rider alone pays it herself. Both ride
screens show the fee (`RideZoneCharges.tsx`). The place must be on the map (latitude, longitude, radius) for this to work.

The database objects live in the ICAN repository (they join CMMS, the business wallet and the rider cards):

    ICAN/supabase/migrations/20261110100000_restricted_zone_access.sql
    ICAN/RESTRICTED_ZONE_ACCESS_PASTE_INTO_SUPABASE.sql      (the same file, to paste into the SQL editor)
    ICAN/RESTRICTED_ZONE_ACCESS_DEPLOY.md                    (how it works, deploy order, tests)

Run it after `ADD_RIDER_ID_CARDS.sql` and `ADD_RIDER_CARD_EXPIRY_AND_KIN.sql` in this folder.

Rider-side functions (all `authenticated`): `mbg_my_gate_passes()`, `mbg_rider_pay_gate_fee(visit)`, `mbg_rider_decline_gate_fee(visit)`.
Customer-side: `mbg_zone_charges_for_trip(...)` (the warning), `mbg_ack_ride_zone_charges(ride, vehicle_type)` (called once the ride is
booked), `mbg_ride_zone_charges(ride)` (for the ride screens). It also needs `ICAN/backend/ADD_RIDE_EARNING_CREDIT_FUNCTION.sql`.
Screen: `frontend/src/mybodaguy/components/RiderGatePasses.tsx` (tab on the rider dashboard and an Overview tile that appears
only while a gate is waiting for the rider).

**The gate runs from the public rider-card page.** `/rider-card/<code>` (`RiderCardVerifyPage.tsx`) now carries `RiderCardGatePanel.tsx`.
Staff of a zone scan the card with a phone camera, sign in once (Google or e-mail link; `main.tsx` returns them to the card after the
redirect) and the panel previews the scan (approved: free; not approved: the fee and who pays; inside: check out), then runs it with one
tap, follows a requested fee until the rider approves it in Gate Passes (or the gate takes cash), and warns first when the plate typed
does not match the card. Nobody else sees it: it appears only when `mbg_my_gate_zones()` returns a zone, which needs the Transport
**gate** action on the person's CMMS role. Service: `services/gateStaffService.ts`. SQL (in ICAN): `20261111100000_zone_gate_from_card_page.sql`
/ `ZONE_GATE_FROM_CARD_PAGE_PASTE_INTO_SUPABASE.sql` adds `mbg_my_gate_zones()` and `mbg_zone_gate_peek(zone, code)`; run it after the
restricted-zones SQL. Without it the page is unchanged and the panel stays hidden.

**A rider who goes in by force keeps it on his record, publicly.** The card page (`RiderCardVerifyPage.tsx`) shows `RiderGateRecord.tsx`
for everyone: each time a gate recorded that the vehicle went into a restricted area without paying (*Went in by force*) or left owing
money (*Left without paying*), with the date, the area, the organisation and *Settled / Not settled*. Never who recorded it, the private note
or the amount. Hidden for a clean record, and when the SQL is not installed. Gate staff report it from `RiderCardGatePanel.tsx` behind a
small link that says plainly it is public; the rider gets a phone alert; every other gate gets a warning. Paying settles a line but does not
remove it; only a manager of the organisation can withdraw one recorded in error. The staff of the organisation that recorded a line also
see it with its private details and the buttons they may use. SQL (in ICAN): `20261112100000_zone_forced_entry_record.sql` /
`ZONE_FORCED_ENTRY_RECORD_PASTE_INTO_SUPABASE.sql`. Service calls: `gateStaffService.ts` (`getRecord`, `staffIncidents`, `report`, `resolve`).
