-- =============================================================
-- Phase 19e — Michael Yang carryover reconciliation
-- =============================================================
-- Problem: Today (2026-05-15) Michael's Apr 15 → May 14 contract
-- ended with 6.75 hours leftover (40 included + 2.75 carried in
-- - 36 used). His May 14 → Jun 13 contract auto-renewed but the
-- 6.75 didn't roll forward. The workspace shows "40 remaining"
-- on the new contract when truth should be 40 + 6.75 = 46.75.
--
-- Pattern we're matching: Apr 15 itself had "2.75 hours carried
-- over" recorded as a positive ledger entry on that contract.
-- We'll do the same — drop a positive minutes_delta entry on the
-- new May 14 contract for the leftover from Apr 15. Bank (25)
-- stays untouched; this is a contract→contract roll-forward.
--
-- ─── HOW TO RUN ─────────────────────────────────────────────
-- 1. Run Step 1 first (READ-ONLY inspection). Confirm the
--    numbers match your Google Sheet (Apr 15 should show
--    remaining ≈ 6.75, May 14 should show remaining ≈ 40).
-- 2. If numbers match, run Step 2 (the fix).
-- 3. Run Step 3 to verify (May 14 should now show ≈ 46.75).
-- 4. Reload Michael's workspace — Hours Remaining should
--    read 46.75 with "+6.75 carried in" under Plan size.
-- =============================================================


-- ─── STEP 1: INSPECT (read-only) ──────────────────────────
-- Shows every Michael contract, balance, and ledger composition.

WITH michael AS (
  SELECT id FROM public.clients
  WHERE full_name = 'Michael Yang'
  ORDER BY created_at ASC
  LIMIT 1
)
SELECT
  c.id AS contract_id,
  c.status,
  c.start_at::date AS start_date,
  c.end_at::date   AS end_date,
  ROUND((c.included_minutes / 60.0)::numeric, 2) AS included_h,
  ROUND((COALESCE(SUM(CASE WHEN hl.minutes_delta > 0 THEN hl.minutes_delta END), 0) / 60.0)::numeric, 2)
    AS topped_up_h,
  ROUND((COALESCE(SUM(CASE WHEN hl.minutes_delta < 0 THEN ABS(hl.minutes_delta) END), 0) / 60.0)::numeric, 2)
    AS used_h,
  ROUND(((c.included_minutes + COALESCE(SUM(hl.minutes_delta), 0)) / 60.0)::numeric, 2)
    AS remaining_h
FROM public.contracts c
LEFT JOIN public.hours_ledger hl ON hl.contract_id = c.id
WHERE c.client_id = (SELECT id FROM michael)
GROUP BY c.id
ORDER BY c.start_at DESC;

-- Also confirm bank balance (expected: 25)
SELECT
  ROUND((banked_minutes / 60.0)::numeric, 2) AS bank_hours
FROM public.client_bank_balance
WHERE client_id = (SELECT id FROM public.clients
                   WHERE full_name = 'Michael Yang' LIMIT 1);


-- ─── STEP 2: FIX (DO NOT RUN until Step 1 numbers match) ──
-- (a) Flip Apr 15 contract to 'expired' if it's past end_at
--     and still 'active' — this also lets any cron-based
--     reconciliation see it in a settled state.
-- (b) Insert a positive ledger entry on the May 14 contract
--     equal to the residual balance of the Apr 15 contract.
-- (c) Insert a contract_carryover_events row for audit.

DO $$
DECLARE
  v_client_id     uuid;
  v_old_contract  uuid;
  v_new_contract  uuid;
  v_residual_min  int;
