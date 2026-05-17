-- ============================================================================
-- phase-19c8b-contract-scenarios.sql
-- ----------------------------------------------------------------------------
-- Oracle now handles the contract-activation decision via chat.
-- The old contract-lifecycle cron stays paused (Phase 19h decision).
-- Replaces it: scenario detector that creates a thread for every draft
-- contract whose start_at has hit + parent hasn't paid yet. Freeze-aware
-- (skips clients currently on a contract freeze).
--
-- NEW SCENARIO
--   contract_waiting_payment — "Michael's contract starts today.
--                                Has Daniel paid?"
--
-- NEW ACTION
--   activate_contract — promotes draft → active, resolves the thread.
--
-- WHAT THIS DOES NOT TOUCH
--   The paused 'contract-lifecycle-every-15-min' cron stays paused —
--   Oracle's chat replaces the auto-activate part. If/when we want to
--   re-enable other lifecycle transitions (active → expired, etc.) we'll
--   do that in a future phase with a payment-aware variant.
-- ============================================================================

BEGIN;

-- ─── 1. New scenario detector: contract_waiting_payment ──────────────────
CREATE OR REPLACE FUNCTION public.assistant_detect_contract_waiting_payment(
  p_owner_user_id uuid
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_ctr record;
  v_thread_id uuid;
  v_count int := 0;
BEGIN
  FOR v_ctr IN
    SELECT ctr.id AS contract_id,
           ctr.client_id,
           ctr.start_at::date AS start_date,
           ctr.end_at::date   AS end_date,
           ctr.included_minutes,
           c.full_name        AS student_name,
           COALESCE(c.billing_contact_name, c.full_name) AS guardian_name
    FROM public.contracts ctr
    LEFT JOIN public.clients c ON c.id = ctr.client_id
    WHERE ctr.status = 'draft'
      AND ctr.start_at::date <= current_date
      AND ctr.start_at::date >= current_date - interval '60 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.assistant_threads t
        WHERE t.contract_id = ctr.id
          AND t.status IN ('open','awaiting_user','snoozed')
          AND t.owner_user_id = p_owner_user_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.contract_freezes f
        WHERE f.contract_id = ctr.id
          AND f.starts_on <= current_date
          AND f.ends_on   >= current_date
          AND f.ended_early_at IS NULL
      )
  LOOP
    INSERT INTO public.assistant_threads (
      owner_user_id, scenario_key, title, subtitle,
      contract_id, client_id, status, context
    ) VALUES (
      p_owner_user_id,
      'contract_waiting_payment',
      v_ctr.student_name || '''s contract starts ' || to_char(v_ctr.start_date, 'Mon DD'),
      'Waiting on payment from ' || v_ctr.guardian_name,
      v_ctr.contract_id,
      v_ctr.client_id,
      'awaiting_user',
      jsonb_build_object(
        'contract_id',   v_ctr.contract_id,
        'start_date',    v_ctr.start_date,
        'end_date',      v_ctr.end_date,
        'student_name',  v_ctr.student_name,
        'guardian_name', v_ctr.guardian_name
      )
    )
    RETURNING id INTO v_thread_id;

    INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
    VALUES (
      v_thread_id, 'bot', 'text',
      'Oracle here. ' || v_ctr.student_name || '''s new contract is supposed to start ' ||
        to_char(v_ctr.start_date, 'FMMonth DD') ||
        '. Has ' || v_ctr.guardian_name || ' paid yet? If yes I''ll activate it; if not, I''ll check back with you in a few days.'
    );

    INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
    VALUES (
      v_thread_id, 'bot', 'actions', NULL,
      jsonb_build_object('actions', jsonb_build_array(
        jsonb_build_object('key','activate_contract', 'label','Yes — they paid, activate now','style','primary'),
        jsonb_build_object('key','snooze_3d',         'label','Not yet — remind in 3 days',  'style','ghost'),
        jsonb_build_object('key','snooze_7d',         'label','Snooze 7 days',                'style','ghost'),
        jsonb_build_object('key','dismiss',           'label','Cancel — not happening',      'style','ghost')
      ))
    );

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$func$;


