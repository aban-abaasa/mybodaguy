# BodaGoEra and the franchise program

BodaGoEra shares one database with IcanEra, so its rides take part in the IcanEra franchise program with no
code change in this repo. The franchise layer lives in the ICAN repo (`supabase/migrations/20261004100000_franchise_layer.sql`,
deploy notes in `FRANCHISE_LAYER_DEPLOY.md`).

## How a ride reaches a partner

1. A ride credits ICANera's platform fee through `fn_credit_platform_fee_to_business()` as it does today
   (`source_app = 'mybodaguy'`). Every path is covered: the wallet surcharge, the cash-ride fee fronted from the
   float, and the platform share of the rider cut.
2. A trigger on `ican_business_wallet_settlements` hands the fee to the franchise engine. HQ still receives 100%.
3. The engine finds the **Country Master licensed for BodaGoEra** in the rider's or customer's country and records
   its share (default 70% of the platform fee, HQ 30%) as an amount owed. Agencies and referral partners do not earn
   on rides.

Chairperson payouts are a separate mechanism, paid out of the same pool before ICANera's share, and are unchanged.

## What to keep right on this side

- **Country comes from `mbg_user_profiles.country`**, matched by country name against the shared country list.
  Sign-up already stores it. The column defaults to `Uganda`, so accounts created before country was captured count
  as Uganda.
- A BodaGoEra operator is a Country Master whose licence includes the `bodagoera` product. Without it, ride fees
  stay with HQ. Set this under the developer panel's Franchise tab, Partners.
- A refunded or reversed ride fee (`fn_reverse_platform_fee_to_business`) cancels the partner's share as well.
