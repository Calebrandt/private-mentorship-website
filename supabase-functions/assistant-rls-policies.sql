-- ─────────────────────────────────────────────────────────────────────────
-- Assistant RLS policies — Phase 1 (read-only) + Phase 3 (request inserts)
-- ─────────────────────────────────────────────────────────────────────────
-- Context: the existing schema grants RLS access to clients (via
-- clients.profile_id = auth.uid()) and to admins (via is_staff() →
-- is_admin()). There is no path that lets an authenticated ASSISTANT
-- read rows tied to their own work. These policies fix that with the
-- minimum surface area possible: every policy below scopes access to
-- rows where the assistant explicitly owns the relationship.
--
-- Designed to be additive — no existing policy is touched.
-- Safe to run multiple times; each policy uses IF NOT EXISTS pattern
-- (via DROP POLICY IF EXISTS first, then CREATE).
-- ─────────────────────────────────────────────────────────────────────────

-- ─── appointments: assistant reads their own ──────────────────────────────
DROP POLICY IF EXISTS appointments_assistant_select_own ON public.appointments;
CREATE POLICY appointments_assistant_select_own
  ON public.appointments
  FOR SELECT
  TO authenticated
  USING (assistant_id = auth.uid());


-- ─── contracts: assistant reads contracts they're assigned to ────────────
DROP POLICY IF EXISTS contracts_assistant_select_own ON public.contracts;
CREATE POLICY contracts_assistant_select_own
  ON public.contracts
  FOR SELECT
  TO authenticated
  USING (assistant_id = auth.uid());


-- ─── contract_recurring_patterns: assistant reads patterns on their contracts ──
DROP POLICY IF EXISTS recurring_patterns_assistant_select_own ON public.contract_recurring_patterns;
CREATE POLICY recurring_patterns_assistant_select_own
  ON public.contract_recurring_patterns
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = contract_recurring_patterns.contract_id
        AND c.assistant_id = auth.uid()
    )
  );


-- ─── hours_ledger: assistant reads ledger entries on contracts they're on ─
DROP POLICY IF EXISTS ledger_assistant_select_own ON public.hours_ledger;
CREATE POLICY ledger_assistant_select_own
  ON public.hours_ledger
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.id = hours_ledger.contract_id
        AND c.assistant_id = auth.uid()
    )
  );


-- ─── clients: assistant reads the clients they're engaged with ────────────
-- Important: scoped to assistant_id on contracts, so the assistant only sees
-- the family they are actively assigned to. Once a contract ends, access
-- ends (because the contract row still exists but they remain the
-- assistant_id for it — adjust later if "ended engagements" should drop
-- visibility immediately).
DROP POLICY IF EXISTS clients_assistant_select_assigned ON public.clients;
CREATE POLICY clients_assistant_select_assigned
  ON public.clients
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts c
      WHERE c.client_id = clients.id
        AND c.assistant_id = auth.uid()
    )
  );


-- ─── schedule_change_requests: assistant reads their own requests ─────────
-- An assistant should see (a) any request they filed themselves
-- (assistant_id matches) AND (b) any request that targets an appointment
-- where they are the assistant.
DROP POLICY IF EXISTS schedule_change_requests_assistant_select_own ON public.schedule_change_requests;
CREATE POLICY schedule_change_requests_assistant_select_own
  ON public.schedule_change_requests
  FOR SELECT
  TO authenticated
  USING (
    assistant_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = schedule_change_requests.appointment_id
        AND a.assistant_id = auth.uid()
    )
  );


-- ─── schedule_change_requests: assistant can FILE requests on their own appts ──
-- This is Phase 3 — but ship the policy with Phase 1 so the surface is
-- consistent. The check enforces:
--   • appointment_id (if present) must point to an appointment they own
--   • the assistant_id column on the request row matches auth.uid()
--   • for kind='extra' (no appointment_id), the request must reference
--     a client whose active contract has this user as the assistant
DROP POLICY IF EXISTS schedule_change_requests_assistant_insert ON public.schedule_change_requests;
CREATE POLICY schedule_change_requests_assistant_insert
  ON public.schedule_change_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    assistant_id = auth.uid()
    AND status = 'pending'
    AND (
      -- Reschedule/cancel — must own the appointment
      (appointment_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.appointments a
        WHERE a.id = appointment_id
          AND a.assistant_id = auth.uid()
      ))
      OR
      -- Extra (no appointment_id) — must be the assistant on an active
      -- contract for this client
      (request_type = 'extra' AND appointment_id IS NULL AND EXISTS (
        SELECT 1 FROM public.contracts c
        WHERE c.client_id = schedule_change_requests.client_id
          AND c.assistant_id = auth.uid()
          AND c.status = 'active'
      ))
    )
  );


-- ─── assistant_profiles: assistant updates their own ──────────────────────
-- This was added manually earlier today; included here for completeness so
-- the file is the single source of truth for "what RLS the assistant role
-- needs." Safe to re-run.
DROP POLICY IF EXISTS assistants_update_own_profile ON public.assistant_profiles;
CREATE POLICY assistants_update_own_profile
  ON public.assistant_profiles
  FOR UPDATE
  TO authenticated
  USING (assistant_id = auth.uid())
  WITH CHECK (assistant_id = auth.uid());


-- ─────────────────────────────────────────────────────────────────────────
-- NOT YET INCLUDED — Phase 2 (appointment status writes):
--   The "mark complete" / "mark no-show" actions need either:
--     (a) an UPDATE policy on appointments scoped to assistant_id=auth.uid(),
--         plus a corresponding INSERT policy on hours_ledger so the trigger
--         (if any) or the service layer can write the consumption row, OR
--     (b) SECURITY DEFINER RPCs (recommended — matches the existing
--         cancel_own_appointment pattern).
--
--   Adding writes is a separate decision because it has financial
--   consequences (the hours ledger is sacred per the Master Engineering
--   Manual). Ship Phase 1 first, validate it visually, then design
--   Phase 2 in a follow-on file.
-- ─────────────────────────────────────────────────────────────────────────
