-- ============================================================================
-- phase-19c12b-lesson-view-funding.sql
-- ----------------------------------------------------------------------------
-- Add appointments.funding_source + funding_note to the
-- v_appointment_with_lesson view so the lesson tracker can show which
-- sessions were bank-funded (and why).
--
-- DROP + CREATE because views can't add columns via CREATE OR REPLACE
-- if the column set changes.
-- ============================================================================

BEGIN;

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
  a.funding_source,                                     -- NEW (Phase 19c.12)
  a.funding_note,                                       -- NEW (Phase 19c.12)
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

COMMIT;
