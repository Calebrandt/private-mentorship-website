-- ============================================================================
-- phase-19c8b-fix-auth-uid-audit.sql
-- ----------------------------------------------------------------------------
-- Same FK bug pattern as the earlier 19c.7a hotfix: auth.uid() inside this
-- SECURITY DEFINER RPC can return a value that's not in auth.users in
-- some contexts, which trips audit_logs_user_id_fkey on direct INSERTs.
--
-- This rewrite of assistant_action declares v_uid at the top, defensively
-- maps it to NULL if it doesn't reference a real row, then uses v_uid
-- everywhere (resolved_by + audit_logs.user_id). NULL satisfies both FKs.
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
  v_thread      record;
  v_event_msg   text;
  v_contract_id uuid;
  v_uid         uuid;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;

  v_uid := auth.uid();
  IF v_uid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid) THEN
    v_uid := NULL;
  END IF;

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
          resolved_by = v_uid, updated_at = now()
      WHERE t.id = p_thread_id;
      v_event_msg := 'Marked as handled';

    WHEN 'dismiss' THEN
      UPDATE public.assistant_threads AS t
      SET status = 'dismissed', resolved_at = now(),
          resolved_by = v_uid, updated_at = now()
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
          resolved_by = v_uid, updated_at = now()
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
          resolved_by = v_uid, updated_at = now()
      WHERE t.id = p_thread_id;

      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (
        v_uid,
        'CONTRACT_ACTIVATED_VIA_ORACLE',
        'contracts',
        v_contract_id,
        jsonb_build_object('actor','oracle_chat','thread_id', p_thread_id)
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

COMMIT;
