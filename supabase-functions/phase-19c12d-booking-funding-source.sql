-- ============================================================================
-- phase-19c12d-booking-funding-source.sql
-- ----------------------------------------------------------------------------
-- Phase 19c.12 #5 — Booking-time funding-source choice.
--
-- Lets the assistant pre-flag a new session as bank-funded at booking
-- time (in the 'Book new session' modal). The request payload's
-- proposed_schedule jsonb gains funding_source + funding_note keys.
-- The admin approval RPC inherits them onto the created appointment.
--
-- This complements the existing 'Complete from bank' button at
-- completion time (Phase 19c.12 #1). Booking-time choice is the
-- 'pre-plan' path; completion-time override is the 'turned out longer
-- than expected' path. Both supported.
-- ============================================================================

BEGIN;

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
  v_funding_source text := 'contract';  -- Phase 19c.12 #5
  v_funding_note text;                  -- Phase 19c.12 #5
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

    v_is_complimentary := COALESCE((v_req.proposed_schedule->>'is_complimentary')::boolean, false);

    -- Phase 19c.12 #5: inherit funding_source + funding_note from the request.
    -- Whitelist values; default to 'contract' on missing/invalid.
    v_funding_source := COALESCE(LOWER(NULLIF(TRIM(v_req.proposed_schedule->>'funding_source'),'')), 'contract');
    IF v_funding_source NOT IN ('contract', 'bank') THEN v_funding_source := 'contract'; END IF;
    v_funding_note := NULLIF(TRIM(v_req.proposed_schedule->>'funding_note'), '');
    -- Complimentary takes precedence: it means no deduction at all, so
    -- funding_source is moot. Force back to contract for clean state.
    IF v_is_complimentary THEN
      v_funding_source := 'contract';
      v_funding_note := NULL;
    END IF;

    SELECT id INTO v_contract_id FROM public.contracts
     WHERE client_id = v_req.client_id AND status = 'active'
       AND start_at <= v_proposed_starts AND end_at >= v_proposed_starts
     ORDER BY start_at DESC LIMIT 1;
    IF v_contract_id IS NULL THEN
      RAISE EXCEPTION 'No active contract found for client at proposed time'; END IF;

    INSERT INTO public.appointments
      (client_id, contract_id, assistant_id, starts_at, ends_at, duration_minutes,
       status, kind, title, created_by, is_complimentary,
       funding_source, funding_note)
    VALUES
      (v_req.client_id, v_contract_id, v_req.assistant_id, v_proposed_starts,
       v_proposed_starts + (v_proposed_duration || ' minutes')::interval, v_proposed_duration,
       'scheduled'::public.appointment_status, 'extra_billable'::public.appointment_kind,
       COALESCE(LEFT(v_req.reason, 80),
                CASE WHEN v_is_complimentary THEN 'Complimentary session'
                     WHEN v_funding_source = 'bank' THEN 'Additional session (bank-funded)'
                     ELSE 'Additional session' END),
       v_caller_id, v_is_complimentary,
       v_funding_source, v_funding_note)
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
                  WHEN 'extra' THEN CASE
                    WHEN v_is_complimentary THEN 'Additional session approved (complimentary)'
                    WHEN v_funding_source = 'bank' THEN 'Additional session approved (bank-funded)'
                    ELSE 'Additional session approved' END
                  ELSE 'Approved' END
           ELSE admin_response END,
         reviewed_at = NOW()
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'ok', true, 'request_id', p_request_id, 'request_type', v_req.request_type,
    'late_cancel', v_late, 'new_appointment_status', v_new_status,
    'new_appointment_id', v_new_apt_id, 'contract_id', v_contract_id,
    'charge_minutes', v_charge_minutes, 'over_token_budget', v_over_budget,
    'is_complimentary', v_is_complimentary,
    'funding_source', v_funding_source, 'funding_note', v_funding_note);
END;
$$;

COMMIT;