-- ─── 2. Add 'activate_contract' to the action handler ────────────────────
CREATE OR REPLACE FUNCTION public.assistant_action(
  p_thread_id uuid,
  p_action    text,
  p_payload   jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_thread record;
  v_event_msg text;
  v_contract_id uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;

  SELECT * INTO v_thread FROM public.assistant_threads t
  WHERE t.id = p_thread_id AND t.owner_user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'Thread not found'; END IF;

  CASE p_action
    WHEN 'snooze_1d', 'snooze_3d', 'snooze_7d' THEN
      UPDATE public.assistant_threads AS t
      SET status = 'snoozed',
          snoozed_until = now() + (CASE p_action
            WHEN 'snooze_1d' THEN interval '1 day'
            WHEN 'snooze_3d' THEN interval '3 days'
            ELSE interval '7 days' END),
          updated_at = now()
      WHERE t.id = p_thread_id;
      v_event_msg := 'Snoozed for ' || split_part(p_action, '_', 2);

    WHEN 'resolve' THEN
      UPDATE public.assistant_threads AS t
      SET status = 'resolved', resolved_at = now(),
          resolved_by = auth.uid(), updated_at = now()
      WHERE t.id = p_thread_id;
      v_event_msg := 'Marked as handled';

    WHEN 'dismiss' THEN
      UPDATE public.assistant_threads AS t
      SET status = 'dismissed', resolved_at = now(),
          resolved_by = auth.uid(), updated_at = now()
      WHERE t.id = p_thread_id;
      v_event_msg := 'Dismissed';

    WHEN 'reopen' THEN
      UPDATE public.assistant_threads AS t
      SET status = 'awaiting_user',
          resolved_at = NULL, resolved_by = NULL,
          snoozed_until = NULL, updated_at = now()
      WHERE t.id = p_thread_id;
      v_event_msg := 'Reopened';

    WHEN 'mark_email_sent' THEN
      UPDATE public.assistant_threads AS t
      SET status = 'resolved', resolved_at = now(),
          resolved_by = auth.uid(), updated_at = now()
      WHERE t.id = p_thread_id;
      v_event_msg := COALESCE(p_payload->>'event_text', 'Email sent ✓');

    WHEN 'activate_contract' THEN
      v_contract_id := v_thread.contract_id;
      IF v_contract_id IS NULL THEN
        RAISE EXCEPTION 'Thread has no contract_id linked';
      END IF;

      UPDATE public.contracts
      SET status = 'active'
      WHERE id = v_contract_id
        AND status = 'draft';

      UPDATE public.assistant_threads AS t
      SET status = 'resolved', resolved_at = now(),
          resolved_by = auth.uid(), updated_at = now()
      WHERE t.id = p_thread_id;

      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (
        auth.uid(),
        'CONTRACT_ACTIVATED_VIA_ORACLE',
        'contracts',
        v_contract_id,
        jsonb_build_object(
          'actor',     'oracle_chat',
          'thread_id', p_thread_id
        )
      );

      v_event_msg := 'Contract activated ✓';

    ELSE
      RAISE EXCEPTION 'Unknown action: %', p_action;
  END CASE;

  INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
  VALUES (p_thread_id, 'system', 'event', v_event_msg, p_payload);

  RETURN jsonb_build_object('ok', true, 'event', v_event_msg);
END;
$func$;


-- ─── 3. Update assistant_scan_now to call the new detector ──────────────
CREATE OR REPLACE FUNCTION public.assistant_scan_now()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid           uuid;
  v_owner_id      uuid;
  v_inv_ready     int := 0;
  v_contract_wait int := 0;
  v_total         int := 0;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    SELECT user_id INTO v_owner_id FROM public.profiles
    WHERE role IN ('OWNER','SUPERADMIN','SuperAdmin','Owner')
    ORDER BY created_at LIMIT 1;
    IF v_owner_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'No owner user found for scan');
    END IF;
  ELSE
    v_owner_id := v_uid;
  END IF;

  v_inv_ready     := public.assistant_detect_invoice_ready_to_send(v_owner_id);
  v_contract_wait := public.assistant_detect_contract_waiting_payment(v_owner_id);

  v_total := v_inv_ready + v_contract_wait;

  RETURN jsonb_build_object(
    'ok',                       true,
    'owner_user_id',            v_owner_id,
    'invoice_ready_threads',    v_inv_ready,
    'contract_waiting_threads', v_contract_wait,
    'total_threads_created',    v_total,
    'run_at',                   now()
  );
END;
$func$;


-- ─── 4. Verify ──────────────────────────────────────────────────────────
SELECT 'detector_function_exists' AS what,
       (EXISTS(SELECT 1 FROM pg_proc WHERE proname='assistant_detect_contract_waiting_payment'))::text AS value
UNION ALL SELECT 'action_supports_activate_contract',
       (position('activate_contract' IN prosrc) > 0)::text
       FROM pg_proc WHERE proname = 'assistant_action'
UNION ALL SELECT 'scan_calls_contract_detector',
       (position('assistant_detect_contract_waiting_payment' IN prosrc) > 0)::text
       FROM pg_proc WHERE proname = 'assistant_scan_now'
UNION ALL SELECT 'draft_contracts_past_start_count',
       (SELECT count(*)::text FROM public.contracts
        WHERE status='draft' AND start_at::date <= current_date
          AND start_at::date >= current_date - interval '60 days');

COMMIT;
