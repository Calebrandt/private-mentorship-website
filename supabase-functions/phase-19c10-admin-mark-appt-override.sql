-- ============================================================================
-- phase-19c10-admin-mark-appt-override.sql
-- ----------------------------------------------------------------------------
-- Owner/admin override for appointment status RPCs.
--
-- The original RPCs (assistant_mark_appointment_complete /
-- assistant_mark_appointment_no_show) enforce auth.uid() = assistant_id.
-- That's correct for assistants (you don't want assistants marking each
-- other's sessions). But the OWNER/ADMIN must always be able to act on
-- behalf of anyone — per Master Engineering Manual: admin has full
-- operational override on appointments (just not casual mutation of
-- active contracts themselves).
--
-- Change: permission check now passes if EITHER caller is the assigned
-- assistant OR caller is admin. Meta field records which path was used
-- ('assistant' vs 'admin') for audit clarity.
--
-- Other invariants (status='scheduled', starts_at <= now(), contract
-- linkage required) are unchanged — those protect data integrity, not
-- access control.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assistant_mark_appointment_complete(p_appointment_id uuid)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt    public.appointments%ROWTYPE;
  v_is_admin boolean;
  v_marked_by text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment % not found', p_appointment_id USING ERRCODE = 'P0002';
  END IF;

  v_is_admin := public.is_admin();

  -- Admin override: owner/admin can act on any appointment. Assistants can
  -- only act on their own. Family / clients still blocked.
  IF NOT v_is_admin AND (v_appt.assistant_id IS NULL OR v_appt.assistant_id <> auth.uid()) THEN
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

  v_marked_by := CASE WHEN v_is_admin AND (v_appt.assistant_id IS NULL OR v_appt.assistant_id <> auth.uid())
                      THEN 'admin'
                      ELSE 'assistant' END;

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
     jsonb_build_object('marked_by', v_marked_by, 'marked_at', now()),
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
  v_appt     public.appointments%ROWTYPE;
  v_is_admin boolean;
  v_marked_by text;
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
    RAISE EXCEPTION 'Appointment is not in scheduled state (current: %)', v_appt.status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_appt.starts_at > now() THEN
    RAISE EXCEPTION 'Cannot mark no-show: session has not started yet'
      USING ERRCODE = 'P0001';
  END IF;

  v_marked_by := CASE WHEN v_is_admin AND (v_appt.assistant_id IS NULL OR v_appt.assistant_id <> auth.uid())
                      THEN 'admin'
                      ELSE 'assistant' END;

  UPDATE public.appointments
     SET status = 'no_show',
         updated_at = now()
   WHERE id = p_appointment_id;

  -- No-show DOES consume the hours per business rule (client booked the slot,
  -- assistant showed up, hours are spent). If your policy differs, change
  -- the minutes_delta below to 0.
  INSERT INTO public.hours_ledger
    (client_id, contract_id, appointment_id,
     minutes_delta, reason_code, meta, created_by)
  VALUES
    (v_appt.client_id, v_appt.contract_id, v_appt.id,
     -v_appt.duration_minutes,
     'session_no_show',
     jsonb_build_object('marked_by', v_marked_by, 'marked_at', now()),
     auth.uid());

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  RETURN v_appt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assistant_mark_appointment_no_show(uuid) TO authenticated;

COMMIT;
