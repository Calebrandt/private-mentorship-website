-- ─────────────────────────────────────────────────────────────────────────
-- Phase 15a: Wipe test data — clean slate before real customers
-- ─────────────────────────────────────────────────────────────────────────
-- Context: Before launching, owner audited the data and confirmed every
-- contract in the system was test data (TYNUT, TYDOG, POPKING, etc.).
-- Real production goes forward with 3 real clients: Michael Yang, Daniel
-- Jiang (Yaxi mother), Ryan Roe (Eileen mother).
--
-- WHAT THIS DOES
--   TRUNCATE ... CASCADE on the parent tables (clients, contracts,
--   appointments, conversations, notifications). PostgreSQL auto-wipes
--   every child table with an FK pointing at these — invoices, hours_ledger,
--   family_assignments, sales_receipts, tasks, homework, every conversation
--   message, etc. Faster than DELETE and we don't have to enumerate every
--   child table by hand.
--
-- WHY TRUNCATE INSTEAD OF DELETE
--   The first attempt (DELETE per table) failed at:
--     "ERROR: update or delete on table 'clients' violates foreign key
--      constraint 'invoices_client_id_fkey' on table 'invoices'"
--   I forgot to include invoices. With dozens of possible child tables
--   (sales_receipts, tasks, homework, picks, etc.), enumerating is brittle.
--   TRUNCATE CASCADE auto-discovers all FK children and wipes them.
--
-- WHAT THIS DOES NOT TOUCH
--   - auth.users (login accounts stay; cheap, purge later via dashboard)
--   - public.profiles (metadata for auth users)
--   - public.assistant_profiles (assistant card info)
--   - public.assistant_availability_windows / _blackouts
--   - System level (extensions, RLS policies, triggers, RPCs)
--
-- WHEN TO RUN
--   Once. Before Phase 15b (Michael import) and 15c (Yaxi + Eileen import).
--
-- SAFETY
--   - Transaction-wrapped. Any failure rolls back the entire batch.
--   - BEFORE + AFTER counts for visual confirmation.
--   - Final SELECT confirms 5 keep-list profiles survived.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

SELECT 'BEFORE' AS phase,
       (SELECT COUNT(*) FROM public.clients)                   AS clients,
       (SELECT COUNT(*) FROM public.contracts)                 AS contracts,
       (SELECT COUNT(*) FROM public.appointments)              AS appointments,
       (SELECT COUNT(*) FROM public.invoices)                  AS invoices,
       (SELECT COUNT(*) FROM public.conversations)             AS conversations;

-- CASCADE wipes every table with an FK to any of these parents.
TRUNCATE TABLE
  public.clients,
  public.contracts,
  public.appointments,
  public.conversations,
  public.notifications
CASCADE;

SELECT 'AFTER' AS phase,
       (SELECT COUNT(*) FROM public.clients)                   AS clients,
       (SELECT COUNT(*) FROM public.contracts)                 AS contracts,
       (SELECT COUNT(*) FROM public.appointments)              AS appointments,
       (SELECT COUNT(*) FROM public.invoices)                  AS invoices,
       (SELECT COUNT(*) FROM public.conversations)             AS conversations,
       (SELECT COUNT(*) FROM public.conversation_messages)     AS messages,
       (SELECT COUNT(*) FROM public.hours_ledger)              AS hours_ledger,
       (SELECT COUNT(*) FROM public.family_assignments)        AS family_assignments,
       (SELECT COUNT(*) FROM public.client_bank_balance)       AS bank_balances,
       (SELECT COUNT(*) FROM public.contract_carryover_events) AS carryover_events,
       (SELECT COUNT(*) FROM public.schedule_change_requests)  AS schedule_requests;

SELECT user_id, role, full_name
  FROM public.profiles
 WHERE user_id IN (
   '186282d5-96e8-45b6-a9f5-718db4c60913',  -- assistant@privatementorship.com (test assistant)
   '9b7b4106-1914-4062-818d-3074a0d2f7ff',  -- caleb@private-mentorship.com (owner)
   '2f4e1826-5cf7-4351-adf4-58270a5d4af1',  -- yangm7971@gmail.com (Michael — client)
   'a1a1fb97-d56f-4fdd-b5ee-d4341a9f33fc',  -- danielyang.ubc@gmail.com (Daniel — brother)
   '6be3dee1-4f64-42f2-9897-189b4b10580c'   -- lindachen8822@gmail.com (Linda — mother)
 );

COMMIT;
