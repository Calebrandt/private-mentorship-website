-- ============================================================================
-- phase-19c10c-escalation-ladder.sql
-- ----------------------------------------------------------------------------
-- Late-payment escalation ladder for the invoice_overdue detector.
--
-- Before this phase:
--   The overdue detector fired ONCE when an invoice was 1+ day late, with a
--   single "⚠️ Urgent" message. No grace period (e-transfers can sit in
--   transit), no escalation as days passed (a 2-day-late invoice looked
--   identical to a 30-day-late one), and the thread never updated its tone
--   even when the situation got worse.
--
-- After this phase — 3-tier escalation:
--
--   Days 1-2 late  → SILENT (grace period — payment may be in transit)
--   Days 3-6 late  → 💬 GENTLE      "Heads up, INV-X is 3 days late.
--                                    Want to send a friendly reminder?"
--   Days 7-13 late → ⚠️ FIRM        "INV-X is now 1 week late. Time to
--                                    follow up directly."
--   Days 14+ late  → 🚨 FINAL       "INV-X is 14+ days late. Send a final
--                                    notice or write it off?"
--
-- Thread evolution:
--   ONE thread per overdue invoice. As days pass, the detector posts a NEW
--   bot message in the same thread when the tier escalates, and updates the
--   thread's title/subtitle/context to reflect current tier. The user opens
--   the thread once and sees a chronological dunning history.
--
-- Dedup logic:
--   - First detection (no thread exists): only fires if tier is NON-NULL
--     (i.e. we skip days 1-2 entirely).
--   - Subsequent runs: looks up existing thread by (contract_id, 'invoice_overdue',
--     open/awaiting_user/snoozed). Posts a new escalation message ONLY when
--     context.tier has actually changed. Same-tier days = silent (no spam).
--
-- What stays the same:
--   - Same scenario_key ('invoice_overdue') so frontend filters/icons keep working.
--   - Same action buttons (preview_pdf, send_reminder, mark_paid_full,
--     snooze_1d, dismiss) — already wired in assistant-fab.js.
--   - Same dedup against contract freezes and paid renewals.
--
-- Safe to re-run. Replaces existing function via CREATE OR REPLACE.
-- ============================================================================

BEGIN;

-- ─── Helper: tier from days_late ──────────────────────────────────────────
-- Returns 'gentle' | 'firm' | 'final' | NULL (grace period).
-- Pure function, callable from anywhere.
CREATE OR REPLACE FUNCTION public._compute_overdue_tier(p_days_late int)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_days_late >= 14 THEN 'final'
    WHEN p_days_late >= 7  THEN 'firm'
    WHEN p_days_late >= 3  THEN 'gentle'
    ELSE NULL                       -- grace period (0-2 days)
  END;
$$;


-- ─── Helper: message text per tier ────────────────────────────────────────
-- Builds the bot message body for a given tier + context. Kept as a function
-- so the same wording is used on initial fire AND on escalation re-fire.
CREATE OR REPLACE FUNCTION public._overdue_message_for_tier(
  p_tier         text,
  p_recipient    text,
  p_invoice_num  text,
  p_balance_cents bigint,
  p_days_late    int,
  p_has_invoice  boolean
)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_recipient text := COALESCE(p_recipient, 'this family');
  v_amount    text := to_char(COALESCE(p_balance_cents, 0) / 100.0, 'FM999,990.00');
  v_days_word text := p_days_late || ' day' || CASE WHEN p_days_late = 1 THEN '' ELSE 's' END;
