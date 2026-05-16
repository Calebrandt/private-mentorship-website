-- ─────────────────────────────────────────────────────────────────────────
-- Phase 15c (Foundation): Daniel Jiang + Ryan Roe — clients, families,
-- contracts, recurring patterns, family_assignments
-- ─────────────────────────────────────────────────────────────────────────
-- These two families don't have auth users yet (they don't sign in to the
-- website). So we create:
--   - clients row with profile_id = NULL (link later when they get accounts)
--   - families row with owner_id = Caleb (admin placeholder)
--   - family_assignments — ONLY the ASSISTANT row (test assistant). No
--     OWNER row until they create accounts.
--   - 9 contracts each, 2-month/24-hour plan, calendar-month tiled
--     (Jan-Feb, Mar-Apr, etc. through May-Jun 2026 active)
--   - Recurring patterns on the ACTIVE contract only:
--       Daniel: Mon 6:00-8:00pm + Thu 4:00-6:00pm
--       Ryan:   Wed 4:30-6:30pm + Sun 9:30-11:30am
--
-- ASSISTANT: TYASSISTANT (test assistant) — so when signed in as test
-- assistant, Daniel + Ryan both appear in "My Families" alongside Michael.
--
-- Hours-balance math will be wrong until Phase 15c-Daniel-Backfill and
-- Phase 15c-Ryan-Backfill add real appointments + ledger entries. That's
-- expected — this phase only stands up the scaffolding.
--
-- Safe to re-run only if you first wipe these two clients.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  v_caleb            uuid := '9b7b4106-1914-4062-818d-3074a0d2f7ff';
  v_test_assistant   uuid := '186282d5-96e8-45b6-a9f5-718db4c60913';
  v_tz               text := 'America/Vancouver';

  -- Daniel Jiang
  v_daniel_client    uuid;
  v_jiang_family     uuid := gen_random_uuid();
  v_daniel_c1        uuid := gen_random_uuid();
  v_daniel_c2        uuid := gen_random_uuid();
  v_daniel_c3        uuid := gen_random_uuid();
  v_daniel_c4        uuid := gen_random_uuid();
  v_daniel_c5        uuid := gen_random_uuid();
  v_daniel_c6        uuid := gen_random_uuid();
  v_daniel_c7        uuid := gen_random_uuid();
  v_daniel_c8        uuid := gen_random_uuid();
  v_daniel_c9        uuid := gen_random_uuid();  -- active

  -- Ryan Roe
  v_ryan_client      uuid;
  v_roe_family       uuid := gen_random_uuid();
  v_ryan_c1          uuid := gen_random_uuid();
  v_ryan_c2          uuid := gen_random_uuid();
  v_ryan_c3          uuid := gen_random_uuid();
  v_ryan_c4          uuid := gen_random_uuid();
  v_ryan_c5          uuid := gen_random_uuid();
  v_ryan_c6          uuid := gen_random_uuid();
  v_ryan_c7          uuid := gen_random_uuid();
  v_ryan_c8          uuid := gen_random_uuid();
  v_ryan_c9          uuid := gen_random_uuid();  -- active
