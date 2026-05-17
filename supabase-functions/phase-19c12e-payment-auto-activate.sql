-- ============================================================================
-- phase-19c12e-payment-auto-activate.sql
-- ----------------------------------------------------------------------------
-- Phase 19c.12 #6 — Payment → next contract auto-activation.
--
-- When an invoice flips to status='paid', look for the family's draft
-- contract that this payment covers (start_at in a sensible window
-- around the invoice's date). If exactly ONE draft matches, activate
-- it (status='draft' → 'active'), and roll residual hours from the
-- prior expired contract forward.
--
-- Mirrors assistant_activate_renewal but bypasses the auth.uid() check
-- so it can fire from a trigger context where there's no user (cron,
-- pg_net callbacks, etc.). Audit logs record the activation.
--
-- Safety: only activates if EXACTLY ONE matching draft exists. Zero
-- or multiple → silent no-op + warning in audit_logs (admin decides).
-- ============================================================================

BEGIN;

-- ─── 1. System-level activation helper (no auth required) ─────────────────
CREATE OR REPLACE FUNCTION public.system_activate_draft_for_payment(
  p_invoice_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_invoice       record;
  v_drafts        record[];
  v_target_draft  uuid;
  v_match_count   int := 0;
  v_client_id     uuid;
  v_old_contract  uuid;
  v_residual_min  int;
  v_draft         record;
BEGIN
  -- Load invoice
  SELECT id, client_id, invoice_date, status
    INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id;
  IF NOT FOUND OR v_invoice.status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invoice not paid');
  END IF;

  v_client_id := v_invoice.client_id;

  -- Find draft contracts for this client whose start_at is near
  -- the invoice date. Window: invoice_date - 14d to + 30d.
  -- Count matches; only act if exactly one.
  SELECT COUNT(*), MIN(id) INTO v_match_count, v_target_draft
  FROM public.contracts
  WHERE client_id = v_client_id
    AND status = 'draft'
    AND start_at::date BETWEEN (v_invoice.invoice_date - interval '14 days')::date
                           AND (v_invoice.invoice_date + interval '30 days')::date;

  IF v_match_count = 0 THEN
    -- Most common case: payment is for the current term (not a renewal).
    -- Or the draft hasn't been created yet (rare).
    BEGIN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (NULL, 'PAYMENT_AUTO_ACTIVATE_SKIP', 'invoices', p_invoice_id,
              jsonb_build_object('reason', 'no matching draft', 'client_id', v_client_id));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN jsonb_build_object('ok', true, 'activated', false, 'reason', 'no matching draft');
  END IF;

  IF v_match_count > 1 THEN
    -- Ambiguous: admin must pick. Log and bail.
    BEGIN
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (NULL, 'PAYMENT_AUTO_ACTIVATE_AMBIGUOUS', 'invoices', p_invoice_id,
              jsonb_build_object('reason', 'multiple matching drafts',
                                 'client_id', v_client_id, 'match_count', v_match_count));
    EXCEPTION WHEN OTHERS THEN NULL; END;
    RETURN jsonb_build_object('ok', true, 'activated', false, 'reason', 'multiple matches');
  END IF;

  -- Exactly one match → activate. Mirrors assistant_activate_renewal's logic.
  SELECT id, client_id, status, start_at, end_at, included_minutes
    INTO v_draft
  FROM public.contracts WHERE id = v_target_draft;

  IF v_draft.status <> 'draft' THEN
    RETURN jsonb_build_object('ok', true, 'activated', false, 'reason', 'draft already promoted');
  END IF;

  -- Find prior expired contract (residual donor)
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
    ORDER BY c.end_at DESC
    LIMIT 1
  )
  SELECT id, residual_min INTO v_old_contract, v_residual_min FROM prior;

  -- Promote
  UPDATE public.contracts SET status = 'active' WHERE id = v_target_draft;

  -- Roll residual forward if positive
  IF v_old_contract IS NOT NULL AND COALESCE(v_residual_min, 0) > 0 THEN
    INSERT INTO public.hours_ledger
      (client_id, contract_id, minutes_delta, reason_code)
    VALUES
      (v_client_id, v_target_draft, v_residual_min, 'admin_adjustment');
    BEGIN
      INSERT INTO public.contract_carryover_events
        (client_id, source_contract_id, destination_contract_id,
         minutes_transferred, destination_kind, notes, created_at)
      VALUES
        (v_client_id, v_old_contract, v_target_draft,
         v_residual_min, 'contract',
         'Auto-activated by payment (Phase 19c.12 system_activate_draft_for_payment)',
         now());
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- Audit
  BEGIN
    INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
    VALUES (NULL, 'PAYMENT_AUTO_ACTIVATED', 'contracts', v_target_draft,
            jsonb_build_object('source', 'invoice_paid_trigger',
                               'invoice_id', p_invoice_id,
                               'client_id', v_client_id,
                               'residual_minutes', COALESCE(v_residual_min, 0),
                               'source_contract_id', v_old_contract));
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'ok', true, 'activated', true,
    'contract_id', v_target_draft,
    'residual_minutes', COALESCE(v_residual_min, 0)
  );
END;
$func$;


-- ─── 2. Trigger on invoices: fire on transition to 'paid' ────────────────
CREATE OR REPLACE FUNCTION public._tg_auto_activate_on_invoice_paid()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Only act when status flips TO 'paid' (not paid → paid, not other transitions)
  IF NEW.status::text = 'paid' AND (OLD.status::text IS DISTINCT FROM 'paid') THEN
    BEGIN
      PERFORM public.system_activate_draft_for_payment(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      -- Don't block the payment if activation has an issue. Log and continue.
      BEGIN
        INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
        VALUES (NULL, 'PAYMENT_AUTO_ACTIVATE_ERROR', 'invoices', NEW.id,
                jsonb_build_object('error', SQLERRM, 'sqlstate', SQLSTATE));
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invoices_auto_activate_on_paid ON public.invoices;
CREATE TRIGGER trg_invoices_auto_activate_on_paid
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public._tg_auto_activate_on_invoice_paid();

COMMIT;
