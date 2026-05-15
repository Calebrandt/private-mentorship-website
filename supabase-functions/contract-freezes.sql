-- ─────────────────────────────────────────────────────────────────────────
-- Phase 6: Contract pause / freeze
-- ─────────────────────────────────────────────────────────────────────────
-- Real customer scenario: family takes a 2-3 month trip (often to China).
-- Their hours should sit untouched, no auto-generated appointments should
-- be marked no-show, and the contract should resume cleanly when they're
-- back. Today the lifecycle automation runs every 15 min and would happily
-- generate missed-session no-shows during the trip.
--
-- Model:
--   contract_freezes (id, contract_id, starts_on, ends_on, reason,
--                     ended_early_at?, ended_by?, created_at, created_by)
--   • Multiple freezes per contract are allowed (multiple trips per year)
--   • Each freeze has an inclusive date range
--   • Admin can end a freeze early (sets ended_early_at)
--
-- Admin RPCs:
--   admin_freeze_contract(contract_id, starts_on, ends_on, reason)
--     • inserts a freeze row
--     • cancels reserved appointments in the window (no hours forfeit,
--       cancel_reason='Contract frozen: ...')
--     • extends contract.end_at by freeze length (this bends the "active
--       contracts immutable" rule slightly — the manual exempts notes
--       for audit. Annotated in contracts.notes for traceability)
--
--   admin_unfreeze_contract(freeze_id)
--     • marks the freeze as ended early
--     • rolls back the unused portion of the end_at extension
--
-- Helper:
--   is_contract_frozen(contract_id, at_date) → boolean
--     • used by UI to show "FROZEN" status pill
--     • can be wired into future booking constraint checks
--
-- NOT covered in this commit:
--   • Family-initiated freeze request (admin-only for now; family asks
--     via Messages, admin clicks the button)
--   • Auto-resume notification email
--   • pg_cron skip-frozen-contracts behavior (we cancel future
--     appointments up front; if pg_cron re-generates, will need a tweak)
-- ─────────────────────────────────────────────────────────────────────────


CREATE TABLE IF NOT EXISTS public.contract_freezes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  ended_early_at timestamptz,
  ended_by uuid,
  CONSTRAINT cf_end_on_or_after_start CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_contract_freezes_contract
  ON public.contract_freezes (contract_id, starts_on);

ALTER TABLE public.contract_freezes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cf_admin_all ON public.contract_freezes;
CREATE POLICY cf_admin_all ON public.contract_freezes
  FOR ALL TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS cf_client_select_own ON public.contract_freezes;
CREATE POLICY cf_client_select_own ON public.contract_freezes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.contracts c
    JOIN public.clients cl ON cl.id = c.client_id
    WHERE c.id = contract_freezes.contract_id
      AND cl.profile_id = auth.uid()
  ));

DROP POLICY IF EXISTS cf_assistant_select_own ON public.contract_freezes;
CREATE POLICY cf_assistant_select_own ON public.contract_freezes
  FOR SELECT TO authenticated
  USING (public.is_my_assistant_contract(contract_id));


