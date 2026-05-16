-- ─────────────────────────────────────────────────────────────────────────
-- Phase 18a.1: Lesson Tracker — denormalized "signature" fields
-- ─────────────────────────────────────────────────────────────────────────
-- Owner flag: "I have a feeling over time you'll see different names
-- working with the same family from the transition of an older assistant
-- to a new one. The lesson doesn't have a way to show who taught it."
--
-- The tables already track assistant_id / uploaded_by (uuid → auth.users).
-- But uuid → name resolution is fragile across time:
--   - assistant leaves the system → their profile may be archived/deleted
--   - assistant renames themselves later → historical records change name
--   - admin needs to see "Tom taught session X" even years later
--
-- Fix: denormalized snapshot of the name AT TIME OF WRITE. Captured by the
-- JS service layer when the row is inserted (the SQL-side trigger fallback
-- below pulls from profiles if the service forgets to set it).
--
-- Safe to re-run. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────


-- ─── 1. ALTER tables to add display-name snapshot columns ────────────────
ALTER TABLE public.session_lesson_logs
  ADD COLUMN IF NOT EXISTS assistant_display_name text;

ALTER TABLE public.session_lesson_files
  ADD COLUMN IF NOT EXISTS uploaded_by_display_name text;


-- ─── 2. Fallback trigger: if service forgets, fill from profiles ─────────
-- Belt-and-suspenders. If a UI inserts a log without setting
-- assistant_display_name, the trigger looks up the assistant_id's
-- profiles.full_name and snapshots it. Same for file uploads.
CREATE OR REPLACE FUNCTION public.lesson_log_snapshot_assistant_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.assistant_display_name IS NULL AND NEW.assistant_id IS NOT NULL THEN
    SELECT full_name INTO NEW.assistant_display_name
      FROM public.profiles WHERE user_id = NEW.assistant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lesson_log_snapshot_name ON public.session_lesson_logs;
CREATE TRIGGER trg_lesson_log_snapshot_name
  BEFORE INSERT OR UPDATE OF assistant_id ON public.session_lesson_logs
  FOR EACH ROW EXECUTE FUNCTION public.lesson_log_snapshot_assistant_name();


CREATE OR REPLACE FUNCTION public.lesson_file_snapshot_uploader_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.uploaded_by_display_name IS NULL AND NEW.uploaded_by IS NOT NULL THEN
    SELECT full_name INTO NEW.uploaded_by_display_name
      FROM public.profiles WHERE user_id = NEW.uploaded_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lesson_file_snapshot_name ON public.session_lesson_files;
CREATE TRIGGER trg_lesson_file_snapshot_name
  BEFORE INSERT OR UPDATE OF uploaded_by ON public.session_lesson_files
  FOR EACH ROW EXECUTE FUNCTION public.lesson_file_snapshot_uploader_name();


-- ─── 3. Update the convenience view to expose the snapshot names ────────
-- DROP + CREATE because CREATE OR REPLACE can't rename existing columns
-- (we're renaming assistant_id → appointment_assistant_id to clarify which
-- assistant is which, plus adding new columns).
DROP VIEW IF EXISTS public.v_appointment_with_lesson;
CREATE VIEW public.v_appointment_with_lesson AS
SELECT
  a.id                        AS appointment_id,
  a.client_id,
  a.contract_id,
  a.assistant_id              AS appointment_assistant_id,
  a.starts_at,
  a.ends_at,
  a.duration_minutes,
  a.status                    AS appointment_status,
  a.title                     AS appointment_title,
  a.is_complimentary,
  l.id                        AS lesson_log_id,
  l.assistant_id              AS lesson_assistant_id,
  l.assistant_display_name    AS lesson_assistant_name,
  l.focus_area,
  l.key_concepts,
  l.status_label,
  l.type_label,
  l.next_session_notes,
  l.feedback,
  l.rating,
  l.created_at                AS lesson_logged_at,
  l.updated_at                AS lesson_last_edited_at,
  COALESCE(file_counts.active_file_count, 0) AS active_file_count,
  -- "Different assistant taught this than the one originally scheduled" flag
  (l.assistant_id IS NOT NULL
   AND a.assistant_id IS NOT NULL
   AND l.assistant_id <> a.assistant_id) AS taught_by_substitute
FROM public.appointments a
LEFT JOIN public.session_lesson_logs l ON l.appointment_id = a.id
LEFT JOIN (
  SELECT lesson_log_id, COUNT(*)::int AS active_file_count
    FROM public.session_lesson_files
   WHERE deleted_at IS NULL
   GROUP BY lesson_log_id
) file_counts ON file_counts.lesson_log_id = l.id;

GRANT SELECT ON public.v_appointment_with_lesson TO authenticated;


-- ─── 4. Verification ────────────────────────────────────────────────────
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='session_lesson_logs'
             AND column_name='assistant_display_name') AS logs_has_name_col,
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='session_lesson_files'
             AND column_name='uploaded_by_display_name') AS files_has_name_col,
  EXISTS (SELECT 1 FROM pg_trigger
           WHERE tgname='trg_lesson_log_snapshot_name') AS log_trigger_installed,
  EXISTS (SELECT 1 FROM pg_trigger
           WHERE tgname='trg_lesson_file_snapshot_name') AS file_trigger_installed,
  EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_schema='public' AND table_name='v_appointment_with_lesson'
             AND column_name='taught_by_substitute') AS view_has_substitute_flag;
