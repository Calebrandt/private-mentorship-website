-- ─────────────────────────────────────────────────────────────────────────
-- Phase 18b.1: Private "internal notes" on lesson logs (assistant-only)
-- ─────────────────────────────────────────────────────────────────────────
-- Owner request: separate the "Plan for next session" (family-visible) from
-- the assistant's PRIVATE prep notes. The latter is the assistant's daily
-- prep tool — what to do next, what the student is struggling with, etc.
-- Family must NEVER be able to read this.
--
-- DESIGN: Separate table with RLS that has NO family/client policy. Only
-- staff + the assigned assistant can SELECT/INSERT/UPDATE. This is stronger
-- than column-level filtering because RLS column carve-outs are fragile.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.session_lesson_internal_notes (
  lesson_log_id   uuid PRIMARY KEY REFERENCES public.session_lesson_logs(id) ON DELETE CASCADE,
  body            text,
  updated_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_by      uuid REFERENCES auth.users(id)
);

ALTER TABLE public.session_lesson_internal_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internal_notes_admin_all ON public.session_lesson_internal_notes;
CREATE POLICY internal_notes_admin_all ON public.session_lesson_internal_notes
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS internal_notes_assistant_only ON public.session_lesson_internal_notes;
CREATE POLICY internal_notes_assistant_only ON public.session_lesson_internal_notes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.session_lesson_logs l
       WHERE l.id = session_lesson_internal_notes.lesson_log_id
         AND public.is_my_assistant_client(l.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.session_lesson_logs l
       WHERE l.id = session_lesson_internal_notes.lesson_log_id
         AND public.is_my_assistant_client(l.client_id)
    )
  );

-- Touch updated_at on UPDATE
CREATE OR REPLACE FUNCTION public.touch_lesson_internal_note_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_internal_note_touch ON public.session_lesson_internal_notes;
CREATE TRIGGER trg_internal_note_touch
  BEFORE UPDATE ON public.session_lesson_internal_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_lesson_internal_note_updated_at();

-- Verify
SELECT
  EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='session_lesson_internal_notes') AS table_exists,
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public' AND tablename='session_lesson_internal_notes') AS policy_count;
