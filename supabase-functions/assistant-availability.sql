-- ─────────────────────────────────────────────────────────────────────────
-- Phase 5: Assistant availability windows
-- ─────────────────────────────────────────────────────────────────────────
-- Two tables (recurring windows + blackouts) plus a SECURITY DEFINER helper
-- that answers: "is this assistant available at this time?" The helper is
-- callable from RPCs that enforce booking constraints later (Phase 5.5+).
-- For now, the helper is unused on the write path — the UI shows a warning
-- but doesn't block requests. We add hard enforcement once we've watched
-- the soft pattern for a week or two.
--
-- Design:
--   • assistant_availability_windows = weekly recurring time blocks
--       weekday (0=Sun..6=Sat) + start_time + end_time
--       optional active_from / active_until bounds (for "from Aug 1"
--       or "until I take parental leave")
--   • assistant_availability_blackouts = date-range exceptions
--       (vacations, sick days, etc.)
--
-- RLS:
--   • assistants read/write their OWN rows (assistant_id = auth.uid())
--   • staff (admin) read/write everything (uses existing is_staff())
--
-- Safe to re-run (uses CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS).
-- ─────────────────────────────────────────────────────────────────────────


-- ─── TABLE 1: Recurring weekly availability windows ──────────────────────
CREATE TABLE IF NOT EXISTS public.assistant_availability_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assistant_id uuid NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  active_from date,
  active_until date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CONSTRAINT availability_end_after_start CHECK (end_time > start_time),
  CONSTRAINT availability_active_range CHECK (
    active_from IS NULL OR active_until IS NULL OR active_until >= active_from
  )
);

CREATE INDEX IF NOT EXISTS idx_avail_windows_assistant
  ON public.assistant_availability_windows (assistant_id, weekday);

ALTER TABLE public.assistant_availability_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS avail_windows_assistant_select_own ON public.assistant_availability_windows;
CREATE POLICY avail_windows_assistant_select_own
  ON public.assistant_availability_windows FOR SELECT TO authenticated
  USING (assistant_id = auth.uid() OR public.is_staff());

DROP POLICY IF EXISTS avail_windows_assistant_insert_own ON public.assistant_availability_windows;
CREATE POLICY avail_windows_assistant_insert_own
  ON public.assistant_availability_windows FOR INSERT TO authenticated
  WITH CHECK (assistant_id = auth.uid() OR public.is_staff());

DROP POLICY IF EXISTS avail_windows_assistant_update_own ON public.assistant_availability_windows;
CREATE POLICY avail_windows_assistant_update_own
  ON public.assistant_availability_windows FOR UPDATE TO authenticated
  USING (assistant_id = auth.uid() OR public.is_staff())
  WITH CHECK (assistant_id = auth.uid() OR public.is_staff());

DROP POLICY IF EXISTS avail_windows_assistant_delete_own ON public.assistant_availability_windows;
CREATE POLICY avail_windows_assistant_delete_own
  ON public.assistant_availability_windows FOR DELETE TO authenticated
  USING (assistant_id = auth.uid() OR public.is_staff());


-- ─── TABLE 2: Date-range blackouts (vacations, sick days, etc.) ──────────
CREATE TABLE IF NOT EXISTS public.assistant_availability_blackouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assistant_id uuid NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CONSTRAINT blackout_end_on_or_after_start CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_avail_blackouts_assistant
  ON public.assistant_availability_blackouts (assistant_id, starts_on);

ALTER TABLE public.assistant_availability_blackouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS avail_blackouts_assistant_select_own ON public.assistant_availability_blackouts;
CREATE POLICY avail_blackouts_assistant_select_own
  ON public.assistant_availability_blackouts FOR SELECT TO authenticated
  USING (assistant_id = auth.uid() OR public.is_staff());

DROP POLICY IF EXISTS avail_blackouts_assistant_insert_own ON public.assistant_availability_blackouts;
CREATE POLICY avail_blackouts_assistant_insert_own
  ON public.assistant_availability_blackouts FOR INSERT TO authenticated
  WITH CHECK (assistant_id = auth.uid() OR public.is_staff());

