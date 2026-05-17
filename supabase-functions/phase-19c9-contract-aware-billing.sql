-- ============================================================================
-- phase-19c9-contract-aware-billing.sql
-- ----------------------------------------------------------------------------
-- Adds a contract-end-driven path to the billing system, alongside (NOT
-- replacing) the existing calendar-driven recurring cron from Phase 19c.7a.
--
-- Real business model (re-grounded 2026-05-17):
--   Families buy pre-paid hour blocks tied to a CONTRACT with an end_at date.
--   The next-term invoice should fire ~3 days BEFORE contract.end_at so the
--   family pays before service interruption. Unused hours roll into the bank
--   (Phase 12 system). Lifecycle is renewal-driven, not calendar-monthly.
--
-- What this phase adds:
--   1. assistant_detect_contract_expiring_soon — finds active contracts with
--      end_at ≤ 3 days away that don't have a renewal invoice yet, creates
--      a thread with action "Create renewal invoice"
--   2. assistant_action 'create_renewal_invoice' — server-side: builds the
--      invoice + line item from the client's recurring template (for pricing),
--      sets due_date = contract.end_at (pay-before-gap), and advances the
--      calendar cron's next_invoice_date so we don't double-fire
--
-- What this phase does NOT touch:
--   • run_contract_lifecycle_tick (sacred — Master Engineering Manual)
--   • create_recurring_invoices_due (calendar cron stays as backup)
--   • client_bank_balance / carryover (Phase 12 — working as designed)
--   • Existing invoice/overdue/payment_expected detectors (separate phase)
--
-- After the new path proves itself in production, a follow-up phase will:
--   • Re-anchor invoice_overdue + payment_expected to contract.end_at
--   • Pause the calendar cron (or repurpose it as a safety-net only)
-- ============================================================================

BEGIN;