BEGIN
  -- Missing invoice case: same urgency regardless of tier (we have nothing to send)
  IF NOT p_has_invoice THEN
    RETURN '⚠️ Urgent — ' || v_recipient ||
           '''s contract ended ' || v_days_word ||
           ' ago and there''s no renewal invoice yet. Service is interrupted. ' ||
           'Create the renewal invoice now?';
  END IF;

  RETURN CASE p_tier
    WHEN 'gentle' THEN
      '💬 Heads up — ' || v_recipient || '''s renewal ' || p_invoice_num ||
      ' for $' || v_amount || ' is ' || v_days_word ||
      ' late. Want to send a friendly reminder?'

    WHEN 'firm' THEN
      '⚠️ ' || v_recipient || '''s renewal ' || p_invoice_num ||
      ' for $' || v_amount || ' is now ' || v_days_word ||
      ' late — that''s over a week. Time to follow up directly. ' ||
      'Service should be considered interrupted until they pay.'

    WHEN 'final' THEN
      '🚨 Final notice territory — ' || v_recipient || '''s renewal ' ||
      p_invoice_num || ' for $' || v_amount || ' is ' || v_days_word ||
      ' late. Send a firm final notice, write it off as bad debt, or ' ||
      'snooze if you''ve agreed on a deferred payment.'

    ELSE
      -- Shouldn't happen (we never write for grace tier), but stay safe
      v_recipient || '''s renewal ' || p_invoice_num || ' is overdue.'
  END;
END;
$$;


-- ─── Helper: title prefix per tier ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._overdue_title_for_tier(p_tier text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_tier
    WHEN 'gentle' THEN ''                     -- no prefix; tone is light
    WHEN 'firm'   THEN '[Past due] '
    WHEN 'final'  THEN '[FINAL NOTICE] '
    ELSE ''
  END;
$$;


-- ─── Main detector: tier-aware invoice_overdue ────────────────────────────
CREATE OR REPLACE FUNCTION public.assistant_detect_invoice_overdue(
  p_owner_user_id uuid
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_row           record;
  v_thread        record;
  v_thread_id     uuid;
  v_days_late     int;
  v_new_tier      text;
  v_existing_tier text;
  v_count         int := 0;
  v_title_prefix  text;
  v_recipient     text;
  v_amount        text;
  v_msg_body      text;
BEGIN
  FOR v_row IN
    SELECT ctr.id AS contract_id, ctr.end_at, ctr.client_id, ctr.status AS ctr_status,
           COALESCE(c.billing_contact_name, c.full_name) AS recipient_label,
           inv.id AS invoice_id, inv.invoice_number, inv.balance_due_cents
    FROM public.contracts ctr
    JOIN public.clients c ON c.id = ctr.client_id
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
      -- Skip if a paid renewal exists
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices ip
        WHERE ip.client_id = ctr.client_id
          AND ip.status = 'paid'
          AND ip.invoice_date >= (ctr.end_at::date - interval '14 days')
          AND ip.invoice_date <= (ctr.end_at::date + interval '14 days')
      )
      -- Skip if a freeze is currently active for this contract
      AND NOT EXISTS (
        SELECT 1 FROM public.contract_freezes f
        WHERE f.contract_id = ctr.id
          AND f.starts_on <= current_date
          AND (f.ends_on IS NULL OR f.ends_on > current_date)
      )
  LOOP
    v_days_late := (current_date - v_row.end_at::date)::int;
    v_new_tier  := public._compute_overdue_tier(v_days_late);

    -- Grace period (days 1-2): skip silently
    IF v_new_tier IS NULL THEN
      CONTINUE;
    END IF;

    v_recipient   := COALESCE(v_row.recipient_label, 'Client');
    v_amount      := to_char(COALESCE(v_row.balance_due_cents, 0) / 100.0, 'FM999,990.00');
    v_title_prefix := public._overdue_title_for_tier(v_new_tier);

    -- Look up existing thread (if any)
    SELECT id, COALESCE(context->>'tier','') AS tier
      INTO v_thread
      FROM public.assistant_threads
     WHERE contract_id = v_row.contract_id
       AND scenario_key = 'invoice_overdue'
       AND status IN ('open','awaiting_user','snoozed')
       AND owner_user_id = p_owner_user_id
     LIMIT 1;

    v_existing_tier := COALESCE(v_thread.tier, NULL);

    IF v_thread.id IS NULL THEN
      -- ─── First fire: create thread + opening message + actions ────
      v_msg_body := public._overdue_message_for_tier(
        v_new_tier, v_recipient, v_row.invoice_number,
        v_row.balance_due_cents, v_days_late, v_row.invoice_id IS NOT NULL);

      INSERT INTO public.assistant_threads (
        owner_user_id, scenario_key, title, subtitle,
        contract_id, invoice_id, client_id, status, context
      ) VALUES (
        p_owner_user_id, 'invoice_overdue',
        v_title_prefix || v_recipient || ' — renewal payment ' ||
          v_days_late || ' day' || CASE WHEN v_days_late = 1 THEN '' ELSE 's' END || ' late',
        CASE WHEN v_row.invoice_id IS NULL THEN
               'No renewal invoice — contract ended ' || to_char(v_row.end_at, 'Mon DD')
             ELSE
               v_row.invoice_number || ' · $' || v_amount || ' unpaid'
        END,
        v_row.contract_id, v_row.invoice_id, v_row.client_id, 'awaiting_user',
        jsonb_build_object(
          'contract_id',       v_row.contract_id,
          'end_at',            v_row.end_at,
          'days_late',         v_days_late,
          'invoice_id',        v_row.invoice_id,
          'invoice_number',    v_row.invoice_number,
          'balance_due_cents', COALESCE(v_row.balance_due_cents, 0),
          'tier',              v_new_tier,
          'tier_first_at',     to_jsonb(now()),
          'tier_history',      jsonb_build_array(
            jsonb_build_object('tier', v_new_tier, 'at', to_jsonb(now()), 'days_late', v_days_late)
          )
        )
      ) RETURNING id INTO v_thread_id;

      INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
      VALUES (v_thread_id, 'bot', 'text', v_msg_body);

      -- Action buttons depend on whether we have an invoice yet, AND on tier.
      -- Final tier (day 14+) gets two extra actions: defer_7d and write_off.
      -- write_off needs a follow-up phase to wire up the backend; defer_7d
      -- can reuse the existing snooze handler with a 7-day duration.
      IF v_row.invoice_id IS NOT NULL THEN
        INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
        VALUES (v_thread_id, 'bot', 'actions', NULL,
          jsonb_build_object('actions',
            CASE WHEN v_new_tier = 'final' THEN
              jsonb_build_array(
                jsonb_build_object('key','preview_pdf',    'label','Preview PDF',         'style','ghost'),
                jsonb_build_object('key','send_reminder',  'label','Send final notice',   'style','primary'),
                jsonb_build_object('key','mark_paid_full', 'label','They paid',           'style','ghost'),
                jsonb_build_object('key','defer_7d',       'label','Defer 7 days',        'style','ghost'),
                jsonb_build_object('key','write_off',      'label','Write off',           'style','ghost'),
                jsonb_build_object('key','dismiss',        'label','Stop tracking',       'style','ghost'))
            ELSE
              jsonb_build_array(
                jsonb_build_object('key','preview_pdf',    'label','Preview PDF',         'style','ghost'),
                jsonb_build_object('key','send_reminder',  'label',
                  CASE v_new_tier WHEN 'firm' THEN 'Send firm reminder' ELSE 'Send reminder' END,
                  'style','primary'),
                jsonb_build_object('key','mark_paid_full', 'label','They paid',           'style','ghost'),
                jsonb_build_object('key','snooze_1d',      'label','Snooze 1 day',        'style','ghost'),
                jsonb_build_object('key','dismiss',        'label','Stop tracking',       'style','ghost'))
            END));
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

    ELSIF v_new_tier != v_existing_tier THEN
      -- ─── Escalation: post new message in same thread, bump context ────
      v_msg_body := public._overdue_message_for_tier(
        v_new_tier, v_recipient, v_row.invoice_number,
        v_row.balance_due_cents, v_days_late, v_row.invoice_id IS NOT NULL);

      -- Post the escalation message
      INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
      VALUES (v_thread.id, 'bot', 'text', v_msg_body);

      -- Refresh the action chips at the new tier (so user always sees latest options)
      IF v_row.invoice_id IS NOT NULL THEN
        INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
        VALUES (v_thread.id, 'bot', 'actions', NULL,
          jsonb_build_object('actions',
            CASE WHEN v_new_tier = 'final' THEN
              jsonb_build_array(
                jsonb_build_object('key','preview_pdf',    'label','Preview PDF',         'style','ghost'),
                jsonb_build_object('key','send_reminder',  'label','Send final notice',   'style','primary'),
                jsonb_build_object('key','mark_paid_full', 'label','They paid',           'style','ghost'),
                jsonb_build_object('key','defer_7d',       'label','Defer 7 days',        'style','ghost'),
                jsonb_build_object('key','write_off',      'label','Write off',           'style','ghost'),
                jsonb_build_object('key','dismiss',        'label','Stop tracking',       'style','ghost'))
            ELSE
              jsonb_build_array(
                jsonb_build_object('key','preview_pdf',    'label','Preview PDF',         'style','ghost'),
                jsonb_build_object('key','send_reminder',  'label',
                  CASE v_new_tier WHEN 'firm' THEN 'Send firm reminder' ELSE 'Send reminder' END,
                  'style','primary'),
                jsonb_build_object('key','mark_paid_full', 'label','They paid',           'style','ghost'),
                jsonb_build_object('key','snooze_1d',      'label','Snooze 1 day',        'style','ghost'),
                jsonb_build_object('key','dismiss',        'label','Stop tracking',       'style','ghost'))
            END));
      END IF;

      -- Update thread title, subtitle, context to reflect new tier
      UPDATE public.assistant_threads
         SET title = v_title_prefix || v_recipient || ' — renewal payment ' ||
                     v_days_late || ' day' || CASE WHEN v_days_late = 1 THEN '' ELSE 's' END || ' late',
             subtitle = CASE WHEN v_row.invoice_id IS NULL THEN
                              'No renewal invoice — contract ended ' || to_char(v_row.end_at, 'Mon DD')
                            ELSE
                              v_row.invoice_number || ' · $' || v_amount || ' unpaid'
                       END,
             status = 'awaiting_user',   -- re-surface even if snoozed
             updated_at = now(),
             context = context
                       || jsonb_build_object('tier', v_new_tier)
                       || jsonb_build_object('days_late', v_days_late)
                       || jsonb_build_object('tier_history',
                            COALESCE(context->'tier_history','[]'::jsonb) ||
                            jsonb_build_array(
                              jsonb_build_object('tier', v_new_tier,
                                                 'at',   to_jsonb(now()),
                                                 'days_late', v_days_late)
                            ))
       WHERE id = v_thread.id;

      v_count := v_count + 1;
    END IF;
    -- Same tier as before? Stay silent (no spam).

  END LOOP;
  RETURN v_count;
END;
$func$;

COMMIT;

-- ─── Verify ──────────────────────────────────────────────────────────────
-- These should both return the new function definition:
-- SELECT pg_get_functiondef('public.assistant_detect_invoice_overdue(uuid)'::regprocedure);
-- SELECT pg_get_functiondef('public._compute_overdue_tier(int)'::regprocedure);

-- Quick smoke check (returns count of new/escalated threads — should be 0 on a
-- happy system, or N if there are currently overdue invoices):
SELECT public.assistant_detect_invoice_overdue(
  (SELECT id FROM auth.users WHERE email ILIKE 'caleb%' LIMIT 1)
) AS new_or_escalated_threads;
