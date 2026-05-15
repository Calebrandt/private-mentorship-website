-- ─────────────────────────────────────────────────────────────────────────
-- Phase 10: Complimentary sessions (no hour deduction)
-- ─────────────────────────────────────────────────────────────────────────
-- Real business need: assistant sometimes books a session that shouldn't
-- bill the family — make-up after an assistant-initiated cancel, courtesy
-- onboarding call, quick check-in, goodwill follow-up, etc.
--
-- Owner decisions (recorded):
--  • Assistant can mark a booking complimentary themselves (they're
--    contractors, responsible for their own hours-management).
--  • Audit trail is sacred — every complimentary session stays in the
--    appointments history forever; the hours_ledger also gets an
--    auto_generated audit row at completion so the full record is
--    explicit and never erasable.
--  • Complimentary sessions appear in everyone's history; the UI shows
--    a different visual treatment (badge / color) so they're clearly
--    distinguishable from billable ones.
--
-- Schema change:
--   appointments.is_complimentary boolean NOT NULL DEFAULT false
--   Backwards compatible (defaults to existing behavior).
--
-- RPC changes:
--   • admin_approve_schedule_request — extra branch — reads
--     proposed_schedule.is_complimentary and sets the column on the
--     newly-created appointment.
--   • assistant_mark_appointment_complete — if appointment is
--     complimentary, SKIPS the session_completed ledger deduction and
--     instead writes an auto_generated row (minutes_delta=0) noting
--     the complimentary completion for audit.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS is_complimentary boolean NOT NULL DEFAULT false;

-- Index for the admin "complimentary sessions" filter later (cheap; only
-- writes when the column is updated).
CREATE INDEX IF NOT EXISTS idx_appointments_complimentary
  ON public.appointments (is_complimentary)
  WHERE is_complimentary = true;


-- ─── admin_approve_schedule_request — set is_complimentary on extras ────
-- Same body as the recent Phase 7.2 version, plus one read of
-- proposed_schedule.is_complimentary in the extra branch.
CREATE OR REPLACE FUNCTION public.admin_approve_schedule_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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
  v_is_complimentary boolean := false;
