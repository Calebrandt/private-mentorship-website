-- ─────────────────────────────────────────────────────────────────────────
-- Phase 7.1: Audit-driven fixes for change-token tracking
-- ─────────────────────────────────────────────────────────────────────────
-- Two issues caught in the post-Phase-7 audit:
--
-- (1) get_contract_token_status was SECURITY DEFINER with no authz check —
--     any authenticated user could see another family's token count. The
--     data is just numbers (no PII), but it's still a small information
--     leak. Fix: require caller to be admin OR the contract's client OR
--     the contract's assistant.
--
-- (2) cancel_own_appointment (the client-side immediate-cancel RPC) didn't
--     write a `change_token_spent` ledger row. Per the policy "3 free
--     schedule changes per contract" applies to BOTH reschedules AND
--     cancels, the counter has been undercounting cancels. Fix: write
--     an audit-only ledger row (minutes_delta=0) at the end of the cancel.
--
-- NOT changed here:
--   • assistant_cancel_appointment — Phase 3.5 says "family held harmless
--     when assistant cancels", so it deliberately does NOT consume a token.
--   • admin_approve_schedule_request (reschedule branch) — already writes
--     a token row on every approved reschedule. Whether assistant-initiated
--     reschedules should also be "free for the family" is a policy decision
--     to revisit; the current behavior (always consume on reschedule
--     regardless of initiator) is defensible and stays.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────


-- (1) get_contract_token_status — add authz check
CREATE OR REPLACE FUNCTION public.get_contract_token_status(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_authorized boolean := false;
  v_used int := 0;
  v_total int := 3;
  v_remaining int := 3;
BEGIN
  IF p_contract_id IS NULL THEN
    RETURN jsonb_build_object('tokens_used', 0, 'tokens_total', 0,
                              'tokens_remaining', 0, 'over_budget', false);
  END IF;
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Caller must be admin, OR the contract's client, OR its assistant.
  SELECT EXISTS (
    SELECT 1 FROM public.contracts c
    LEFT JOIN public.clients cl ON cl.id = c.client_id
    WHERE c.id = p_contract_id
      AND ( public.is_staff()
            OR cl.profile_id = v_caller_id
            OR c.assistant_id = v_caller_id )
  ) INTO v_authorized;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized for this contract' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(change_tokens_used, 0)::int INTO v_used
   FROM public.v_contract_balance WHERE contract_id = p_contract_id;
  SELECT COALESCE(change_tokens_total, 3)::int INTO v_total
   FROM public.contract_policy_limits WHERE contract_id = p_contract_id LIMIT 1;
  IF v_total IS NULL THEN v_total := 3; END IF;
  v_remaining := GREATEST(0, v_total - v_used);

  RETURN jsonb_build_object(
    'tokens_used',      v_used,
    'tokens_total',     v_total,
    'tokens_remaining', v_remaining,
    'over_budget',      (v_used >= v_total)
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_contract_token_status(uuid) TO authenticated;


-- (2) cancel_own_appointment — write a change_token_spent audit row when
-- the family cancels. Audit-only (minutes_delta=0); does not auto-deduct
-- hours (that decision stays with admin for now per Phase 3.5).
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_client
   FROM public.clients c
   WHERE c.profile_id = auth.uid()
   LIMIT 1;
  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'Client record not found for current user';
  END IF;

  SELECT * INTO v_appt
   FROM public.appointments a
   WHERE a.id = p_appointment_id
     AND a.client_id = v_client.id
   LIMIT 1;
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

  -- Phase 7.1: family-initiated cancellation consumes a change token.
  -- Audit-only row (minutes_delta=0) — does NOT auto-deduct hours.
  -- The counter in v_contract_balance.change_tokens_used picks this up
  -- so the UI's "X free changes left" counter works correctly for cancels.
  IF v_appt.contract_id IS NOT NULL THEN
    INSERT INTO public.hours_ledger
      (client_id, contract_id, appointment_id,
       minutes_delta, reason_code, meta, created_by)
    VALUES
      (v_appt.client_id, v_appt.contract_id, v_appt.id,
       0, 'change_token_spent'::public.ledger_reason_code,
       jsonb_build_object(
         'source', 'cancel_own_appointment',
         'initiator', 'client',
         'late', (v_new_status = 'late_cancelled')
       ),
       auth.uid());
  END IF;

  RETURN v_appt;
END;
$$;
