-- =============================================================
-- Phase 19f — "Activate renewal" RPC + safer lifecycle cron
-- =============================================================
-- Root cause fixed: prior to this phase, run_contract_lifecycle_tick()
-- auto-promoted any draft contract whose start_at had passed to
-- 'active'. Real-world payment timing is loose (clients pay days
-- before, on, or after the calendar renewal date) so the auto-promo
-- created phantom active contracts and confused the hours math.
-- Phase 19h paused the cron entirely as a tourniquet. This is the
-- proper repair: separate the calendar-driven actions (expire) from
-- the money-driven actions (activate), and give the admin a one-click
-- "Activate" button to make the latter explicit.
--
-- This script does FOUR things:
--   (1) Creates RPC `assistant_activate_renewal(contract_id)` that
--       flips a draft → active AND fires carryover from the prior
--       expired contract in one atomic transaction.
--   (2) Replaces run_contract_lifecycle_tick() with a version that
--       ONLY expires past-end_at active contracts (no auto-activate).
--       Carryover STILL fires on expiry — when an active contract
--       expires with residual, those hours roll to bank.
--   (3) Re-enables the contract-lifecycle-every-15-min cron job
--       (paused in Phase 19h).
--   (4) Verifies all three.
-- =============================================================


-- ─── (1) assistant_activate_renewal RPC ─────────────────────────

DROP FUNCTION IF EXISTS public.assistant_activate_renewal(uuid);

CREATE OR REPLACE FUNCTION public.assistant_activate_renewal(p_contract_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       uuid := auth.uid();
  v_contract      record;
  v_client_id     uuid;
  v_old_contract  uuid;
  v_residual_min  int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  -- Load the contract
  SELECT id, client_id, status, assistant_id, start_at, end_at, included_minutes
    INTO v_contract
  FROM public.contracts
  WHERE id = p_contract_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract % not found', p_contract_id;
  END IF;

  IF v_contract.status <> 'draft' THEN
    RAISE EXCEPTION 'Contract is not a draft (status=%)', v_contract.status;
  END IF;

  -- Authorization: caller must either own the contract as assistant_id,
  -- OR be in family_assignments for this client. Mirrors the same
  -- permission shape we use for hours_ledger / appointments RLS.
  IF v_contract.assistant_id IS DISTINCT FROM v_user_id
     AND NOT EXISTS (
       SELECT 1 FROM public.family_assignments
       WHERE client_id = v_contract.client_id
         AND user_id = v_user_id
     )
  THEN
    RAISE EXCEPTION 'Not authorized to activate this renewal';
  END IF;

  v_client_id := v_contract.client_id;

  -- Find the most recent EXPIRED contract for this client whose
  -- end_at lands on or before the new contract's start_at. This is
  -- the donor whose residual hours roll forward.
  WITH prior AS (
    SELECT
      c.id,
      c.included_minutes + COALESCE(SUM(hl.minutes_delta), 0) AS residual_min
    FROM public.contracts c
    LEFT JOIN public.hours_ledger hl ON hl.contract_id = c.id
    WHERE c.client_id = v_client_id
      AND c.status = 'expired'
      AND c.id <> p_contract_id
      AND (v_contract.start_at IS NULL OR c.end_at <= v_contract.start_at)
    GROUP BY c.id, c.included_minutes, c.end_at
    ORDER BY c.end_at DESC
    LIMIT 1
  )
  SELECT id, residual_min
    INTO v_old_contract, v_residual_min
  FROM prior;

  -- Flip the contract to active first so any downstream triggers
  -- see the new status when reading via this row.
  UPDATE public.contracts
  SET status = 'active'
  WHERE id = p_contract_id;

  -- Roll the residual forward (only if positive).
  IF v_old_contract IS NOT NULL
     AND v_residual_min IS NOT NULL
     AND v_residual_min > 0
  THEN
    INSERT INTO public.hours_ledger (
      client_id, contract_id, minutes_delta, reason_code
    ) VALUES (
      v_client_id, p_contract_id, v_residual_min, 'admin_adjustment'
    );

    -- Audit row mirroring what the auto-carryover trigger writes
    BEGIN
      INSERT INTO public.contract_carryover_events (
        client_id, source_contract_id, destination_contract_id,
        minutes_transferred, destination_kind, notes, created_at
      ) VALUES (
        v_client_id, v_old_contract, p_contract_id,
        v_residual_min, 'contract',
        'Manual Activate (Phase 19f assistant_activate_renewal)',
        now()
      );
    EXCEPTION WHEN OTHERS THEN
      -- Carryover events table may have different shape across envs;
      -- the ledger entry above is the source of truth so an audit
      -- write failure shouldn't block the activation.
      RAISE NOTICE 'contract_carryover_events insert skipped: %', SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'contract_id', p_contract_id,
    'status', 'active',
    'carryover_minutes', COALESCE(v_residual_min, 0),
    'source_contract_id', v_old_contract
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assistant_activate_renewal(uuid) TO authenticated;


-- ─── (2) Safer lifecycle tick: expire only, never auto-activate ───
-- We keep the function NAME so the existing cron job keeps calling
-- it. Just replace the body. Carryover-on-expiry behavior is
-- preserved (whatever trigger fires on status='expired' continues
-- to fire). What changes: the auto-promo of drafts is GONE — that's
-- now the human's job via assistant_activate_renewal.

CREATE OR REPLACE FUNCTION public.run_contract_lifecycle_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired int := 0;
BEGIN
  -- Expire active contracts whose end_at has passed.
  UPDATE public.contracts
  SET status = 'expired'
  WHERE status = 'active'
    AND end_at IS NOT NULL
    AND end_at < now();
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  RETURN jsonb_build_object(
    'expired_count', v_expired,
    'tick_ran_at', now(),
    -- Auto-activation is deliberately removed in Phase 19f. Use
    -- assistant_activate_renewal(uuid) to flip a draft to active
    -- after payment lands.
    'auto_activated_count', 0
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.run_contract_lifecycle_tick() TO postgres;


-- ─── (3) Re-enable the cron job ────────────────────────────────
UPDATE cron.job
SET active = true
WHERE jobname = 'contract-lifecycle-every-15-min';


-- ─── (4) Verify ────────────────────────────────────────────────
-- Cron should now be active again
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = 'contract-lifecycle-every-15-min';

-- RPC should exist and be callable by authenticated
SELECT proname, prosecdef AS is_security_definer
FROM pg_proc
WHERE proname IN ('assistant_activate_renewal', 'run_contract_lifecycle_tick')
ORDER BY proname;
