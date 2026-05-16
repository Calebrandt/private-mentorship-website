-- =============================================================
-- Phase 19s — Appointments time-of-day timezone fix
-- =============================================================
-- Symptom (caught 2026-05-16): imported appointments display ~7
-- hours earlier than they actually happened. A 10:00 AM Pacific
-- session shows up as 3:00 AM. Root cause: the bulk-import script
-- treated Pacific local times as if they were UTC, so a row meant
-- to mean "10:00 Pacific" got stored as 2026-04-15T10:00:00Z. When
-- Pacific is PDT (UTC-7), JS renders that DB value as 3:00 AM PDT.
--
-- Strategy:
--   1. PREVIEW — list every appointment whose Pacific local hour
--      falls in the wee hours (00:00–06:59). For a childcare /
--      family-assistant business, these are virtually always the
--      broken imports, not legitimate pre-dawn sessions.
--   2. SHIFT — add 7 hours to starts_at + ends_at on those rows so
--      they land at their intended real-world times (07:00–13:59).
--   3. VERIFY — re-run the preview; should return zero rows.
--
-- IMPORTANT: This file is split into 4 sections. Run them ONE AT
-- A TIME, top to bottom. Do NOT paste the whole file at once.
-- Confirm the preview output looks like the broken imports before
-- running section 2 (the actual UPDATE).
-- =============================================================


-- ════════════════════════════════════════════════════════════
-- 1) PREVIEW — run this FIRST, alone
-- ════════════════════════════════════════════════════════════
-- Shows every row that would be shifted. The "would_become" column
-- should look like sensible session times (morning / midday Pacific).
-- If anything in here is genuinely a 3am session (e.g. some kind of
-- overnight care), do NOT run section 2 — message me and we'll
-- narrow the WHERE clause first.

SELECT
  a.id,
  COALESCE(c.full_name, '—')              AS client,
  a.starts_at                             AS current_utc,
  (a.starts_at AT TIME ZONE 'America/Vancouver')                            AS current_pacific,
  ((a.starts_at + INTERVAL '7 hours') AT TIME ZONE 'America/Vancouver')     AS would_become_pacific,
  a.duration_minutes,
  a.status,
  a.created_at
FROM public.appointments a
LEFT JOIN public.clients c ON c.id = a.client_id
WHERE EXTRACT(hour FROM a.starts_at AT TIME ZONE 'America/Vancouver') BETWEEN 0 AND 6
ORDER BY a.starts_at;


-- ════════════════════════════════════════════════════════════
-- 2) SHIFT — run AFTER confirming the preview looks correct
-- ════════════════════════════════════════════════════════════
-- Adds 7 hours to starts_at AND ends_at on every matching row.
-- The WHERE clause means re-running this is a no-op (already-correct
-- rows have hour > 6 and won't be re-matched).
--
-- Returns the count of rows updated so you can sanity-check against
-- the preview count.

WITH shifted AS (
  UPDATE public.appointments
  SET starts_at = starts_at + INTERVAL '7 hours',
      ends_at   = COALESCE(ends_at, starts_at + (duration_minutes || ' minutes')::interval)
                  + INTERVAL '7 hours'
  WHERE EXTRACT(hour FROM starts_at AT TIME ZONE 'America/Vancouver') BETWEEN 0 AND 6
  RETURNING id
)
SELECT COUNT(*) AS rows_shifted FROM shifted;


-- ════════════════════════════════════════════════════════════
-- 3) VERIFY — should return 0 after section 2
-- ════════════════════════════════════════════════════════════
-- If this returns 0, the fix worked end-to-end.
-- If > 0, those rows were either created after the shift (unlikely)
-- OR are genuine pre-dawn sessions that the heuristic caught.

SELECT
  COUNT(*) AS remaining_wee_hours,
  MIN(starts_at AT TIME ZONE 'America/Vancouver') AS earliest_pacific,
  MAX(starts_at AT TIME ZONE 'America/Vancouver') AS latest_pacific
FROM public.appointments
WHERE EXTRACT(hour FROM starts_at AT TIME ZONE 'America/Vancouver') BETWEEN 0 AND 6;


-- ════════════════════════════════════════════════════════════
-- 4) SPOT-CHECK — visually confirm the three real families
-- ════════════════════════════════════════════════════════════
-- After the fix, this should show sensible Pacific session times
-- for Michael / Daniel / Ryan. Adjust the name filter if needed.

SELECT
  c.full_name,
  TO_CHAR(a.starts_at AT TIME ZONE 'America/Vancouver', 'YYYY-MM-DD Dy HH24:MI') AS pacific_when,
  a.duration_minutes                                                              AS dur_min,
  a.status
FROM public.appointments a
JOIN public.clients c ON c.id = a.client_id
WHERE c.full_name ILIKE ANY (ARRAY['%michael%','%daniel%','%ryan%'])
ORDER BY c.full_name, a.starts_at DESC
LIMIT 30;
