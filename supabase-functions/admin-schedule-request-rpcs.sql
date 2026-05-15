-- ============================================================================
-- Schedule Request approval RPCs
-- Atomic, server-side approval/rejection for the schedule_change_requests engine.
-- Mirrors the app's appointmentService.js behavior (cancel_own_appointment +
-- spendChangeTokenForAppointment + chargeAppointmentHours) in ONE place so
-- both the React Native app and the website can call this single RPC.
--
-- Deploy: paste this entire file into Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

-- ─── APPROVE ────────────────────────────────────────────────────────────────
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
  v_new_status public.appointment_status := NULL;
  v_proposed_starts timestamptz;
  v_proposed_duration int;
  v_new_apt_id uuid := NULL;
  v_contract_id uuid := NULL;
  v_charge_minutes int := 0;
BEGIN
  -- 1. Verify caller is admin/owner.
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT role::text INTO v_caller_role FROM public.profiles WHERE user_id = v_caller_id;
  IF UPPER(COALESCE(v_caller_role, '')) NOT IN ('OWNER','ADMIN','SUPERADMIN') THEN
    RAISE EXCEPTION 'Forbidden — admin/owner role required (caller role: %)', v_caller_role;
  END IF;

  -- 2. Load the request.
  SELECT * INTO v_req FROM public.schedule_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found: %', p_request_id;
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is already % — cannot re-approve', v_req.status;
  END IF;

  -- 3. Branch on request_type. Each branch is fully atomic in this function.
  IF v_req.request_type = 'cancel' THEN
    IF v_req.appointment_id IS NULL THEN
      RAISE EXCEPTION 'Cancel request has no linked appointment';
    END IF;
    SELECT * INTO v_apt FROM public.appointments WHERE id = v_req.appointment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked appointment not found: %', v_req.appointment_id;
    END IF;

    -- Late cancel = within 24 hours from now (mirrors isLateCancellationFromStartsAt).
    v_late := (v_apt.starts_at - NOW()) < INTERVAL '24 hours';
    v_new_status := (CASE WHEN v_late THEN 'late_cancelled' ELSE 'cancelled' END)::public.appointment_status;

    UPDATE public.appointments
       SET status = v_new_status,
           cancelled_at = NOW(),
           cancelled_by = v_caller_id,
           cancel_reason = COALESCE(v_req.reason, cancel_reason)
     WHERE id = v_apt.id;

    -- Hours ledger entry. New schema: minutes_delta (int) + reason_code (enum) + contract_id required.
    IF v_late THEN
      -- Forfeit hours equal to the appointment duration in MINUTES (negative).
      v_charge_minutes := -1 * COALESCE(v_apt.duration_minutes, 60);
      INSERT INTO public.hours_ledger
        (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
      VALUES
        (v_apt.client_id, v_apt.contract_id, v_apt.id,
         v_charge_minutes, 'late_cancel_forfeit'::public.ledger_reason_code,
         jsonb_build_object('source','admin_approve_schedule_request','request_id',p_request_id,'kind','cancel'),
         v_caller_id);
    ELSE
      -- Spend a change token (audit-only row, minutes_delta=0).
      INSERT INTO public.hours_ledger
        (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
      VALUES
        (v_apt.client_id, v_apt.contract_id, v_apt.id,
         0, 'change_token_spent'::public.ledger_reason_code,
         jsonb_build_object('source','admin_approve_schedule_request','request_id',p_request_id,'kind','cancel'),
         v_caller_id);
    END IF;

  ELSIF v_req.request_type = 'reschedule' THEN
    IF v_req.appointment_id IS NULL THEN
      RAISE EXCEPTION 'Reschedule request has no linked appointment';
    END IF;
    SELECT * INTO v_apt FROM public.appointments WHERE id = v_req.appointment_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked appointment not found: %', v_req.appointment_id;
    END IF;

    -- Resolve proposed start: prefer proposed_schedule.starts_at, else build
    -- from requested_date + requested_start.
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
           status = 'scheduled'::public.appointment_status,
           rescheduled_from_id = COALESCE(rescheduled_from_id, v_apt.id),
           reschedule_request_created_at = COALESCE(reschedule_request_created_at, v_req.created_at)
     WHERE id = v_apt.id;

    -- Spend change token (audit-only row).
    INSERT INTO public.hours_ledger
      (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
    VALUES
      (v_apt.client_id, v_apt.contract_id, v_apt.id,
       0, 'change_token_spent'::public.ledger_reason_code,
       jsonb_build_object('source','admin_approve_schedule_request','request_id',p_request_id,'kind','reschedule'),
       v_caller_id);

  ELSIF v_req.request_type = 'extra' THEN
    -- Resolve client's active contract at the proposed time.
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

    -- Required by appt_extra_billable_no_contract / appt_kind_reserved_requires_contract.
    IF v_contract_id IS NULL THEN
      RAISE EXCEPTION 'No active contract found for client at proposed time — cannot create extra session';
    END IF;

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
      'scheduled'::public.appointment_status,
      'extra_billable'::public.appointment_kind,
      COALESCE(LEFT(v_req.reason, 80), 'Additional session'),
      v_caller_id
    )
    RETURNING id INTO v_new_apt_id;

  ELSE
    RAISE EXCEPTION 'Unknown request_type: %', v_req.request_type;
  END IF;

  -- 4. Mark request approved.
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
    'charge_minutes', v_charge_minutes
  );
END;
$$;

-- ─── REJECT ─────────────────────────────────────────────────────────────────
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
  v_updated_count int;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT role::text INTO v_caller_role FROM public.profiles WHERE user_id = v_caller_id;
  IF UPPER(COALESCE(v_caller_role, '')) NOT IN ('OWNER','ADMIN','SUPERADMIN') THEN
    RAISE EXCEPTION 'Forbidden — admin/owner role required';
  END IF;

  UPDATE public.schedule_change_requests
     SET status = 'rejected',
         admin_response = COALESCE(NULLIF(TRIM(p_reason), ''), 'Rejected by admin'),
         reviewed_at = NOW()
   WHERE id = p_request_id
     AND status = 'pending';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Request not found or not pending: %', p_request_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'request_id', p_request_id);
END;
$$;

-- ─── PERMISSIONS ────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.admin_approve_schedule_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_schedule_request(uuid, text) TO authenticated;

-- ─── DONE ───────────────────────────────────────────────────────────────────
-- After running this, the website's admin page (admin-schedule-requests.html)
-- will use these RPCs via supabase.rpc(...). The React Native app can be
-- migrated to use the same RPCs in a future cleanup pass to remove the
-- duplicated client-side approval logic in appointmentService.js.
