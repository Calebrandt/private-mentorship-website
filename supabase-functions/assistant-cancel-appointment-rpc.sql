-- ─────────────────────────────────────────────────────────────────────────
-- Phase 3.5: Immediate assistant-initiated cancellation
-- ─────────────────────────────────────────────────────────────────────────
-- Business rule (owner): "if someone cancels, an assistant can't say no.
-- no one can be forced to do appointments. reschedule needs approval (it
-- aligns with the assistant's schedule), but cancellation doesn't."
--
-- So: assistant clicks Cancel → immediate cancellation, no admin step.
-- This RPC mirrors the existing cancel_own_appointment pattern (which exists
-- for clients) but is scoped to the appointment's assistant.
--
-- Late-cancel policy: when the assistant cancels within 24h of the session,
-- the appointment is marked 'late_cancelled' (audit signal), but NO hours
-- are deducted from the family's contract — the assistant initiated the
-- cancellation, so the family is held harmless. This differs from the
-- existing admin_approve_schedule_request 'cancel' branch, which forfeits
-- hours regardless of who initiated. Adjust later if a different policy
-- is wanted.
--
-- Safe to re-run (CREATE OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assistant_cancel_appointment(
  p_appointment_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_appt public.appointments%ROWTYPE;
  v_late boolean := false;
  v_new_status public.appointment_status;
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

  -- Late = within 24h of a session that has not yet started.
  v_late := (v_appt.starts_at - NOW()) < INTERVAL '24 hours' AND v_appt.starts_at > NOW();
  v_new_status := (CASE WHEN v_late THEN 'late_cancelled' ELSE 'cancelled' END)
                  ::public.appointment_status;

  UPDATE public.appointments
     SET status = v_new_status,
         cancelled_at = NOW(),
         cancelled_by = auth.uid(),
         cancel_reason = COALESCE(p_reason, cancel_reason),
         updated_at = NOW()
   WHERE id = p_appointment_id;

  -- Intentional: NO hours_ledger insert here. Family is not charged when
  -- the assistant cancels — even if late — because the family did not
  -- initiate the cancellation. Adjust this policy by writing a row here
  -- if the business decides differently later.

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  RETURN v_appt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assistant_cancel_appointment(uuid, text) TO authenticated;
