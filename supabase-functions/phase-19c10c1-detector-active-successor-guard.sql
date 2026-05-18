-- ============================================================================
-- phase-19c10c1-detector-active-successor-guard.sql
-- ----------------------------------------------------------------------------
-- Adds the "active successor" guard to the invoice_overdue detector. Without
-- this, the detector incorrectly fires on expired contracts that were
-- already succeeded by a paid renewal.
--
-- The false positive that surfaced this:
--   Day 1 of shipping 19c.10c, the detector flagged Ryan Roe / Eileen Zhou
--   at FINAL NOTICE tier. Investigation showed:
--     • Ryan's contracts table: March 1→May 1 EXPIRED, April 3→June 3 ACTIVE
--     • The April 3 active contract had already succeeded the March 1 one
--       (Eileen paid late, Model B kicked in, new cycle started on payment date)
--     • The detector was looking at the OLD expired contract and didn't
--       realize a newer active one existed
--
-- The fix:
--   One extra WHERE clause: skip any expired contract if the family already
--   has a currently-running active contract (status='active' AND end_at in
--   the future). If they do, they're not overdue — they renewed and moved on.
--
-- Why the previous attempt (skip zero-invoice families) was wrong:
--   That patch tried to avoid flagging families who hadn't been invoiced
--   through the system yet. But Caleb's reality: every family's historical
--   CONTRACTS are imported into the system (which is why Ryan even appears
--   in contracts); only the historical INVOICES weren't backfilled. So
--   "no invoice = not tracked" was the wrong heuristic. The right one is
--   "no successor active contract = genuinely overdue."
--
-- Effect for Caleb's current state:
--   Every family in the contracts table has a currently-running active
--   contract (because all contracts were imported through May 2026 cycles).
--   So the detector will fire ZERO false positives. As contracts naturally
--   expire AND families fail to renew, only THOSE genuine cases will fire.
--
-- Safe to re-run. CREATE OR REPLACE replaces existing function definition.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assistant_detect_invoice_overdue(p_owner_user_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $func$
DECLARE
  v_row record; v_thread record; v_thread_id uuid;
  v_days_late int; v_new_tier text; v_existing_tier text;
  v_count int := 0; v_title_prefix text;
  v_recipient text; v_amount text; v_msg_body text;
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
      WHERE i.client_id = ctr.client_id AND i.status = 'open'
        AND i.balance_due_cents > 0
        AND i.invoice_date >= (ctr.end_at::date - interval '14 days')
        AND i.invoice_date <= (ctr.end_at::date + interval '14 days')
      ORDER BY i.invoice_date DESC, i.created_at DESC LIMIT 1
    ) inv ON true
    WHERE ctr.end_at::date < current_date
      AND ctr.end_at::date > current_date - interval '60 days'
      AND ctr.status IN ('active','expired')
      -- NEW (19c.10c1): skip if family already has a currently-running active
      -- contract. If they do, the prior expired one was succeeded by a paid
      -- renewal — no money owing. Catches the Ryan Roe case where the
      -- old March-May contract was succeeded by an April-June active one.
      AND NOT EXISTS (
        SELECT 1 FROM public.contracts succ
        WHERE succ.client_id = ctr.client_id
          AND succ.status = 'active'
          AND succ.id != ctr.id
          AND succ.end_at::date >= current_date
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices ip
        WHERE ip.client_id = ctr.client_id AND ip.status = 'paid'
          AND ip.invoice_date >= (ctr.end_at::date - interval '14 days')
          AND ip.invoice_date <= (ctr.end_at::date + interval '14 days'))
      AND NOT EXISTS (
        SELECT 1 FROM public.contract_freezes f
        WHERE f.contract_id = ctr.id AND f.starts_on <= current_date
          AND (f.ends_on IS NULL OR f.ends_on > current_date))
  LOOP
    v_days_late := (current_date - v_row.end_at::date)::int;
    v_new_tier  := public._compute_overdue_tier(v_days_late);
    IF v_new_tier IS NULL THEN CONTINUE; END IF;

    v_recipient    := COALESCE(v_row.recipient_label, 'Client');
    v_amount       := to_char(COALESCE(v_row.balance_due_cents, 0) / 100.0, 'FM999,990.00');
    v_title_prefix := public._overdue_title_for_tier(v_new_tier);

    SELECT id, COALESCE(context->>'tier','') AS tier INTO v_thread
      FROM public.assistant_threads
     WHERE contract_id = v_row.contract_id AND scenario_key = 'invoice_overdue'
       AND status IN ('open','awaiting_user','snoozed')
       AND owner_user_id = p_owner_user_id LIMIT 1;
    v_existing_tier := COALESCE(v_thread.tier, NULL);

    IF v_thread.id IS NULL THEN
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
             ELSE v_row.invoice_number || ' · $' || v_amount || ' unpaid' END,
        v_row.contract_id, v_row.invoice_id, v_row.client_id, 'awaiting_user',
        jsonb_build_object(
          'contract_id', v_row.contract_id, 'end_at', v_row.end_at,
          'days_late', v_days_late, 'invoice_id', v_row.invoice_id,
          'invoice_number', v_row.invoice_number,
          'balance_due_cents', COALESCE(v_row.balance_due_cents, 0),
          'tier', v_new_tier, 'tier_first_at', to_jsonb(now()),
          'tier_history', jsonb_build_array(
            jsonb_build_object('tier', v_new_tier, 'at', to_jsonb(now()), 'days_late', v_days_late))
        )) RETURNING id INTO v_thread_id;

      INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
      VALUES (v_thread_id, 'bot', 'text', v_msg_body);

      IF v_row.invoice_id IS NOT NULL THEN
        INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
        VALUES (v_thread_id, 'bot', 'actions', NULL,
          jsonb_build_object('actions',
            CASE WHEN v_new_tier = 'final' THEN
              jsonb_build_array(
                jsonb_build_object('key','preview_pdf','label','Preview PDF','style','ghost'),
                jsonb_build_object('key','send_reminder','label','Send final notice','style','primary'),
                jsonb_build_object('key','mark_paid_full','label','They paid','style','ghost'),
                jsonb_build_object('key','defer_7d','label','Defer 7 days','style','ghost'),
                jsonb_build_object('key','write_off','label','Write off','style','ghost'),
                jsonb_build_object('key','dismiss','label','Stop tracking','style','ghost'))
            ELSE
              jsonb_build_array(
                jsonb_build_object('key','preview_pdf','label','Preview PDF','style','ghost'),
                jsonb_build_object('key','send_reminder','label',
                  CASE v_new_tier WHEN 'firm' THEN 'Send firm reminder' ELSE 'Send reminder' END,
                  'style','primary'),
                jsonb_build_object('key','mark_paid_full','label','They paid','style','ghost'),
                jsonb_build_object('key','snooze_1d','label','Snooze 1 day','style','ghost'),
                jsonb_build_object('key','dismiss','label','Stop tracking','style','ghost'))
            END));
      ELSE
        INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
        VALUES (v_thread_id, 'bot', 'actions', NULL,
          jsonb_build_object('actions', jsonb_build_array(
            jsonb_build_object('key','create_renewal_invoice','label','Create renewal invoice','style','primary'),
            jsonb_build_object('key','snooze_1d','label','Snooze 1 day','style','ghost'),
            jsonb_build_object('key','dismiss','label','Stop tracking','style','ghost'))));
      END IF;
      v_count := v_count + 1;

    ELSIF v_new_tier != v_existing_tier THEN
      v_msg_body := public._overdue_message_for_tier(
        v_new_tier, v_recipient, v_row.invoice_number,
        v_row.balance_due_cents, v_days_late, v_row.invoice_id IS NOT NULL);

      INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
      VALUES (v_thread.id, 'bot', 'text', v_msg_body);

      IF v_row.invoice_id IS NOT NULL THEN
        INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
        VALUES (v_thread.id, 'bot', 'actions', NULL,
          jsonb_build_object('actions',
            CASE WHEN v_new_tier = 'final' THEN
              jsonb_build_array(
                jsonb_build_object('key','preview_pdf','label','Preview PDF','style','ghost'),
                jsonb_build_object('key','send_reminder','label','Send final notice','style','primary'),
                jsonb_build_object('key','mark_paid_full','label','They paid','style','ghost'),
                jsonb_build_object('key','defer_7d','label','Defer 7 days','style','ghost'),
                jsonb_build_object('key','write_off','label','Write off','style','ghost'),
                jsonb_build_object('key','dismiss','label','Stop tracking','style','ghost'))
            ELSE
              jsonb_build_array(
                jsonb_build_object('key','preview_pdf','label','Preview PDF','style','ghost'),
                jsonb_build_object('key','send_reminder','label',
                  CASE v_new_tier WHEN 'firm' THEN 'Send firm reminder' ELSE 'Send reminder' END,
                  'style','primary'),
                jsonb_build_object('key','mark_paid_full','label','They paid','style','ghost'),
                jsonb_build_object('key','snooze_1d','label','Snooze 1 day','style','ghost'),
                jsonb_build_object('key','dismiss','label','Stop tracking','style','ghost'))
            END));
      END IF;

      UPDATE public.assistant_threads
         SET title = v_title_prefix || v_recipient || ' — renewal payment ' ||
                     v_days_late || ' day' || CASE WHEN v_days_late = 1 THEN '' ELSE 's' END || ' late',
             subtitle = CASE WHEN v_row.invoice_id IS NULL THEN
                              'No renewal invoice — contract ended ' || to_char(v_row.end_at, 'Mon DD')
                            ELSE v_row.invoice_number || ' · $' || v_amount || ' unpaid' END,
             status = 'awaiting_user',
             updated_at = now(),
             context = context
                       || jsonb_build_object('tier', v_new_tier)
                       || jsonb_build_object('days_late', v_days_late)
                       || jsonb_build_object('tier_history',
                            COALESCE(context->'tier_history','[]'::jsonb) ||
                            jsonb_build_array(jsonb_build_object('tier', v_new_tier,
                              'at', to_jsonb(now()), 'days_late', v_days_late)))
       WHERE id = v_thread.id;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$func$;

COMMIT;

-- One-time cleanup: dismiss any existing invoice_overdue threads where the
-- family has a currently-running active contract (these were false positives
-- created before the active-successor guard shipped).
UPDATE public.assistant_threads t
   SET status = 'dismissed', resolved_at = now()
 WHERE scenario_key = 'invoice_overdue'
   AND status IN ('open','awaiting_user','snoozed')
   AND EXISTS (
     SELECT 1 FROM public.contracts succ
     WHERE succ.client_id = t.client_id
       AND succ.status = 'active'
       AND succ.end_at::date >= current_date
   );
