-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2: Assistant appointment status writes
-- ─────────────────────────────────────────────────────────────────────────
-- Mirrors the cancel_own_appointment pattern that already exists in
-- production: SECURITY DEFINER functions that bypass RLS but validate
-- auth.uid() and ownership inside the body. The hours ledger is sacred —
-- every state transition writes exactly one ledger row in the same
-- transaction so the chain stays consistent.
--
-- Allowed transitions:
--   scheduled → completed       (writes -duration_minutes / session_completed)
--   scheduled → no_show         (writes -duration_minutes / no_show_forfeit)
--
-- Guards:
--   • must be authenticated
--   • caller must be the appointment's assistant
--   • appointment must currently be 'scheduled'
--   • appointment must have already started (starts_at <= now())
--   • appointment must have a contract_id (sanity)
--
-- Safe to re-run (CREATE OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────────


CREATE OR REPLACE FUNCTION public.assistant_mark_appointment_complete(p_appointment_id uuid)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment % not found', p_appointment_id USING ERRCODE = 'P0002';
  END IF;

  IF v_appt.assistant_id IS NULL OR v_appt.assistant_id <> auth.uid() THEN
    RAISE EXCEPTION 'You are not the assistant on this appointment' USING ERRCODE = '42501';
  END IF;

  IF v_appt.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Appointment is not in scheduled state (current: %)', v_appt.status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_appt.starts_at > now() THEN
    RAISE EXCEPTION 'Cannot mark complete: session has not started yet'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_appt.contract_id IS NULL THEN
    RAISE EXCEPTION 'Cannot complete appointment without a contract'
      USING ERRCODE = 'P0001';
  END IF;

  -- Status transition
  UPDATE public.appointments
     SET status = 'completed',
         updated_at = now()
   WHERE id = p_appointment_id;

  -- Ledger row (consumption = negative minutes_delta)
  INSERT INTO public.hours_ledger
    (client_id, contract_id, appointment_id,
     minutes_delta, reason_code, meta, created_by)
  VALUES
    (v_appt.client_id, v_appt.contract_id, v_appt.id,
     -v_appt.duration_minutes,
     'session_completed',
     jsonb_build_object('marked_by', 'assistant', 'marked_at', now()),
     auth.uid());

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  RETURN v_appt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assistant_mark_appointment_complete(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.assistant_mark_appointment_no_show(p_appointment_id uuid)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment % not found', p_appointment_id USING ERRCODE = 'P0002';
  END IF;

  IF v_appt.assistant_id IS NULL OR v_appt.assistant_id <> auth.uid() THEN
    RAISE EXCEPTION 'You are not the assistant on this appointment' USING ERRCODE = '42501';
  END IF;

  IF v_appt.status <> 'scheduled' THEN
    RAISE EXCEPTION 'Appointment is not in scheduled state (current: %)', v_appt.status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_appt.starts_at > now() THEN
    RAISE EXCEPTION 'Cannot mark no-show: session has not started yet'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_appt.contract_id IS NULL THEN
    RAISE EXCEPTION 'Cannot mark no-show on appointment without a contract'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.appointments
     SET status = 'no_show',
         updated_at = now()
   WHERE id = p_appointment_id;

  INSERT INTO public.hours_ledger
    (client_id, contract_id, appointment_id,
     minutes_delta, reason_code, meta, created_by)
  VALUES
    (v_appt.client_id, v_appt.contract_id, v_appt.id,
     -v_appt.duration_minutes,
     'no_show_forfeit',
     jsonb_build_object('marked_by', 'assistant', 'marked_at', now()),
     auth.uid());

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  RETURN v_appt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assistant_mark_appointment_no_show(uuid) TO authenticated;
