-- ============================================================================
-- phase-19c10a-auto-receipt-return-ids.sql
-- ----------------------------------------------------------------------------
-- Phase 19c.10a — auto-fire receipt to family when chip marks invoice paid.
--
-- Server side: just one tiny change — assistant_action now returns the
--   receipt_id, invoice_id, and client_id in its response jsonb so the
--   browser FAB knows what to render + email after a successful
--   mark_paid_full. Other action keys return NULL for those fields.
--
-- Client side does the actual PDF render + email send (existing pipeline)
-- because html2canvas only runs in the browser.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assistant_action(
  p_thread_id uuid,
  p_action    text,
  p_payload   jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_thread       record;
  v_event_msg    text;
  v_uid          uuid;
  v_balance      int;
  v_inv_number   text;
  v_payment_rpc  jsonb;
  v_renewal      record;
  v_new_inv_id   uuid;
  v_new_inv_num  text;
  v_total_cents  int;
  v_receipt_id   uuid;       -- new: surfaced for auto-receipt
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;

  v_uid := auth.uid();
  IF v_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid) THEN
    v_uid := NULL;
  END IF;

  SELECT * INTO v_thread FROM public.assistant_threads WHERE id = p_thread_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Thread not found'; END IF;

  CASE p_action
    WHEN 'snooze_1d', 'snooze_3d', 'snooze_7d' THEN
      UPDATE public.assistant_threads
      SET status = 'snoozed',
          snoozed_until = now() + (CASE p_action
            WHEN 'snooze_1d' THEN interval '1 day'
            WHEN 'snooze_3d' THEN interval '3 days'
            ELSE interval '7 days' END),
          updated_at = now()
      WHERE id = p_thread_id;
      v_event_msg := 'Snoozed for ' || split_part(p_action, '_', 2);

    WHEN 'resolve' THEN
      UPDATE public.assistant_threads
      SET status='resolved', resolved_at=now(), resolved_by=v_uid, updated_at=now()
      WHERE id = p_thread_id;
      v_event_msg := 'Marked as handled';

    WHEN 'dismiss' THEN
      UPDATE public.assistant_threads
      SET status='dismissed', resolved_at=now(), resolved_by=v_uid, updated_at=now()
      WHERE id = p_thread_id;
      v_event_msg := 'Dismissed';

    WHEN 'reopen' THEN
      UPDATE public.assistant_threads
      SET status='awaiting_user', resolved_at=NULL, resolved_by=NULL,
          snoozed_until=NULL, updated_at=now()
      WHERE id = p_thread_id;
      v_event_msg := 'Reopened';

    WHEN 'mark_email_sent', 'send_reminder', 'send_followup' THEN
      UPDATE public.assistant_threads
      SET status='resolved', resolved_at=now(), resolved_by=v_uid, updated_at=now()
      WHERE id = p_thread_id;
      v_event_msg := COALESCE(p_payload->>'event_text',
        CASE p_action
          WHEN 'send_reminder' THEN 'Reminder email sent ✓'
          WHEN 'send_followup' THEN 'Follow-up email sent ✓'
          ELSE 'Email sent ✓' END);

    WHEN 'activate_contract' THEN
      IF v_thread.contract_id IS NULL THEN RAISE EXCEPTION 'Thread has no contract_id'; END IF;
      UPDATE public.contracts SET status='active', updated_at=now()
      WHERE id = v_thread.contract_id AND status='draft';
      IF NOT FOUND THEN RAISE EXCEPTION 'Contract not in draft status'; END IF;
      BEGIN
        INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
        VALUES (v_uid, 'CONTRACT_ACTIVATED', 'contracts', v_thread.contract_id,
                jsonb_build_object('via','oracle','thread_id',p_thread_id));
      EXCEPTION WHEN OTHERS THEN NULL; END;
      UPDATE public.assistant_threads
      SET status='resolved', resolved_at=now(), resolved_by=v_uid, updated_at=now()
      WHERE id = p_thread_id;
      v_event_msg := 'Contract activated ✓';

    WHEN 'mark_paid_full' THEN
      IF v_thread.invoice_id IS NULL THEN RAISE EXCEPTION 'Thread has no invoice_id'; END IF;
      SELECT balance_due_cents, invoice_number INTO v_balance, v_inv_number
      FROM public.invoices WHERE id = v_thread.invoice_id;
      IF v_balance IS NULL OR v_balance <= 0 THEN
        v_event_msg := 'Invoice ' || COALESCE(v_inv_number, '?') || ' was already paid';
      ELSE
        BEGIN
          v_payment_rpc := public.record_payment_received(
            v_thread.invoice_id, v_balance,
            COALESCE(p_payload->>'method', 'etransfer'),
            COALESCE(p_payload->>'reference', NULL),
            COALESCE(p_payload->>'note', 'Marked paid via Oracle chat'));
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'record_payment_received failed: %', SQLERRM;
        END;
        -- record_payment_received returns { receipt_id, receipt_number, ... }
        v_receipt_id := (v_payment_rpc->>'receipt_id')::uuid;
        v_event_msg  := 'Marked ' || COALESCE(v_inv_number, 'invoice') ||
                        ' paid in full ($' || to_char(v_balance / 100.0, 'FM999,990.00') || ') ✓';
      END IF;
      UPDATE public.assistant_threads
      SET status='resolved', resolved_at=now(), resolved_by=v_uid, updated_at=now()
      WHERE id = p_thread_id;

    WHEN 'create_renewal_invoice' THEN
      IF v_thread.contract_id IS NULL THEN
        RAISE EXCEPTION 'Thread has no contract_id';
      END IF;
      SELECT ctr.end_at, ctr.client_id,
             cri.id AS recurring_id, cri.cycle_months, cri.hours, cri.hourly_rate_cents,
             cri.unit_price_cents, cri.quantity, cri.subject, cri.terms,
             cri.customer_notes, cri.currency, cri.due_days_offset, cri.description
        INTO v_renewal
      FROM public.contracts ctr
      LEFT JOIN public.client_recurring_invoices cri
             ON cri.client_id = ctr.client_id AND cri.enabled = true
      WHERE ctr.id = v_thread.contract_id;

      IF v_renewal.recurring_id IS NULL THEN
        RAISE EXCEPTION 'No active recurring template for this client — set one up in the Recurring tab first';
      END IF;

      v_total_cents := (v_renewal.quantity * v_renewal.unit_price_cents)::int;

      INSERT INTO public.invoices (
        client_id, invoice_date, due_date, subject, terms, customer_notes,
        currency, status, total_cents, amount_paid_cents, balance_due_cents
      ) VALUES (
        v_renewal.client_id, current_date, v_renewal.end_at::date,
        v_renewal.subject, v_renewal.terms, v_renewal.customer_notes,
        v_renewal.currency, 'open', v_total_cents, 0, v_total_cents
      ) RETURNING id, invoice_number INTO v_new_inv_id, v_new_inv_num;

      INSERT INTO public.invoice_lines (
        invoice_id, position, description, quantity,
        unit_price_cents, line_total_cents, hours, hourly_rate_cents
      ) VALUES (
        v_new_inv_id, 1, v_renewal.description, v_renewal.quantity,
        v_renewal.unit_price_cents, v_total_cents,
        v_renewal.hours, v_renewal.hourly_rate_cents
      );

      UPDATE public.client_recurring_invoices
      SET next_invoice_date = (v_renewal.end_at::date + (v_renewal.cycle_months || ' months')::interval)::date,
          last_invoice_id = v_new_inv_id, last_invoice_date = current_date,
          total_invoices_created = total_invoices_created + 1,
          last_error = NULL, last_error_at = NULL, updated_at = now()
      WHERE id = v_renewal.recurring_id;

      BEGIN
        INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
        VALUES (v_uid, 'ORACLE_RENEWAL_INVOICE_CREATED', 'invoices', v_new_inv_id,
                jsonb_build_object('via','oracle','thread_id',p_thread_id,
                                   'contract_id',v_thread.contract_id,
                                   'total_cents',v_total_cents,
                                   'due_date',v_renewal.end_at::date));
      EXCEPTION WHEN OTHERS THEN NULL; END;

      UPDATE public.assistant_threads
      SET invoice_id = v_new_inv_id, status = 'resolved',
          resolved_at = now(), resolved_by = v_uid, updated_at = now()
      WHERE id = p_thread_id;

      v_event_msg := 'Created renewal invoice ' || COALESCE(v_new_inv_num, '?') ||
                     ' for $' || to_char(v_total_cents / 100.0, 'FM999,990.00') ||
                     ' (due ' || to_char(v_renewal.end_at, 'Mon DD') || ') ✓';

    ELSE
      RAISE EXCEPTION 'Unknown action: %', p_action;
  END CASE;

  INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
  VALUES (p_thread_id, 'system', 'event', v_event_msg, p_payload);

  -- Return shape: ok + event always, plus optional ids the FAB uses for
  -- follow-on actions (auto-receipt after mark_paid_full, etc.)
  RETURN jsonb_build_object(
    'ok',         true,
    'event',      v_event_msg,
    'receipt_id', v_receipt_id,
    'invoice_id', v_thread.invoice_id,
    'client_id',  v_thread.client_id
  );
END;
$func$;
GRANT EXECUTE ON FUNCTION public.assistant_action(uuid, text, jsonb) TO authenticated;

COMMIT;
