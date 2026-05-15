-- ─────────────────────────────────────────────────────────────────────────
-- Phase 8: Multi-timezone support for assistant availability
-- ─────────────────────────────────────────────────────────────────────────
-- Today is_assistant_available_at() hardcodes America/Vancouver. Works
-- fine while every assistant is in BC. The moment someone gets hired in
-- Toronto, Calgary, or anywhere outside Pacific time, their published
-- 9am window gets read as Pacific 9am — which is 12pm in Toronto. Slot
-- proposals fall outside availability for the wrong reason.
--
-- Fix: store each assistant's timezone (default America/Vancouver) and
-- have the helper read it.
--
-- Where to store: assistant_profiles is the right table — it's the
-- per-assistant settings table and already has assistant_id PK matching
-- auth.uid().
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Add timezone column to assistant_profiles
ALTER TABLE public.assistant_profiles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Vancouver';

-- Optional constraint: only allow valid IANA names. Postgres has no
-- bulletproof way to validate without trying it; rely on app-side validation.
-- (No constraint added — assistants pick from a curated list in the UI.)


-- 2) Replace the helper with the timezone-aware version
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
  v_tz text;
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

  -- Resolve the assistant's timezone; fall back to Vancouver.
  SELECT COALESCE(NULLIF(TRIM(timezone), ''), 'America/Vancouver')
    INTO v_tz
    FROM public.assistant_profiles
   WHERE assistant_id = p_assistant_id;
  IF v_tz IS NULL THEN
    v_tz := 'America/Vancouver';
  END IF;

  v_local_start := (p_starts_at AT TIME ZONE v_tz);
  v_local_end   := (p_starts_at + (p_duration_minutes || ' minutes')::interval) AT TIME ZONE v_tz;
  v_local_date  := v_local_start::date;
  v_weekday     := EXTRACT(DOW FROM v_local_start)::int;
  v_start_time  := v_local_start::time;
  v_end_time    := v_local_end::time;

  SELECT COUNT(*) INTO v_window_count
   FROM public.assistant_availability_windows
   WHERE assistant_id = p_assistant_id;
  IF v_window_count = 0 THEN
    SELECT COUNT(*) INTO v_blocking_blackout
     FROM public.assistant_availability_blackouts
     WHERE assistant_id = p_assistant_id
       AND v_local_date BETWEEN starts_on AND ends_on;
    RETURN v_blocking_blackout = 0;
  END IF;

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

  SELECT COUNT(*) INTO v_blocking_blackout
   FROM public.assistant_availability_blackouts
   WHERE assistant_id = p_assistant_id
     AND v_local_date BETWEEN starts_on AND ends_on;
  RETURN v_blocking_blackout = 0;
END;
$$;
GRANT EXECUTE ON FUNCTION public.is_assistant_available_at(uuid, timestamptz, int) TO authenticated;
