-- ─────────────────────────────────────────────────────────────────────────
-- Phase 14: Sync contracts.assistant_id from family_assignments
-- ─────────────────────────────────────────────────────────────────────────
-- BUG DISCOVERED 2026-05-15
--
-- Every contract in the database has a NULL assistant_id (79/79 active +
-- draft contracts confirmed empty). Meanwhile, family_assignments holds the
-- real assistant↔family link (role='ASSISTANT', designation='ASSIGNED_ASSISTANT').
--
-- The consequence: assistant-client.html (`fetchMyAssignedClients`) queries
-- `contracts.assistant_id = auth.uid()` to populate "My Clients" — so every
-- signed-in assistant sees an empty list. Michael's family appeared only
-- because his contract was manually patched in a prior session.
--
-- This was masquerading as a "future bug" (auto-renewal loses the link).
-- It's actually a present-tense bug for the entire active fleet.
--
-- FIX (two parts)
-- ───────────────
-- 1. BACKFILL: For every contract with NULL assistant_id where a matching
--    ASSISTANT row exists in family_assignments, copy the user_id into
--    contracts.assistant_id. One-time repair.
--
-- 2. TRIGGER: On INSERT or UPDATE of contracts, if assistant_id ends up
--    NULL, auto-populate it from the latest family_assignments(role=ASSISTANT)
--    row for that client. This defends against ALL future code paths —
--    admin create, ensure_future_contract_drafts, manual SQL, anything.
--    The actual ensure_future_contract_drafts function fix is then optional.
--
-- Safe to re-run. Idempotent. No DROP of existing data.
-- ─────────────────────────────────────────────────────────────────────────


-- ─── 1. Trigger function: cache assistant_id from family_assignments ─────
CREATE OR REPLACE FUNCTION public.sync_contract_assistant_from_family_assignments()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- If the caller already set assistant_id, respect it (admin override).
  IF NEW.assistant_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Look up the most-recently-assigned ASSISTANT for this client.
  SELECT fa.user_id
    INTO NEW.assistant_id
    FROM public.family_assignments fa
   WHERE fa.client_id = NEW.client_id
     AND fa.role = 'ASSISTANT'
   ORDER BY fa.created_at DESC
   LIMIT 1;
  -- NEW.assistant_id may still be NULL if no ASSISTANT row exists; that's
  -- a real "unassigned" state and we leave it for admin to resolve.
  RETURN NEW;
END;
$$;


-- ─── 2. Install the trigger ─────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_contracts_sync_assistant ON public.contracts;
CREATE TRIGGER trg_contracts_sync_assistant
  BEFORE INSERT OR UPDATE OF client_id, assistant_id ON public.contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_contract_assistant_from_family_assignments();


-- ─── 3. One-time backfill of all 79 (or however many) broken contracts ──
-- For every contract with NULL assistant_id, find the matching ASSISTANT
-- entry in family_assignments and copy the user_id. Skip contracts whose
-- client has no ASSISTANT entry (those are genuinely unassigned).
UPDATE public.contracts c
   SET assistant_id = sub.assistant_user_id
  FROM (
    SELECT DISTINCT ON (fa.client_id)
           fa.client_id,
           fa.user_id AS assistant_user_id
      FROM public.family_assignments fa
     WHERE fa.role = 'ASSISTANT'
       AND fa.client_id IS NOT NULL
     ORDER BY fa.client_id, fa.created_at DESC
  ) sub
 WHERE c.client_id = sub.client_id
   AND c.assistant_id IS NULL;


-- ─── 4. Verification: how many got patched, how many still NULL? ────────
-- Read-only — purely informational. Run after the UPDATE.
SELECT
  COUNT(*) FILTER (WHERE assistant_id IS NOT NULL)            AS contracts_with_assistant,
  COUNT(*) FILTER (WHERE assistant_id IS NULL)                AS contracts_still_unassigned,
  COUNT(*) FILTER (WHERE assistant_id IS NULL AND status IN ('active','draft')) AS active_unassigned_remaining
  FROM public.contracts;


-- ─── 5. Show which contracts are STILL unassigned (no ASSISTANT row in
--    family_assignments). Admin needs to fix these manually.
SELECT
  c.id            AS contract_id,
  c.client_id,
  cl.full_name,
  c.status,
  c.start_at,
  c.end_at
  FROM public.contracts c
  LEFT JOIN public.clients cl ON cl.id = c.client_id
 WHERE c.assistant_id IS NULL
   AND c.status IN ('active','draft')
 ORDER BY c.start_at DESC;
