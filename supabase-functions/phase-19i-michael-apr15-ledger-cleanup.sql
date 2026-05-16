-- =============================================================
-- Phase 19i — Michael Apr 15 ledger breakdown reconciliation
-- =============================================================
-- After Phase 19e/19g landed, Michael's workspace correctly showed
-- 6.75 hours remaining — but the BREAKDOWN didn't match Caleb's
-- Google Sheet bookkeeping:
--
--   Caleb's sheet: 40 (purchased) + 2.75 (carried over) - 36 (used) = 6.75
--   DB had:        40 (included)  + 5.50 (topped up)    - 38.75 (used) = 6.75
--
-- Headline matched, breakdown was off by an 8.25h pair of offsetting
-- entries (+5.50 admin_adjustment + -2.75 admin_adjustment + 2.75
-- worth of phantom -3h session entries that don't exist in Caleb's
-- record). Workspace's blue "Carried over" tile read 5.5 — felt
-- wrong to Caleb because his real carryover was 2.75.
--
-- Apr 15 ledger before this script:
--   12 × -3.00h session_completed (real sessions, sum -36h, KEEP)
--   1  × -2.75h admin_adjustment  (balance-out, DELETE)
--   1  × +5.50h admin_adjustment  (over-puffed carry, DELETE)
--
-- After this script:
--   12 × -3.00h session_completed (unchanged)
--   1  × +2.75h admin_adjustment  (clean carryover from Mar 13)
--
-- Verified post-run: topped_up_h=2.75, used_h=36.00, remaining_h=6.75
-- =============================================================

-- (1) Delete the two off-balance admin adjustments
DELETE FROM public.hours_ledger
WHERE id IN (
  '57ac4efb-8cd5-4349-8ef4-4e80c8ae1212',  -- -2.75h
  'ee1bb9c8-a427-4b5a-accb-98ada329bdb2'   -- +5.50h
);

-- (2) Insert clean +2.75h (165 min) carryover from Mar 13 contract.
--     Pulls client_id from the contract row to satisfy the NOT NULL
--     constraint on hours_ledger.client_id (caught earlier in 19e).
INSERT INTO public.hours_ledger (client_id, contract_id, minutes_delta, reason_code)
SELECT client_id, id, 165, 'admin_adjustment'
FROM public.contracts
WHERE id = 'd44d84c1-4f07-42ed-9625-c3ecefbb6d28';

-- (3) Verify: should show topped_up_h=2.75, used_h=36.00, remaining_h=6.75
SELECT
  ROUND(SUM(CASE WHEN minutes_delta > 0 THEN minutes_delta END)/60.0, 2) AS topped_up_h,
  ROUND(SUM(CASE WHEN minutes_delta < 0 THEN ABS(minutes_delta) END)/60.0, 2) AS used_h,
  ROUND((40 + SUM(minutes_delta)/60.0), 2) AS remaining_h
FROM public.hours_ledger
WHERE contract_id = 'd44d84c1-4f07-42ed-9625-c3ecefbb6d28';
