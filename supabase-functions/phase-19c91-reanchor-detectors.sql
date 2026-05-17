-- ============================================================================
-- phase-19c91-reanchor-detectors.sql
-- ----------------------------------------------------------------------------
-- Re-anchors invoice_overdue + payment_expected detectors to contract.end_at
-- (instead of invoice.due_date). This completes the contract-aware rewire
-- started in Phase 19c.9.
--
-- Real semantics now:
--   • invoice_overdue   = contract.end_at PASSED + renewal unpaid (or missing)
--                          → SERVICE INTERRUPTED. Urgent.
--   • payment_expected  = contract.end_at ≤7d AWAY + renewal sent but unpaid
--                          → friendly nudge.
--   • contract_expiring_soon (19c.9) = contract.end_at ≤3d AWAY, no renewal yet
--                          → create the invoice.
--
-- Together these cover the full timeline:
--   [3d before end_at] → expiring_soon → "create invoice"
--   [1-7d before end_at, invoice unpaid] → payment_expected → "send nudge"
--   [past end_at, invoice unpaid or missing] → invoice_overdue → "URGENT"
-- ============================================================================

BEGIN;

-- ─── invoice_overdue (re-anchored to contract.end_at) ─────────────────────
CREATE OR REPLACE FUNCTION public.assistant_detect_invoice_overdue(
  p_owner_user_id uuid
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_row record;
  v_thread_id uuid;
  v_days_late int;
  v_count int := 0;
BEGIN
  FOR v_row IN
    SELECT ctr.id AS contract_id, ctr.end_at, ctr.client_id, ctr.status AS ctr_status,
           COALESCE(c.billing_contact_name, c.full_name) AS recipient_label,
           inv.id AS invoice_id, inv.invoice_number, inv.balance_due_cents
    FROM public.contracts ctr
    JOIN public.clients c ON c.id = ctr.client_id
    -- The renewal invoice for this contract: most recent unpaid invoice
    -- for the client dated within ±14d of end_at. NULL if none exists.
    LEFT JOIN LATERAL (
      SELECT i.id, i.invoice_number, i.balance_due_cents
      FROM public.invoices i
      WHERE i.client_id = ctr.client_id
        AND i.status = 'open'
        AND i.balance_due_cents > 0
        AND i.invoice_date >= (ctr.end_at::date - interval '14 days')
        AND i.invoice_date <= (ctr.end_at::date + interval '14 days')
      ORDER BY i.invoice_date DESC, i.created_at DESC
      LIMIT 1
    ) inv ON true
    WHERE ctr.end_at::date < current_date                            -- past end_at
      AND ctr.end_at::date > current_date - interval '60 days'        -- not ancient
      AND ctr.status IN ('active','expired')
      -- No PAID renewal invoice (if there's a paid one, we're not actually overdue)
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices ip
        WHERE ip.client_id = ctr.client_id
          AND ip.status = 'paid'
          AND ip.invoice_date >= (ctr.end_at::date - interval '14 days')
          AND ip.invoice_date <= (ctr.end_at::date + interval '14 days')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.assistant_threads t
        WHERE t.contract_id = ctr.id
          AND t.scenario_key = 'invoice_overdue'
          AND t.status IN ('open','awaiting_user','snoozed')
          AND t.owner_user_id = p_owner_user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.contract_freezes f
        WHERE f.contract_id = ctr.id
          AND f.starts_on <= current_date
          AND (f.ends_on IS NULL OR f.ends_on > current_date)
      )
  LOOP
    v_days_late := (current_date - v_row.end_at::date)::int;

    INSERT INTO public.assistant_threads (
      owner_user_id, scenario_key, title, subtitle,
      contract_id, invoice_id, client_id, status, context
    ) VALUES (
      p_owner_user_id, 'invoice_overdue',
      COALESCE(v_row.recipient_label, 'Client') || ' — renewal payment ' ||
        v_days_late || ' day' || CASE WHEN v_days_late = 1 THEN '' ELSE 's' END || ' late',
      CASE WHEN v_row.invoice_id IS NULL THEN
             'No renewal invoice — contract ended ' || to_char(v_row.end_at, 'Mon DD')
           ELSE
             v_row.invoice_number || ' · $' ||
             to_char(v_row.balance_due_cents / 100.0, 'FM999,990.00') || ' unpaid'
      END,
      v_row.contract_id, v_row.invoice_id, v_row.client_id, 'awaiting_user',
      jsonb_build_object(
        'contract_id',       v_row.contract_id,
        'end_at',            v_row.end_at,
        'days_late',         v_days_late,
        'invoice_id',        v_row.invoice_id,
        'invoice_number',    v_row.invoice_number,
        'balance_due_cents', COALESCE(v_row.balance_due_cents, 0)
      )
    ) RETURNING id INTO v_thread_id;

    INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
    VALUES (v_thread_id, 'bot', 'text',
      CASE WHEN v_row.invoice_id IS NULL THEN
            '⚠️ Urgent — ' || COALESCE(v_row.recipient_label, 'this family') ||
            '''s contract ended ' || v_days_late || ' day' ||
            CASE WHEN v_days_late = 1 THEN '' ELSE 's' END ||
            ' ago (' || to_char(v_row.end_at, 'Mon DD') ||
            ') and there''s no renewal invoice yet. Their service is interrupted. ' ||
            'Create the renewal invoice now?'
          ELSE
            '⚠️ Urgent — ' || COALESCE(v_row.recipient_label, 'this family') ||
            '''s renewal ' || v_row.invoice_number || ' for $' ||
            to_char(v_row.balance_due_cents / 100.0, 'FM999,990.00') ||
            ' is ' || v_days_late || ' day' ||
            CASE WHEN v_days_late = 1 THEN '' ELSE 's' END ||
            ' overdue. Service is interrupted until they pay. Send a stronger reminder?'
      END
    );

    -- Action buttons depend on whether we have an invoice yet
    IF v_row.invoice_id IS NOT NULL THEN
      INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
      VALUES (v_thread_id, 'bot', 'actions', NULL,
        jsonb_build_object('actions', jsonb_build_array(
          jsonb_build_object('key','preview_pdf',    'label','Preview PDF',           'style','ghost'),
          jsonb_build_object('key','send_reminder',  'label','Send past-due reminder', 'style','primary'),
          jsonb_build_object('key','mark_paid_full', 'label','They paid',              'style','ghost'),
          jsonb_build_object('key','snooze_1d',      'label','Snooze 1 day',           'style','ghost'),
          jsonb_build_object('key','dismiss',        'label','Stop tracking',          'style','ghost')
        )));
    ELSE
      INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
      VALUES (v_thread_id, 'bot', 'actions', NULL,
        jsonb_build_object('actions', jsonb_build_array(
          jsonb_build_object('key','create_renewal_invoice', 'label','Create renewal invoice', 'style','primary'),
          jsonb_build_object('key','snooze_1d',              'label','Snooze 1 day',           'style','ghost'),
          jsonb_build_object('key','dismiss',                'label','Stop tracking',          'style','ghost')
        )));
    END IF;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$func$;


