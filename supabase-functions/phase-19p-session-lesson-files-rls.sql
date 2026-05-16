-- =============================================================
-- Phase 19p — session_lesson_files visible to families
-- =============================================================
-- Symptom (caught 2026-05-16): when Michael signed in and tried to
-- open a session's attached file from the Lesson Journal page, the
-- chip flipped to "Could not load files." The browser query was
--   SELECT id, file_name, storage_path FROM session_lesson_files
--    WHERE lesson_log_id = '<id>' AND deleted_at IS NULL;
-- which RLS silently filtered to zero rows for the family member
-- (the existing policy was assistant-only).
--
-- Storage bucket policies for 'lesson-files' already grant family
-- read access (Phase 18d). This commit grants the same access on
-- the metadata TABLE so the row is visible too.
-- =============================================================

DROP POLICY IF EXISTS "slf_select_family" ON public.session_lesson_files;

CREATE POLICY "slf_select_family" ON public.session_lesson_files
FOR SELECT TO authenticated
USING (
  -- Visible if the requesting user is on family_assignments for the
  -- client this lesson belongs to, OR is the client themselves
  -- (clients.profile_id = auth.uid()).
  EXISTS (
    SELECT 1
    FROM public.session_lesson_logs sll
    JOIN public.appointments a ON a.id = sll.appointment_id
    LEFT JOIN public.family_assignments fa
      ON fa.client_id = a.client_id AND fa.user_id = auth.uid()
    LEFT JOIN public.clients c
      ON c.id = a.client_id AND c.profile_id = auth.uid()
    WHERE sll.id = session_lesson_files.lesson_log_id
      AND (fa.user_id IS NOT NULL OR c.id IS NOT NULL)
  )
);

-- Verify
SELECT polname, polcmd FROM pg_policy
WHERE polrelid = 'public.session_lesson_files'::regclass
ORDER BY polname;
