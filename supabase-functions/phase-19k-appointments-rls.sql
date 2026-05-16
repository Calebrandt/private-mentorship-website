-- =============================================================
-- Phase 19k — appointments RLS + assistant_id backfill
-- =============================================================
-- Symptom (caught 2026-05-15/16): dashboard calendar showed
-- Daniel and Ryan's sessions but not Michael's, even after
-- backfilling family_assignments and contracts.assistant_id.
--
-- Root cause: the SELECT policy on public.appointments was
--   appointments_assistant_select_own: USING (assistant_id = auth.uid())
-- which checks the APPOINTMENT row's assistant_id column —
-- separate from contracts.assistant_id. Michael's appointments
-- were imported in Phase 15d with NULL appointments.assistant_id,
-- so RLS silently filtered them away from assistant@'s queries.
--
-- Daniel/Ryan's imports happened to set appointments.assistant_id
-- correctly which is why their sessions had been visible.
--
-- Fix has two parts (belt and suspenders):
--   (1) Backfill appointments.assistant_id for all three families
--   (2) Add a wider SELECT policy that ALSO allows visibility via
--       family_assignments — so future imports / new assistants /
--       family members logged in as themselves all work the same
--       way without depending on a backfill.
--
-- Mirrors the pattern from Phase 19g (hours_ledger).
-- =============================================================

DO $$
DECLARE
  v_user uuid;
BEGIN
  SELECT id INTO v_user FROM auth.users
  WHERE email = 'assistant@privatementorship.com' LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'assistant@privatementorship.com not found in auth.users';
  END IF;

  UPDATE public.appointments a
  SET assistant_id = v_user
  WHERE a.client_id IN (
    SELECT id FROM public.clients
    WHERE full_name IN ('Michael Yang','Daniel Jiang','Ryan Roe')
  )
  AND (a.assistant_id IS NULL OR a.assistant_id != v_user);

  RAISE NOTICE 'Backfilled appointments.assistant_id for user %', v_user;
END $$;

DROP POLICY IF EXISTS "appts_select_assistant_or_family" ON public.appointments;

CREATE POLICY "appts_select_assistant_or_family" ON public.appointments
FOR SELECT TO authenticated
USING (
  -- Direct ownership on the appointment row
  assistant_id = auth.uid()
  -- OR via the contract's assistant_id
  OR EXISTS (
    SELECT 1 FROM public.contracts c
    WHERE c.id = appointments.contract_id
      AND c.assistant_id = auth.uid()
  )
  -- OR via family_assignments (assistant or family member assigned
  -- to this appointment's client). Lets new assistants + family
  -- viewers see the data without per-row backfilling.
  OR EXISTS (
    SELECT 1 FROM public.family_assignments fa
    WHERE fa.client_id = appointments.client_id
      AND fa.user_id = auth.uid()
  )
);

-- Verify
SELECT polname
FROM pg_policy
WHERE polrelid = 'public.appointments'::regclass
  AND polcmd = 'r'
ORDER BY polname;
