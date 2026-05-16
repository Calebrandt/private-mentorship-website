-- =============================================================
-- Phase 19h — TEMPORARY: pause contract-lifecycle cron job
-- =============================================================
-- Symptom (2026-05-15 evening): every time we reconciled Michael's
-- May 15 contract back to 'draft' (because Daniel hadn't paid yet),
-- it flipped itself back to 'active' within ~15 minutes. Workspace
-- KPIs flipped from "6.75 remaining on Apr 15 expired" to "40 on
-- the empty May 15 active" — confusing the assistant view.
--
-- Cause: pg_cron job 'contract-lifecycle-every-15-min' calls
-- run_contract_lifecycle_tick() every 15 min, which auto-promotes
-- any draft contract whose start_at has arrived to status='active'.
-- This is the right behavior IF payment has landed — but right now
-- it fires regardless of payment status, which jumps the gun for
-- families who pay a day or two after the calendar renewal.
--
-- This SQL PAUSES the cron until Phase 19f (the "Activate renewal"
-- button) ships. Once Phase 19f lands, the lifecycle tick should
-- only auto-promote when an associated invoice is marked paid, and
-- this cron can be re-enabled (or replaced by an invoice-driven
-- trigger).
--
-- To RE-ENABLE later:
--   UPDATE cron.job
--   SET active = true
--   WHERE jobname = 'contract-lifecycle-every-15-min';
-- =============================================================

-- Pause the cron
UPDATE cron.job
SET active = false
WHERE jobname = 'contract-lifecycle-every-15-min';

-- Safety: re-flip May 15 in case the cron promoted it again in the
-- few minutes between detection and disabling.
UPDATE public.contracts
SET status = 'draft'
WHERE id = '5af622ec-5ef7-4329-b22a-2a4b3d4e7648'
  AND status = 'active';

-- Verify the cron is paused
SELECT jobname, schedule, active
FROM cron.job
WHERE jobname = 'contract-lifecycle-every-15-min';

-- Verify May 15 is draft
SELECT id, status, start_at::date, end_at::date
FROM public.contracts
WHERE id = '5af622ec-5ef7-4329-b22a-2a4b3d4e7648';
