-- =============================================================
-- Phase 19g — RLS policy: hours_ledger visible to assigned family
-- =============================================================
-- Symptom (caught 2026-05-15 in Michael's workspace):
--   Assistant view picked the right contract (Apr 15 expired,
--   38.75 used in DB, 6.75 remaining), but the workspace KPIs
--   rendered Plan 40 / Used 0 / Remaining 40 — because the
--   browser query against hours_ledger silently returned 0 rows
--   despite the rows existing in the DB.
--
-- Root cause:
--   The existing RLS on hours_ledger
--     • ledger_assistant_select_own  — required contract.assistant_id = auth.uid()
--     • ledger_client_select_own     — required ledger.client_id = auth.uid()
--   Neither matched Caleb-as-assistant viewing a contract that was
--   imported with a NULL/legacy assistant_id, or a contract whose
--   ownership had drifted away from the assistant currently
--   browsing the family workspace.
--
-- Fix:
--   Add a wider, audit-safe SELECT policy that allows the row IFF
--   the requesting user is EITHER:
--     (a) listed on the contract as the assistant, OR
--     (b) listed in family_assignments for the contract's client
--         (covers assistants assigned to the family AND family
--          members logged in as their own user).
--
-- Matches the lockdown pattern already in place for `clients`
-- and `invoices` (Phase 15-era scoped policies). Does NOT widen
-- access beyond a family's own circle.
-- =============================================================

DROP POLICY IF EXISTS "hl_select_assistant_or_family" ON public.hours_ledger;

CREATE POLICY "hl_select_assistant_or_family" ON public.hours_ledger
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = hours_ledger.contract_id
      AND (
        c.assistant_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.family_assignments fa
          WHERE fa.client_id = c.client_id
            AND fa.user_id = auth.uid()
        )
      )
  )
);

-- Verify
SELECT polname, polcmd
FROM pg_policy
WHERE polrelid = 'public.hours_ledger'::regclass
ORDER BY polname;
