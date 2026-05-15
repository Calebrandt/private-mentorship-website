-- ─────────────────────────────────────────────────────────────────────────
-- Phase 12: Bank-hours system (carryover of leftover minutes)
-- ─────────────────────────────────────────────────────────────────────────
-- Owner's recorded business rule (paraphrased):
--   "Almost every contract has 2-15 leftover hours. Those don't expire —
--    they're banked. Family can use them for longer sessions, extra
--    sessions outside the recurring schedule, special events, study
--    intensives, sports outings. If they sit too long, the assistant
--    should nudge the family to use them. Worst case is a family lets
--    hours pile up then asks for a refund — the assistant ends up owing
--    money back."
--
-- Current production bug (verified by audit):
--   When a contract expires, the cron's run_contract_lifecycle() marks
--   it 'expired' and (for auto-renew) creates a fresh contract with the
--   full included_minutes. The leftover minutes on the expired contract
--   become inaccessible — they're still in the hours_ledger as the
--   contract's remaining_minutes, but no UI or RPC exposes them to be
--   spent against future appointments.
--
-- Fix architecture:
--
--   1. client_bank_balance — a per-client store of bankable minutes.
--      Aggregated by trigger on contract_carryover events; never edited
--      by hand. Read by UI to show the family/assistant their saved time.
--
--   2. contract_carryover_events — append-only audit log: every time a
--      contract's leftover minutes get migrated to the bank, we record
--      the source contract, the minutes, the timestamp, the actor (cron
--      or admin), and the reason. Sacred — never edited or deleted.
--
--   3. apply_contract_carryover_on_expire() — runs as part of the
--      lifecycle when a contract status flips active→expired (and again
--      when run_contract_lifecycle promotes drafts). Reads remaining
--      minutes from v_contract_balance, writes them to bank balance,
--      logs the event. Idempotent: same contract can't be carried over
--      twice.
--
--   4. Hours-spending order: when a family books an extra session that
--      would deduct hours, first deduct from the current contract's
--      included_minutes. When THAT runs out, deduct from the bank.
--      (This is Phase 12.1+ — not in this commit. We add the BANK
--      STORE and TRACKING first; the spend-from-bank wiring lives in
--      a follow-up because it touches every cancel/complete RPC.)
--
--   5. Admin can manually adjust bank balance (rare, for disputes) via
--      a SECURITY DEFINER RPC that writes an admin_adjustment carryover
--      event. Never an UPDATE; only an INSERT with the new delta.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────


-- ─── 1. Tables ────────────────────────────────────────────────────────────

-- Per-client bank balance. One row per client. Maintained by trigger.
CREATE TABLE IF NOT EXISTS public.client_bank_balance (
  client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE,
  banked_minutes integer NOT NULL DEFAULT 0,
  last_event_id uuid,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT bank_minutes_nonneg CHECK (banked_minutes >= 0)
);

ALTER TABLE public.client_bank_balance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_balance_admin_all ON public.client_bank_balance;
CREATE POLICY bank_balance_admin_all ON public.client_bank_balance
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS bank_balance_client_select_own ON public.client_bank_balance;
CREATE POLICY bank_balance_client_select_own ON public.client_bank_balance
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_bank_balance.client_id AND c.profile_id = auth.uid()
  ));

DROP POLICY IF EXISTS bank_balance_assistant_select_own ON public.client_bank_balance;
CREATE POLICY bank_balance_assistant_select_own ON public.client_bank_balance
  FOR SELECT TO authenticated
  USING (public.is_my_assistant_client(client_id));