-- ─── payment_expected (re-anchored to contract.end_at) ────────────────────
CREATE OR REPLACE FUNCTION public.assistant_detect_payment_expected(
  p_owner_user_id uuid
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_row record;
  v_thread_id uuid;
  v_days_until int;
  v_count int := 0;
BEGIN
  FOR v_row IN
    SELECT ctr.id AS contract_id, ctr.end_at, ctr.client_id,
           COALESCE(c.billing_contact_name, c.full_name) AS recipient_label,
           inv.id AS invoice_id, inv.invoice_number, inv.balance_due_cents,
           (SELECT min(a.created_at) FROM public.audit_logs a
            WHERE a.action = 'EMAIL_FINANCIAL_DOC_SENT' AND a.entity_id = inv.id) AS sent_at
    FROM public.contracts ctr
    JOIN public.clients c ON c.id = ctr.client_id
    JOIN LATERAL (
      -- Renewal invoice MUST exist AND be unpaid for this detector to fire
      SELECT i.id, i.invoice_number, i.balance_due_cents
      FROM public.invoices i
      WHERE i.client_id = ctr.client_id
        AND i.status = 'open'
        AND i.balance_due_cents > 0
        AND i.invoice_date >= (ctr.end_at::date - interval '14 days')
        AND i.invoice_date <= (ctr.end_at::date + interval '14 days')
      ORDER BY i.invoice_date DESC, i.created_at DESC
      LIMIT 1
    ) inv ON true
    WHERE ctr.end_at::date >= current_date                            -- not yet past
      AND ctr.end_at::date <= current_date + interval '7 days'        -- within next 7d
      AND ctr.status = 'active'
      -- Invoice must have been sent (at least 3 days ago to give them time)
      AND EXISTS (
        SELECT 1 FROM public.audit_logs a
        WHERE a.action = 'EMAIL_FINANCIAL_DOC_SENT'
          AND a.entity_id = inv.id
          AND a.created_at <= now() - interval '3 days'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.assistant_threads t
        WHERE t.contract_id = ctr.id
          AND t.scenario_key = 'payment_expected'
          AND t.status IN ('open','awaiting_user','snoozed')
          AND t.owner_user_id = p_owner_user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.contract_freezes f
        WHERE f.contract_id = ctr.id
          AND f.starts_on <= current_date
          AND (f.ends_on IS NULL OR f.ends_on > current_date)
      )
  LOOP
    v_days_until := (v_row.end_at::date - current_date)::int;

    INSERT INTO public.assistant_threads (
      owner_user_id, scenario_key, title, subtitle,
      contract_id, invoice_id, client_id, status, context
    ) VALUES (
      p_owner_user_id, 'payment_expected',
      COALESCE(v_row.recipient_label, 'Client') || ' — ' ||
        CASE WHEN v_days_until = 0 THEN 'contract ends today, renewal unpaid'
             WHEN v_days_until = 1 THEN 'contract ends tomorrow, renewal unpaid'
             ELSE 'contract ends in ' || v_days_until || ' days, renewal unpaid'
        END,
      v_row.invoice_number || ' · $' ||
      to_char(v_row.balance_due_cents / 100.0, 'FM999,990.00') || ' outstanding',
      v_row.contract_id, v_row.invoice_id, v_row.client_id, 'awaiting_user',
      jsonb_build_object(
        'contract_id',       v_row.contract_id,
        'end_at',            v_row.end_at,
        'days_until_end',    v_days_until,
        'invoice_id',        v_row.invoice_id,
        'invoice_number',    v_row.invoice_number,
        'balance_due_cents', v_row.balance_due_cents
      )
    ) RETURNING id INTO v_thread_id;

    INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
    VALUES (v_thread_id, 'bot', 'text',
      'Quick check — ' || COALESCE(v_row.recipient_label, 'this family') ||
      '''s contract ' ||
        CASE WHEN v_days_until = 0 THEN 'ends TODAY'
             WHEN v_days_until = 1 THEN 'ends TOMORROW'
             ELSE 'ends in ' || v_days_until || ' days'
        END ||
      ' (' || to_char(v_row.end_at, 'Mon DD') ||
      ') and ' || v_row.invoice_number || ' for $' ||
      to_char(v_row.balance_due_cents / 100.0, 'FM999,990.00') ||
      ' hasn''t been paid yet. Want me to send a friendly check-in?'
    );

    INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
    VALUES (v_thread_id, 'bot', 'actions', NULL,
      jsonb_build_object('actions', jsonb_build_array(
        jsonb_build_object('key','preview_pdf',    'label','Preview PDF',     'style','ghost'),
        jsonb_build_object('key','send_followup',  'label','Send check-in',    'style','primary'),
        jsonb_build_object('key','mark_paid_full', 'label','They paid',        'style','ghost'),
        jsonb_build_object('key','snooze_1d',      'label','Wait 1 day',       'style','ghost'),
        jsonb_build_object('key','dismiss',        'label','Stop tracking',    'style','ghost')
      )));

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$func$;

COMMIT;
