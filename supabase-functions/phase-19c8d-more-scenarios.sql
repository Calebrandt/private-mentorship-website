-- ============================================================================
-- phase-19c8d-more-scenarios.sql
-- ----------------------------------------------------------------------------
-- Three new Oracle behaviors:
--   A. Overdue invoice detector — past due_date, status=open → "send reminder?"
--   B. Payment-expected detector — sent ≥7 days ago, still open, not yet
--                                   overdue → "send a friendly check-in?"
--   C. "I got paid" parser — extends assistant_post_message to scan for
--                            INV-XXX-### + payment keyword, replies with a
--                            confirm card. New action: mark_paid_full
--                            (calls record_payment_received for the balance).
--
-- Conservative scope: parser REQUIRES an explicit invoice number to avoid
-- mis-matching the wrong invoice from a vague mention like "Daniel paid me."
-- ============================================================================

BEGIN;

-- ─── A. Detector: invoice_overdue ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assistant_detect_invoice_overdue(
  p_owner_user_id uuid
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_inv record;
  v_thread_id uuid;
  v_days_late int;
  v_count int := 0;
BEGIN
  FOR v_inv IN
    SELECT i.id, i.invoice_number, i.total_cents, i.balance_due_cents,
           i.client_id, i.due_date, i.invoice_date,
           COALESCE(c.billing_contact_name, c.full_name) AS recipient_label
    FROM public.invoices i
    LEFT JOIN public.clients c ON c.id = i.client_id
    WHERE i.status = 'open'
      AND i.due_date IS NOT NULL
      AND i.due_date < current_date              -- past due
      AND i.balance_due_cents > 0
      AND EXISTS (                                -- was actually sent
        SELECT 1 FROM public.audit_logs a
        WHERE a.action = 'EMAIL_FINANCIAL_DOC_SENT'
          AND a.entity_id = i.id
      )
      AND NOT EXISTS (                            -- no live overdue thread for it
        SELECT 1 FROM public.assistant_threads t
        WHERE t.invoice_id = i.id
          AND t.scenario_key = 'invoice_overdue'
          AND t.status IN ('open','awaiting_user','snoozed')
          AND t.owner_user_id = p_owner_user_id
      )
  LOOP
    v_days_late := (current_date - v_inv.due_date)::int;

    INSERT INTO public.assistant_threads (
      owner_user_id, scenario_key, title, subtitle,
      invoice_id, client_id, status, context
    ) VALUES (
      p_owner_user_id,
      'invoice_overdue',
      v_inv.invoice_number || ' is ' || v_days_late || ' day' ||
        CASE WHEN v_days_late = 1 THEN '' ELSE 's' END || ' overdue',
      '$' || to_char(v_inv.balance_due_cents / 100.0, 'FM999,990.00') ||
        ' from ' || COALESCE(v_inv.recipient_label, 'client'),
      v_inv.id, v_inv.client_id, 'awaiting_user',
      jsonb_build_object(
        'invoice_number',    v_inv.invoice_number,
        'balance_due_cents', v_inv.balance_due_cents,
        'days_late',         v_days_late,
        'email_kind',        'reminder'
      )
    )
    RETURNING id INTO v_thread_id;

    INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
    VALUES (
      v_thread_id, 'bot', 'text',
      'Heads up — ' || v_inv.invoice_number || ' for $' ||
        to_char(v_inv.balance_due_cents / 100.0, 'FM999,990.00') ||
        ' to ' || COALESCE(v_inv.recipient_label, 'the parent') ||
        ' is ' || v_days_late || ' day' ||
        CASE WHEN v_days_late = 1 THEN '' ELSE 's' END ||
        ' past due. Want me to send a payment reminder?'
    );

    INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
    VALUES (
      v_thread_id, 'bot', 'actions', NULL,
      jsonb_build_object('actions', jsonb_build_array(
        jsonb_build_object('key','preview_pdf',    'label','Preview PDF',          'style','ghost'),
        jsonb_build_object('key','send_reminder',  'label','Send reminder',         'style','primary'),
        jsonb_build_object('key','mark_paid_full', 'label','They already paid',     'style','ghost'),
        jsonb_build_object('key','snooze_3d',      'label','Remind in 3 days',      'style','ghost'),
        jsonb_build_object('key','dismiss',        'label','Stop tracking',         'style','ghost')
      ))
    );

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$func$;


-- ─── B. Detector: payment_expected (gentle 7-day follow-up) ───────────────
CREATE OR REPLACE FUNCTION public.assistant_detect_payment_expected(
  p_owner_user_id uuid
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_inv record;
  v_thread_id uuid;
  v_days_out int;
  v_count int := 0;
BEGIN
  FOR v_inv IN
    SELECT i.id, i.invoice_number, i.total_cents, i.balance_due_cents,
           i.client_id, i.due_date,
           COALESCE(c.billing_contact_name, c.full_name) AS recipient_label,
           (SELECT min(a.created_at) FROM public.audit_logs a
            WHERE a.action = 'EMAIL_FINANCIAL_DOC_SENT' AND a.entity_id = i.id) AS sent_at
    FROM public.invoices i
    LEFT JOIN public.clients c ON c.id = i.client_id
    WHERE i.status = 'open'
      AND i.balance_due_cents > 0
      AND (i.due_date IS NULL OR i.due_date >= current_date) -- NOT yet overdue
      AND EXISTS (
        SELECT 1 FROM public.audit_logs a
        WHERE a.action = 'EMAIL_FINANCIAL_DOC_SENT'
          AND a.entity_id = i.id
          AND a.created_at <= now() - interval '7 days'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.assistant_threads t
        WHERE t.invoice_id = i.id
          AND t.scenario_key = 'payment_expected'
          AND t.status IN ('open','awaiting_user','snoozed')
          AND t.owner_user_id = p_owner_user_id
      )
  LOOP
    v_days_out := EXTRACT(DAY FROM (now() - v_inv.sent_at))::int;

    INSERT INTO public.assistant_threads (
      owner_user_id, scenario_key, title, subtitle,
      invoice_id, client_id, status, context
    ) VALUES (
      p_owner_user_id,
      'payment_expected',
      v_inv.invoice_number || ' — ' || v_days_out || ' days out, still unpaid',
      '$' || to_char(v_inv.balance_due_cents / 100.0, 'FM999,990.00') ||
        ' from ' || COALESCE(v_inv.recipient_label, 'client'),
      v_inv.id, v_inv.client_id, 'awaiting_user',
      jsonb_build_object(
        'invoice_number',    v_inv.invoice_number,
        'balance_due_cents', v_inv.balance_due_cents,
        'days_out',          v_days_out,
        'email_kind',        'followup'
      )
    )
    RETURNING id INTO v_thread_id;

    INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
    VALUES (
      v_thread_id, 'bot', 'text',
      'Quick check — ' || v_inv.invoice_number || ' for $' ||
        to_char(v_inv.balance_due_cents / 100.0, 'FM999,990.00') ||
        ' went out to ' || COALESCE(v_inv.recipient_label, 'the parent') ||
        ' ' || v_days_out || ' days ago and still hasn''t been paid. ' ||
        'Want me to send a friendly check-in?'
    );

    INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
    VALUES (
      v_thread_id, 'bot', 'actions', NULL,
      jsonb_build_object('actions', jsonb_build_array(
        jsonb_build_object('key','preview_pdf',    'label','Preview PDF',          'style','ghost'),
        jsonb_build_object('key','send_followup',  'label','Send check-in',         'style','primary'),
        jsonb_build_object('key','mark_paid_full', 'label','They already paid',     'style','ghost'),
        jsonb_build_object('key','snooze_3d',      'label','Wait 3 more days',      'style','ghost'),
        jsonb_build_object('key','dismiss',        'label','Stop tracking',         'style','ghost')
      ))
    );

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$func$;


-- ─── C.1. Mark-paid action handler ────────────────────────────────────────
-- Extends assistant_action with three new keys:
--   • send_reminder       — client fires email; this just resolves the thread
--                            with a tagged event message
--   • send_followup       — same as above, different label
--   • mark_paid_full      — server-side: calls record_payment_received with
--                            the invoice's balance_due_cents, then resolves
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
  v_thread       record;
  v_event_msg    text;
  v_uid          uuid;
  v_balance      int;
  v_inv_number   text;
  v_payment_rpc  jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;

  v_uid := auth.uid();
  -- Defensive: confirm uid actually exists in auth.users (some SECURITY DEFINER
  -- contexts return a uid not in the table → FK violations downstream)
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
      -- All three: client has fired the email and is telling us. Resolve.
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
      -- Existing handler from phase-19c8b — keep as-is. Re-applying here
      -- because CREATE OR REPLACE blows away the previous body.
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
      -- Server-side: mark the invoice paid using its current balance.
      IF v_thread.invoice_id IS NULL THEN
        RAISE EXCEPTION 'Thread has no invoice_id';
      END IF;

      SELECT balance_due_cents, invoice_number
        INTO v_balance, v_inv_number
      FROM public.invoices
      WHERE id = v_thread.invoice_id;

      IF v_balance IS NULL OR v_balance <= 0 THEN
        v_event_msg := 'Invoice ' || COALESCE(v_inv_number, '?') || ' was already paid';
      ELSE
        BEGIN
          -- record_payment_received(invoice_id, amount_cents, method, ref, note)
          v_payment_rpc := public.record_payment_received(
            v_thread.invoice_id,
            v_balance,
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

    ELSE
      RAISE EXCEPTION 'Unknown action: %', p_action;
  END CASE;

  -- Audit-style event message in the chat log
  INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
  VALUES (p_thread_id, 'system', 'event', v_event_msg, p_payload);

  RETURN jsonb_build_object('ok', true, 'event', v_event_msg);
END;
$func$;
GRANT EXECUTE ON FUNCTION public.assistant_action(uuid, text, jsonb) TO authenticated;


-- ─── C.2. Payment-intent parser (called by extended post_message) ─────────
-- Returns the FIRST matching invoice for a given text + owner. Conservative:
-- requires an explicit invoice number match (INV-XXX-###). Returns NULL row
-- if no match. Used internally by assistant_post_message — not exposed as
-- a public RPC.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assistant_parse_payment_intent(
  p_text     text,
  p_owner_id uuid
)
RETURNS TABLE (
  invoice_id        uuid,
  invoice_number    text,
  balance_due_cents int,
  recipient_label   text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_text_lower text := lower(coalesce(p_text, ''));
  v_match      text;
  v_inv        record;
BEGIN
  -- Must contain a payment keyword
  IF v_text_lower !~ '(paid|received|settled|got it|collected|came in|e-?transfer|etransfer)' THEN
    RETURN;
  END IF;

  -- Must contain a clear invoice number pattern: INV-XXX-### (case-insensitive)
  v_match := (regexp_match(p_text, 'INV-[A-Za-z]{1,8}-[0-9]{1,5}', 'i'))[1];
  IF v_match IS NULL THEN
    RETURN;
  END IF;

  -- Look up the invoice for THIS owner (via clients.owner_user_id if present,
  -- otherwise via the invoice number alone — invoice numbers are owner-unique
  -- in our INV-{LAST3}-{NNN} scheme).
  SELECT i.id, i.invoice_number, i.balance_due_cents,
         COALESCE(c.billing_contact_name, c.full_name) AS recipient_label
    INTO v_inv
  FROM public.invoices i
  LEFT JOIN public.clients c ON c.id = i.client_id
  WHERE upper(i.invoice_number) = upper(v_match)
  LIMIT 1;

  IF v_inv.id IS NULL THEN RETURN; END IF;

  invoice_id        := v_inv.id;
  invoice_number    := v_inv.invoice_number;
  balance_due_cents := v_inv.balance_due_cents;
  recipient_label   := v_inv.recipient_label;
  RETURN NEXT;
END;
$func$;


-- ─── C.3. Extend assistant_post_message with intent reply ─────────────────
CREATE OR REPLACE FUNCTION public.assistant_post_message(
  p_thread_id uuid,
  p_content   text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_id uuid;
  v_owner uuid;
  v_intent record;
  v_bot_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;

  SELECT owner_user_id INTO v_owner
  FROM public.assistant_threads
  WHERE id = p_thread_id AND owner_user_id = auth.uid();
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Thread not found / not yours'; END IF;

  IF p_content IS NULL OR length(trim(p_content)) = 0 THEN
    RAISE EXCEPTION 'Empty message';
  END IF;

  INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
  VALUES (p_thread_id, 'user', 'text', trim(p_content))
  RETURNING id INTO v_id;

  UPDATE public.assistant_threads SET updated_at = now() WHERE id = p_thread_id;

  -- Payment-intent autoreply: only triggers when the user's message
  -- contains BOTH a payment keyword AND an explicit INV-XXX-### number.
  SELECT * INTO v_intent
  FROM public.assistant_parse_payment_intent(p_content, v_owner)
  LIMIT 1;

  IF v_intent.invoice_id IS NOT NULL THEN
    INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
    VALUES (
      p_thread_id, 'bot', 'text',
      CASE
        WHEN v_intent.balance_due_cents <= 0 THEN
          'Heads up — ' || v_intent.invoice_number || ' shows $0 balance already (looks paid). ' ||
          'Want me to confirm-resolve this thread anyway?'
        ELSE
          'Got it. ' || v_intent.invoice_number || ' has $' ||
          to_char(v_intent.balance_due_cents / 100.0, 'FM999,990.00') ||
          ' outstanding to ' || COALESCE(v_intent.recipient_label, 'this client') ||
          '. Mark it paid in full?'
      END
    )
    RETURNING id INTO v_bot_id;

    -- Action buttons. Payload tells mark_paid_full which invoice to act on
    -- by embedding it in the thread context if needed. The action handler
    -- resolves via v_thread.invoice_id, so this only works cleanly when the
    -- user is in an invoice-scoped thread. If they're in a non-invoice thread,
    -- we surface a single "Open INV-XXX thread" hint instead.
    IF EXISTS (SELECT 1 FROM public.assistant_threads
               WHERE id = p_thread_id AND invoice_id = v_intent.invoice_id) THEN
      INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
      VALUES (
        p_thread_id, 'bot', 'actions', NULL,
        jsonb_build_object('actions', jsonb_build_array(
          jsonb_build_object('key','mark_paid_full','label','Mark paid in full','style','primary'),
          jsonb_build_object('key','dismiss',       'label','Cancel',            'style','ghost')
        ))
      );
    ELSE
      -- Cross-thread mention. Tell the user how to act on it.
      INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
      VALUES (
        p_thread_id, 'bot', 'text',
        'Tip: open the ' || v_intent.invoice_number ||
        ' thread directly and you''ll get a one-tap "Mark paid in full" button.'
      );
    END IF;
  END IF;

  RETURN v_id;
END;
$func$;
GRANT EXECUTE ON FUNCTION public.assistant_post_message(uuid, text) TO authenticated;


-- ─── D. Wire new detectors into assistant_scan_now ────────────────────────
-- Same shape as before, just adds two more detector calls. Preserves the
-- cron-side email firing branch from phase-19c8c1.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assistant_scan_now()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid               uuid;
  v_owner_id          uuid;
  v_inv_ready         int := 0;
  v_contract_wait     int := 0;
  v_overdue           int := 0;
  v_pay_expected      int := 0;
  v_total             int := 0;
  v_open_count        int := 0;
  v_notify_url        text;
  v_notify_secret     text;
  v_notify_request_id bigint;
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

  v_inv_ready     := public.assistant_detect_invoice_ready_to_send(v_owner_id);
  v_contract_wait := public.assistant_detect_contract_waiting_payment(v_owner_id);
  v_overdue       := public.assistant_detect_invoice_overdue(v_owner_id);
  v_pay_expected  := public.assistant_detect_payment_expected(v_owner_id);
  v_total         := v_inv_ready + v_contract_wait + v_overdue + v_pay_expected;

  SELECT count(*) INTO v_open_count
  FROM public.assistant_threads
  WHERE owner_user_id = v_owner_id
    AND status IN ('open', 'awaiting_user');

  -- Cron-side email firing (unchanged from phase-19c8c1)
  IF v_uid IS NULL AND v_open_count > 0 THEN
    BEGIN
      SELECT notify_url, cron_secret
        INTO v_notify_url, v_notify_secret
      FROM public.oracle_config
      WHERE id = 1;

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
    'ok',                       true,
    'owner_user_id',            v_owner_id,
    'invoice_ready_threads',    v_inv_ready,
    'contract_waiting_threads', v_contract_wait,
    'invoice_overdue_threads',  v_overdue,
    'payment_expected_threads', v_pay_expected,
    'total_threads_created',    v_total,
    'open_thread_count',        v_open_count,
    'notify_request_id',        v_notify_request_id,
    'run_at',                   now()
  );
END;
$func$;

COMMIT;