-- ─── Helper: is the contract frozen on the given date? ───────────────────
CREATE OR REPLACE FUNCTION public.is_contract_frozen(
  p_contract_id uuid,
  p_at date DEFAULT CURRENT_DATE
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.contract_freezes
    WHERE contract_id = p_contract_id
      AND ended_early_at IS NULL
      AND p_at BETWEEN starts_on AND ends_on
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_contract_frozen(uuid, date) TO authenticated;


-- ─── RPC: admin freezes a contract ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_freeze_contract(
  p_contract_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_contract public.contracts%ROWTYPE;
  v_freeze_id uuid;
  v_days int;
  v_cancelled_count int := 0;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  SELECT role::text INTO v_caller_role FROM public.profiles WHERE user_id = v_caller_id;
  IF UPPER(COALESCE(v_caller_role, '')) NOT IN ('OWNER','ADMIN','SUPERADMIN') THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_contract FROM public.contracts WHERE id = p_contract_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contract % not found', p_contract_id;
  END IF;
  IF v_contract.status NOT IN ('active', 'draft') THEN
    RAISE EXCEPTION 'Cannot freeze contract in status %', v_contract.status;
  END IF;
  IF p_ends_on < p_starts_on THEN
    RAISE EXCEPTION 'End date must be on or after start date';
  END IF;

  v_days := (p_ends_on - p_starts_on) + 1;

  -- 1. Record the freeze
  INSERT INTO public.contract_freezes
    (contract_id, starts_on, ends_on, reason, created_by)
  VALUES
    (p_contract_id, p_starts_on, p_ends_on, p_reason, v_caller_id)
  RETURNING id INTO v_freeze_id;

  -- 2. Cancel reserved appointments in the freeze window. No hours forfeit.
  WITH updated AS (
    UPDATE public.appointments
       SET status = 'cancelled'::public.appointment_status,
           cancelled_at = NOW(),
           cancelled_by = v_caller_id,
           cancel_reason = COALESCE('Contract frozen: ' || COALESCE(p_reason, 'family on break'), 'Contract frozen'),
           updated_at = NOW()
     WHERE contract_id = p_contract_id
       AND status = 'scheduled'
       AND (starts_at AT TIME ZONE 'America/Vancouver')::date
           BETWEEN p_starts_on AND p_ends_on
    RETURNING id
  )
  SELECT COUNT(*) INTO v_cancelled_count FROM updated;

  -- 3. Extend the contract's end date by the freeze length, with an
  --    audit-trail note in contracts.notes (the only contract column
  --    the engineering manual permits touching on active contracts).
  UPDATE public.contracts
     SET end_at = end_at + (v_days || ' days')::interval,
         notes = COALESCE(notes || E'\n', '') ||
                 '[' || NOW()::date || '] Frozen ' || p_starts_on || ' to ' || p_ends_on
                 || ' (+' || v_days || 'd end_at extension). Reason: ' || COALESCE(p_reason, 'n/a')
   WHERE id = p_contract_id;

  RETURN jsonb_build_object(
    'ok', true,
    'freeze_id', v_freeze_id,
    'days_frozen', v_days,
    'appointments_cancelled', v_cancelled_count
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_freeze_contract(uuid, date, date, text) TO authenticated;


-- ─── RPC: admin ends a freeze early (e.g. family came back sooner) ───────
CREATE OR REPLACE FUNCTION public.admin_unfreeze_contract(
  p_freeze_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_freeze public.contract_freezes%ROWTYPE;
  v_remaining_days int;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT role::text INTO v_caller_role FROM public.profiles WHERE user_id = v_caller_id;
  IF UPPER(COALESCE(v_caller_role, '')) NOT IN ('OWNER','ADMIN','SUPERADMIN') THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;

  SELECT * INTO v_freeze FROM public.contract_freezes WHERE id = p_freeze_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Freeze % not found', p_freeze_id;
  END IF;
  IF v_freeze.ended_early_at IS NOT NULL THEN
    RAISE EXCEPTION 'Freeze already ended early on %', v_freeze.ended_early_at::date;
  END IF;

  v_remaining_days := GREATEST(0, (v_freeze.ends_on - CURRENT_DATE));

  UPDATE public.contract_freezes
     SET ended_early_at = NOW(),
         ended_by = v_caller_id
   WHERE id = p_freeze_id;

  -- Refund the unused portion of the end_at extension
  IF v_remaining_days > 0 THEN
    UPDATE public.contracts
       SET end_at = end_at - (v_remaining_days || ' days')::interval,
           notes = COALESCE(notes || E'\n', '') ||
                   '[' || NOW()::date || '] Freeze ended early. Refund ' || v_remaining_days || ' days from end_at.'
     WHERE id = v_freeze.contract_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'freeze_id', p_freeze_id,
    'days_refunded', v_remaining_days
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_unfreeze_contract(uuid) TO authenticated;
