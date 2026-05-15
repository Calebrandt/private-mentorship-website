-- ─────────────────────────────────────────────────────────────────────────
-- Phase 11: Fix contract_history_ledger usage columns + plan_freezes tombstone
-- ─────────────────────────────────────────────────────────────────────────
-- Audit caught two issues:
--
-- (1) sync_contract_history_ledger_row writes hours_purchased correctly
--     but always leaves hours_used and hours_remaining_display NULL. So
--     every row in contract_history_ledger says "the family bought 24 hours
--     for this period" but never says "they used X." Audit incomplete.
--     If a family disputes hours, the history table can't prove what they
--     consumed. Fix: pull from v_contract_balance (which sums the ledger
--     correctly) and write both columns on every sync.
--
-- (2) plan_freezes references public.client_plans(id) — but client_plans
--     was removed in the migration to the canonical contracts schema. So
--     plan_freezes has a dangling FK target. Dead code. Phase 6's
--     contract_freezes is the correct replacement. Add a comment marking
--     plan_freezes as deprecated so the next session doesn't accidentally
--     wire to it.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────


-- (1) Replace sync_contract_history_ledger_row to populate usage columns

CREATE OR REPLACE FUNCTION public.sync_contract_history_ledger_row(p_contract_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_contract record;
  v_existing_id uuid;
  v_next_sort integer;
  v_consumed_minutes bigint;
  v_remaining_minutes bigint;
  v_hours_used numeric;
  v_hours_remaining numeric;
BEGIN
  SELECT
    c.id, c.client_id, c.start_at, c.end_at, c.status,
    c.created_at, c.included_minutes
  INTO v_contract
  FROM public.contracts c
  WHERE c.id = p_contract_id;

  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'Contract not found: %', p_contract_id;
  END IF;

  -- Phase 11: pull usage from v_contract_balance, which sums the
  -- canonical hours_ledger entries. consumed_minutes is the sum of
  -- session_completed / late_cancel_forfeit / no_show_forfeit /
  -- reinstate_deduct (all the *minutes-spent* reason codes).
  -- remaining_minutes = included_minutes + signed ledger sum (so it
  -- accounts for refunds and admin adjustments too).
  SELECT
    COALESCE(consumed_minutes, 0),
    COALESCE(remaining_minutes, 0)
  INTO v_consumed_minutes, v_remaining_minutes
  FROM public.v_contract_balance
  WHERE contract_id = p_contract_id;

  v_hours_used      := ROUND(GREATEST(0, COALESCE(v_consumed_minutes, 0))::numeric / 60.0, 2);
  v_hours_remaining := ROUND(GREATEST(0, COALESCE(v_remaining_minutes, 0))::numeric / 60.0, 2);

  SELECT chl.id
  INTO v_existing_id
  FROM public.contract_history_ledger chl
  WHERE chl.contract_id = v_contract.id
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.contract_history_ledger
    SET
      client_id = v_contract.client_id,
      period_start = v_contract.start_at::date,
      period_end = v_contract.end_at::date,
      payment_date = COALESCE(payment_date, v_contract.created_at::date),
      status = v_contract.status,
      hours_purchased = ROUND((COALESCE(v_contract.included_minutes, 0)::numeric / 60.0), 2),
      hours_used = v_hours_used,
      hours_remaining_display = v_hours_remaining,
      updated_at = NOW()
    WHERE id = v_existing_id;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(sort_order), -1) + 1
  INTO v_next_sort
  FROM public.contract_history_ledger
  WHERE client_id = v_contract.client_id;

  INSERT INTO public.contract_history_ledger (
    client_id, contract_id, ledger_label,
    period_start, period_end, payment_date,
    status, payment_amount_cents,
    hours_purchased, hours_used, hours_remaining_display,
    sort_order, notes
  )
  VALUES (
    v_contract.client_id, v_contract.id,
    CASE WHEN v_next_sort = 0 THEN 'Initial Contract' ELSE 'Renewal #' || v_next_sort END,
    v_contract.start_at::date, v_contract.end_at::date,
    v_contract.created_at::date, v_contract.status,
    NULL,
    ROUND((COALESCE(v_contract.included_minutes, 0)::numeric / 60.0), 2),
    v_hours_used,
    v_hours_remaining,
    v_next_sort,
    'Auto-created from contracts lifecycle'
  );
END;
$$;


-- (1b) Backfill: re-sync every existing row so the audit history is complete
-- right now, not just from this point forward. JOIN to contracts filters
-- out both NULL contract_ids AND orphaned history rows whose contract
-- no longer exists (caught in deploy: legacy data had at least one such row).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT chl.contract_id
    FROM public.contract_history_ledger chl
    JOIN public.contracts c ON c.id = chl.contract_id
  LOOP
    PERFORM public.sync_contract_history_ledger_row(r.contract_id);
  END LOOP;
END $$;


-- (2) plan_freezes tombstone: mark the legacy table as deprecated.
-- We don't drop the table (might have legacy rows useful for audit),
-- but we annotate it so future code/agents see the warning.
COMMENT ON TABLE public.plan_freezes IS
  'DEPRECATED — legacy table from the pre-canonical schema. FK references public.client_plans which no longer exists. Replaced by public.contract_freezes (Phase 6, 2026-05-15). Do not wire new functionality to this table.';
