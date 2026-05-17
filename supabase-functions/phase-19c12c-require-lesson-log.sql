-- ============================================================================
-- phase-19c12c-require-lesson-log.sql
-- ----------------------------------------------------------------------------
-- Phase 19c.12 #3 — Require a non-empty lesson log before marking a
-- session complete. This protects the family audit trail: every
-- consumed hour has a written record of what was done.
--
-- "Non-empty" = session_lesson_logs row exists for this appointment AND
-- focus_area is not null and not just whitespace. (Other fields stay
-- optional — focus_area is the canonical 'what did you do' answer.)
--
-- Applied to BOTH contract-funded (assistant_mark_appointment_complete)
-- and bank-funded (complete_appointment_from_bank) variants.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assistant_mark_appointment_complete(p_appointment_id uuid)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_appt      public.appointments%ROWTYPE;
  v_is_admin  boolean;
  v_marked_by text;
  v_has_log   boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment % not found', p_appointment_id USING ERRCODE = 'P0002';
  END IF;

  v_is_admin := public.is_admin();

  IF NOT v_is_admin AND (v_appt.assistant_id IS NULL OR v_appt.assistant_id <> auth.uid()) THEN
    RAISE EXCEPTION 'You are not the assistant on this appointment' USING ERRCODE = '42501';
  END IF;

  IF v_appt.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Appointment is not in scheduled state (current: %)', v_appt.status USING ERRCODE = 'P0001';
  END IF;

  IF v_appt.starts_at > now() THEN
    RAISE EXCEPTION 'Cannot mark complete: session has not started yet' USING ERRCODE = 'P0001';
  END IF;

  IF v_appt.contract_id IS NULL THEN
    RAISE EXCEPTION 'Cannot complete appointment without a contract' USING ERRCODE = 'P0001';
  END IF;

  -- Phase 19c.12 #3: Require a non-empty lesson log entry before marking complete.
  -- The lesson tracker's focus_area is the canonical 'what did you do' field;
  -- the audit trail is meaningless without it.
  SELECT EXISTS (
    SELECT 1 FROM public.session_lesson_logs
    WHERE appointment_id = p_appointment_id
      AND focus_area IS NOT NULL
      AND length(trim(focus_area)) > 0
  ) INTO v_has_log;

  IF NOT v_has_log THEN
    RAISE EXCEPTION 'A lesson log with a Focus area is required before marking this session complete. Open the Lesson Tracker for this family to log it first.'
      USING ERRCODE = 'P0001';
  END IF;

  v_marked_by := CASE WHEN v_is_admin AND (v_appt.assistant_id IS NULL OR v_appt.assistant_id <> auth.uid())
                      THEN 'admin' ELSE 'assistant' END;

  UPDATE public.appointments
     SET status = 'completed', updated_at = now()
   WHERE id = p_appointment_id;

  INSERT INTO public.hours_ledger
    (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
  VALUES
    (v_appt.client_id, v_appt.contract_id, v_appt.id,
     -v_appt.duration_minutes, 'session_completed',
     jsonb_build_object('marked_by', v_marked_by, 'marked_at', now()),
     auth.uid());

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  RETURN v_appt;
END;
$$;
GRANT EXECUTE ON FUNCTION public.assistant_mark_appointment_complete(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.complete_appointment_from_bank(
  p_appointment_id uuid,
  p_note text
)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_appt       public.appointments%ROWTYPE;
  v_is_admin   boolean;
  v_marked_by  text;
  v_caller     uuid := auth.uid();
  v_bank_avail int;
  v_has_log    boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_note IS NULL OR length(trim(p_note)) = 0 THEN
    RAISE EXCEPTION 'Bank-funded sessions require a justification note' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment % not found', p_appointment_id USING ERRCODE = 'P0002';
  END IF;
  v_is_admin := public.is_admin();
  IF NOT v_is_admin AND (v_appt.assistant_id IS NULL OR v_appt.assistant_id <> v_caller) THEN
    RAISE EXCEPTION 'You are not the assistant on this appointment' USING ERRCODE = '42501';
  END IF;
  IF v_appt.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Appointment is not in scheduled state (current: %)', v_appt.status USING ERRCODE = 'P0001';
  END IF;
  IF v_appt.starts_at > now() THEN
    RAISE EXCEPTION 'Cannot mark complete: session has not started yet' USING ERRCODE = 'P0001';
  END IF;
  IF v_appt.duration_minutes IS NULL OR v_appt.duration_minutes <= 0 THEN
    RAISE EXCEPTION 'Appointment has no duration to deduct' USING ERRCODE = 'P0001';
  END IF;

  -- Phase 19c.12 #3: Required lesson log applies to bank-funded sessions too.
  SELECT EXISTS (
    SELECT 1 FROM public.session_lesson_logs
    WHERE appointment_id = p_appointment_id
      AND focus_area IS NOT NULL
      AND length(trim(focus_area)) > 0
  ) INTO v_has_log;
  IF NOT v_has_log THEN
    RAISE EXCEPTION 'A lesson log with a Focus area is required before marking this session complete. Open the Lesson Tracker for this family to log it first.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(banked_minutes, 0) INTO v_bank_avail
  FROM public.client_bank_balance WHERE client_id = v_appt.client_id;
  IF COALESCE(v_bank_avail, 0) < v_appt.duration_minutes THEN
    RAISE EXCEPTION 'Bank insufficient: needs %, has %', v_appt.duration_minutes, COALESCE(v_bank_avail, 0)
      USING ERRCODE = 'P0001';
  END IF;

  v_marked_by := CASE WHEN v_is_admin AND (v_appt.assistant_id IS NULL OR v_appt.assistant_id <> v_caller)
                      THEN 'admin' ELSE 'assistant' END;

  UPDATE public.appointments
     SET status = 'completed', funding_source = 'bank',
         funding_note = trim(p_note), updated_at = now()
   WHERE id = p_appointment_id;

  INSERT INTO public.contract_carryover_events
    (client_id, source_contract_id, minutes_delta, reason, meta, created_by)
  VALUES (
    v_appt.client_id, v_appt.contract_id, -v_appt.duration_minutes,
    'bank_session_spend',
    jsonb_build_object('appointment_id', v_appt.id, 'marked_by', v_marked_by,
                       'note', trim(p_note), 'marked_at', now()),
    v_caller
  );

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  RETURN v_appt;
END;
$$;
GRANT EXECUTE ON FUNCTION public.complete_appointment_from_bank(uuid, text) TO authenticated;

COMMIT;
