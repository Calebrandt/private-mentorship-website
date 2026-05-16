-- ─────────────────────────────────────────────────────────────────────────
-- Phase 15b: Michael Yang full import (4 contracts, ~54 sessions, bank seed)
-- ─────────────────────────────────────────────────────────────────────────
-- Imports Michael Yang's real session history from owner's Google Sheets
-- (Jan–May 2026). Creates:
--   - 1 client row (Michael Yang, profile=yangm7971@gmail.com)
--   - 3 family_assignments rows (Linda mother, Daniel brother, Caleb assistant)
--   - 4 contracts (Jan, Feb, Mar expired; Apr–May ACTIVE)
--   - 1 recurring pattern on current contract (Tue/Wed/Thu 10am, 3hr)
--   - 3 carryover-deficit ledger rows (-6 → Feb, -5.75 → Mar, -2.75 → Apr-May)
--   - 54 completed appointments + matching session_completed ledger rows
--   - 1 plug admin_adjustment to land current balance at exactly 6.75 hrs
--   - 1 bank seed of +25 hrs (Michael's "Total Hours: 25 Hours Saved")
--
-- TIMEZONE: All Vancouver-local times built with `... AT TIME ZONE 'America/Vancouver'`
-- so DST transitions (PST↔PDT around Mar 8 2026) handle automatically.
--
-- CONTRACT DATE RANGES (intentionally tile with no gaps so every session
-- maps to exactly one contract — even sessions in between formal renewal dates):
--   - Jan: Jan 4 → Feb 9 (status='expired')
--   - Feb: Feb 10 → Mar 12 (status='expired')
--   - Mar: Mar 13 → Apr 14 (status='expired')
--   - Apr–May: Apr 15 → May 14 (status='active')
--
-- APPOINTMENT KINDS:
--   - 'reserved' for sessions matching the recurring Tue/Wed/Thu 10am pattern
--   - 'extra_billable' for off-pattern sessions (Fri/Sat/Mon entries we saw)
--
-- ASSISTANT ATTRIBUTION:
--   Caleb's assistant_id is set explicitly on every contract. The Phase 14
--   trigger (sync_contract_assistant_from_family_assignments) is also active
--   as a safety net — it respects explicit values, so no conflict.
--
-- SAFETY:
--   - Transaction-wrapped (BEGIN/COMMIT). Any failure rolls back the whole thing.
--   - Verification SELECTs at the end print what got created.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  -- Stable IDs we'll reference throughout
  v_client_id         uuid;
  v_family_id         uuid := gen_random_uuid();
  v_contract_jan      uuid := gen_random_uuid();
  v_contract_feb      uuid := gen_random_uuid();
  v_contract_mar      uuid := gen_random_uuid();
  v_contract_apr      uuid := gen_random_uuid();

  -- Auth user IDs (from earlier confirmation)
  v_michael_user      uuid := '2f4e1826-5cf7-4351-adf4-58270a5d4af1';
  v_linda_user        uuid := '6be3dee1-4f64-42f2-9897-189b4b10580c';
  v_daniel_user       uuid := 'a1a1fb97-d56f-4fdd-b5ee-d4341a9f33fc';
  v_caleb_user        uuid := '9b7b4106-1914-4062-818d-3074a0d2f7ff';

  v_tz                text := 'America/Vancouver';
  v_meta_base         jsonb := jsonb_build_object('source','phase-15b-michael-import','imported_at', NOW());
BEGIN

  -- ─── 1. CLIENT ───────────────────────────────────────────────────────
  INSERT INTO public.clients
    (full_name, email, profile_id, display_name, parent_full_name,
     billing_email, existing_offline_client, created_by)
  VALUES
    ('Michael Yang', 'yangm7971@gmail.com', v_michael_user,
     'Michael', 'Linda Chen', 'lindachen8822@gmail.com',
     true, v_caleb_user)
  RETURNING id INTO v_client_id;

  RAISE NOTICE 'Created Michael client_id = %', v_client_id;


  -- ─── 2a. FAMILY ROW (parent of family_assignments) ──────────────────
  -- public.families is the parent table; family_assignments.family_id FKs to it.
  INSERT INTO public.families (id, name, contact_name, owner_id)
  VALUES (v_family_id, 'Yang Family', 'Linda Chen', v_caleb_user);


  -- ─── 2b. FAMILY ASSIGNMENTS ──────────────────────────────────────────
  -- Mother = FAMILY_LEADER (primary billing contact)
  -- Brother = OWNER (family member, no special designation)
  -- Caleb = ASSIGNED_ASSISTANT (will auto-cache to contracts.assistant_id
  -- via Phase 14 trigger — though we also set it explicitly below)
  INSERT INTO public.family_assignments
    (family_id, user_id, role, client_id, designation, display_name)
  VALUES
    (v_family_id, v_linda_user,   'OWNER',     v_client_id, 'FAMILY_LEADER',      'Linda Chen'),
    (v_family_id, v_daniel_user,  'OWNER',     v_client_id, NULL,                 'Daniel Yang'),
    (v_family_id, v_caleb_user,   'ASSISTANT', v_client_id, 'ASSIGNED_ASSISTANT', 'Caleb Brandt');


  -- ─── 3. CONTRACTS (4 total: 3 expired + 1 active) ────────────────────
  INSERT INTO public.contracts
    (id, client_id, status, start_at, end_at, included_minutes,
     assistant_id, assistant_name, renewal_mode, created_by, activated_at)
  VALUES
    -- January contract: Jan 4 → Feb 9 (extended to cover Feb 3/4/6 sessions)
    (v_contract_jan, v_client_id, 'expired',
     TIMESTAMP '2026-01-04 00:00:00' AT TIME ZONE v_tz,
     TIMESTAMP '2026-02-09 23:59:59' AT TIME ZONE v_tz,
     2400, v_caleb_user, 'Caleb Brandt', 'auto',
     v_caleb_user, TIMESTAMP '2026-01-04 00:00:00' AT TIME ZONE v_tz),

    -- February contract: Feb 10 → Mar 12
    (v_contract_feb, v_client_id, 'expired',
     TIMESTAMP '2026-02-10 00:00:00' AT TIME ZONE v_tz,
     TIMESTAMP '2026-03-12 23:59:59' AT TIME ZONE v_tz,
     2400, v_caleb_user, 'Caleb Brandt', 'auto',
     v_caleb_user, TIMESTAMP '2026-02-10 00:00:00' AT TIME ZONE v_tz),

    -- March contract: Mar 13 → Apr 14
    (v_contract_mar, v_client_id, 'expired',
     TIMESTAMP '2026-03-13 00:00:00' AT TIME ZONE v_tz,
     TIMESTAMP '2026-04-14 23:59:59' AT TIME ZONE v_tz,
     2400, v_caleb_user, 'Caleb Brandt', 'auto',
     v_caleb_user, TIMESTAMP '2026-03-13 00:00:00' AT TIME ZONE v_tz),

    -- April–May contract: Apr 15 → May 14 (CURRENT, ACTIVE)
    (v_contract_apr, v_client_id, 'active',
     TIMESTAMP '2026-04-15 00:00:00' AT TIME ZONE v_tz,
     TIMESTAMP '2026-05-14 23:59:59' AT TIME ZONE v_tz,
     2400, v_caleb_user, 'Caleb Brandt', 'auto',
     v_caleb_user, TIMESTAMP '2026-04-15 00:00:00' AT TIME ZONE v_tz);


  -- ─── 4. RECURRING PATTERN (current contract only) ───────────────────
  -- Tue/Wed/Thu 10am–1pm (3hr). day_of_week: 0=Sun, 2=Tue, 3=Wed, 4=Thu.
  INSERT INTO public.contract_recurring_patterns
    (contract_id, day_of_week, start_time_local, duration_minutes,
     timezone, assistant_id, service_type)
  VALUES
    (v_contract_apr, 2, '10:00:00', 180, v_tz, v_caleb_user, 'Life Skills'),  -- Tue
    (v_contract_apr, 3, '10:00:00', 180, v_tz, v_caleb_user, 'Life Skills'),  -- Wed
    (v_contract_apr, 4, '10:00:00', 180, v_tz, v_caleb_user, 'Life Skills');  -- Thu


  -- ─── 5. CARRYOVER DEFICITS (loaded at start of Feb/Mar/Apr contracts) ─
  -- Per Michael's manual tracking, each contract started carrying a deficit
  -- from the prior one. Modeled as auto_generated ledger rows so they show
  -- up explicitly in the audit trail as "what we owed coming in."
  -- NOTE: Using 'admin_adjustment' (not 'auto_generated') because the
  -- ledger_zero_only_for_audit CHECK constraint reserves auto_generated for
  -- rows with minutes_delta = 0 (the comp-session audit pattern).
  INSERT INTO public.hours_ledger
    (client_id, contract_id, minutes_delta, reason_code, meta, created_by)
  VALUES
    -- Feb contract: -6 hrs deficit from Jan
    (v_client_id, v_contract_feb, -360, 'admin_adjustment',
     v_meta_base || jsonb_build_object('kind','prior_contract_carryover_deficit','from_contract_id', v_contract_jan, 'hours', -6),
     v_caleb_user),
    -- Mar contract: -5.75 hrs deficit from Feb
    (v_client_id, v_contract_mar, -345, 'admin_adjustment',
     v_meta_base || jsonb_build_object('kind','prior_contract_carryover_deficit','from_contract_id', v_contract_feb, 'hours', -5.75),
     v_caleb_user),
    -- Apr-May contract: -2.75 hrs deficit from Mar
    (v_client_id, v_contract_apr, -165, 'admin_adjustment',
     v_meta_base || jsonb_build_object('kind','prior_contract_carryover_deficit','from_contract_id', v_contract_mar, 'hours', -2.75),
     v_caleb_user);


  -- ─── 6. APPOINTMENTS — JANUARY contract (15 sessions) ────────────────
  -- 12 on-pattern T/W/Th + 3 off-pattern Friday sessions + 3 carryover sessions in early Feb
  INSERT INTO public.appointments
    (client_id, contract_id, assistant_id, kind, status,
     starts_at, ends_at, duration_minutes, title, created_by, updated_at)
  VALUES
    -- Week 1 (Jan 6-10)
    (v_client_id, v_contract_jan, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-01-06 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-01-06 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_jan, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-01-07 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-01-07 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_jan, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-01-08 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-01-08 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    -- Week 2 (Jan 13-17)
    (v_client_id, v_contract_jan, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-01-13 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-01-13 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_jan, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-01-15 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-01-15 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_jan, v_caleb_user, 'extra_billable', 'completed', TIMESTAMP '2026-01-16 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-01-16 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    -- Week 3 (Jan 20-24)
    (v_client_id, v_contract_jan, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-01-20 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-01-20 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_jan, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-01-21 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-01-21 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_jan, v_caleb_user, 'extra_billable', 'completed', TIMESTAMP '2026-01-23 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-01-23 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    -- Week 4 (Jan 27-31)
    (v_client_id, v_contract_jan, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-01-27 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-01-27 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_jan, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-01-29 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-01-29 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_jan, v_caleb_user, 'extra_billable', 'completed', TIMESTAMP '2026-01-30 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-01-30 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    -- Carryover sessions into early Feb (still tied to Jan contract per extended end_at)
    (v_client_id, v_contract_jan, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-02-03 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-02-03 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_jan, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-02-04 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-02-04 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_jan, v_caleb_user, 'extra_billable', 'completed', TIMESTAMP '2026-02-06 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-02-06 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW());


  -- ─── 7. APPOINTMENTS — FEBRUARY contract (13 sessions, includes 2hr session) ─
  INSERT INTO public.appointments
    (client_id, contract_id, assistant_id, kind, status,
     starts_at, ends_at, duration_minutes, title, created_by, updated_at)
  VALUES
    -- Feb: in-contract
    (v_client_id, v_contract_feb, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-02-10 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-02-10 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session (contract payment day)', v_caleb_user, NOW()),
    (v_client_id, v_contract_feb, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-02-12 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-02-12 12:00:00' AT TIME ZONE v_tz, 120, 'Life Skills Session (short)', v_caleb_user, NOW()),
    (v_client_id, v_contract_feb, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-02-17 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-02-17 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_feb, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-02-18 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-02-18 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_feb, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-02-19 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-02-19 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_feb, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-02-24 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-02-24 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_feb, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-02-25 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-02-25 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_feb, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-02-26 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-02-26 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    -- Early March (still in Feb contract per extended end_at)
    (v_client_id, v_contract_feb, v_caleb_user, 'extra_billable', 'completed', TIMESTAMP '2026-03-02 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-03-02 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session (Mon makeup)', v_caleb_user, NOW()),
    (v_client_id, v_contract_feb, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-03-03 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-03-03 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_feb, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-03-05 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-03-05 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_feb, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-03-10 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-03-10 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_feb, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-03-12 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-03-12 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW());


  -- ─── 8. APPOINTMENTS — MARCH contract (14 sessions, includes 1hr + 2hr Sat) ─
  INSERT INTO public.appointments
    (client_id, contract_id, assistant_id, kind, status,
     starts_at, ends_at, duration_minutes, title, created_by, updated_at)
  VALUES
    -- In March
    (v_client_id, v_contract_mar, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-03-17 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-03-17 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_mar, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-03-18 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-03-18 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_mar, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-03-19 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-03-19 11:00:00' AT TIME ZONE v_tz, 60,  'Life Skills Session (short)', v_caleb_user, NOW()),
    (v_client_id, v_contract_mar, v_caleb_user, 'extra_billable', 'completed', TIMESTAMP '2026-03-21 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-03-21 12:00:00' AT TIME ZONE v_tz, 120, 'Life Skills Session (Sat)', v_caleb_user, NOW()),
    (v_client_id, v_contract_mar, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-03-24 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-03-24 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_mar, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-03-25 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-03-25 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_mar, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-03-26 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-03-26 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_mar, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-03-31 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-03-31 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    -- Into April (still in Mar contract per extended end_at)
    (v_client_id, v_contract_mar, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-04-02 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-02 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_mar, v_caleb_user, 'extra_billable', 'completed', TIMESTAMP '2026-04-03 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-03 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session (Fri)', v_caleb_user, NOW()),
    (v_client_id, v_contract_mar, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-04-07 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-07 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_mar, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-04-08 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-08 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_mar, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-04-09 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-09 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_mar, v_caleb_user, 'reserved',       'completed', TIMESTAMP '2026-04-14 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-14 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW());


  -- ─── 9. APPOINTMENTS — APRIL-MAY contract (12 sessions, ACTIVE) ─────
  INSERT INTO public.appointments
    (client_id, contract_id, assistant_id, kind, status,
     starts_at, ends_at, duration_minutes, title, created_by, updated_at)
  VALUES
    -- April (post Apr 15 renewal)
    (v_client_id, v_contract_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2026-04-16 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-16 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2026-04-21 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-21 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2026-04-22 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-22 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2026-04-23 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-23 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2026-04-28 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-28 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2026-04-29 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-29 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2026-04-30 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-30 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    -- May (through May 14)
    (v_client_id, v_contract_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2026-05-06 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-05-06 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2026-05-07 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-05-07 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2026-05-12 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-05-12 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2026-05-13 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-05-13 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW()),
    (v_client_id, v_contract_apr, v_caleb_user, 'reserved', 'completed', TIMESTAMP '2026-05-14 10:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-05-14 13:00:00' AT TIME ZONE v_tz, 180, 'Life Skills Session', v_caleb_user, NOW());


  -- ─── 10. HOURS LEDGER — bulk-insert session_completed rows ──────────
  -- One per appointment, computed from the appointments just inserted.
  -- minutes_delta = -duration_minutes (negative since it's a deduction).
  INSERT INTO public.hours_ledger
    (client_id, contract_id, appointment_id, minutes_delta, reason_code, meta, created_by)
  SELECT
    a.client_id,
    a.contract_id,
    a.id,
    -a.duration_minutes,
    'session_completed',
    v_meta_base || jsonb_build_object('kind','backfilled_from_manual_calendar',
                                       'session_date', (a.starts_at AT TIME ZONE v_tz)::date),
    v_caleb_user
  FROM public.appointments a
  WHERE a.client_id = v_client_id
    AND a.status = 'completed';


  -- ─── 11. PLUG — reconcile current contract to exact 6.75 hrs remaining ─
  -- Math without plug for Apr-May contract:
  --   40 hrs (included) − 2.75 (deficit ledger) − 36 (12 sessions × 3hr) = 1.25 hrs
  -- Target per Michael's May 14 manual record: 6.75 hrs
  -- Plug: +5.5 hrs (330 min) admin_adjustment to reconcile.
  INSERT INTO public.hours_ledger
    (client_id, contract_id, minutes_delta, reason_code, meta, created_by)
  VALUES
    (v_client_id, v_contract_apr, 330, 'admin_adjustment',
     v_meta_base || jsonb_build_object('kind','reconcile_to_manual_tracking',
                                        'note','Plug to land current balance at exactly 6.75 hrs per May 14 owner-tracked record',
                                        'hours_delta', 5.5),
     v_caleb_user);


  -- ─── 12. BANK SEED — +25 hrs (1500 min) ─────────────────────────────
  -- "Total Hours: 25 Hours Saved" per Michael's manual record. These come
  -- from contracts before our 4-month window. Inserting as a single carryover
  -- event with reason='admin_adjustment'; the apply_bank_balance_event trigger
  -- will set client_bank_balance.banked_minutes to 1500.
  INSERT INTO public.contract_carryover_events
    (client_id, source_contract_id, minutes_delta, reason, meta, created_by)
  VALUES
    (v_client_id, NULL, 1500, 'admin_adjustment',
     v_meta_base || jsonb_build_object('kind','michael_initial_bank_seed',
                                        'note','Seeds bank to 25 hrs from pre-import savings (Total Hours Saved per manual tracking)',
                                        'hours', 25),
     v_caleb_user);


  RAISE NOTICE 'Michael Yang import complete. Created: 1 client, 3 family_assignments, 4 contracts, 3 patterns, % appointments + ledger rows, 1 plug, 1 bank seed.',
    (SELECT COUNT(*) FROM public.appointments WHERE client_id = v_client_id);

END $$;


-- ─── VERIFICATION ─────────────────────────────────────────────────────
-- Run these to confirm everything landed as expected.

-- Counts per table (should all be > 0 for Michael)
SELECT 'Counts for Michael' AS section,
       (SELECT COUNT(*) FROM public.clients WHERE full_name = 'Michael Yang')    AS clients,
       (SELECT COUNT(*) FROM public.contracts c JOIN public.clients cl ON cl.id = c.client_id WHERE cl.full_name = 'Michael Yang') AS contracts,
       (SELECT COUNT(*) FROM public.appointments a JOIN public.clients cl ON cl.id = a.client_id WHERE cl.full_name = 'Michael Yang') AS appointments,
       (SELECT COUNT(*) FROM public.hours_ledger l JOIN public.clients cl ON cl.id = l.client_id WHERE cl.full_name = 'Michael Yang') AS ledger_rows,
       (SELECT COUNT(*) FROM public.contract_recurring_patterns p JOIN public.contracts c ON c.id = p.contract_id JOIN public.clients cl ON cl.id = c.client_id WHERE cl.full_name = 'Michael Yang') AS patterns,
       (SELECT COUNT(*) FROM public.family_assignments fa JOIN public.clients cl ON cl.id = fa.client_id WHERE cl.full_name = 'Michael Yang') AS family_assignments,
       (SELECT COUNT(*) FROM public.contract_carryover_events e JOIN public.clients cl ON cl.id = e.client_id WHERE cl.full_name = 'Michael Yang') AS carryover_events;

-- Active contract balance (should show 6.75 hrs remaining)
SELECT
  c.status,
  c.start_at::date AS start_date,
  c.end_at::date   AS end_date,
  ROUND(c.included_minutes / 60.0, 2) AS included_hours,
  ROUND(COALESCE(SUM(l.minutes_delta), 0) / 60.0, 2) AS ledger_total_hours,
  ROUND((c.included_minutes + COALESCE(SUM(l.minutes_delta), 0)) / 60.0, 2) AS remaining_hours
  FROM public.contracts c
  JOIN public.clients cl ON cl.id = c.client_id
  LEFT JOIN public.hours_ledger l ON l.contract_id = c.id
 WHERE cl.full_name = 'Michael Yang'
 GROUP BY c.id, c.status, c.start_at, c.end_at, c.included_minutes
 ORDER BY c.start_at;

-- Bank balance (should show 25 hrs)
SELECT
  ROUND(b.banked_minutes / 60.0, 2) AS banked_hours,
  b.updated_at
  FROM public.client_bank_balance b
  JOIN public.clients cl ON cl.id = b.client_id
 WHERE cl.full_name = 'Michael Yang';

-- Clients.hours_balance (should also show 6.75 — synced by apply_hours_ledger trigger)
SELECT full_name, hours_balance
  FROM public.clients
 WHERE full_name = 'Michael Yang';

COMMIT;
