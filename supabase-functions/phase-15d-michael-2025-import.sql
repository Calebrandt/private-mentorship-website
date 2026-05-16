-- ─────────────────────────────────────────────────────────────────────────
-- Phase 15d: Michael Yang 2025 historical backfill (12 contracts, 89 sessions)
-- ─────────────────────────────────────────────────────────────────────────
-- Purpose: documentation / history view. The owner asked: "lots of clients
-- stay here so it would be cool. If like the information people could check
-- like clients and Assistants they could check different years cause even in
-- my Google sheets I have like 2025 2026."
--
-- This loads all of 2025 so the assistant + family year-switcher UI (Phase
-- 17.5) has real data to show.
--
-- OWNER DECISIONS (recorded in chat):
--   - Jan + Feb 2025: Michael on vacation in China → empty contracts
--   - Feb 2025 was a different 24hr plan (the rest are 40hr/month)
--   - Mar 2025: 1 Academic Session
--   - Apr 2025: All Gym Sessions
--   - May 2025+: Life Skills (with occasional Independent Work, Gym mix)
--   - "Independent Work" sessions: bucket as Life Skills service_type
--   - Skip all cancellations/missed appointments (owner: "don't worry
--     too much about putting that into there")
--   - Skip Dec 2025 sessions (just cancellations + reschedules)
--
-- CONTRACT DATES:
--   Using calendar-month boundaries (Jan 1 → Jan 31, Feb 1 → Feb 28, etc.)
--   for clean import. Doesn't precisely match real renewal dates but works
--   for historical browsing.
--
-- BANK: Not touched. Already correctly seeded to 25 hrs by Phase 15b
--   representing all-time accumulated savings.
--
-- SAFETY:
--   - Transaction-wrapped. Any error rolls back the whole block.
--   - Requires Michael's client row to already exist (created in Phase 15b).
--   - Uses 'reserved' kind for all 2025 sessions for clean display.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  v_client_id   uuid;
  v_caleb_user  uuid := '9b7b4106-1914-4062-818d-3074a0d2f7ff';
  v_tz          text := 'America/Vancouver';
  v_meta_base   jsonb := jsonb_build_object('source','phase-15d-michael-2025-import','imported_at', NOW());

  c_jan uuid := gen_random_uuid();
  c_feb uuid := gen_random_uuid();
  c_mar uuid := gen_random_uuid();
  c_apr uuid := gen_random_uuid();
  c_may uuid := gen_random_uuid();
  c_jun uuid := gen_random_uuid();
  c_jul uuid := gen_random_uuid();
  c_aug uuid := gen_random_uuid();
  c_sep uuid := gen_random_uuid();
  c_oct uuid := gen_random_uuid();
  c_nov uuid := gen_random_uuid();
  c_dec uuid := gen_random_uuid();
BEGIN

  -- Find Michael's existing client_id (created in Phase 15b)
  SELECT id INTO v_client_id FROM public.clients WHERE full_name = 'Michael Yang' LIMIT 1;
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Michael Yang client row not found. Run Phase 15b first.';
  END IF;

  -- ─── 12 EXPIRED CONTRACTS (Jan–Dec 2025) ────────────────────────────
  -- All 40hr/month except Feb 2025 (24hr plan during vacation period).
  INSERT INTO public.contracts
    (id, client_id, status, start_at, end_at, included_minutes,
     assistant_id, assistant_name, renewal_mode, created_by, activated_at, notes)
  VALUES
    (c_jan, v_client_id, 'expired', TIMESTAMP '2025-01-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-01-31 23:59:59' AT TIME ZONE v_tz, 2400, v_caleb_user, 'Caleb Brandt', 'auto', v_caleb_user, TIMESTAMP '2025-01-01 00:00:00' AT TIME ZONE v_tz, 'Michael on vacation in China — no sessions'),
    (c_feb, v_client_id, 'expired', TIMESTAMP '2025-02-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-02-28 23:59:59' AT TIME ZONE v_tz, 1440, v_caleb_user, 'Caleb Brandt', 'auto', v_caleb_user, TIMESTAMP '2025-02-01 00:00:00' AT TIME ZONE v_tz, 'Vacation continues — switched to 24-hour plan that month'),
    (c_mar, v_client_id, 'expired', TIMESTAMP '2025-03-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-03-31 23:59:59' AT TIME ZONE v_tz, 2400, v_caleb_user, 'Caleb Brandt', 'auto', v_caleb_user, TIMESTAMP '2025-03-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (c_apr, v_client_id, 'expired', TIMESTAMP '2025-04-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-04-30 23:59:59' AT TIME ZONE v_tz, 2400, v_caleb_user, 'Caleb Brandt', 'auto', v_caleb_user, TIMESTAMP '2025-04-01 00:00:00' AT TIME ZONE v_tz, 'All Gym Sessions this month'),
    (c_may, v_client_id, 'expired', TIMESTAMP '2025-05-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-05-31 23:59:59' AT TIME ZONE v_tz, 2400, v_caleb_user, 'Caleb Brandt', 'auto', v_caleb_user, TIMESTAMP '2025-05-01 00:00:00' AT TIME ZONE v_tz, 'Mix of Gym, Life Skills, and Independent Work'),
    (c_jun, v_client_id, 'expired', TIMESTAMP '2025-06-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-30 23:59:59' AT TIME ZONE v_tz, 2400, v_caleb_user, 'Caleb Brandt', 'auto', v_caleb_user, TIMESTAMP '2025-06-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (c_jul, v_client_id, 'expired', TIMESTAMP '2025-07-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-31 23:59:59' AT TIME ZONE v_tz, 2400, v_caleb_user, 'Caleb Brandt', 'auto', v_caleb_user, TIMESTAMP '2025-07-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (c_aug, v_client_id, 'expired', TIMESTAMP '2025-08-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-08-31 23:59:59' AT TIME ZONE v_tz, 2400, v_caleb_user, 'Caleb Brandt', 'auto', v_caleb_user, TIMESTAMP '2025-08-01 00:00:00' AT TIME ZONE v_tz, 'Included several long sessions (6-9 hours)'),
    (c_sep, v_client_id, 'expired', TIMESTAMP '2025-09-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-09-30 23:59:59' AT TIME ZONE v_tz, 2400, v_caleb_user, 'Caleb Brandt', 'auto', v_caleb_user, TIMESTAMP '2025-09-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (c_oct, v_client_id, 'expired', TIMESTAMP '2025-10-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-31 23:59:59' AT TIME ZONE v_tz, 2400, v_caleb_user, 'Caleb Brandt', 'auto', v_caleb_user, TIMESTAMP '2025-10-01 00:00:00' AT TIME ZONE v_tz, '6 cancellations during this month (not imported)'),
    (c_nov, v_client_id, 'expired', TIMESTAMP '2025-11-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-11-30 23:59:59' AT TIME ZONE v_tz, 2400, v_caleb_user, 'Caleb Brandt', 'auto', v_caleb_user, TIMESTAMP '2025-11-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (c_dec, v_client_id, 'expired', TIMESTAMP '2025-12-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-12-31 23:59:59' AT TIME ZONE v_tz, 2400, v_caleb_user, 'Caleb Brandt', 'auto', v_caleb_user, TIMESTAMP '2025-12-01 00:00:00' AT TIME ZONE v_tz, 'Period of cancellations + reschedules — no completed sessions');

  -- ─── 89 APPOINTMENTS (all status='completed', kind='reserved') ───────
  INSERT INTO public.appointments
    (client_id, contract_id, assistant_id, kind, status, starts_at, ends_at, duration_minutes, title, created_by, updated_at)
  VALUES
    -- MAR 2025 (1 session, Academic)
    (v_client_id, c_mar, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-03-25 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-03-25 13:00:00' AT TIME ZONE v_tz, 180, 'Academic Session', v_caleb_user, NOW()),

    -- APR 2025 (8 Gym Sessions)
    (v_client_id, c_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-04-02 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-04-02 13:00:00' AT TIME ZONE v_tz, 180, 'Gym Session', v_caleb_user, NOW()),
    (v_client_id, c_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-04-03 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-04-03 13:00:00' AT TIME ZONE v_tz, 180, 'Gym Session', v_caleb_user, NOW()),
    (v_client_id, c_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-04-08 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-04-08 13:00:00' AT TIME ZONE v_tz, 180, 'Gym Session', v_caleb_user, NOW()),
    (v_client_id, c_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-04-09 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-04-09 13:00:00' AT TIME ZONE v_tz, 180, 'Gym Session', v_caleb_user, NOW()),
    (v_client_id, c_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-04-15 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-04-15 13:00:00' AT TIME ZONE v_tz, 180, 'Gym Session', v_caleb_user, NOW()),
    (v_client_id, c_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-04-22 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-04-22 13:00:00' AT TIME ZONE v_tz, 180, 'Gym Session', v_caleb_user, NOW()),
    (v_client_id, c_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-04-24 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-04-24 13:00:00' AT TIME ZONE v_tz, 180, 'Gym Session', v_caleb_user, NOW()),
    (v_client_id, c_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-04-30 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-04-30 13:00:00' AT TIME ZONE v_tz, 180, 'Gym Session', v_caleb_user, NOW()),

    -- MAY 2025 (12 sessions, mixed types incl. 1hr Independent Work + 4hr long + 2.5hr short)
    (v_client_id, c_may, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-05-01 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-05-01 13:00:00' AT TIME ZONE v_tz, 180, 'Gym Session', v_caleb_user, NOW()),
    (v_client_id, c_may, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-05-04 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-05-04 11:00:00' AT TIME ZONE v_tz, 60,  'Independent Work', v_caleb_user, NOW()),
    (v_client_id, c_may, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-05-05 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-05-05 11:00:00' AT TIME ZONE v_tz, 60,  'Independent Work', v_caleb_user, NOW()),
    (v_client_id, c_may, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-05-08 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-05-08 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_may, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-05-13 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-05-13 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_may, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-05-14 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-05-14 14:00:00' AT TIME ZONE v_tz, 240, 'Life Skills Session (long)', v_caleb_user, NOW()),
    (v_client_id, c_may, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-05-15 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-05-15 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_may, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-05-20 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-05-20 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_may, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-05-21 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-05-21 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_may, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-05-22 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-05-22 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_may, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-05-23 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-05-23 12:30:00' AT TIME ZONE v_tz, 150, 'Life Skills Session (short)', v_caleb_user, NOW()),
    (v_client_id, c_may, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-05-29 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-05-29 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),

    -- JUN 2025 (13 sessions)
    (v_client_id, c_jun, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-06-02 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-02 12:00:00' AT TIME ZONE v_tz, 120, 'Life Skills Session (short)', v_caleb_user, NOW()),
    (v_client_id, c_jun, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-06-04 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-04 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jun, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-06-05 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-05 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jun, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-06-10 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-10 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jun, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-06-11 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-11 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jun, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-06-12 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-12 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jun, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-06-16 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-16 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jun, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-06-17 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-17 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jun, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-06-19 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-19 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jun, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-06-24 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-24 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jun, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-06-25 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-25 14:30:00' AT TIME ZONE v_tz, 270, 'Life Skills Session (long)', v_caleb_user, NOW()),
    (v_client_id, c_jun, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-06-26 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-26 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jun, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-06-30 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-30 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),

    -- JUL 2025 (13 sessions)
    (v_client_id, c_jul, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-07-02 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-02 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jul, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-07-04 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-04 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jul, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-07-07 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-07 13:30:00' AT TIME ZONE v_tz, 210, 'Life Skills Session (long)', v_caleb_user, NOW()),
    (v_client_id, c_jul, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-07-09 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-09 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jul, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-07-12 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-12 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jul, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-07-14 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-14 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jul, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-07-16 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-16 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jul, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-07-18 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-18 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jul, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-07-21 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-21 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jul, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-07-23 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-23 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jul, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-07-25 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-25 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jul, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-07-28 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-28 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_jul, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-07-30 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-07-30 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),

    -- AUG 2025 (10 sessions, includes long 6hr + 9hr)
    (v_client_id, c_aug, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-08-05 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-08-05 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_aug, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-08-06 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-08-06 16:00:00' AT TIME ZONE v_tz, 360, 'Life Skills Session (long)', v_caleb_user, NOW()),
    (v_client_id, c_aug, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-08-07 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-08-07 16:00:00' AT TIME ZONE v_tz, 360, 'Life Skills Session (long)', v_caleb_user, NOW()),
    (v_client_id, c_aug, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-08-08 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-08-08 19:00:00' AT TIME ZONE v_tz, 540, 'Life Skills Session (full day)', v_caleb_user, NOW()),
    (v_client_id, c_aug, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-08-11 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-08-11 11:30:00' AT TIME ZONE v_tz, 90,  'Life Skills Session (short)', v_caleb_user, NOW()),
    (v_client_id, c_aug, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-08-12 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-08-12 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_aug, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-08-15 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-08-15 12:30:00' AT TIME ZONE v_tz, 150, 'Life Skills Session (short)', v_caleb_user, NOW()),
    (v_client_id, c_aug, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-08-20 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-08-20 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_aug, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-08-21 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-08-21 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_aug, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-08-22 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-08-22 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),

    -- SEP 2025 (10 sessions)
    (v_client_id, c_sep, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-09-09 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-09-09 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_sep, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-09-10 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-09-10 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_sep, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-09-11 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-09-11 12:00:00' AT TIME ZONE v_tz, 120, 'Life Skills Session (short)', v_caleb_user, NOW()),
    (v_client_id, c_sep, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-09-16 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-09-16 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_sep, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-09-18 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-09-18 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_sep, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-09-19 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-09-19 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_sep, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-09-23 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-09-23 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_sep, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-09-24 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-09-24 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_sep, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-09-25 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-09-25 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_sep, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-09-30 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-09-30 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),

    -- OCT 2025 (12 sessions; 6 cancellations skipped per owner instruction)
    (v_client_id, c_oct, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-10-01 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-01 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session (contract renewal day)', v_caleb_user, NOW()),
    (v_client_id, c_oct, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-10-02 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-02 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_oct, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-10-07 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-07 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_oct, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-10-09 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-09 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_oct, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-10-16 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-16 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_oct, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-10-17 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-17 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_oct, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-10-21 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-21 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_oct, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-10-22 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-22 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_oct, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-10-23 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-23 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_oct, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-10-28 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-28 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_oct, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-10-29 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-29 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_oct, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-10-30 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-30 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),

    -- NOV 2025 (10 sessions)
    (v_client_id, c_nov, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-11-04 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-11-04 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session (contract renewal day)', v_caleb_user, NOW()),
    (v_client_id, c_nov, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-11-05 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-11-05 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_nov, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-11-06 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-11-06 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_nov, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-11-11 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-11-11 12:00:00' AT TIME ZONE v_tz, 120, 'Life Skills Session (short)', v_caleb_user, NOW()),
    (v_client_id, c_nov, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-11-12 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-11-12 12:00:00' AT TIME ZONE v_tz, 120, 'Life Skills Session (short)', v_caleb_user, NOW()),
    (v_client_id, c_nov, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-11-13 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-11-13 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_nov, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-11-19 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-11-19 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_nov, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-11-25 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-11-25 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_nov, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-11-26 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-11-26 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, c_nov, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2025-11-27 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-11-27 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW());

  -- ─── LEDGER ROWS for every 2025 appointment ────────────────────────
  INSERT INTO public.hours_ledger
    (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
  SELECT a.client_id, a.contract_id, a.id, -a.duration_minutes, 'session_completed',
    v_meta_base || jsonb_build_object('kind','backfilled_from_2025_manual_calendar', 'session_date', (a.starts_at AT TIME ZONE v_tz)::date),
    v_caleb_user
  FROM public.appointments a
  WHERE a.client_id = v_client_id
    AND a.starts_at >= TIMESTAMP '2025-01-01 00:00:00' AT TIME ZONE v_tz
    AND a.starts_at <  TIMESTAMP '2026-01-01 00:00:00' AT TIME ZONE v_tz
    AND a.status = 'completed';

  RAISE NOTICE 'Michael 2025 backfill complete. 12 contracts + 89 sessions imported.';
END $$;

-- VERIFICATION
SELECT 'Per-year session counts' AS section,
       (SELECT COUNT(*) FROM public.appointments a JOIN public.clients cl ON cl.id = a.client_id
         WHERE cl.full_name = 'Michael Yang' AND a.starts_at >= '2025-01-01' AND a.starts_at < '2026-01-01') AS sessions_2025,
       (SELECT COUNT(*) FROM public.appointments a JOIN public.clients cl ON cl.id = a.client_id
         WHERE cl.full_name = 'Michael Yang' AND a.starts_at >= '2026-01-01' AND a.starts_at < '2027-01-01') AS sessions_2026,
       (SELECT COUNT(*) FROM public.contracts c JOIN public.clients cl ON cl.id = c.client_id
         WHERE cl.full_name = 'Michael Yang' AND c.start_at >= '2025-01-01' AND c.start_at < '2026-01-01') AS contracts_2025,
       (SELECT COUNT(*) FROM public.contracts c JOIN public.clients cl ON cl.id = c.client_id
         WHERE cl.full_name = 'Michael Yang' AND c.start_at >= '2026-01-01' AND c.start_at < '2027-01-01') AS contracts_2026;

-- Bank balance should be UNCHANGED at 25 hrs (this phase didn't touch it)
SELECT ROUND(b.banked_minutes / 60.0, 2) AS banked_hours_should_still_be_25
  FROM public.client_bank_balance b
  JOIN public.clients cl ON cl.id = b.client_id
 WHERE cl.full_name = 'Michael Yang';

-- Current contract balance should still be 6.75 (only 2025 expired contracts touched)
SELECT full_name, hours_balance AS should_still_be_6_75
  FROM public.clients
 WHERE full_name = 'Michael Yang';

COMMIT;
