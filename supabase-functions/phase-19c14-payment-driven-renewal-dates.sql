-- ============================================================================
-- phase-19c14-payment-driven-renewal-dates.sql
-- ----------------------------------------------------------------------------
-- Phase 19c.14 — Model B: payment-driven term dates.
--
-- Business model (locked 2026-05-17 per Caleb):
--   When a renewal invoice is paid, the new contract's term starts on
--   the payment date and runs for cycle_months calendar months. Examples:
--     • Daniel pays Apr 15 → new term Apr 15 - May 15
--     • Daniel pays May 17 (2 days late) → new term May 17 - Jun 17
--     • Family always gets a FULL month from the day they pay
--     • Renewal date "rolls forward" with payment timing
--
-- This phase updates BOTH activation paths to use payment-date math:
--   1. system_activate_draft_for_payment  (auto, fired by trigger
--      when invoice flips to paid — Phase 19c.12 #6)
--   2. assistant_activate_renewal         (manual, called by Caleb
--      from the website — Phase 19f)
--
-- Edge cases handled:
--   • No recurring template → default to 1 month
--   • cycle_months 2 → 2-month plan, end_at = start + interval '2 months'
--   • Postgres month arithmetic auto-handles short months (Jan 31 + 1mo
--     → Feb 28 → Mar 31 returns to last day of month)
--   • end_at set to end-of-day (23:59:59) to match existing convention
-- ============================================================================

BEGIN;

-- ─── 1. system_activate_draft_for_payment — payment-driven dates ──────────
CREATE OR REPLACE FUNCTION public.system_activate_draft_for_payment(
  p_invoice_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_invoice       record;
  v_target_draft  uuid;
  v_match_count   int := 0;
  v_client_id     uuid;
  v_old_contract  uuid;
  v_residual_min  int;
  v_draft         record;
  v_has_active    boolean;
  v_cycle_months  int;
  v_new_start     timestamptz;
  v_new_end       timestamptz;
BEGIN
  SELECT id, client_id, invoice_date, status INTO v_invoice
  FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND OR v_invoice.status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invoice not paid');
  END IF;
  v_client_id := v_invoice.client_id;

  SELECT EXISTS (
    SELECT 1 FROM public.contracts
    WHERE client_id = v_client_id AND status = 'active'
  ) INTO v_has_active;

  IF v_has_active THEN
    BEGIN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (NULL, 'PAYMENT_AUTO_ACTIVATE_SKIP', 'invoices', p_invoice_id,
              jsonb_build_object('reason', 'client still has active contract — payment is for current term',
                                 'client_id', v_client_id));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN jsonb_build_object('ok', true, 'activated', false, 'reason', 'client has active contract');
  END IF;

  SELECT COUNT(*), MIN(id) INTO v_match_count, v_target_draft
  FROM public.contracts
  WHERE client_id = v_client_id
    AND status = 'draft'
    AND start_at::date <= current_date;

  IF v_match_count = 0 THEN
    BEGIN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (NULL, 'PAYMENT_AUTO_ACTIVATE_SKIP', 'invoices', p_invoice_id,
              jsonb_build_object('reason', 'no ready draft', 'client_id', v_client_id));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN jsonb_build_object('ok', true, 'activated', false, 'reason', 'no ready draft');
  END IF;

  IF v_match_count > 1 THEN
    BEGIN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (NULL, 'PAYMENT_AUTO_ACTIVATE_AMBIGUOUS', 'invoices', p_invoice_id,
              jsonb_build_object('reason', 'multiple ready drafts',
                                 'client_id', v_client_id, 'match_count', v_match_count));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN jsonb_build_object('ok', true, 'activated', false, 'reason', 'multiple matches');
  END IF;

  SELECT id, client_id, status, start_at, end_at, included_minutes INTO v_draft
  FROM public.contracts WHERE id = v_target_draft;
  IF v_draft.status <> 'draft' THEN
    RETURN jsonb_build_object('ok', true, 'activated', false, 'reason', 'draft already promoted');
  END IF;

  -- Phase 19c.14 — payment-driven dates. Look up cycle_months from the
  -- client's recurring template (default 1 if missing). New term begins
  -- TODAY (when payment landed) and runs cycle_months calendar months.
  -- Postgres month arithmetic handles short-month edge cases naturally.
  SELECT COALESCE(cycle_months, 1) INTO v_cycle_months
  FROM public.client_recurring_invoices
  WHERE client_id = v_client_id AND enabled = true
  LIMIT 1;
  IF v_cycle_months IS NULL OR v_cycle_months < 1 THEN v_cycle_months := 1; END IF;

  v_new_start := current_date::timestamptz;
  v_new_end   := (current_date + (v_cycle_months || ' months')::interval
                  + interval '1 day' - interval '1 second')::timestamptz;

  WITH prior AS (
    SELECT c.id,
           c.included_minutes + COALESCE(SUM(hl.minutes_delta), 0) AS residual_min
    FROM public.contracts c
    LEFT JOIN public.hours_ledger hl ON hl.contract_id = c.id
    WHERE c.client_id = v_client_id
      AND c.status = 'expired'
      AND c.id <> v_target_draft
      AND (v_draft.start_at IS NULL OR c.end_at <= v_draft.start_at)
    GROUP BY c.id, c.included_minutes, c.end_at
    ORDER BY c.end_at DESC LIMIT 1
  )
  SELECT id, residual_min INTO v_old_contract, v_residual_min FROM prior;

  UPDATE public.contracts
     SET status = 'active',
         start_at = v_new_start,
         end_at = v_new_end,
         activated_at = now()
   WHERE id = v_target_draft;

  IF v_old_contract IS NOT NULL AND COALESCE(v_residual_min, 0) > 0 THEN
    INSERT INTO public.hours_ledger
      (client_id, contract_id, minutes_delta, reason_code)
    VALUES (v_client_id, v_target_draft, v_residual_min, 'admin_adjustment');
    BEGIN
      INSERT INTO public.contract_carryover_events
        (client_id, source_contract_id, destination_contract_id,
         minutes_transferred, destination_kind, notes, created_at)
      VALUES (v_client_id, v_old_contract, v_target_draft,
              v_residual_min, 'contract',
              'Auto-activated by payment (Phase 19c.12 + 19c.14 payment-driven)',
              now());
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  BEGIN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (NULL, 'PAYMENT_AUTO_ACTIVATED', 'contracts', v_target_draft,
            jsonb_build_object('source', 'invoice_paid_trigger',
                               'invoice_id', p_invoice_id,
                               'client_id', v_client_id,
                               'residual_minutes', COALESCE(v_residual_min, 0),
                               'source_contract_id', v_old_contract,
                               'new_start_at', v_new_start,
                               'new_end_at', v_new_end,
                               'cycle_months', v_cycle_months,
                               'date_model', 'payment_driven'));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'ok', true, 'activated', true,
    'contract_id', v_target_draft,
    'new_start_at', v_new_start,
    'new_end_at', v_new_end,
    'residual_minutes', COALESCE(v_residual_min, 0));
END;
$func$;


-- ─── 2. assistant_activate_renewal — payment-driven dates too ─────────────
-- Manual activation path: when admin clicks "Activate" on a draft. Uses
-- the same payment-driven date math as the auto path so behaviour is
-- consistent regardless of how activation is triggered.
CREATE OR REPLACE FUNCTION public.assistant_activate_renewal(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id       uuid := auth.uid();
  v_contract      record;
  v_client_id     uuid;
  v_old_contract  uuid;
  v_residual_min  int;
  v_cycle_months  int;
  v_new_start     timestamptz;
  v_new_end       timestamptz;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;

  SELECT id, client_id, status, assistant_id, start_at, end_at, included_minutes
    INTO v_contract
  FROM public.contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contract % not found', p_contract_id; END IF;
  IF v_contract.status <> 'draft' THEN
    RAISE EXCEPTION 'Contract is not a draft (status=%)', v_contract.status;
  END IF;
  IF v_contract.assistant_id IS DISTINCT FROM v_user_id
     AND NOT EXISTS (
       SELECT 1 FROM public.family_assignments
       WHERE client_id = v_contract.client_id AND user_id = v_user_id
     )
     AND NOT public.is_admin()
  THEN
    RAISE EXCEPTION 'Not authorized to activate this renewal';
  END IF;

  v_client_id := v_contract.client_id;

  -- Phase 19c.14 — payment-driven dates. New term begins TODAY
  -- (when activation happens) and runs cycle_months calendar months.
  SELECT COALESCE(cycle_months, 1) INTO v_cycle_months
  FROM public.client_recurring_invoices
  WHERE client_id = v_client_id AND enabled = true
  LIMIT 1;
  IF v_cycle_months IS NULL OR v_cycle_months < 1 THEN v_cycle_months := 1; END IF;

  v_new_start := current_date::timestamptz;
  v_new_end   := (current_date + (v_cycle_months || ' months')::interval
                  + interval '1 day' - interval '1 second')::timestamptz;

  WITH prior AS (
    SELECT c.id,
           c.included_minutes + COALESCE(SUM(hl.minutes_delta), 0) AS residual_min
    FROM public.contracts c
    LEFT JOIN public.hours_ledger hl ON hl.contract_id = c.id
    WHERE c.client_id = v_client_id
      AND c.status = 'expired'
      AND c.id <> p_contract_id
      AND (v_contract.start_at IS NULL OR c.end_at <= v_contract.start_at)
    GROUP BY c.id, c.included_minutes, c.end_at
    ORDER BY c.end_at DESC LIMIT 1
  )
  SELECT id, residual_min INTO v_old_contract, v_residual_min FROM prior;

  UPDATE public.contracts
     SET status = 'active',
         start_at = v_new_start,
         end_at = v_new_end,
         activated_at = now()
   WHERE id = p_contract_id;

  IF v_old_contract IS NOT NULL AND COALESCE(v_residual_min, 0) > 0 THEN
    INSERT INTO public.hours_ledger (client_id, contract_id, minutes_delta, reason_code)
    VALUES (v_client_id, p_contract_id, v_residual_min, 'admin_adjustment');
    BEGIN
      INSERT INTO public.contract_carryover_events (
        client_id, source_contract_id, destination_contract_id,
        minutes_transferred, destination_kind, notes, created_at
      ) VALUES (
        v_client_id, v_old_contract, p_contract_id,
        v_residual_min, 'contract',
        'Manual activation (Phase 19f + 19c.14 payment-driven)',
        now()
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'contract_carryover_events insert skipped: %', SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'contract_id', p_contract_id,
    'status', 'active',
    'carryover_minutes', COALESCE(v_residual_min, 0),
    'source_contract_id', v_old_contract,
    'new_start_at', v_new_start,
    'new_end_at', v_new_end,
    'cycle_months', v_cycle_months,
    'date_model', 'payment_driven'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assistant_activate_renewal(uuid) TO authenticated;

COMMIT;
