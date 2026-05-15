-- ─────────────────────────────────────────────────────────────────────────
-- Phase 7.2: Auto-deduct hours when a change pushes over the token budget
-- ─────────────────────────────────────────────────────────────────────────
-- Owner policy: "people can use the tokens whenever for reschedule and cancel.
-- after 3 tokens are used, the hours they have for that session are deducted."
--
-- This commit closes the loop. When a family cancels their 4th session of
-- the contract period (or admin approves their 4th reschedule), the RPC
-- writes BOTH:
--   1. The change_token_spent audit row (minutes_delta=0)
--   2. A forfeit row using reason_code='admin_adjustment' with negative
--      minutes_delta equal to the session's duration, and meta annotating
--      the cause as 'over_token_budget'.
--
-- Why admin_adjustment: the existing ledger_reason_code enum doesn't have
-- a dedicated 'over_token_budget_forfeit' value. Adding to enums in
-- production is risky. admin_adjustment is the closest semantic fit —
-- the system is enforcing an admin-set policy. The meta jsonb provides
-- the full reason for the audit trail.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────


-- 1) cancel_own_appointment — write forfeit when over budget
CREATE OR REPLACE FUNCTION public.cancel_own_appointment(
  p_appointment_id uuid,
  p_cancel_reason text DEFAULT NULL::text
)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_now timestamptz := now();
  v_new_status public.appointment_status;
  v_tokens_used int;
  v_tokens_total int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_client FROM public.clients c
   WHERE c.profile_id = auth.uid() LIMIT 1;
  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'Client record not found for current user';
  END IF;

  SELECT * INTO v_appt FROM public.appointments a
   WHERE a.id = p_appointment_id AND a.client_id = v_client.id LIMIT 1;
  IF v_appt.id IS NULL THEN
    RAISE EXCEPTION 'Appointment not found';
  END IF;
  IF v_appt.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Only scheduled appointments can be cancelled';
  END IF;

  IF v_appt.starts_at < (v_now + interval '24 hours') THEN
    v_new_status := 'late_cancelled';
  ELSE
    v_new_status := 'cancelled';
  END IF;

  UPDATE public.appointments a
     SET status = v_new_status,
         cancelled_at = v_now,
         cancelled_by = auth.uid(),
         cancel_reason = NULLIF(TRIM(COALESCE(p_cancel_reason, '')), ''),
         updated_at = v_now
   WHERE a.id = v_appt.id
   RETURNING * INTO v_appt;

  IF v_appt.contract_id IS NOT NULL THEN
    -- Always write the audit token row.
    INSERT INTO public.hours_ledger
      (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
    VALUES
      (v_appt.client_id, v_appt.contract_id, v_appt.id, 0,
       'change_token_spent'::public.ledger_reason_code,
       jsonb_build_object('source','cancel_own_appointment','initiator','client',
                          'late',(v_new_status = 'late_cancelled')),
       auth.uid());

    -- Then check if this push the family over budget; if yes, deduct.
    -- The audit row above is already counted in v_contract_balance by now.
    SELECT COALESCE(change_tokens_used, 0)::int INTO v_tokens_used
     FROM public.v_contract_balance WHERE contract_id = v_appt.contract_id;
    SELECT COALESCE(change_tokens_total, 3)::int INTO v_tokens_total
     FROM public.contract_policy_limits WHERE contract_id = v_appt.contract_id;
    IF v_tokens_total IS NULL THEN v_tokens_total := 3; END IF;

    IF v_tokens_used > v_tokens_total THEN
      INSERT INTO public.hours_ledger
        (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
      VALUES
        (v_appt.client_id, v_appt.contract_id, v_appt.id,
         -COALESCE(v_appt.duration_minutes, 60),
         'admin_adjustment'::public.ledger_reason_code,
         jsonb_build_object(
           'source','cancel_own_appointment',
           'cause','over_token_budget',
           'tokens_used', v_tokens_used,
           'tokens_total', v_tokens_total
         ),
         auth.uid());
    END IF;
  END IF;

  RETURN v_appt;
END;
$$;


-- 2) admin_approve_schedule_request — add over-budget forfeit on the
--    reschedule branch. (Cancel branch and extra branch unchanged.)
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
  v_tokens_used int;
  v_tokens_total int;
  v_over_budget boolean := false;
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
    v_new_status := (CASE WHEN v_late THEN 'late_cancelled' ELSE 'cancelled' END)::public.appointment_status;

    UPDATE public.appointments
       SET status = v_new_status, cancelled_at = NOW(), cancelled_by = v_caller_id,
           cancel_reason = COALESCE(v_req.reason, cancel_reason)
     WHERE id = v_apt.id;

    IF v_late THEN
      v_charge_minutes := -1 * COALESCE(v_apt.duration_minutes, 60);
      INSERT INTO public.hours_ledger
        (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
      VALUES
        (v_apt.client_id, v_apt.contract_id, v_apt.id, v_charge_minutes,
         'late_cancel_forfeit'::public.ledger_reason_code,
         jsonb_build_object('source','admin_approve_schedule_request','request_id',p_request_id,'kind','cancel'),
         v_caller_id);
    ELSE
      INSERT INTO public.hours_ledger
        (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
      VALUES
        (v_apt.client_id, v_apt.contract_id, v_apt.id, 0,
         'change_token_spent'::public.ledger_reason_code,
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
    BEGIN
      v_proposed_starts := COALESCE(
        (v_req.proposed_schedule->>'starts_at')::timestamptz,
        (v_req.requested_date::text || ' ' || v_req.requested_start::text)::timestamptz);
    EXCEPTION WHEN others THEN v_proposed_starts := NULL;
    END;
    IF v_proposed_starts IS NULL THEN
      RAISE EXCEPTION 'Reschedule request has no usable proposed time';
    END IF;
    v_proposed_duration := COALESCE(
      NULLIF((v_req.proposed_schedule->>'duration_min')::int, 0),
      CASE WHEN v_req.requested_start IS NOT NULL AND v_req.requested_end IS NOT NULL
           THEN (EXTRACT(EPOCH FROM (v_req.requested_end - v_req.requested_start)) / 60)::int
           ELSE NULL END,
      v_apt.duration_minutes, 60);

    UPDATE public.appointments
       SET starts_at = v_proposed_starts,
           ends_at = v_proposed_starts + (v_proposed_duration || ' minutes')::interval,
           duration_minutes = v_proposed_duration,
           status = 'scheduled'::public.appointment_status,
           rescheduled_from_id = COALESCE(rescheduled_from_id, v_apt.id),
           reschedule_request_created_at = COALESCE(reschedule_request_created_at, v_req.created_at)
     WHERE id = v_apt.id;

    -- Audit token row
    INSERT INTO public.hours_ledger
      (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
    VALUES
      (v_apt.client_id, v_apt.contract_id, v_apt.id, 0,
       'change_token_spent'::public.ledger_reason_code,
       jsonb_build_object('source','admin_approve_schedule_request','request_id',p_request_id,'kind','reschedule'),
       v_caller_id);

    -- Phase 7.2: if approving this pushed the family over budget, deduct hours.
    SELECT COALESCE(change_tokens_used, 0)::int INTO v_tokens_used
     FROM public.v_contract_balance WHERE contract_id = v_apt.contract_id;
    SELECT COALESCE(change_tokens_total, 3)::int INTO v_tokens_total
     FROM public.contract_policy_limits WHERE contract_id = v_apt.contract_id;
    IF v_tokens_total IS NULL THEN v_tokens_total := 3; END IF;
    v_over_budget := v_tokens_used > v_tokens_total;

    IF v_over_budget THEN
      v_charge_minutes := -COALESCE(v_apt.duration_minutes, v_proposed_duration, 60);
      INSERT INTO public.hours_ledger
        (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
      VALUES
        (v_apt.client_id, v_apt.contract_id, v_apt.id, v_charge_minutes,
         'admin_adjustment'::public.ledger_reason_code,
         jsonb_build_object('source','admin_approve_schedule_request','request_id',p_request_id,
                            'kind','reschedule','cause','over_token_budget',
                            'tokens_used', v_tokens_used, 'tokens_total', v_tokens_total),
         v_caller_id);
    END IF;

  ELSIF v_req.request_type = 'extra' THEN
    BEGIN
      v_proposed_starts := COALESCE(
        (v_req.proposed_schedule->>'starts_at')::timestamptz,
        (v_req.requested_date::text || ' ' || v_req.requested_start::text)::timestamptz);
    EXCEPTION WHEN others THEN v_proposed_starts := NULL;
    END;
    IF v_proposed_starts IS NULL THEN
      RAISE EXCEPTION 'Extra request has no usable proposed time';
    END IF;
    v_proposed_duration := COALESCE(
      NULLIF((v_req.proposed_schedule->>'duration_min')::int, 0),
      CASE WHEN v_req.requested_start IS NOT NULL AND v_req.requested_end IS NOT NULL
           THEN (EXTRACT(EPOCH FROM (v_req.requested_end - v_req.requested_start)) / 60)::int
           ELSE NULL END, 60);
    SELECT id INTO v_contract_id FROM public.contracts
     WHERE client_id = v_req.client_id AND status = 'active'
       AND start_at <= v_proposed_starts AND end_at >= v_proposed_starts
     ORDER BY start_at DESC LIMIT 1;
    IF v_contract_id IS NULL THEN
      RAISE EXCEPTION 'No active contract found for client at proposed time';
    END IF;
    INSERT INTO public.appointments
      (client_id, contract_id, assistant_id, starts_at, ends_at, duration_minutes,
       status, kind, title, created_by)
    VALUES
      (v_req.client_id, v_contract_id, v_req.assistant_id, v_proposed_starts,
       v_proposed_starts + (v_proposed_duration || ' minutes')::interval, v_proposed_duration,
       'scheduled'::public.appointment_status, 'extra_billable'::public.appointment_kind,
       COALESCE(LEFT(v_req.reason, 80), 'Additional session'), v_caller_id)
    RETURNING id INTO v_new_apt_id;

  ELSE
    RAISE EXCEPTION 'Unknown request_type: %', v_req.request_type;
  END IF;

  UPDATE public.schedule_change_requests
     SET status = 'approved',
         admin_response = CASE
           WHEN admin_response IS NULL OR LENGTH(TRIM(admin_response)) = 0
           THEN CASE v_req.request_type
                  WHEN 'cancel'     THEN CASE WHEN v_late THEN 'Cancellation approved (late)' ELSE 'Cancellation approved' END
                  WHEN 'reschedule' THEN CASE WHEN v_over_budget THEN 'Reschedule approved (over token budget — hours deducted)' ELSE 'Reschedule approved' END
                  WHEN 'extra'      THEN 'Additional session approved'
                  ELSE 'Approved' END
           ELSE admin_response END,
         reviewed_at = NOW()
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'ok', true, 'request_id', p_request_id, 'request_type', v_req.request_type,
    'late_cancel', v_late, 'new_appointment_status', v_new_status,
    'new_appointment_id', v_new_apt_id, 'contract_id', v_contract_id,
    'charge_minutes', v_charge_minutes,
    'over_token_budget', v_over_budget
  );
END;
$$;
