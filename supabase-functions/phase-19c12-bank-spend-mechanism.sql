-- ============================================================================
-- phase-19c12-bank-spend-mechanism.sql
-- ----------------------------------------------------------------------------
-- Phase 19c.12 — Bank-hour spend mechanism.
--
-- Business rules locked 2026-05-17 per Caleb:
--   1. Bank hours are NOT family entitlement. They're an assistant-discretion
--      reserve for extra appointments (outside the recurring weekly schedule)
--      or session-extensions (booked for 3hrs, ran to 5hrs).
--   2. Bank hours are non-refundable (no cash-back).
--   3. Assistant must EXPLICITLY decide to use bank hours. There must be a
--      visible button — never automatic.
--   4. Bank-funded sessions must be visually distinguishable from contract-
--      funded sessions (calendar, lists, lesson tracker).
--   5. Every bank-funded session requires a justification note for the audit
--      trail ('why did this come out of bank, not contract?').
--
-- What this phase ships (server side):
--   • appointments.funding_source ('contract' default | 'bank')
--   • appointments.funding_note (text, required for bank-funded)
--   • complete_appointment_from_bank(p_appointment_id uuid, p_note text) RPC
--     — Inserts contract_carryover_events (negative minutes_delta) → trigger
--       updates client_bank_balance
--     — Does NOT touch hours_ledger (contract stays clean)
--     — Stamps appointment with funding_source='bank' + note
--     — Atomic; admin override included
--   • assistant_mark_appointment_complete updated: respects funding_source if
--     already set on the appointment (so booking-time choice survives to
--     completion-time)
-- ============================================================================

BEGIN;

-- ─── 1. Schema: funding source + justification on appointments ────────────
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS funding_source text NOT NULL DEFAULT 'contract'
    CHECK (funding_source IN ('contract', 'bank'));

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS funding_note text;

COMMENT ON COLUMN public.appointments.funding_source IS
  'Whether the session draws from the contract''s hours_ledger (default) or the family bank (client_bank_balance). Locked at booking, can be overridden at completion.';
COMMENT ON COLUMN public.appointments.funding_note IS
  'Required justification text when funding_source=''bank''. Surfaces in lesson tracker + audit logs so the family-facing story is clear.';


-- ─── 2. RPC: complete an appointment by spending from family bank ─────────
-- Mirrors assistant_mark_appointment_complete but:
--   • Writes to contract_carryover_events (negative delta) instead of hours_ledger
--   • Stamps the appointment with funding_source='bank' + funding_note
--   • Requires the justification text (non-null, non-empty)
--   • Same admin override pattern as Phase 19c.10
-- ────────────────────────────────────────────────────────────────────────
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
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_note IS NULL OR length(trim(p_note)) = 0 THEN
    RAISE EXCEPTION 'Bank-funded sessions require a justification note (why bank instead of contract)' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appointment % not found', p_appointment_id USING ERRCODE = 'P0002';
  END IF;

  v_is_admin := public.is_admin();

  -- Same access control as the contract-funded variant: admin OR assigned assistant
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

  -- Verify the family has enough bank to cover this session
  SELECT COALESCE(banked_minutes, 0) INTO v_bank_avail
  FROM public.client_bank_balance
  WHERE client_id = v_appt.client_id;

  IF COALESCE(v_bank_avail, 0) < v_appt.duration_minutes THEN
    RAISE EXCEPTION 'Bank insufficient: needs %, has %', v_appt.duration_minutes, COALESCE(v_bank_avail, 0)
      USING ERRCODE = 'P0001';
  END IF;

  v_marked_by := CASE WHEN v_is_admin AND (v_appt.assistant_id IS NULL OR v_appt.assistant_id <> v_caller)
                      THEN 'admin' ELSE 'assistant' END;

  -- Status + funding source stamp
  UPDATE public.appointments
     SET status = 'completed',
         funding_source = 'bank',
         funding_note = trim(p_note),
         updated_at = now()
   WHERE id = p_appointment_id;

  -- Spend from bank — negative carryover event. The trg_apply_bank_balance
  -- trigger from Phase 12 updates client_bank_balance automatically.
  INSERT INTO public.contract_carryover_events
    (client_id, source_contract_id, minutes_delta, reason, meta, created_by)
  VALUES (
    v_appt.client_id,
    v_appt.contract_id,           -- track which contract was active when bank was spent
    -v_appt.duration_minutes,     -- negative = spend
    'bank_session_spend',
    jsonb_build_object(
      'appointment_id', v_appt.id,
      'marked_by',      v_marked_by,
      'note',           trim(p_note),
      'marked_at',      now()
    ),
    v_caller
  );

  SELECT * INTO v_appt FROM public.appointments WHERE id = p_appointment_id;
  RETURN v_appt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_appointment_from_bank(uuid, text) TO authenticated;


-- ─── 3. RLS clarity ───────────────────────────────────────────────────────
-- The existing appointment RLS policies cover the new columns automatically
-- (full row read/update). No new policies needed.

COMMIT;
