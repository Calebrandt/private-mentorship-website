-- ─────────────────────────────────────────────────────────────────────────
-- Phase 18a: Lesson Tracker — SQL foundation
-- ─────────────────────────────────────────────────────────────────────────
-- The assistant writes a journal entry after each session: what was the
-- focus, key concepts, how engaged was the student, attached files,
-- supporting URLs, feedback, star rating, next-session notes. Family
-- reads it (with optional file uploads from their side later).
--
-- Mirrors what the owner has been doing in Google Sheets for years.
--
-- TWO TABLES:
--   session_lesson_logs   — one row per appointment (1:1 with appointments)
--   session_lesson_files  — many rows per log (files + URL links)
--
-- PERMISSIONS:
--   - Admin/owner: all
--   - Assistant assigned to the client: full CRUD on logs + files
--   - Family member (OWNER in family_assignments): SELECT on logs + files,
--     INSERT files only (can add their own materials but never edit/delete
--     the assistant's records)
--   - Nobody can DELETE logs hard — files use soft-delete via deleted_at
--
-- DESIGN NOTES:
--   - status_label and type_label are free text. UI shows a dropdown of
--     common values (engaging / low_energy / low_effort / in_progress /
--     needs_improvement / completed) but allows custom.
--   - rating is 0-5 (0 = ☆☆☆☆☆, 5 = ★★★★★).
--   - session_lesson_files.kind = 'file' | 'url'. For 'file', use
--     storage_path. For 'url', use external_url.
--   - File deletes are soft (deleted_at + deleted_by) so audit trail
--     stays intact.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────


-- ─── 1. session_lesson_logs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_lesson_logs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id      uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  client_id           uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  assistant_id        uuid REFERENCES auth.users(id),

  -- The session description (the bread and butter)
  focus_area          text,                 -- "Life Skill Focus Area"
  key_concepts        text,                 -- "Key Concepts Covered"
  status_label        text,                 -- 'engaging' | 'low_energy' | 'low_effort' | 'in_progress' | 'needs_improvement' | 'completed' (free text)
  type_label          text,                 -- 'social_engagement' | 'gym_session' | 'life_skills_task' | 'independent_task' | 'setback' | etc.
  next_session_notes  text,                 -- what to do/prep next time
  feedback            text,                 -- "Great work today Michael!"
  rating              int CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),

  -- Audit
  created_at          timestamptz NOT NULL DEFAULT NOW(),
  updated_at          timestamptz NOT NULL DEFAULT NOW(),
  created_by          uuid REFERENCES auth.users(id),
  updated_by          uuid REFERENCES auth.users(id),

  CONSTRAINT lesson_logs_one_per_appointment UNIQUE (appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_logs_client ON public.session_lesson_logs (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_logs_assistant ON public.session_lesson_logs (assistant_id, created_at DESC);

-- Auto-update updated_at on edits
CREATE OR REPLACE FUNCTION public.touch_lesson_log_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_lesson_log_touch_updated ON public.session_lesson_logs;
CREATE TRIGGER trg_lesson_log_touch_updated
  BEFORE UPDATE ON public.session_lesson_logs
  FOR EACH ROW EXECUTE FUNCTION public.touch_lesson_log_updated_at();


-- ─── 2. session_lesson_files ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_lesson_files (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_log_id       uuid NOT NULL REFERENCES public.session_lesson_logs(id) ON DELETE CASCADE,

  kind                text NOT NULL CHECK (kind IN ('file', 'url')),
  display_name        text NOT NULL,         -- shown in UI; for files = filename, for URLs = link label
  storage_path        text,                  -- supabase storage object key (only for kind='file')
  external_url        text,                  -- the URL (only for kind='url')
  mime_type           text,                  -- for files
  size_bytes          bigint,                -- for files
  description         text,                  -- optional caption / note

  -- Who uploaded
  uploaded_by         uuid REFERENCES auth.users(id),
  uploaded_at         timestamptz NOT NULL DEFAULT NOW(),
  uploaded_by_role    text NOT NULL DEFAULT 'assistant' CHECK (uploaded_by_role IN ('assistant','family','admin')),

  -- Soft delete (audit trail preserved)
  deleted_at          timestamptz,
  deleted_by          uuid REFERENCES auth.users(id),

  CONSTRAINT lesson_files_kind_consistency CHECK (
    (kind = 'file' AND storage_path IS NOT NULL)
    OR
    (kind = 'url' AND external_url IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_lesson_files_log ON public.session_lesson_files (lesson_log_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_lesson_files_active ON public.session_lesson_files (lesson_log_id) WHERE deleted_at IS NULL;


-- ─── 3. RLS — session_lesson_logs ───────────────────────────────────────
ALTER TABLE public.session_lesson_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lesson_logs_admin_all ON public.session_lesson_logs;
CREATE POLICY lesson_logs_admin_all ON public.session_lesson_logs
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS lesson_logs_assistant_crud ON public.session_lesson_logs;
CREATE POLICY lesson_logs_assistant_crud ON public.session_lesson_logs
  FOR ALL TO authenticated
  USING (public.is_my_assistant_client(client_id))
  WITH CHECK (public.is_my_assistant_client(client_id));

DROP POLICY IF EXISTS lesson_logs_family_select ON public.session_lesson_logs;
CREATE POLICY lesson_logs_family_select ON public.session_lesson_logs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = session_lesson_logs.client_id AND c.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.family_assignments fa
      WHERE fa.client_id = session_lesson_logs.client_id
        AND fa.user_id = auth.uid()
        AND fa.role = 'OWNER'
    )
  );


-- ─── 4. RLS — session_lesson_files ──────────────────────────────────────
ALTER TABLE public.session_lesson_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lesson_files_admin_all ON public.session_lesson_files;
CREATE POLICY lesson_files_admin_all ON public.session_lesson_files
  FOR ALL TO authenticated
  USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS lesson_files_assistant_crud ON public.session_lesson_files;
CREATE POLICY lesson_files_assistant_crud ON public.session_lesson_files
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.session_lesson_logs l
      WHERE l.id = session_lesson_files.lesson_log_id
        AND public.is_my_assistant_client(l.client_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.session_lesson_logs l
      WHERE l.id = session_lesson_files.lesson_log_id
        AND public.is_my_assistant_client(l.client_id)
    )
  );

-- Family can SELECT files
DROP POLICY IF EXISTS lesson_files_family_select ON public.session_lesson_files;
CREATE POLICY lesson_files_family_select ON public.session_lesson_files
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.session_lesson_logs l
      JOIN public.clients c ON c.id = l.client_id
      WHERE l.id = session_lesson_files.lesson_log_id
        AND (c.profile_id = auth.uid()
             OR EXISTS (
               SELECT 1 FROM public.family_assignments fa
               WHERE fa.client_id = c.id AND fa.user_id = auth.uid() AND fa.role = 'OWNER'
             ))
    )
  );

-- Family can INSERT files (their own materials), but only with uploaded_by_role='family'
DROP POLICY IF EXISTS lesson_files_family_insert ON public.session_lesson_files;
CREATE POLICY lesson_files_family_insert ON public.session_lesson_files
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by_role = 'family'
    AND uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.session_lesson_logs l
      JOIN public.clients c ON c.id = l.client_id
      WHERE l.id = session_lesson_files.lesson_log_id
        AND (c.profile_id = auth.uid()
             OR EXISTS (
               SELECT 1 FROM public.family_assignments fa
               WHERE fa.client_id = c.id AND fa.user_id = auth.uid() AND fa.role = 'OWNER'
             ))
    )
  );