BEGIN
  -- Find Michael
  SELECT id INTO v_client_id
  FROM public.clients
  WHERE full_name = 'Michael Yang'
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Michael Yang not found';
  END IF;

  -- Find the most recent contract that ended ON OR BEFORE today
  -- (this is the one that just expired with leftover hours).
  SELECT id INTO v_old_contract
  FROM public.contracts
  WHERE client_id = v_client_id
    AND end_at::date <= CURRENT_DATE
    AND start_at::date <= CURRENT_DATE - INTERVAL '15 days'  -- not the new one
  ORDER BY end_at DESC
  LIMIT 1;

  -- Find the currently-active contract (whose window contains today)
  SELECT id INTO v_new_contract
  FROM public.contracts
  WHERE client_id = v_client_id
    AND start_at::date <= CURRENT_DATE
    AND end_at::date   >= CURRENT_DATE
    AND status = 'active'
  ORDER BY start_at DESC
  LIMIT 1;

  RAISE NOTICE 'Old (just-ended) contract: %', v_old_contract;
  RAISE NOTICE 'New (currently active)   : %', v_new_contract;

  IF v_old_contract IS NULL OR v_new_contract IS NULL THEN
    RAISE EXCEPTION 'Could not identify both old and new contracts';
  END IF;

  IF v_old_contract = v_new_contract THEN
    RAISE EXCEPTION 'Old and new resolved to same row — aborting';
  END IF;

  -- Compute residual on the OLD contract:
  --   included + sum(ledger deltas) = remaining
  SELECT (c.included_minutes + COALESCE(SUM(hl.minutes_delta), 0))
    INTO v_residual_min
  FROM public.contracts c
  LEFT JOIN public.hours_ledger hl ON hl.contract_id = c.id
  WHERE c.id = v_old_contract
  GROUP BY c.id, c.included_minutes;

  RAISE NOTICE 'Residual minutes to carry: % (% hours)',
    v_residual_min, ROUND((v_residual_min / 60.0)::numeric, 2);

  IF v_residual_min IS NULL OR v_residual_min <= 0 THEN
    RAISE NOTICE 'No positive residual — nothing to carry. Done.';
    RETURN;
  END IF;

  -- (a) Flip old contract to 'expired' if still 'active'
  UPDATE public.contracts
  SET status = 'expired'
  WHERE id = v_old_contract
    AND status = 'active';

  -- (b) Drop a positive ledger entry on the new contract.
  --     reason_code 'admin_adjustment' is the safe enum value that
  --     allows non-zero positive deltas (matches Phase 12 pattern).
  --     IMPORTANT: hours_ledger.client_id is NOT NULL. Always pull
  --     it from the contract so the row never falls afoul of the
  --     constraint. (Hit on first attempt 2026-05-16.)
  INSERT INTO public.hours_ledger (
    client_id,
    contract_id,
    minutes_delta,
    reason_code
  ) VALUES (
    v_client_id,
    v_new_contract,
    v_residual_min,
    'admin_adjustment'
  );

  -- (c) Audit row in contract_carryover_events for full traceability.
  --     This mirrors what the auto-carryover trigger would have done.
  INSERT INTO public.contract_carryover_events (
    client_id,
    source_contract_id,
    destination_contract_id,
    minutes_transferred,
    destination_kind,
    notes,
    created_at
  ) VALUES (
    v_client_id,
    v_old_contract,
    v_new_contract,
    v_residual_min,
    'contract',  -- carried into next contract, not bank
    'Phase 19e manual reconciliation: auto-carryover didnt fire on rollover',
    now()
  );

  RAISE NOTICE 'Done. % minutes carried from % into %.',
    v_residual_min, v_old_contract, v_new_contract;
END $$;


-- ─── STEP 3: VERIFY ───────────────────────────────────────
-- Re-run Step 1's query. Expected outcome:
--   • Old contract (Apr 15 → May 14): status='expired', remaining_h ≈ 0
--     (still shows 6.75 as topped_up_h on its row but balance is now
--      considered settled because it's expired).
--   • New contract (May 14 → Jun 13): status='active',
--     topped_up_h ≈ 6.75, remaining_h ≈ 46.75
--   • Bank: 25 (unchanged)

WITH michael AS (
  SELECT id FROM public.clients
  WHERE full_name = 'Michael Yang'
  ORDER BY created_at ASC
  LIMIT 1
)
SELECT
  c.id AS contract_id,
  c.status,
  c.start_at::date AS start_date,
  c.end_at::date   AS end_date,
  ROUND((c.included_minutes / 60.0)::numeric, 2) AS included_h,
  ROUND((COALESCE(SUM(CASE WHEN hl.minutes_delta > 0 THEN hl.minutes_delta END), 0) / 60.0)::numeric, 2)
    AS topped_up_h,
  ROUND((COALESCE(SUM(CASE WHEN hl.minutes_delta < 0 THEN ABS(hl.minutes_delta) END), 0) / 60.0)::numeric, 2)
    AS used_h,
  ROUND(((c.included_minutes + COALESCE(SUM(hl.minutes_delta), 0)) / 60.0)::numeric, 2)
    AS remaining_h
FROM public.contracts c
LEFT JOIN public.hours_ledger hl ON hl.contract_id = c.id
WHERE c.client_id = (SELECT id FROM michael)
GROUP BY c.id
ORDER BY c.start_at DESC;


-- ─── QUICK RECIPE (what we actually ran for Michael) ──────
-- One-shot SQL to roll a known residual from an expired
-- contract into a known active contract. Use this whenever
-- the auto-carryover trigger doesn't fire on a renewal.
-- Replace the destination contract_id and minutes_delta with
-- the values from your Step 1 inspect query.
--
-- Pulls client_id from the contract itself so the NOT NULL
-- constraint on hours_ledger.client_id can't bite (it will).
--
--   INSERT INTO public.hours_ledger (client_id, contract_id, minutes_delta, reason_code)
--   SELECT client_id, id, <residual_minutes>, 'admin_adjustment'
--   FROM public.contracts
--   WHERE id = '<destination_contract_uuid>';
--
-- Example actually used for Michael 2026-05-16 (6.75 h = 405 min):
--   INSERT INTO public.hours_ledger (client_id, contract_id, minutes_delta, reason_code)
--   SELECT client_id, id, 405, 'admin_adjustment'
--   FROM public.contracts
--   WHERE id = '5af622ec-5ef7-4329-b22a-2a4b3d4e7648';
--
-- After running, re-run the Step 1 inspect query to verify
-- topped_up_h and remaining_h on the destination contract.