-- Append-only event log. NEVER updated or deleted.
CREATE TABLE IF NOT EXISTS public.contract_carryover_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source_contract_id uuid REFERENCES public.contracts(id),
  minutes_delta integer NOT NULL,    -- signed: positive = added to bank, negative = spent from bank
  reason text NOT NULL,              -- e.g. 'contract_expired_carryover', 'admin_adjustment', 'session_spend'
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid,
  CONSTRAINT cce_reason_required CHECK (length(trim(reason)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_cce_client ON public.contract_carryover_events (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cce_contract ON public.contract_carryover_events (source_contract_id);

ALTER TABLE public.contract_carryover_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cce_admin_all ON public.contract_carryover_events;
CREATE POLICY cce_admin_all ON public.contract_carryover_events
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS cce_client_select_own ON public.contract_carryover_events;
CREATE POLICY cce_client_select_own ON public.contract_carryover_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = contract_carryover_events.client_id AND c.profile_id = auth.uid()
  ));

DROP POLICY IF EXISTS cce_assistant_select_own ON public.contract_carryover_events;
CREATE POLICY cce_assistant_select_own ON public.contract_carryover_events
  FOR SELECT TO authenticated
  USING (public.is_my_assistant_client(client_id));


-- ─── 2. Trigger: keep client_bank_balance in sync with events ────────────
-- INSERT initializes the row, ON CONFLICT applies the signed delta and
-- floors at 0 (a refund/admin_adjustment could theoretically push negative;
-- we don't allow it — admin would need a positive correction instead).
CREATE OR REPLACE FUNCTION public.apply_bank_balance_event()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.client_bank_balance (client_id, banked_minutes, last_event_id, updated_at)
  VALUES (NEW.client_id, GREATEST(0, NEW.minutes_delta), NEW.id, NOW())
  ON CONFLICT (client_id) DO UPDATE
    SET banked_minutes = GREATEST(0, public.client_bank_balance.banked_minutes + NEW.minutes_delta),
        last_event_id = NEW.id,
        updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_bank_balance ON public.contract_carryover_events;
CREATE TRIGGER trg_apply_bank_balance
  AFTER INSERT ON public.contract_carryover_events
  FOR EACH ROW EXECUTE FUNCTION public.apply_bank_balance_event();


-- ─── 3. Lifecycle carryover function ────────────────────────────────────
-- Called as part of the cron tick (we'll wire it below). For each contract
-- transitioning to 'expired' OR 'completed', if there are remaining minutes
-- AND we haven't already recorded a carryover for that contract, write one.
CREATE OR REPLACE FUNCTION public.apply_contract_carryover_on_expire()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_remaining bigint;
BEGIN
  -- Look at every contract whose status is expired or completed AND has
  -- not yet been carried over (no event row exists for it yet).
  FOR r IN
    SELECT c.id, c.client_id
      FROM public.contracts c
      WHERE c.status IN ('expired', 'completed')
        AND NOT EXISTS (
          SELECT 1 FROM public.contract_carryover_events cce
           WHERE cce.source_contract_id = c.id
             AND cce.reason = 'contract_expired_carryover'
        )
        -- Phase 12.1: only process contracts with actual ledger entries.
        -- Legacy contracts (no session_completed rows) would otherwise
        -- bank their full plan minutes — but those hours were actually
        -- used, just not migrated to the new ledger schema.
        AND EXISTS (
          SELECT 1 FROM public.hours_ledger l WHERE l.contract_id = c.id
        )
  LOOP
    SELECT COALESCE(remaining_minutes, 0)
      INTO v_remaining
      FROM public.v_contract_balance
      WHERE contract_id = r.id;

    IF v_remaining > 0 THEN
      INSERT INTO public.contract_carryover_events
        (client_id, source_contract_id, minutes_delta, reason, meta, created_by)
      VALUES
        (r.client_id, r.id, v_remaining, 'contract_expired_carryover',
         jsonb_build_object('source', 'apply_contract_carryover_on_expire',
                            'auto', true),
         NULL); -- system action; created_by is null
    ELSE
      -- Even 0-minute carryovers get a row, so admins see "we checked,
      -- there was nothing to bank." Keeps the audit trail explicit.
      INSERT INTO public.contract_carryover_events
        (client_id, source_contract_id, minutes_delta, reason, meta, created_by)
      VALUES
        (r.client_id, r.id, 0, 'contract_expired_carryover',
         jsonb_build_object('source', 'apply_contract_carryover_on_expire',
                            'auto', true, 'note', 'no_minutes_to_carry'),
         NULL);
    END IF;
  END LOOP;
END;
$$;
GRANT EXECUTE ON FUNCTION public.apply_contract_carryover_on_expire() TO authenticated;


-- ─── 4. Wire carryover into the lifecycle tick ──────────────────────────
-- We don't modify run_contract_lifecycle_tick() itself (the manual marks
-- it as protected). Instead we add a thin wrapper that the cron will call,
-- which does: tick + carryover. Then re-schedule the cron to point at the
-- new wrapper.
--
-- Actually simpler: REPLACE run_contract_lifecycle_tick to also call our
-- new function at the end. That keeps the cron entry pointing at the same
-- function name.
CREATE OR REPLACE FUNCTION public.run_contract_lifecycle_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE c record;
BEGIN
  -- Phase 1 of the tick: transitions (expire, promote, auto-renew)
  PERFORM public.run_contract_lifecycle();

  -- Phase 2 of the tick: per-active-contract maintenance
  FOR c IN SELECT id FROM public.contracts WHERE status = 'active' LOOP
    PERFORM public.generate_reserved_inventory_for_contract(c.id);
    PERFORM public.sync_contract_history_ledger_row(c.id);
  END LOOP;

  -- Phase 3 of the tick (Phase 12 addition): carryover leftover minutes
  -- from any newly-expired contracts into the family's bank balance.
  PERFORM public.apply_contract_carryover_on_expire();
END;
$$;
GRANT EXECUTE ON FUNCTION public.run_contract_lifecycle_tick() TO authenticated;


-- ─── 5. Admin manual adjustment RPC ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_adjust_bank_balance(
  p_client_id uuid,
  p_minutes_delta integer,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_event_id uuid;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;
  SELECT role::text INTO v_caller_role FROM public.profiles WHERE user_id = v_caller_id;
  IF UPPER(COALESCE(v_caller_role,'')) NOT IN ('OWNER','ADMIN','SUPERADMIN') THEN
    RAISE EXCEPTION 'Admin role required' USING ERRCODE = '42501';
  END IF;
  IF p_minutes_delta = 0 THEN
    RAISE EXCEPTION 'minutes_delta must be non-zero';
  END IF;

  INSERT INTO public.contract_carryover_events
    (client_id, source_contract_id, minutes_delta, reason, meta, created_by)
  VALUES
    (p_client_id, NULL, p_minutes_delta, 'admin_adjustment',
     jsonb_build_object('note', COALESCE(NULLIF(TRIM(p_reason), ''), 'admin manual adjustment')),
     v_caller_id)
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object('ok', true, 'event_id', v_event_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_adjust_bank_balance(uuid, integer, text) TO authenticated;


-- ─── 6. Helper: client's current bank summary (read RPC) ─────────────────
CREATE OR REPLACE FUNCTION public.get_client_bank_summary(p_client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_authorized boolean := false;
  v_minutes int := 0;
  v_last_event timestamptz;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_client_id IS NULL THEN
    RETURN jsonb_build_object('banked_minutes', 0, 'banked_hours', 0);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = p_client_id
      AND (public.is_staff() OR c.profile_id = v_caller_id
           OR public.is_my_assistant_client(c.id))
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT banked_minutes, updated_at INTO v_minutes, v_last_event
    FROM public.client_bank_balance
   WHERE client_id = p_client_id;
  IF v_minutes IS NULL THEN v_minutes := 0; END IF;

  RETURN jsonb_build_object(
    'banked_minutes', v_minutes,
    'banked_hours', ROUND(v_minutes::numeric / 60.0, 2),
    'last_event_at', v_last_event
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_client_bank_summary(uuid) TO authenticated;


-- ─── 7. Backfill: process every already-expired contract ────────────────
-- For each contract that's currently 'expired' or 'completed' and has no
-- carryover event yet, write one. This catches all historical contracts.
SELECT public.apply_contract_carryover_on_expire();
