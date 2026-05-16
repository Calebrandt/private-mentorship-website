-- ─────────────────────────────────────────────────────────────────────────
-- Phase 15e: Auto-copy recurring patterns on contract renewal
-- ─────────────────────────────────────────────────────────────────────────
-- BUG DISCOVERED 2026-05-16
--
-- When `ensure_future_contract_drafts()` (the renewal cron) creates the next
-- contract for a client with auto-renewal, it copies the contract row but
-- NOT the `contract_recurring_patterns` rows attached to the prior contract.
-- Result: families on auto-renew lose their locked T/W/Th 10am schedule the
-- moment a contract expires, and "Reserved schedule" shows blank.
--
-- Same shape as the assistant_id bug fixed in Phase 14. Same defense:
-- a BEFORE INSERT trigger on contracts that, if the new contract gets
-- created with no patterns, copies them from the most recent prior
-- contract for the same client. Belt-and-suspenders — works regardless of
-- whether `ensure_future_contract_drafts` is ever patched.
--
-- HOW IT WORKS
--   - Trigger fires AFTER INSERT on contracts (we need NEW.id to exist
--     before we can attach patterns to it).
--   - Skips if the inserted contract already has patterns (admin might
--     create with patterns explicitly).
--   - Looks up the most recent prior contract for the same client that
--     HAS patterns.
--   - Copies each pattern row (new id, new contract_id, everything else).
--
-- ALSO IN THIS PHASE
--   - One-time fix for Michael's current contract (created by auto-renewal
--     today but missing patterns).
--
-- SAFETY: Trigger is idempotent. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────


-- ─── 1. Trigger function ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.copy_recurring_patterns_to_new_contract()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_existing_count int;
  v_prior_contract_id uuid;
BEGIN
  -- Skip if the inserted contract already has patterns (explicit create).
  SELECT COUNT(*) INTO v_existing_count
    FROM public.contract_recurring_patterns
   WHERE contract_id = NEW.id;
  IF v_existing_count > 0 THEN RETURN NEW; END IF;

  -- Find the most recent prior contract for the same client that has patterns.
  SELECT c.id INTO v_prior_contract_id
    FROM public.contracts c
    WHERE c.client_id = NEW.client_id
      AND c.id <> NEW.id
      AND c.start_at < NEW.start_at
      AND EXISTS (SELECT 1 FROM public.contract_recurring_patterns p WHERE p.contract_id = c.id)
    ORDER BY c.start_at DESC
    LIMIT 1;
  IF v_prior_contract_id IS NULL THEN RETURN NEW; END IF;

  -- Copy each pattern row over to the new contract.
  INSERT INTO public.contract_recurring_patterns
    (contract_id, day_of_week, start_time_local, duration_minutes,
     timezone, assistant_id, service_type)
  SELECT
    NEW.id, day_of_week, start_time_local, duration_minutes,
    timezone, assistant_id, service_type
    FROM public.contract_recurring_patterns
   WHERE contract_id = v_prior_contract_id;

  RETURN NEW;
END;
$$;


-- ─── 2. Install the trigger (AFTER INSERT) ──────────────────────────────
DROP TRIGGER IF EXISTS trg_copy_patterns_on_new_contract ON public.contracts;
CREATE TRIGGER trg_copy_patterns_on_new_contract
  AFTER INSERT ON public.contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.copy_recurring_patterns_to_new_contract();


-- ─── 3. One-time fix: Michael's current active + draft contracts ────────
-- The auto-renewal that ran today created an active contract for 2026-05-15
-- and a draft for 2026-06-14, both with zero patterns. Backfill them.
DO $$
DECLARE
  v_client_id uuid;
  v_source_contract_id uuid;
  r record;
BEGIN
  SELECT id INTO v_client_id FROM public.clients WHERE full_name = 'Michael Yang' LIMIT 1;
  IF v_client_id IS NULL THEN
    RAISE NOTICE 'Michael not found; skipping pattern backfill.';
    RETURN;
  END IF;

  -- Find the most recent past contract that DID have patterns (Apr-May 2026)
  SELECT c.id INTO v_source_contract_id
    FROM public.contracts c
    WHERE c.client_id = v_client_id
      AND EXISTS (SELECT 1 FROM public.contract_recurring_patterns p WHERE p.contract_id = c.id)
    ORDER BY c.start_at DESC
    LIMIT 1;
  IF v_source_contract_id IS NULL THEN
    RAISE NOTICE 'No source patterns found for Michael; cannot backfill.';
    RETURN;
  END IF;

  -- Copy patterns onto every active/draft contract that has none
  FOR r IN
    SELECT c.id AS contract_id
      FROM public.contracts c
      WHERE c.client_id = v_client_id
        AND c.status IN ('active','draft')
        AND NOT EXISTS (SELECT 1 FROM public.contract_recurring_patterns p WHERE p.contract_id = c.id)
  LOOP
    INSERT INTO public.contract_recurring_patterns
      (contract_id, day_of_week, start_time_local, duration_minutes,
       timezone, assistant_id, service_type)
    SELECT
      r.contract_id, day_of_week, start_time_local, duration_minutes,
      timezone, assistant_id, service_type
      FROM public.contract_recurring_patterns
     WHERE contract_id = v_source_contract_id;

    RAISE NOTICE 'Copied patterns onto contract %', r.contract_id;
  END LOOP;
END $$;


-- ─── 4. Verification ────────────────────────────────────────────────────
SELECT
  c.status,
  c.start_at::date AS start_date,
  c.end_at::date AS end_date,
  (SELECT COUNT(*) FROM public.contract_recurring_patterns p WHERE p.contract_id = c.id) AS pattern_count
  FROM public.contracts c
  JOIN public.clients cl ON cl.id = c.client_id
 WHERE cl.full_name = 'Michael Yang'
   AND c.status IN ('active','draft')
 ORDER BY c.start_at;

-- And confirm the bank carryover happened
SELECT
  ROUND(b.banked_minutes / 60.0, 2) AS banked_hours,
  b.updated_at
  FROM public.client_bank_balance b
  JOIN public.clients cl ON cl.id = b.client_id
 WHERE cl.full_name = 'Michael Yang';