DROP POLICY IF EXISTS avail_blackouts_assistant_update_own ON public.assistant_availability_blackouts;
CREATE POLICY avail_blackouts_assistant_update_own
  ON public.assistant_availability_blackouts FOR UPDATE TO authenticated
  USING (assistant_id = auth.uid() OR public.is_staff())
  WITH CHECK (assistant_id = auth.uid() OR public.is_staff());

DROP POLICY IF EXISTS avail_blackouts_assistant_delete_own ON public.assistant_availability_blackouts;
CREATE POLICY avail_blackouts_assistant_delete_own
  ON public.assistant_availability_blackouts FOR DELETE TO authenticated
  USING (assistant_id = auth.uid() OR public.is_staff());


-- ─── HELPER: is_assistant_available_at ───────────────────────────────────
-- Answers: "is this assistant available for an appointment of this length
-- starting at this UTC timestamp?"
--
-- Logic:
--   • Convert timestamp to assistant's local day-of-week + local time
--     (the conversion uses America/Vancouver — adjust later if assistants
--     are in other zones; the business is BC-centric for now)
--   • Walk recurring windows: at least one must contain the whole slot
--   • Walk blackouts: NONE must cover the local date
--
-- SECURITY DEFINER so RPCs in other functions can call it without RLS
-- worries about reading another assistant's availability rows. Returns
-- TRUE if no availability data exists at all (we default to "available"
-- rather than "blocked" until the assistant has published windows — same
-- pattern as the soft-launch UX).

CREATE OR REPLACE FUNCTION public.is_assistant_available_at(
  p_assistant_id uuid,
  p_starts_at timestamptz,
  p_duration_minutes int
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_local_start timestamp;
  v_local_end   timestamp;
  v_local_date  date;
  v_weekday     int;
  v_start_time  time;
  v_end_time    time;
  v_window_count int;
  v_matching_window int;
  v_blocking_blackout int;
BEGIN
  IF p_assistant_id IS NULL OR p_starts_at IS NULL OR p_duration_minutes IS NULL THEN
    RETURN false;
  END IF;

  -- Convert to Vancouver local time
  v_local_start := (p_starts_at AT TIME ZONE 'America/Vancouver');
  v_local_end   := (p_starts_at + (p_duration_minutes || ' minutes')::interval)
                   AT TIME ZONE 'America/Vancouver';
  v_local_date  := v_local_start::date;
  v_weekday     := EXTRACT(DOW FROM v_local_start)::int; -- 0=Sun..6=Sat
  v_start_time  := v_local_start::time;
  v_end_time    := v_local_end::time;

  -- If the assistant hasn't published ANY availability at all, default to
  -- "available" — so the soft-launch UX still works.
  SELECT COUNT(*) INTO v_window_count
   FROM public.assistant_availability_windows
   WHERE assistant_id = p_assistant_id;
  IF v_window_count = 0 THEN
    -- still respect blackouts though
    SELECT COUNT(*) INTO v_blocking_blackout
     FROM public.assistant_availability_blackouts
     WHERE assistant_id = p_assistant_id
       AND v_local_date BETWEEN starts_on AND ends_on;
    RETURN v_blocking_blackout = 0;
  END IF;

  -- Otherwise check windows: need at least one that fully contains the slot.
  SELECT COUNT(*) INTO v_matching_window
   FROM public.assistant_availability_windows
   WHERE assistant_id = p_assistant_id
     AND weekday = v_weekday
     AND start_time <= v_start_time
     AND end_time   >= v_end_time
     AND (active_from  IS NULL OR active_from  <= v_local_date)
     AND (active_until IS NULL OR active_until >= v_local_date);
  IF v_matching_window = 0 THEN
    RETURN false;
  END IF;

  -- And no blackout covers the day.
  SELECT COUNT(*) INTO v_blocking_blackout
   FROM public.assistant_availability_blackouts
   WHERE assistant_id = p_assistant_id
     AND v_local_date BETWEEN starts_on AND ends_on;
  RETURN v_blocking_blackout = 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_assistant_available_at(uuid, timestamptz, int) TO authenticated;