-- Family can soft-delete files THEY uploaded (UPDATE deleted_at)
DROP POLICY IF EXISTS lesson_files_family_update_own ON public.session_lesson_files;
CREATE POLICY lesson_files_family_update_own ON public.session_lesson_files
  FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid() AND uploaded_by_role = 'family')
  WITH CHECK (uploaded_by = auth.uid() AND uploaded_by_role = 'family');


-- ─── 5. Convenience view: appointments + their lesson log + file count ──
CREATE OR REPLACE VIEW public.v_appointment_with_lesson AS
SELECT
  a.id                        AS appointment_id,
  a.client_id,
  a.contract_id,
  a.assistant_id,
  a.starts_at,
  a.ends_at,
  a.duration_minutes,
  a.status                    AS appointment_status,
  a.title                     AS appointment_title,
  a.is_complimentary,
  l.id                        AS lesson_log_id,
  l.focus_area,
  l.key_concepts,
  l.status_label,
  l.type_label,
  l.next_session_notes,
  l.feedback,
  l.rating,
  l.created_at                AS lesson_logged_at,
  l.updated_at                AS lesson_last_edited_at,
  COALESCE(file_counts.active_file_count, 0) AS active_file_count
FROM public.appointments a
LEFT JOIN public.session_lesson_logs l ON l.appointment_id = a.id
LEFT JOIN (
  SELECT lesson_log_id, COUNT(*)::int AS active_file_count
    FROM public.session_lesson_files
   WHERE deleted_at IS NULL
   GROUP BY lesson_log_id
) file_counts ON file_counts.lesson_log_id = l.id;

GRANT SELECT ON public.v_appointment_with_lesson TO authenticated;


-- ─── 6. Verification ────────────────────────────────────────────────────
SELECT
  (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename='session_lesson_logs')  AS logs_table_exists,
  (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename='session_lesson_files') AS files_table_exists,
  (SELECT COUNT(*) FROM pg_views  WHERE schemaname='public' AND viewname='v_appointment_with_lesson') AS view_exists,
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public' AND tablename='session_lesson_logs')  AS logs_policy_count,
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public' AND tablename='session_lesson_files') AS files_policy_count;
