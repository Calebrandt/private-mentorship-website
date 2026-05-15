-- ─────────────────────────────────────────────────────────────────────────
-- Drop stale FK: schedule_change_requests.assistant_id → public.users(id)
-- ─────────────────────────────────────────────────────────────────────────
-- Background:
--   public.users is the legacy user table from the original app (role check
--   constrained to 'admin' / 'assistant' / 'parent' — lowercase, pre-migration).
--   Modern code resolves assistant identity via profiles.user_id tied to
--   auth.uid(). Every newer table that has an assistant_id column (appointments,
--   contracts) intentionally has NO FK on it. schedule_change_requests was
--   created earlier and kept its legacy FK to public.users, which now breaks
--   any insert whose assistant_id is an auth.uid() that doesn't happen to
--   exist in public.users.
--
-- Discovered: an assistant-side reschedule request submission failed with
--   ERROR: insert or update on table "schedule_change_requests" violates
--   foreign key constraint "schedule_change_requests_assistant_id_fkey"
--
-- This affects the client-side flow too (latent — no real client requests
-- have been filed yet against assistants whose user_id isn't in public.users).
--
-- Fix: drop the FK. assistant_id remains a uuid column.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.schedule_change_requests
  DROP CONSTRAINT IF EXISTS schedule_change_requests_assistant_id_fkey;

-- Note: assistants_clients.assistant_id has the same stale FK to public.users.
-- Not dropping that one in this migration — that table may still be in active
-- use and needs its own audit before changing constraints. Left as a known
-- carry-forward item; if you ever populate that table via the modern flow,
-- it'll likely need the same treatment.
