-- Bump the boda-ride (motorcycle/bicycle/tuktuk) rider cut from 95% to 88%,
-- i.e. chairpersons now share 12% of the fare instead of 5%. mbg_request_ride
-- computes rider_earning from commission.boda_chair_total_percentage alone,
-- while mbg_complete_ride/mbg_confirm_cash_received pay out the 5 hierarchy
-- levels independently from their own percentage keys — so both the total
-- AND the 5 per-level keys must be updated together, or the gap between
-- what's deducted from the rider and what's actually paid to chairpersons
-- would just go uncredited to anyone.
--
-- Per-level split keeps the SAME relative weights as the original 5% split
-- (stage 40% / parish 24% / subcounty 16% / division 12% / district 8%),
-- rescaled to sum to 12% instead of 5%. Non-boda (car/van/truck) is
-- untouched — that model has no chairperson to share with.

UPDATE public.mbg_platform_settings SET value = '12.0', updated_at = NOW() WHERE key = 'commission.boda_chair_total_percentage';
UPDATE public.mbg_platform_settings SET value = '4.8',  updated_at = NOW() WHERE key = 'commission.stage_chair_percentage';
UPDATE public.mbg_platform_settings SET value = '2.88', updated_at = NOW() WHERE key = 'commission.parish_chair_percentage';
UPDATE public.mbg_platform_settings SET value = '1.92', updated_at = NOW() WHERE key = 'commission.subcounty_chair_percentage';
UPDATE public.mbg_platform_settings SET value = '1.44', updated_at = NOW() WHERE key = 'commission.division_chair_percentage';
UPDATE public.mbg_platform_settings SET value = '0.96', updated_at = NOW() WHERE key = 'commission.district_chair_percentage';

NOTIFY pgrst, 'reload schema';
