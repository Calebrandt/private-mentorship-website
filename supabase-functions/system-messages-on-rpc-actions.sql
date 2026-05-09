-- ============================================================================
-- System Messages on RPC actions (Messaging Integration — Phase 6 prep)
-- ----------------------------------------------------------------------------
-- Adds an internal helper `_post_system_message_for_client` and re-creates
-- the existing approval/rejection/end-of-service RPCs so that EVERY successful
-- action also posts a system message into the client's CLIENT_SHARED
-- conversation. This wires the website's contract/appointment work into the
-- existing app messaging system — no app changes required.
--
-- Behaviour:
--   - If no CLIENT_SHARED conversation exists for the client, the helper
--     silently no-ops (returns NULL). The parent RPC still succeeds.
--   - The actor (profile_id on the message) is resolved as:
--       1) explicit caller (admin who approved)
--       2) conversation.created_by
--       3) any ADMIN/OWNER/ASSISTANT participant
--     If none of those resolve, the message is skipped (still no-op).
--
-- Deploy: paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Re-running is safe (CREATE OR REPLACE everywhere).
-- ============================================================================

-- ─── HELPER ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._post_system_message_for_client(
  p_client_id uuid,
  p_subject text,
  p_body text,
  p_event_type text,
  p_actor_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_convo_id uuid;
  v_actor uuid;
  v_msg_id uuid;
BEGIN
  IF p_client_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_convo_id FROM public.conversations
   WHERE type = 'CLIENT_SHARED' AND client_id = p_client_id
   LIMIT 1;
  IF v_convo_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_actor := p_actor_user_id;
  IF v_actor IS NULL THEN
    SELECT created_by INTO v_actor FROM public.conversations WHERE id = v_convo_id;
  END IF;
  IF v_actor IS NULL THEN
    SELECT profile_id INTO v_actor FROM public.conversation_participants
     WHERE conversation_id = v_convo_id
       AND UPPER(role) IN ('ADMIN','OWNER','ASSISTANT')
     LIMIT 1;
  END IF;
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.conversation_messages
    (conversation_id, profile_id, body, subject, message_type, event_type)
  VALUES
    (v_convo_id, v_actor, p_body, p_subject, 'system', p_event_type)
  RETURNING id INTO v_msg_id;

  RETURN v_msg_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public._post_system_message_for_client(uuid, text, text, text, uuid) TO authenticated;

-- ============================================================================
-- SCHEDULE REQUESTS (cancel / reschedule / extra)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_approve_schedule_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_req public.schedule_change_requests%ROWTYPE;
  v_apt public.appointments%ROWTYPE;
  v_late boolean := false;
  v_new_status text := NULL;
  v_proposed_starts timestamptz;
  v_proposed_duration int;
  v_new_apt_id uuid := NULL;
  v_contract_id uuid := NULL;
  v_charge_hours numeric := 0;
  v_msg_subject text;
  v_msg_body text;
  v_msg_event text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT role::text INTO v_caller_role FROM public.profiles WHERE user_id = v_caller_id;
  IF UPPER(COALESCE(v_caller_role, '')) NOT IN ('OWNER','ADMIN','SUPERADMIN') THEN
    RAISE EXCEPTION 'Forbidden — admin/owner role required (caller role: %)', v_caller_role;
  END IF;

  SELECT * INTO v_req FROM public.schedule_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found: %', p_request_id;
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is already % — cannot re-approve', v_req.status;
  END IF;

  IF v_req.request_type = 'cancel' THEN
    IF v_req.appointment_id IS NULL THEN
      RAISE EXCEPTION 'Cancel request has no linked appointment';
    END IF;
    SELECT * INTO v_apt FROM public.appointments WHERE id = v_req.appointment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked appointment not found: %', v_req.appointment_id;
    END IF;

    v_late := (v_apt.starts_at - NOW()) < INTERVAL '24 hours';
    v_new_status := CASE WHEN v_late THEN 'late_cancelled' ELSE 'cancelled' END;

    UPDATE public.appointments
       SET status = v_new_status,
           cancelled_at = NOW(),
           cancel_reason = COALESCE(v_req.reason, cancel_reason)
     WHERE id = v_apt.id;

    IF v_late THEN
      v_charge_hours := -1 * COALESCE(v_apt.duration_minutes, 60) / 60.0;
      INSERT INTO public.hours_ledger (client_id, delta_hours, reason, appointment_id)
      VALUES (v_apt.client_id, v_charge_hours, 'late_cancel', v_apt.id);
    ELSE
      INSERT INTO public.hours_ledger (client_id, delta_hours, reason, appointment_id)
      VALUES (v_apt.client_id, 0, 'change_token:cancel', v_apt.id);
    END IF;

    v_msg_subject := CASE WHEN v_late THEN 'Session Cancelled (Late)' ELSE 'Session Cancelled' END;
    v_msg_body := 'The session originally scheduled for '
                  || to_char(v_apt.starts_at AT TIME ZONE 'America/Vancouver', 'FMDay, FMMonth FMDD at FMHH12:MIam')
                  || ' has been cancelled.'
                  || CASE WHEN v_late THEN ' This was within 24 hours of the start time, so the session hours have been charged.' ELSE '' END
                  || CASE WHEN v_req.reason IS NOT NULL AND LENGTH(TRIM(v_req.reason)) > 0
                          THEN E'\n\nReason: ' || v_req.reason ELSE '' END;
    v_msg_event := 'appointment_cancelled';
    PERFORM public._post_system_message_for_client(
      v_apt.client_id, v_msg_subject, v_msg_body, v_msg_event, v_caller_id);

  ELSIF v_req.request_type = 'reschedule' THEN
    IF v_req.appointment_id IS NULL THEN
      RAISE EXCEPTION 'Reschedule request has no linked appointment';
    END IF;
    SELECT * INTO v_apt FROM public.appointments WHERE id = v_req.appointment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked appointment not found: %', v_req.appointment_id;
    END IF;

    BEGIN
      v_proposed_starts := COALESCE(
        (v_req.proposed_schedule->>'starts_at')::timestamptz,
        (v_req.requested_date::text || ' ' || v_req.requested_start::text)::timestamptz
      );
    EXCEPTION WHEN others THEN
      v_proposed_starts := NULL;
    END;
    IF v_proposed_starts IS NULL THEN
      RAISE EXCEPTION 'Reschedule request has no usable proposed time';
    END IF;

    v_proposed_duration := COALESCE(
      NULLIF((v_req.proposed_schedule->>'duration_min')::int, 0),
      CASE
        WHEN v_req.requested_start IS NOT NULL AND v_req.requested_end IS NOT NULL
        THEN (EXTRACT(EPOCH FROM (v_req.requested_end - v_req.requested_start)) / 60)::int
        ELSE NULL
      END,
      v_apt.duration_minutes,
      60
    );

    UPDATE public.appointments
       SET starts_at = v_proposed_starts,
           ends_at = v_proposed_starts + (v_proposed_duration || ' minutes')::interval,
           duration_minutes = v_proposed_duration,
           status = 'scheduled',
           rescheduled_from_id = COALESCE(rescheduled_from_id, v_apt.id),
           reschedule_request_created_at = COALESCE(reschedule_request_created_at, v_req.created_at)
     WHERE id = v_apt.id;

    INSERT INTO public.hours_ledger (client_id, delta_hours, reason, appointment_id)
    VALUES (v_apt.client_id, 0, 'change_token:reschedule', v_apt.id);

    v_msg_subject := 'Session Rescheduled';
    v_msg_body := 'A session has been moved to '
                  || to_char(v_proposed_starts AT TIME ZONE 'America/Vancouver', 'FMDay, FMMonth FMDD at FMHH12:MIam')
                  || ' (' || v_proposed_duration || ' minutes).';
    v_msg_event := 'appointment_rescheduled';
    PERFORM public._post_system_message_for_client(
      v_apt.client_id, v_msg_subject, v_msg_body, v_msg_event, v_caller_id);

  ELSIF v_req.request_type = 'extra' THEN
    BEGIN
      v_proposed_starts := COALESCE(
        (v_req.proposed_schedule->>'starts_at')::timestamptz,
        (v_req.requested_date::text || ' ' || v_req.requested_start::text)::timestamptz
      );
    EXCEPTION WHEN others THEN
      v_proposed_starts := NULL;
    END;
    IF v_proposed_starts IS NULL THEN
      RAISE EXCEPTION 'Extra request has no usable proposed time';
    END IF;

    v_proposed_duration := COALESCE(
      NULLIF((v_req.proposed_schedule->>'duration_min')::int, 0),
      CASE
        WHEN v_req.requested_start IS NOT NULL AND v_req.requested_end IS NOT NULL
        THEN (EXTRACT(EPOCH FROM (v_req.requested_end - v_req.requested_start)) / 60)::int
        ELSE NULL
      END,
      60
    );

    SELECT id INTO v_contract_id FROM public.contracts
     WHERE client_id = v_req.client_id
       AND status = 'active'
       AND start_at <= v_proposed_starts
       AND end_at   >= v_proposed_starts
     ORDER BY start_at DESC
     LIMIT 1;

    INSERT INTO public.appointments (
      client_id, contract_id, assistant_id,
      starts_at, ends_at, duration_minutes,
      status, kind, title, created_by
    )
    VALUES (
      v_req.client_id, v_contract_id, v_req.assistant_id,
      v_proposed_starts,
      v_proposed_starts + (v_proposed_duration || ' minutes')::interval,
      v_proposed_duration,
      'scheduled', 'Session',
      COALESCE(LEFT(v_req.reason, 80), 'Additional session'),
      v_caller_id
    )
    RETURNING id INTO v_new_apt_id;

    v_msg_subject := 'Additional Session Approved';
    v_msg_body := 'A new session has been added on '
                  || to_char(v_proposed_starts AT TIME ZONE 'America/Vancouver', 'FMDay, FMMonth FMDD at FMHH12:MIam')
                  || ' (' || v_proposed_duration || ' minutes).';
    v_msg_event := 'extra_session_added';
    PERFORM public._post_system_message_for_client(
      v_req.client_id, v_msg_subject, v_msg_body, v_msg_event, v_caller_id);

  ELSE
    RAISE EXCEPTION 'Unknown request_type: %', v_req.request_type;
  END IF;

  UPDATE public.schedule_change_requests
     SET status = 'approved',
         admin_response = CASE
           WHEN admin_response IS NULL OR LENGTH(TRIM(admin_response)) = 0
           THEN CASE v_req.request_type
                  WHEN 'cancel'     THEN CASE WHEN v_late THEN 'Cancellation approved (late)' ELSE 'Cancellation approved' END
                  WHEN 'reschedule' THEN 'Reschedule approved'
                  WHEN 'extra'      THEN 'Additional session approved'
                  ELSE 'Approved'
                END
           ELSE admin_response
         END,
         reviewed_at = NOW()
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'request_type', v_req.request_type,
    'late_cancel', v_late,
    'new_appointment_status', v_new_status,
    'new_appointment_id', v_new_apt_id,
    'contract_id', v_contract_id,
    'charge_hours', v_charge_hours
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_schedule_request(
  p_request_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_req public.schedule_change_requests%ROWTYPE;
  v_updated_count int;
  v_msg_subject text;
  v_msg_body text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT role::text INTO v_caller_role FROM public.profiles WHERE user_id = v_caller_id;
  IF UPPER(COALESCE(v_caller_role, '')) NOT IN ('OWNER','ADMIN','SUPERADMIN') THEN
    RAISE EXCEPTION 'Forbidden — admin/owner role required';
  END IF;

  SELECT * INTO v_req FROM public.schedule_change_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request not found or not pending: %', p_request_id;
  END IF;

  UPDATE public.schedule_change_requests
     SET status = 'rejected',
         admin_response = COALESCE(NULLIF(TRIM(p_reason), ''), 'Rejected by admin'),
         reviewed_at = NOW()
   WHERE id = p_request_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Request not found or not pending: %', p_request_id;
  END IF;

  v_msg_subject := CASE v_req.request_type
                     WHEN 'cancel'     THEN 'Cancellation Request Declined'
                     WHEN 'reschedule' THEN 'Reschedule Request Declined'
                     WHEN 'extra'      THEN 'Additional Session Request Declined'
                     ELSE 'Schedule Request Declined'
                   END;
  v_msg_body := 'Your request was declined.'
                || CASE WHEN p_reason IS NOT NULL AND LENGTH(TRIM(p_reason)) > 0
                        THEN E'\n\nReason: ' || p_reason ELSE '' END;
  PERFORM public._post_system_message_for_client(
    v_req.client_id, v_msg_subject, v_msg_body, 'schedule_request_rejected', v_caller_id);

  RETURN jsonb_build_object('ok', true, 'request_id', p_request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_approve_schedule_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_schedule_request(uuid, text) TO authenticated;

-- ============================================================================
-- MEMBERSHIP CHANGE REQUESTS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_approve_membership_change(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_req public.membership_change_requests%ROWTYPE;
  v_current public.contracts%ROWTYPE;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_new_minutes int;
  v_renewal_mode text;
  v_policy_version text;
  v_draft_id uuid;
  v_replaced_count int := 0;
  v_pattern_count int := 0;
  v_slot jsonb;
  v_dow int;
  v_start_t text;
  v_dur int;
  v_msg_body text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT role::text INTO v_caller_role FROM public.profiles WHERE user_id = v_caller_id;
  IF UPPER(COALESCE(v_caller_role, '')) NOT IN ('OWNER','ADMIN','SUPERADMIN') THEN
    RAISE EXCEPTION 'Forbidden — admin/owner role required (caller role: %)', v_caller_role;
  END IF;

  SELECT * INTO v_req FROM public.membership_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found: %', p_request_id;
  END IF;
  IF v_req.status NOT IN ('pending','client_accepted_review','awaiting_client_review') THEN
    RAISE EXCEPTION 'Request status is % — cannot approve', v_req.status;
  END IF;

  IF v_req.current_contract_id IS NOT NULL THEN
    SELECT * INTO v_current FROM public.contracts WHERE id = v_req.current_contract_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked current contract not found: %', v_req.current_contract_id;
    END IF;
  END IF;

  IF v_req.requested_plan_key IS NULL THEN
    RAISE EXCEPTION 'Request has no requested_plan_key';
  END IF;

  DECLARE
    v_months int := 1;
    v_hours  int := 40;
  BEGIN
    v_months := COALESCE(NULLIF(SUBSTRING(v_req.requested_plan_key FROM '^([0-9]+)mo'), '')::int, 1);
    v_hours  := COALESCE(NULLIF(SUBSTRING(v_req.requested_plan_key FROM '_([0-9]+)h$'), '')::int, 40);
    v_new_minutes := v_hours * 60;
    v_new_start := COALESCE(v_current.end_at, NOW());
    v_new_end   := v_new_start + (v_months || ' months')::interval;
  END;

  v_renewal_mode := COALESCE(v_current.renewal_mode, 'manual');
  v_policy_version := COALESCE(v_current.policy_version, 'v1');

  DELETE FROM public.contracts
   WHERE client_id = v_req.client_id
     AND status = 'draft'
     AND start_at = v_new_start
  RETURNING id INTO v_draft_id;

  GET DIAGNOSTICS v_replaced_count = ROW_COUNT;

  INSERT INTO public.contracts (
    client_id, status, start_at, end_at, included_minutes,
    policy_version, renewal_mode, notes, created_by
  )
  VALUES (
    v_req.client_id, 'draft', v_new_start, v_new_end, v_new_minutes,
    v_policy_version, v_renewal_mode,
    'membership_change_approved_from:' || COALESCE(v_req.current_contract_id::text, 'none')
      || ' planKey:' || v_req.requested_plan_key
      || ' policy:' || v_policy_version,
    v_caller_id
  )
  RETURNING id INTO v_draft_id;

  DECLARE
    v_schedule jsonb := COALESCE(v_req.reviewed_schedule, v_req.requested_schedule, '[]'::jsonb);
  BEGIN
    IF jsonb_typeof(v_schedule) = 'array' THEN
      FOR v_slot IN SELECT * FROM jsonb_array_elements(v_schedule) LOOP
        v_dow := COALESCE(NULLIF(v_slot->>'day_of_week','')::int, NULL);
        IF v_dow IS NULL THEN
          DECLARE v_day_text text := UPPER(COALESCE(v_slot->>'day',''));
          BEGIN
            v_dow := CASE v_day_text
              WHEN 'SUN' THEN 0 WHEN 'SUNDAY' THEN 0
              WHEN 'MON' THEN 1 WHEN 'MONDAY' THEN 1
              WHEN 'TUE' THEN 2 WHEN 'TUESDAY' THEN 2
              WHEN 'WED' THEN 3 WHEN 'WEDNESDAY' THEN 3
              WHEN 'THU' THEN 4 WHEN 'THURSDAY' THEN 4
              WHEN 'FRI' THEN 5 WHEN 'FRIDAY' THEN 5
              WHEN 'SAT' THEN 6 WHEN 'SATURDAY' THEN 6
              ELSE NULL END;
          END;
        END IF;
        v_start_t := COALESCE(v_slot->>'start_time_local', v_slot->>'start_time', NULL);
        v_dur     := COALESCE(NULLIF(v_slot->>'duration_minutes','')::int, 60);
        IF v_dow IS NULL OR v_start_t IS NULL THEN CONTINUE; END IF;
        INSERT INTO public.contract_recurring_patterns
          (contract_id, day_of_week, start_time_local, duration_minutes, timezone)
        VALUES (
          v_draft_id, v_dow, v_start_t::time, v_dur,
          COALESCE(v_slot->>'timezone', 'America/Vancouver')
        );
        v_pattern_count := v_pattern_count + 1;
      END LOOP;
    END IF;
  END;

  UPDATE public.membership_change_requests
     SET status = 'approved',
         approved_by = v_caller_id,
         reviewed_at = NOW(),
         admin_response = 'approved · replaced_draft_count=' || v_replaced_count
                         || ' · draft_contract_id=' || v_draft_id::text
                         || ' · patterns=' || v_pattern_count
   WHERE id = p_request_id;

  v_msg_body := 'Your new plan (' || v_req.requested_plan_key || ') has been approved.'
                || E'\n\nIt starts on '
                || to_char(v_new_start AT TIME ZONE 'America/Vancouver', 'FMMonth FMDD, YYYY')
                || ' and includes ' || (v_new_minutes/60) || ' hours over '
                || EXTRACT(MONTH FROM AGE(v_new_end, v_new_start))::int || ' month(s).'
                || E'\n\n' || v_pattern_count || ' weekly session(s) scheduled.';
  PERFORM public._post_system_message_for_client(
    v_req.client_id, 'Membership Change Approved', v_msg_body,
    'membership_change_approved', v_caller_id);

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'draft_contract_id', v_draft_id,
    'replaced_drafts', v_replaced_count,
    'patterns_written', v_pattern_count,
    'new_start_at', v_new_start,
    'new_end_at', v_new_end,
    'new_included_minutes', v_new_minutes
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_membership_change(
  p_request_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_req public.membership_change_requests%ROWTYPE;
  v_updated_count int;
  v_msg_body text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT role::text INTO v_caller_role FROM public.profiles WHERE user_id = v_caller_id;
  IF UPPER(COALESCE(v_caller_role, '')) NOT IN ('OWNER','ADMIN','SUPERADMIN') THEN
    RAISE EXCEPTION 'Forbidden — admin/owner role required';
  END IF;

  SELECT * INTO v_req FROM public.membership_change_requests WHERE id = p_request_id;
  IF NOT FOUND OR v_req.status NOT IN ('pending','client_accepted_review','awaiting_client_review') THEN
    RAISE EXCEPTION 'Request not found or not in a rejectable state: %', p_request_id;
  END IF;

  UPDATE public.membership_change_requests
     SET status = 'rejected',
         rejected_by = v_caller_id,
         reviewed_at = NOW(),
         rejection_reason = COALESCE(NULLIF(TRIM(p_reason), ''), 'Rejected by admin'),
         admin_response = COALESCE(NULLIF(TRIM(p_reason), ''), 'Rejected by admin')
   WHERE id = p_request_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Request not found or not in a rejectable state: %', p_request_id;
  END IF;

  v_msg_body := 'Your membership change request was declined.'
                || CASE WHEN p_reason IS NOT NULL AND LENGTH(TRIM(p_reason)) > 0
                        THEN E'\n\nReason: ' || p_reason ELSE '' END;
  PERFORM public._post_system_message_for_client(
    v_req.client_id, 'Membership Change Declined', v_msg_body,
    'membership_change_rejected', v_caller_id);

  RETURN jsonb_build_object('ok', true, 'request_id', p_request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_approve_membership_change(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_membership_change(uuid, text) TO authenticated;

-- ============================================================================
-- END OF SERVICE / REACTIVATE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.client_request_end_of_service()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_client_id uuid;
  v_contract public.contracts%ROWTYPE;
  v_drafts_removed int := 0;
  v_msg_body text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT id INTO v_client_id FROM public.clients WHERE profile_id = v_user_id LIMIT 1;
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'No client record found for current user';
  END IF;

  SELECT * INTO v_contract FROM public.contracts
   WHERE client_id = v_client_id
     AND status = 'active'
     AND start_at <= NOW()
     AND end_at >= NOW()
   ORDER BY start_at DESC
   LIMIT 1;
  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'No active contract to end';
  END IF;

  UPDATE public.contracts
     SET renewal_mode = 'manual',
         notes = COALESCE(notes, '')
                  || CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END
                  || '[end_of_service requested at ' || NOW()::text
                  || ' by user=' || v_user_id::text || ']'
   WHERE id = v_contract.id;

  DELETE FROM public.contracts
   WHERE client_id = v_client_id
     AND status = 'draft';
  GET DIAGNOSTICS v_drafts_removed = ROW_COUNT;

  v_msg_body := 'End of service has been requested. Your current plan will continue normally until '
                || to_char(v_contract.end_at AT TIME ZONE 'America/Vancouver', 'FMMonth FMDD, YYYY')
                || '. After that date, no new contract will start automatically.'
                || E'\n\nThis can be reversed any time before then by reactivating auto-renew.';
  PERFORM public._post_system_message_for_client(
    v_client_id, 'End of Service Requested', v_msg_body,
    'end_of_service_requested', v_user_id);

  RETURN jsonb_build_object(
    'ok', true,
    'contract_id', v_contract.id,
    'contract_end_at', v_contract.end_at,
    'drafts_removed', v_drafts_removed
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.client_reactivate_auto_renew()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_client_id uuid;
  v_contract_id uuid;
  v_msg_body text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT id INTO v_client_id FROM public.clients WHERE profile_id = v_user_id LIMIT 1;
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'No client record found for current user';
  END IF;

  SELECT id INTO v_contract_id FROM public.contracts
   WHERE client_id = v_client_id
     AND status = 'active'
     AND start_at <= NOW()
     AND end_at >= NOW()
   ORDER BY start_at DESC
   LIMIT 1;
  IF v_contract_id IS NULL THEN
    RAISE EXCEPTION 'No active contract to reactivate';
  END IF;

  UPDATE public.contracts
     SET renewal_mode = 'auto',
         notes = COALESCE(notes, '')
                  || CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END
                  || '[auto_renew_reactivated at ' || NOW()::text
                  || ' by user=' || v_user_id::text || ']'
   WHERE id = v_contract_id;

  v_msg_body := 'Auto-renew has been reactivated. Your service will continue automatically after the current contract ends.';
  PERFORM public._post_system_message_for_client(
    v_client_id, 'Auto-Renew Reactivated', v_msg_body,
    'auto_renew_reactivated', v_user_id);

  RETURN jsonb_build_object('ok', true, 'contract_id', v_contract_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.client_request_end_of_service() TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_reactivate_auto_renew() TO authenticated;

-- ============================================================================
-- DONE.  Re-run safe.  After deploy:
--   - Admins approving/rejecting schedule + membership changes will auto-post
--     a system message into the client's family conversation.
--   - Clients toggling end-of-service / auto-renew will too.
--   - The app's existing system-message renderer (Conversation.js) will pick
--     these up immediately with no app changes.
-- ============================================================================
