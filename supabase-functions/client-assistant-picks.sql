-- ============================================================================
-- Phase C: Client Assistant Picks
--
-- A family's pre-engagement shortlist of Assistants. After applying, families
-- browse the published roster (assistant_profiles WHERE is_published=true) and
-- add up to 3 Assistants to their pick list. Submitting the picks notifies
-- Private Mentorship to schedule intro meetings.
--
-- Lifecycle:
--   shortlisted → introduction_requested → meeting_scheduled →
--   meeting_complete → engaged | declined
--
-- Family routing: per Master Engineering Manual §7, all client logic resolves
-- through clients.profile_id = auth.uid() (the service recipient's record).
--
-- Deploy: paste this entire file into Supabase Dashboard → SQL Editor → Run.
-- Safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE).
-- ============================================================================

-- ─── TABLE ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_assistant_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  assistant_id uuid NOT NULL REFERENCES public.assistant_profiles(assistant_id) ON DELETE CASCADE,
  rank smallint CHECK (rank IS NULL OR rank BETWEEN 1 AND 3),
  status text NOT NULL DEFAULT 'shortlisted' CHECK (status IN (
    'shortlisted',
    'introduction_requested',
    'meeting_scheduled',
    'meeting_complete',
    'engaged',
    'declined'
  )),
  notes text,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, assistant_id)
);

CREATE INDEX IF NOT EXISTS idx_picks_client   ON public.client_assistant_picks(client_id);
CREATE INDEX IF NOT EXISTS idx_picks_assistant ON public.client_assistant_picks(assistant_id);
CREATE INDEX IF NOT EXISTS idx_picks_status   ON public.client_assistant_picks(status);

-- ─── ROW LEVEL SECURITY ─────────────────────────────────────────────────────
ALTER TABLE public.client_assistant_picks ENABLE ROW LEVEL SECURITY;

-- Drop existing policies (so re-running the file is safe)
DROP POLICY IF EXISTS "picks_select_own"    ON public.client_assistant_picks;
DROP POLICY IF EXISTS "picks_insert_own"    ON public.client_assistant_picks;
DROP POLICY IF EXISTS "picks_update_own"    ON public.client_assistant_picks;
DROP POLICY IF EXISTS "picks_delete_own"    ON public.client_assistant_picks;
DROP POLICY IF EXISTS "picks_admin_select"  ON public.client_assistant_picks;
DROP POLICY IF EXISTS "picks_admin_update"  ON public.client_assistant_picks;

-- Clients: read their own picks
CREATE POLICY "picks_select_own"
  ON public.client_assistant_picks
  FOR SELECT
  TO authenticated
  USING (
    client_id IN (SELECT id FROM public.clients WHERE profile_id = auth.uid())
  );

-- Clients: insert picks for themselves only
CREATE POLICY "picks_insert_own"
  ON public.client_assistant_picks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    client_id IN (SELECT id FROM public.clients WHERE profile_id = auth.uid())
  );

-- Clients: update their own picks (e.g., re-rank, change notes)
CREATE POLICY "picks_update_own"
  ON public.client_assistant_picks
  FOR UPDATE
  TO authenticated
  USING (
    client_id IN (SELECT id FROM public.clients WHERE profile_id = auth.uid())
  )
  WITH CHECK (
    client_id IN (SELECT id FROM public.clients WHERE profile_id = auth.uid())
  );

-- Clients: delete their own picks
CREATE POLICY "picks_delete_own"
  ON public.client_assistant_picks
  FOR DELETE
  TO authenticated
  USING (
    client_id IN (SELECT id FROM public.clients WHERE profile_id = auth.uid())
  );

-- Admin/Owner: read all picks
CREATE POLICY "picks_admin_select"
  ON public.client_assistant_picks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE user_id = auth.uid()
         AND UPPER(role::text) IN ('OWNER', 'ADMIN', 'SUPERADMIN')
    )
  );

-- Admin/Owner: update any pick (status transitions etc.)
CREATE POLICY "picks_admin_update"
  ON public.client_assistant_picks
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
       WHERE user_id = auth.uid()
         AND UPPER(role::text) IN ('OWNER', 'ADMIN', 'SUPERADMIN')
    )
  );

-- ─── RPC: SUBMIT PICKS ──────────────────────────────────────────────────────
-- Client transitions all their shortlisted picks → introduction_requested.
-- This is the "submit my pick list" action.
CREATE OR REPLACE FUNCTION public.client_submit_picks()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_client_id uuid;
  v_picks_count int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Resolve service-recipient client_id from authenticated user
  SELECT id INTO v_client_id
    FROM public.clients
   WHERE profile_id = v_user_id
   LIMIT 1;
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'No client record found for current user';
  END IF;

  -- Transition all shortlisted picks to introduction_requested
  UPDATE public.client_assistant_picks
     SET status       = 'introduction_requested',
         submitted_at = NOW(),
         updated_at   = NOW()
   WHERE client_id = v_client_id
     AND status    = 'shortlisted';

  GET DIAGNOSTICS v_picks_count = ROW_COUNT;

  IF v_picks_count = 0 THEN
    RAISE EXCEPTION 'No shortlisted picks to submit';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'submitted_count', v_picks_count,
    'submitted_at',    NOW()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.client_submit_picks() TO authenticated;

-- ─── RPC: ADMIN TRANSITION A PICK'S STATUS ──────────────────────────────────
-- Admin/owner moves a pick through the lifecycle (e.g., schedule the intro,
-- mark complete, mark engaged, decline). Optionally updates notes.
CREATE OR REPLACE FUNCTION public.admin_update_pick_status(
  p_pick_id    uuid,
  p_new_status text,
  p_notes      text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_caller_role text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT role::text INTO v_caller_role FROM public.profiles WHERE user_id = v_user_id;
  IF UPPER(COALESCE(v_caller_role, '')) NOT IN ('OWNER', 'ADMIN', 'SUPERADMIN') THEN
    RAISE EXCEPTION 'Forbidden — admin/owner role required (caller role: %)', v_caller_role;
  END IF;

  IF p_new_status NOT IN (
    'shortlisted', 'introduction_requested', 'meeting_scheduled',
    'meeting_complete', 'engaged', 'declined'
  ) THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status;
  END IF;

  UPDATE public.client_assistant_picks
     SET status     = p_new_status,
         notes      = COALESCE(p_notes, notes),
         updated_at = NOW()
   WHERE id = p_pick_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pick not found: %', p_pick_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'pick_id', p_pick_id,
    'new_status', p_new_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_pick_status(uuid, text, text) TO authenticated;

-- ─── VERIFICATION QUERY (run this last to confirm everything deployed) ──────
-- SELECT
--   (SELECT COUNT(*) FROM pg_policy WHERE polrelid = 'public.client_assistant_picks'::regclass) AS policy_count,
--   (SELECT proname FROM pg_proc WHERE proname = 'client_submit_picks') AS submit_rpc,
--   (SELECT proname FROM pg_proc WHERE proname = 'admin_update_pick_status') AS admin_rpc;
-- Expected: policy_count=6, submit_rpc='client_submit_picks', admin_rpc='admin_update_pick_status'