-- ─── 1. Detector: contract_expiring_soon ──────────────────────────────────
-- Reuses the already-seeded scenario_key from Phase 19c.8a
-- ('contract_expiring_soon', icon '🟠'). No new seed row needed.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assistant_detect_contract_expiring_soon(
  p_owner_user_id uuid
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_ctr record;
  v_thread_id uuid;
  v_days_until_end int;
  v_count int := 0;
BEGIN
  FOR v_ctr IN
    SELECT ctr.id           AS contract_id,
           ctr.client_id,
           ctr.end_at,
           ctr.included_minutes,
           COALESCE(c.billing_contact_name, c.full_name) AS recipient_label,
           cri.id            AS recurring_id,
           cri.cycle_months,
           cri.hours,
           cri.unit_price_cents,
           cri.quantity
    FROM public.contracts ctr
    JOIN public.clients c            ON c.id = ctr.client_id
    LEFT JOIN public.client_recurring_invoices cri
           ON cri.client_id = ctr.client_id AND cri.enabled = true
    WHERE ctr.status = 'active'
      -- Ending within 3 days (or already past — catch missed ones up to 7d back)
      AND ctr.end_at <= now() + interval '3 days'
      AND ctr.end_at >  now() - interval '7 days'
      -- No renewal invoice exists yet for the next term. We look for any
      -- invoice for this client dated within ±7d of end_at — that's our
      -- "renewal invoice for THIS contract boundary" heuristic.
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices i
        WHERE i.client_id = ctr.client_id
          AND i.invoice_date >= (ctr.end_at::date - interval '14 days')
          AND i.invoice_date <= (ctr.end_at::date + interval '14 days')
          AND i.status IN ('open','paid')
      )
      -- No live thread for this contract boundary
      AND NOT EXISTS (
        SELECT 1 FROM public.assistant_threads t
        WHERE t.contract_id = ctr.id
          AND t.scenario_key = 'contract_expiring_soon'
          AND t.status IN ('open','awaiting_user','snoozed')
          AND t.owner_user_id = p_owner_user_id
      )
      -- Not frozen
      AND NOT EXISTS (
        SELECT 1 FROM public.contract_freezes f
        WHERE f.contract_id = ctr.id
          AND f.starts_at <= now()
          AND (f.ends_at IS NULL OR f.ends_at > now())
      )
  LOOP
    v_days_until_end := GREATEST(0, EXTRACT(DAY FROM (v_ctr.end_at - now()))::int);

    INSERT INTO public.assistant_threads (
      owner_user_id, scenario_key, title, subtitle,
      contract_id, client_id, status, context
    ) VALUES (
      p_owner_user_id,
      'contract_expiring_soon',
      COALESCE(v_ctr.recipient_label, 'Client') || ' — contract ' ||
        CASE
          WHEN v_ctr.end_at < now()            THEN 'expired ' || abs(v_days_until_end) || 'd ago'
          WHEN v_days_until_end = 0            THEN 'expires today'
          WHEN v_days_until_end = 1            THEN 'expires tomorrow'
          ELSE 'expires in ' || v_days_until_end || ' days'
        END,
      'Send next-term invoice before ' || to_char(v_ctr.end_at, 'Mon DD'),
      v_ctr.contract_id, v_ctr.client_id, 'awaiting_user',
      jsonb_build_object(
        'contract_id',     v_ctr.contract_id,
        'end_at',          v_ctr.end_at,
        'days_until_end',  v_days_until_end,
        'recurring_id',    v_ctr.recurring_id,
        'expected_total_cents',
          CASE WHEN v_ctr.recurring_id IS NOT NULL
               THEN (v_ctr.quantity * v_ctr.unit_price_cents)::int
               ELSE NULL END
      )
    )
    RETURNING id INTO v_thread_id;

    -- Greeting message
    INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
    VALUES (
      v_thread_id, 'bot', 'text',
      'Heads up — ' || COALESCE(v_ctr.recipient_label, 'this family') ||
      '''s contract ' ||
        CASE
          WHEN v_ctr.end_at < now()            THEN 'EXPIRED ' || abs(v_days_until_end) || ' day' ||
                                                    CASE WHEN abs(v_days_until_end) = 1 THEN '' ELSE 's' END || ' ago'
          WHEN v_days_until_end = 0            THEN 'expires TODAY'
          WHEN v_days_until_end = 1            THEN 'expires TOMORROW'
          ELSE 'expires in ' || v_days_until_end || ' days'
        END ||
      ' (' || to_char(v_ctr.end_at, 'Mon DD') || '). ' ||
      CASE
        WHEN v_ctr.recurring_id IS NULL THEN
          'No recurring billing template is set for this family — I can''t auto-build the renewal invoice. Set one up in Recurring tab first, then re-scan.'
        ELSE
          'Want me to create the next-term invoice for $' ||
          to_char((v_ctr.quantity * v_ctr.unit_price_cents) / 100.0, 'FM999,990.00') ||
          ' now? It''ll be due on ' || to_char(v_ctr.end_at, 'Mon DD') ||
          ' so they pay before the service gap.'
      END
    );

    -- Action buttons — only show "Create" if we have a template
    IF v_ctr.recurring_id IS NOT NULL THEN
      INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
      VALUES (
        v_thread_id, 'bot', 'actions', NULL,
        jsonb_build_object('actions', jsonb_build_array(
          jsonb_build_object('key','create_renewal_invoice', 'label','Create renewal invoice', 'style','primary'),
          jsonb_build_object('key','snooze_1d',              'label','Wait 1 day',              'style','ghost'),
          jsonb_build_object('key','dismiss',                'label','Stop tracking',           'style','ghost')
        ))
      );
    ELSE
      INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
      VALUES (
        v_thread_id, 'bot', 'actions', NULL,
        jsonb_build_object('actions', jsonb_build_array(
          jsonb_build_object('key','snooze_1d', 'label','Wait 1 day',    'style','ghost'),
          jsonb_build_object('key','dismiss',   'label','Stop tracking', 'style','ghost')
        ))
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$func$;


-- ─── 2. Extend assistant_action with 'create_renewal_invoice' ─────────────
-- Server-side renewal-invoice builder. Mirrors the field shape of the
-- calendar cron's INSERT (Phase 19c.7a) so the resulting invoice + line
-- item render identically. Sets due_date = contract.end_at so payment
-- is due BEFORE the service gap. Advances client_recurring_invoices.next_invoice_date
-- to prevent double-fire from the calendar cron.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assistant_action(
  p_thread_id uuid,
  p_action    text,
  p_payload   jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_thread        record;
  v_event_msg     text;
  v_uid           uuid;
  v_balance       int;
  v_inv_number    text;
  v_payment_rpc   jsonb;
  v_renewal       record;
  v_new_inv_id    uuid;
  v_new_inv_num   text;
  v_total_cents   int;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;

  v_uid := auth.uid();
  IF v_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid) THEN
    v_uid := NULL;
  END IF;

  SELECT * INTO v_thread FROM public.assistant_threads
  WHERE id = p_thread_id;
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
      SET status = 'resolved', resolved_at = now(),
          resolved_by = v_uid, updated_at = now()
      WHERE id = p_thread_id;
      v_event_msg := 'Marked as handled';

    WHEN 'dismiss' THEN
      UPDATE public.assistant_threads
      SET status = 'dismissed', resolved_at = now(),
          resolved_by = v_uid, updated_at = now()
      WHERE id = p_thread_id;
      v_event_msg := 'Dismissed';

    WHEN 'reopen' THEN
      UPDATE public.assistant_threads
      SET status = 'awaiting_user', resolved_at = NULL, resolved_by = NULL,
          snoozed_until = NULL, updated_at = now()
      WHERE id = p_thread_id;
      v_event_msg := 'Reopened';

    WHEN 'mark_email_sent', 'send_reminder', 'send_followup' THEN
      UPDATE public.assistant_threads
      SET status = 'resolved', resolved_at = now(),
          resolved_by = v_uid, updated_at = now()
      WHERE id = p_thread_id;
      v_event_msg := COALESCE(p_payload->>'event_text',
        CASE p_action
          WHEN 'send_reminder' THEN 'Reminder email sent ✓'
          WHEN 'send_followup' THEN 'Follow-up email sent ✓'
          ELSE 'Email sent ✓'
        END);

    WHEN 'activate_contract' THEN
      IF v_thread.contract_id IS NULL THEN
        RAISE EXCEPTION 'Thread has no contract_id';
      END IF;
      UPDATE public.contracts
      SET status = 'active', updated_at = now()
      WHERE id = v_thread.contract_id AND status = 'draft';
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Contract not in draft status';
      END IF;
      BEGIN
        INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
        VALUES (v_uid, 'CONTRACT_ACTIVATED', 'contracts', v_thread.contract_id,
                jsonb_build_object('via','oracle','thread_id',p_thread_id));
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
      UPDATE public.assistant_threads
      SET status = 'resolved', resolved_at = now(),
          resolved_by = v_uid, updated_at = now()
      WHERE id = p_thread_id;
      v_event_msg := 'Contract activated ✓';

    WHEN 'mark_paid_full' THEN
      IF v_thread.invoice_id IS NULL THEN
        RAISE EXCEPTION 'Thread has no invoice_id';
      END IF;
      SELECT balance_due_cents, invoice_number
        INTO v_balance, v_inv_number
      FROM public.invoices WHERE id = v_thread.invoice_id;

      IF v_balance IS NULL OR v_balance <= 0 THEN
        v_event_msg := 'Invoice ' || COALESCE(v_inv_number, '?') || ' was already paid';
      ELSE
        BEGIN
          v_payment_rpc := public.record_payment_received(
            v_thread.invoice_id, v_balance,
            COALESCE(p_payload->>'method', 'etransfer'),
            COALESCE(p_payload->>'reference', NULL),
            COALESCE(p_payload->>'note', 'Marked paid via Oracle chat')
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'record_payment_received failed: %', SQLERRM;
        END;
        v_event_msg := 'Marked ' || COALESCE(v_inv_number, 'invoice') ||
                       ' paid in full ($' || to_char(v_balance / 100.0, 'FM999,990.00') || ') ✓';
      END IF;

      UPDATE public.assistant_threads
      SET status = 'resolved', resolved_at = now(),
          resolved_by = v_uid, updated_at = now()
      WHERE id = p_thread_id;

    WHEN 'create_renewal_invoice' THEN
      IF v_thread.contract_id IS NULL THEN
        RAISE EXCEPTION 'Thread has no contract_id';
      END IF;

      -- Pull contract + the family's billing template in one shot
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

      -- INSERT the invoice — mirrors phase-19c7a exactly except due_date,
      -- which is set to contract.end_at so payment is due BEFORE the gap.
      INSERT INTO public.invoices (
        client_id, invoice_date, due_date, subject, terms, customer_notes,
        currency, status, total_cents, amount_paid_cents, balance_due_cents
      ) VALUES (
        v_renewal.client_id,
        current_date,
        v_renewal.end_at::date,
        v_renewal.subject, v_renewal.terms, v_renewal.customer_notes,
        v_renewal.currency, 'open', v_total_cents, 0, v_total_cents
      )
      RETURNING id, invoice_number INTO v_new_inv_id, v_new_inv_num;

      INSERT INTO public.invoice_lines (
        invoice_id, position, description, quantity,
        unit_price_cents, line_total_cents, hours, hourly_rate_cents
      ) VALUES (
        v_new_inv_id, 1, v_renewal.description, v_renewal.quantity,
        v_renewal.unit_price_cents, v_total_cents,
        v_renewal.hours, v_renewal.hourly_rate_cents
      );

      -- Advance the calendar cron's schedule so it doesn't double-fire.
      -- Next slot is end_at + cycle_months (the start of the term AFTER
      -- the one we just billed for).
      UPDATE public.client_recurring_invoices
      SET next_invoice_date      = (v_renewal.end_at::date + (v_renewal.cycle_months || ' months')::interval)::date,
          last_invoice_id        = v_new_inv_id,
          last_invoice_date      = current_date,
          total_invoices_created = total_invoices_created + 1,
          last_error             = NULL,
          last_error_at          = NULL,
          updated_at             = now()
      WHERE id = v_renewal.recurring_id;

      -- Audit
      BEGIN
        INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
        VALUES (v_uid, 'ORACLE_RENEWAL_INVOICE_CREATED', 'invoices', v_new_inv_id,
                jsonb_build_object(
                  'via',          'oracle',
                  'thread_id',    p_thread_id,
                  'contract_id',  v_thread.contract_id,
                  'total_cents',  v_total_cents,
                  'due_date',     v_renewal.end_at::date
                ));
      EXCEPTION WHEN OTHERS THEN NULL;
      END;

      -- Link the new invoice to this thread and resolve. The next Oracle
      -- scan will surface it as an 'invoice_ready_to_send' thread, which
      -- gives Caleb the preview + send buttons.
      UPDATE public.assistant_threads
      SET invoice_id  = v_new_inv_id,
          status      = 'resolved',
          resolved_at = now(),
          resolved_by = v_uid,
          updated_at  = now()
      WHERE id = p_thread_id;

      v_event_msg := 'Created renewal invoice ' || COALESCE(v_new_inv_num, '?') ||
                     ' for $' || to_char(v_total_cents / 100.0, 'FM999,990.00') ||
                     ' (due ' || to_char(v_renewal.end_at, 'Mon DD') || ') ✓';

    ELSE
      RAISE EXCEPTION 'Unknown action: %', p_action;
  END CASE;

  INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
  VALUES (p_thread_id, 'system', 'event', v_event_msg, p_payload);

  RETURN jsonb_build_object('ok', true, 'event', v_event_msg);
END;
$func$;
GRANT EXECUTE ON FUNCTION public.assistant_action(uuid, text, jsonb) TO authenticated;


-- ─── 3. Wire the new detector into assistant_scan_now ─────────────────────
CREATE OR REPLACE FUNCTION public.assistant_scan_now()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid                uuid;
  v_owner_id           uuid;
  v_inv_ready          int := 0;
  v_contract_wait      int := 0;
  v_overdue            int := 0;
  v_pay_expected       int := 0;
  v_contract_expiring  int := 0;
  v_total              int := 0;
  v_open_count         int := 0;
  v_notify_url         text;
  v_notify_secret      text;
  v_notify_request_id  bigint;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    SELECT user_id INTO v_owner_id FROM public.profiles
    WHERE lower(role::text) IN ('owner','superadmin')
    ORDER BY created_at LIMIT 1;
  ELSE
    v_owner_id := v_uid;
  END IF;

  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No owner user found');
  END IF;

  v_inv_ready         := public.assistant_detect_invoice_ready_to_send(v_owner_id);
  v_contract_wait     := public.assistant_detect_contract_waiting_payment(v_owner_id);
  v_overdue           := public.assistant_detect_invoice_overdue(v_owner_id);
  v_pay_expected      := public.assistant_detect_payment_expected(v_owner_id);
  v_contract_expiring := public.assistant_detect_contract_expiring_soon(v_owner_id);
  v_total             := v_inv_ready + v_contract_wait + v_overdue + v_pay_expected + v_contract_expiring;

  SELECT count(*) INTO v_open_count
  FROM public.assistant_threads
  WHERE owner_user_id = v_owner_id
    AND status IN ('open', 'awaiting_user');

  IF v_uid IS NULL AND v_open_count > 0 THEN
    BEGIN
      SELECT notify_url, cron_secret
        INTO v_notify_url, v_notify_secret
      FROM public.oracle_config WHERE id = 1;

      IF v_notify_url IS NOT NULL AND v_notify_secret IS NOT NULL THEN
        SELECT net.http_post(
          url     := v_notify_url,
          headers := jsonb_build_object(
                       'Content-Type',          'application/json',
                       'x-oracle-cron-secret',  v_notify_secret
                     ),
          body    := jsonb_build_object(
                       'owner_user_id', v_owner_id,
                       'source',        'cron'
                     )
        ) INTO v_notify_request_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_notify_request_id := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok',                          true,
    'owner_user_id',               v_owner_id,
    'invoice_ready_threads',       v_inv_ready,
    'contract_waiting_threads',    v_contract_wait,
    'invoice_overdue_threads',     v_overdue,
    'payment_expected_threads',    v_pay_expected,
    'contract_expiring_threads',   v_contract_expiring,
    'total_threads_created',       v_total,
    'open_thread_count',           v_open_count,
    'notify_request_id',           v_notify_request_id,
    'run_at',                      now()
  );
END;
$func$;

COMMIT;
