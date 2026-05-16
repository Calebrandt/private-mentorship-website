-- ─────────────────────────────────────────────────────────────────────────
-- Phase 12.1: Bank-hours SPEND wiring
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 12 built the bank STORE (client_bank_balance + contract_carryover_events)
-- and the carryover-on-expire path. The bank could be filled, viewed, and
-- manually adjusted, but it had no withdrawal mechanism — a savings account
-- nobody could spend from.
--
-- This phase wires the SPEND side onto session completion. The owner's
-- recorded business rule (phase-12.sql line 39-44):
--
--   "Hours-spending order: when a family books an extra session that would
--    deduct hours, first deduct from the current contract's included_minutes.
--    When THAT runs out, deduct from the bank."
--
-- So the policy is **contract first, then bank**. No prompts; the system
-- decides automatically based on contract remaining.
--
-- BEHAVIOR
-- ────────
-- When assistant_mark_appointment_complete fires on a billable session:
--
--   1. Read the contract's remaining_minutes from v_contract_balance.
--      Treat negative as 0 (contract already overdrawn for some reason).
--   2. contract_charge = MIN(session_duration, remaining_in_contract)
--   3. bank_overflow   = session_duration - contract_charge
--   4. Write a hours_ledger row with minutes_delta = -contract_charge.
--      This row is ALWAYS written (even if contract_charge=0) so the
--      appointment-to-ledger 1:1 audit trail is preserved. Meta includes
--      'bank_overflow_minutes' so admins can see what was spilled.
--   5. If bank_overflow > 0:
--        a. bank_available = current banked_minutes (>= 0)
--        b. bank_charge    = MIN(bank_overflow, bank_available)
--        c. If bank_charge > 0: write a contract_carryover_events row
--           with minutes_delta = -bank_charge, reason='session_spend',
--           meta linking the appointment + the originating contract.
--        d. If bank_charge < bank_overflow: the family has an "uncovered"
--           portion. Write an auto_generated hours_ledger audit row
--           noting the uncovered_minutes so admins can resolve later.
--           (We do NOT silently swallow this — the audit trail records
--           that hours were owed beyond what was paid for.)
--
-- WHY THIS APPLIES ONLY TO assistant_mark_appointment_complete
-- ─────────────────────────────────────────────────────────────
-- Penalties (late_cancel_forfeit, over_token_budget reschedule charges)
-- are intentionally NOT routed through the bank. Those are punitive
-- deductions for late or repeated changes; the family shouldn't get to
-- pay them out of saved hours that were meant for service. They stay
-- as direct contract charges. If the contract goes negative from
-- penalties, that's a real signal that admin attention is needed.
--
-- Complimentary sessions: still skip everything (Phase 10 behavior),
-- write only the audit row.
--
-- Safe to re-run. Replaces assistant_mark_appointment_complete in place.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assistant_mark_appointment_complete(p_appointment_id uuid)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_appt              public.appointments%ROWTYPE;
  v_duration          int;
  v_remaining         bigint;
  v_contract_charge   int;
  v_bank_overflow     int;
  v_bank_available    int;
  v_bank_charge       int;
  v_uncovered         int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment % not found', p_appointment_id USING ERRCODE = 'P0002'; END IF;
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

  -- Complimentary: audit-only row, no spend logic at all.
  IF v_appt.is_complimentary THEN
    INSERT INTO public.hours_ledger
      (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
    VALUES
      (v_appt.client_id, v_appt.contract_id, v_appt.id, 0,
       'auto_generated'::public.ledger_reason_code,
       jsonb_build_object('source','assistant_mark_appointment_complete',
                          'kind','complimentary_session_completed',
                          'duration_minutes', v_appt.duration_minutes),
       auth.uid());

    SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
    RETURN v_appt;
  END IF;

  -- ─── Billable path: contract-first-then-bank spend ─────────────────
  v_duration := COALESCE(v_appt.duration_minutes, 60);

  -- How many minutes is the contract still good for?
  SELECT GREATEST(0, COALESCE(remaining_minutes, 0))::int
    INTO v_remaining
    FROM public.v_contract_balance
   WHERE contract_id = v_appt.contract_id;
  IF v_remaining IS NULL THEN v_remaining := 0; END IF;

  v_contract_charge := LEAST(v_duration, v_remaining);
  v_bank_overflow   := v_duration - v_contract_charge;

  -- ALWAYS write a hours_ledger row — even when the contract covers 0 of
  -- this session — so the 1:1 appointment-to-ledger audit invariant holds.
  INSERT INTO public.hours_ledger
    (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
  VALUES
    (v_appt.client_id, v_appt.contract_id, v_appt.id,
     -v_contract_charge,
     'session_completed'::public.ledger_reason_code,
     jsonb_build_object(
       'marked_by','assistant',
       'marked_at', now(),
       'session_duration_minutes', v_duration,
       'contract_charge_minutes', v_contract_charge,
       'bank_overflow_minutes', v_bank_overflow,
       'contract_remaining_before', v_remaining
     ),
     auth.uid());

  -- If the session ran longer than the contract had to give, spill into bank.
  IF v_bank_overflow > 0 THEN
    SELECT COALESCE(banked_minutes, 0)::int
      INTO v_bank_available
      FROM public.client_bank_balance
     WHERE client_id = v_appt.client_id;
    IF v_bank_available IS NULL THEN v_bank_available := 0; END IF;

    v_bank_charge := LEAST(v_bank_overflow, v_bank_available);
    v_uncovered   := v_bank_overflow - v_bank_charge;

    IF v_bank_charge > 0 THEN
      INSERT INTO public.contract_carryover_events
        (client_id, source_contract_id, minutes_delta, reason, meta, created_by)
      VALUES
        (v_appt.client_id, v_appt.contract_id, -v_bank_charge,
         'session_spend',
         jsonb_build_object(
           'source','assistant_mark_appointment_complete',
           'appointment_id', v_appt.id,
           'session_duration_minutes', v_duration,
           'contract_charge_minutes', v_contract_charge,
           'bank_charge_minutes', v_bank_charge,
           'bank_available_before', v_bank_available,
           'uncovered_minutes', v_uncovered
         ),
         auth.uid());
    END IF;

    -- If we still couldn't cover the full session, write an audit row so
    -- the gap is permanent in the record. Family owes hours we don't have
    -- a way to charge for — admin will see this and decide what to do.
    IF v_uncovered > 0 THEN
      INSERT INTO public.hours_ledger
        (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
      VALUES
        (v_appt.client_id, v_appt.contract_id, v_appt.id, 0,
         'auto_generated'::public.ledger_reason_code,
         jsonb_build_object(
           'source','assistant_mark_appointment_complete',
           'kind','session_overage_uncovered',
           'uncovered_minutes', v_uncovered,
           'session_duration_minutes', v_duration,
           'contract_charge_minutes', v_contract_charge,
           'bank_charge_minutes', v_bank_charge,
           'note','Session exceeded contract + bank; admin review needed'
         ),
         auth.uid());
    END IF;
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  RETURN v_appt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.assistant_mark_appointment_complete(uuid) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────
-- Read helper: "what did this appointment actually spend?"
-- ─────────────────────────────────────────────────────────────────────────
-- Useful for the assistant UI to render "Used 30 min from contract + 30 min
-- from bank" badges on completed sessions. Pulls both ledger and carryover
-- rows tied to one appointment.
CREATE OR REPLACE FUNCTION public.get_appointment_spend(p_appointment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id        uuid := auth.uid();
  v_appt             public.appointments%ROWTYPE;
  v_contract_used    int  := 0;
  v_bank_used        int  := 0;
  v_uncovered        int  := 0;
  v_complimentary    boolean := false;
  v_authorized       boolean := false;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment % not found', p_appointment_id USING ERRCODE = 'P0002'; END IF;

  -- Authorized if staff, the assistant on it, or the client's profile owner.
  SELECT (public.is_staff()
       OR v_appt.assistant_id = v_caller_id
       OR EXISTS (SELECT 1 FROM public.clients c
                   WHERE c.id = v_appt.client_id AND c.profile_id = v_caller_id))
    INTO v_authorized;
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501'; END IF;

  v_complimentary := COALESCE(v_appt.is_complimentary, false);

  -- Contract usage = sum of session_completed minutes_delta (negate to make positive)
  SELECT COALESCE(-SUM(minutes_delta), 0)::int
    INTO v_contract_used
    FROM public.hours_ledger
   WHERE appointment_id = p_appointment_id
     AND reason_code = 'session_completed';

  -- Bank usage = sum of session_spend events tied to this appointment
  SELECT COALESCE(-SUM(minutes_delta), 0)::int
    INTO v_bank_used
    FROM public.contract_carryover_events
   WHERE reason = 'session_spend'
     AND (meta->>'appointment_id')::uuid = p_appointment_id;

  -- Uncovered (overage rows)
  SELECT COALESCE(SUM((meta->>'uncovered_minutes')::int), 0)
    INTO v_uncovered
    FROM public.hours_ledger
   WHERE appointment_id = p_appointment_id
     AND reason_code = 'auto_generated'
     AND meta->>'kind' = 'session_overage_uncovered';

  RETURN jsonb_build_object(
    'appointment_id', p_appointment_id,
    'is_complimentary', v_complimentary,
    'session_duration_minutes', COALESCE(v_appt.duration_minutes, 0),
    'contract_minutes_used', v_contract_used,
    'bank_minutes_used', v_bank_used,
    'uncovered_minutes', v_uncovered
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_appointment_spend(uuid) TO authenticated;
