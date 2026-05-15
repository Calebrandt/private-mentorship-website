-- ─────────────────────────────────────────────────────────────────────────
-- Phase 7: Change-token status helper
-- ─────────────────────────────────────────────────────────────────────────
-- Reads the existing v_contract_balance + contract_policy_limits and returns
-- a single jsonb so the UI can show "You have N free reschedules left" and
-- warn families before they exceed the budget.
--
-- Tokens count whenever the system writes a 'change_token_spent' row to
-- hours_ledger. Per current code, that fires on:
--   • admin-approved reschedule (admin_approve_schedule_request)
--   • admin-approved cancel (legacy path — Phase 3.5 cancellations are
--     immediate and currently DON'T write a token row; deliberate, since
--     the policy is fuzzier when admin/assistant initiate. Revisit later.)
--
-- Policy from owner: families get 3 free changes per contract. After the
-- 3rd, the SESSION hours get deducted as a penalty. (Auto-deduction is
-- deferred to a follow-on — for now the UI just warns.)
--
-- Safe to re-run (CREATE OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_contract_token_status(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used int := 0;
  v_total int := 3;
  v_remaining int := 3;
BEGIN
  IF p_contract_id IS NULL THEN
    RETURN jsonb_build_object('tokens_used', 0, 'tokens_total', 0,
                              'tokens_remaining', 0, 'over_budget', false);
  END IF;

  SELECT COALESCE(change_tokens_used, 0)::int INTO v_used
   FROM public.v_contract_balance
   WHERE contract_id = p_contract_id;

  SELECT COALESCE(change_tokens_total, 3)::int INTO v_total
   FROM public.contract_policy_limits
   WHERE contract_id = p_contract_id
   LIMIT 1;

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