BEGIN
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT role::text INTO v_caller_role FROM public.profiles WHERE user_id = v_caller_id;
  IF UPPER(COALESCE(v_caller_role,'')) NOT IN ('OWNER','ADMIN','SUPERADMIN') THEN
    RAISE EXCEPTION 'Admin/owner role required (caller role: %)', v_caller_role; END IF;

  SELECT * INTO v_req FROM public.schedule_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found: %', p_request_id; END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'Request is already % — cannot re-approve', v_req.status; END IF;

  IF v_req.request_type = 'cancel' THEN
    IF v_req.appointment_id IS NULL THEN RAISE EXCEPTION 'Cancel request has no linked appointment'; END IF;
    SELECT * INTO v_apt FROM public.appointments WHERE id = v_req.appointment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Linked appointment not found'; END IF;
    v_late := (v_apt.starts_at - NOW()) < INTERVAL '24 hours';
    v_new_status := (CASE WHEN v_late THEN 'late_cancelled' ELSE 'cancelled' END)::public.appointment_status;
    UPDATE public.appointments SET status = v_new_status, cancelled_at = NOW(),
       cancelled_by = v_caller_id, cancel_reason = COALESCE(v_req.reason, cancel_reason)
       WHERE id = v_apt.id;
    IF v_late THEN
      v_charge_minutes := -1 * COALESCE(v_apt.duration_minutes, 60);
      INSERT INTO public.hours_ledger (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
      VALUES (v_apt.client_id, v_apt.contract_id, v_apt.id, v_charge_minutes,
              'late_cancel_forfeit'::public.ledger_reason_code,
              jsonb_build_object('source','admin_approve_schedule_request','request_id',p_request_id,'kind','cancel'),
              v_caller_id);
    ELSE
      INSERT INTO public.hours_ledger (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
      VALUES (v_apt.client_id, v_apt.contract_id, v_apt.id, 0,
              'change_token_spent'::public.ledger_reason_code,
              jsonb_build_object('source','admin_approve_schedule_request','request_id',p_request_id,'kind','cancel'),
              v_caller_id);
    END IF;

  ELSIF v_req.request_type = 'reschedule' THEN
    IF v_req.appointment_id IS NULL THEN RAISE EXCEPTION 'Reschedule request has no linked appointment'; END IF;
    SELECT * INTO v_apt FROM public.appointments WHERE id = v_req.appointment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Linked appointment not found'; END IF;
    BEGIN
      v_proposed_starts := COALESCE(
        (v_req.proposed_schedule->>'starts_at')::timestamptz,
        (v_req.requested_date::text || ' ' || v_req.requested_start::text)::timestamptz);
    EXCEPTION WHEN others THEN v_proposed_starts := NULL; END;
    IF v_proposed_starts IS NULL THEN RAISE EXCEPTION 'Reschedule request has no usable proposed time'; END IF;
    v_proposed_duration := COALESCE(
      NULLIF((v_req.proposed_schedule->>'duration_min')::int, 0),
      CASE WHEN v_req.requested_start IS NOT NULL AND v_req.requested_end IS NOT NULL
        THEN (EXTRACT(EPOCH FROM (v_req.requested_end - v_req.requested_start)) / 60)::int ELSE NULL END,
      v_apt.duration_minutes, 60);
    UPDATE public.appointments
       SET starts_at = v_proposed_starts,
           ends_at = v_proposed_starts + (v_proposed_duration || ' minutes')::interval,
           duration_minutes = v_proposed_duration,
           status = 'scheduled'::public.appointment_status,
           rescheduled_from_id = COALESCE(rescheduled_from_id, v_apt.id),
           reschedule_request_created_at = COALESCE(reschedule_request_created_at, v_req.created_at)
     WHERE id = v_apt.id;
    INSERT INTO public.hours_ledger (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
    VALUES (v_apt.client_id, v_apt.contract_id, v_apt.id, 0,
            'change_token_spent'::public.ledger_reason_code,
            jsonb_build_object('source','admin_approve_schedule_request','request_id',p_request_id,'kind','reschedule'),
            v_caller_id);
    SELECT COALESCE(change_tokens_used,0)::int INTO v_tokens_used FROM public.v_contract_balance WHERE contract_id = v_apt.contract_id;
    SELECT COALESCE(change_tokens_total,3)::int INTO v_tokens_total FROM public.contract_policy_limits WHERE contract_id = v_apt.contract_id;
    IF v_tokens_total IS NULL THEN v_tokens_total := 3; END IF;
    v_over_budget := v_tokens_used > v_tokens_total;
    IF v_over_budget THEN
      v_charge_minutes := -COALESCE(v_apt.duration_minutes, v_proposed_duration, 60);
      INSERT INTO public.hours_ledger (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
      VALUES (v_apt.client_id, v_apt.contract_id, v_apt.id, v_charge_minutes,
              'admin_adjustment'::public.ledger_reason_code,
              jsonb_build_object('source','admin_approve_schedule_request','request_id',p_request_id,
                                 'kind','reschedule','cause','over_token_budget',
                                 'tokens_used',v_tokens_used,'tokens_total',v_tokens_total),
              v_caller_id);
    END IF;

  ELSIF v_req.request_type = 'extra' THEN
    BEGIN
      v_proposed_starts := COALESCE(
        (v_req.proposed_schedule->>'starts_at')::timestamptz,
        (v_req.requested_date::text || ' ' || v_req.requested_start::text)::timestamptz);
    EXCEPTION WHEN others THEN v_proposed_starts := NULL; END;
    IF v_proposed_starts IS NULL THEN RAISE EXCEPTION 'Extra request has no usable proposed time'; END IF;
    v_proposed_duration := COALESCE(
      NULLIF((v_req.proposed_schedule->>'duration_min')::int, 0),
      CASE WHEN v_req.requested_start IS NOT NULL AND v_req.requested_end IS NOT NULL
        THEN (EXTRACT(EPOCH FROM (v_req.requested_end - v_req.requested_start)) / 60)::int ELSE NULL END, 60);

    -- Phase 10: pull complimentary flag from the request's proposed_schedule
    v_is_complimentary := COALESCE((v_req.proposed_schedule->>'is_complimentary')::boolean, false);

    SELECT id INTO v_contract_id FROM public.contracts
     WHERE client_id = v_req.client_id AND status = 'active'
       AND start_at <= v_proposed_starts AND end_at >= v_proposed_starts
     ORDER BY start_at DESC LIMIT 1;
    IF v_contract_id IS NULL THEN
      RAISE EXCEPTION 'No active contract found for client at proposed time'; END IF;

    INSERT INTO public.appointments
      (client_id, contract_id, assistant_id, starts_at, ends_at, duration_minutes,
       status, kind, title, created_by, is_complimentary)
    VALUES
      (v_req.client_id, v_contract_id, v_req.assistant_id, v_proposed_starts,
       v_proposed_starts + (v_proposed_duration || ' minutes')::interval, v_proposed_duration,
       'scheduled'::public.appointment_status, 'extra_billable'::public.appointment_kind,
       COALESCE(LEFT(v_req.reason, 80), CASE WHEN v_is_complimentary THEN 'Complimentary session' ELSE 'Additional session' END),
       v_caller_id, v_is_complimentary)
    RETURNING id INTO v_new_apt_id;

  ELSE RAISE EXCEPTION 'Unknown request_type: %', v_req.request_type;
  END IF;

  UPDATE public.schedule_change_requests
     SET status = 'approved',
         admin_response = CASE
           WHEN admin_response IS NULL OR LENGTH(TRIM(admin_response)) = 0
           THEN CASE v_req.request_type
                  WHEN 'cancel' THEN CASE WHEN v_late THEN 'Cancellation approved (late)' ELSE 'Cancellation approved' END
                  WHEN 'reschedule' THEN CASE WHEN v_over_budget THEN 'Reschedule approved (over budget — hours deducted)' ELSE 'Reschedule approved' END
                  WHEN 'extra' THEN CASE WHEN v_is_complimentary THEN 'Additional session approved (complimentary)' ELSE 'Additional session approved' END
                  ELSE 'Approved' END
           ELSE admin_response END,
         reviewed_at = NOW()
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'ok', true, 'request_id', p_request_id, 'request_type', v_req.request_type,
    'late_cancel', v_late, 'new_appointment_status', v_new_status,
    'new_appointment_id', v_new_apt_id, 'contract_id', v_contract_id,
    'charge_minutes', v_charge_minutes, 'over_token_budget', v_over_budget,
    'is_complimentary', v_is_complimentary);
END;
$$;


-- ─── assistant_mark_appointment_complete — skip ledger if complimentary ─
-- Comp sessions still get an audit row (auto_generated, minutes_delta=0)
-- so the hours_ledger remains the full record of what happened.
CREATE OR REPLACE FUNCTION public.assistant_mark_appointment_complete(p_appointment_id uuid)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_appt public.appointments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Appointment % not found', p_appointment_id USING ERRCODE = 'P0002'; END IF;
  IF v_appt.assistant_id IS NULL OR v_appt.assistant_id <> auth.uid() THEN
    RAISE EXCEPTION 'You are not the assistant on this appointment' USING ERRCODE = '42501'; END IF;
  IF v_appt.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Appointment is not in scheduled state (current: %)', v_appt.status USING ERRCODE = 'P0001'; END IF;
  IF v_appt.starts_at > now() THEN
    RAISE EXCEPTION 'Cannot mark complete: session has not started yet' USING ERRCODE = 'P0001'; END IF;
  IF v_appt.contract_id IS NULL THEN
    RAISE EXCEPTION 'Cannot complete appointment without a contract' USING ERRCODE = 'P0001'; END IF;

  UPDATE public.appointments
     SET status = 'completed', updated_at = now()
   WHERE id = p_appointment_id;

  IF v_appt.is_complimentary THEN
    -- Audit-only row: no hours move, but the record is permanent.
    INSERT INTO public.hours_ledger
      (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
    VALUES
      (v_appt.client_id, v_appt.contract_id, v_appt.id, 0,
       'auto_generated'::public.ledger_reason_code,
       jsonb_build_object('source','assistant_mark_appointment_complete',
                          'kind','complimentary_session_completed',
                          'duration_minutes', v_appt.duration_minutes),
       auth.uid());
  ELSE
    -- Normal billable completion: deduct hours.
    INSERT INTO public.hours_ledger
      (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
    VALUES
      (v_appt.client_id, v_appt.contract_id, v_appt.id,
       -v_appt.duration_minutes, 'session_completed'::public.ledger_reason_code,
       jsonb_build_object('marked_by','assistant','marked_at', now()),
       auth.uid());
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  RETURN v_appt;
END;
$$;