BEGIN

  -- ═══ DANIEL JIANG (Yaxi Jiang's son) ════════════════════════════════
  INSERT INTO public.clients
    (full_name, email, profile_id, display_name, parent_full_name,
     billing_email, existing_offline_client, created_by, notes)
  VALUES
    ('Daniel Jiang', NULL, NULL, 'Daniel', 'Yaxi Jiang',
     NULL, true, v_caleb,
     'Imported from Google Sheets lesson tracker. Yaxi (mother) has no website account yet; family_assignments OWNER row will be added when she signs up.')
  RETURNING id INTO v_daniel_client;

  INSERT INTO public.families (id, name, contact_name, owner_id, notes)
  VALUES (v_jiang_family, 'Jiang Family', 'Yaxi Jiang', v_caleb,
          'Owner placeholder = Caleb (admin) until Yaxi gets website access.');

  INSERT INTO public.family_assignments
    (family_id, user_id, role, client_id, designation, display_name)
  VALUES
    (v_jiang_family, v_test_assistant, 'ASSISTANT', v_daniel_client,
     'ASSIGNED_ASSISTANT', 'TYASSISTANT');

  -- Daniel's 9 contracts (2-month 24hr plan, calendar-tiled)
  INSERT INTO public.contracts
    (id, client_id, status, start_at, end_at, included_minutes,
     assistant_id, assistant_name, renewal_mode, created_by, activated_at, notes)
  VALUES
    (v_daniel_c1, v_daniel_client, 'expired',
     TIMESTAMP '2025-01-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-02-28 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2025-01-01 00:00:00' AT TIME ZONE v_tz,
     'Calendar-tiled 2-month contract (24 hrs / Jan-Feb 2025)'),
    (v_daniel_c2, v_daniel_client, 'expired',
     TIMESTAMP '2025-03-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-04-30 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2025-03-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (v_daniel_c3, v_daniel_client, 'expired',
     TIMESTAMP '2025-05-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-30 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2025-05-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (v_daniel_c4, v_daniel_client, 'expired',
     TIMESTAMP '2025-07-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-08-31 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2025-07-01 00:00:00' AT TIME ZONE v_tz,
     'Summer break — no sessions in this window'),
    (v_daniel_c5, v_daniel_client, 'expired',
     TIMESTAMP '2025-09-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-31 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2025-09-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (v_daniel_c6, v_daniel_client, 'expired',
     TIMESTAMP '2025-11-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-12-31 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2025-11-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (v_daniel_c7, v_daniel_client, 'expired',
     TIMESTAMP '2026-01-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-02-28 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2026-01-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (v_daniel_c8, v_daniel_client, 'expired',
     TIMESTAMP '2026-03-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-30 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2026-03-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (v_daniel_c9, v_daniel_client, 'active',
     TIMESTAMP '2026-05-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-06-30 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2026-05-01 00:00:00' AT TIME ZONE v_tz,
     'Active contract — May-Jun 2026');

  -- Daniel's recurring pattern (Mon 6-8pm + Thu 4-6pm, on current contract)
  -- day_of_week: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  INSERT INTO public.contract_recurring_patterns
    (contract_id, day_of_week, start_time_local, duration_minutes, timezone, assistant_id, service_type)
  VALUES
    (v_daniel_c9, 1, '18:00:00', 120, v_tz, v_test_assistant, 'English Tutoring'),  -- Mon 6-8pm
    (v_daniel_c9, 4, '16:00:00', 120, v_tz, v_test_assistant, 'English Tutoring');  -- Thu 4-6pm


  -- ═══ RYAN ROE (Eileen Zhou's son) ═══════════════════════════════════
  INSERT INTO public.clients
    (full_name, email, profile_id, display_name, parent_full_name,
     billing_email, existing_offline_client, created_by, notes)
  VALUES
    ('Ryan Roe', NULL, NULL, 'Ryan', 'Eileen Zhou',
     NULL, true, v_caleb,
     'Imported from Google Sheets lesson tracker. Eileen (mother) has no website account yet; family_assignments OWNER row will be added when she signs up.')
  RETURNING id INTO v_ryan_client;

  INSERT INTO public.families (id, name, contact_name, owner_id, notes)
  VALUES (v_roe_family, 'Roe Family', 'Eileen Zhou', v_caleb,
          'Owner placeholder = Caleb (admin) until Eileen gets website access.');

  INSERT INTO public.family_assignments
    (family_id, user_id, role, client_id, designation, display_name)
  VALUES
    (v_roe_family, v_test_assistant, 'ASSISTANT', v_ryan_client,
     'ASSIGNED_ASSISTANT', 'TYASSISTANT');

  -- Ryan's 9 contracts (2-month 24hr plan, calendar-tiled)
  INSERT INTO public.contracts
    (id, client_id, status, start_at, end_at, included_minutes,
     assistant_id, assistant_name, renewal_mode, created_by, activated_at, notes)
  VALUES
    (v_ryan_c1, v_ryan_client, 'expired',
     TIMESTAMP '2025-01-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-02-28 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2025-01-01 00:00:00' AT TIME ZONE v_tz,
     'Calendar-tiled 2-month contract (24 hrs / Jan-Feb 2025)'),
    (v_ryan_c2, v_ryan_client, 'expired',
     TIMESTAMP '2025-03-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-04-30 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2025-03-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (v_ryan_c3, v_ryan_client, 'expired',
     TIMESTAMP '2025-05-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-06-30 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2025-05-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (v_ryan_c4, v_ryan_client, 'expired',
     TIMESTAMP '2025-07-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-08-31 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2025-07-01 00:00:00' AT TIME ZONE v_tz,
     'Summer break — no sessions in this window'),
    (v_ryan_c5, v_ryan_client, 'expired',
     TIMESTAMP '2025-09-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-10-31 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2025-09-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (v_ryan_c6, v_ryan_client, 'expired',
     TIMESTAMP '2025-11-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2025-12-31 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2025-11-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (v_ryan_c7, v_ryan_client, 'expired',
     TIMESTAMP '2026-01-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-02-28 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2026-01-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (v_ryan_c8, v_ryan_client, 'expired',
     TIMESTAMP '2026-03-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-04-30 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2026-03-01 00:00:00' AT TIME ZONE v_tz, NULL),
    (v_ryan_c9, v_ryan_client, 'active',
     TIMESTAMP '2026-05-01 00:00:00' AT TIME ZONE v_tz, TIMESTAMP '2026-06-30 23:59:59' AT TIME ZONE v_tz,
     1440, v_test_assistant, 'TYASSISTANT', 'auto', v_caleb, TIMESTAMP '2026-05-01 00:00:00' AT TIME ZONE v_tz,
     'Active contract — May-Jun 2026');

  -- Ryan's recurring pattern (Wed 4:30-6:30pm + Sun 9:30-11:30am)
  INSERT INTO public.contract_recurring_patterns
    (contract_id, day_of_week, start_time_local, duration_minutes, timezone, assistant_id, service_type)
  VALUES
    (v_ryan_c9, 3, '16:30:00', 120, v_tz, v_test_assistant, 'English Tutoring'),  -- Wed 4:30-6:30pm
    (v_ryan_c9, 0, '09:30:00', 120, v_tz, v_test_assistant, 'English Tutoring');  -- Sun 9:30-11:30am

  RAISE NOTICE 'Phase 15c foundation complete. Daniel client_id=%, Ryan client_id=%', v_daniel_client, v_ryan_client;
END $$;

-- Verify
SELECT
  cl.full_name,
  (SELECT COUNT(*) FROM public.contracts c WHERE c.client_id = cl.id) AS contracts,
  (SELECT COUNT(*) FROM public.contract_recurring_patterns p
    JOIN public.contracts c ON c.id = p.contract_id WHERE c.client_id = cl.id) AS patterns,
  (SELECT COUNT(*) FROM public.family_assignments fa WHERE fa.client_id = cl.id) AS family_assignments
FROM public.clients cl
WHERE cl.full_name IN ('Daniel Jiang','Ryan Roe')
ORDER BY cl.full_name;

COMMIT;
