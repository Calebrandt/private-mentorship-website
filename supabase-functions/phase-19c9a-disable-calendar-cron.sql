-- ============================================================================
-- phase-19c9a-disable-calendar-cron.sql
-- ----------------------------------------------------------------------------
-- Disables the calendar-based recurring-invoice cron from Phase 19c.7a.
-- The contract-aware path from Phase 19c.9 is now the sole invoice creator.
--
-- Why now:
--   • No real clients yet (pre-launch per HANDOVER §1) — low risk to consolidate
--   • Two crons = technical debt, every change has to remember both paths
--   • Contract-aware path is strictly better: it knows about contract.end_at,
--     bank hours, and freezes — calendar cron is blind to all three
--
-- What stays:
--   • client_recurring_invoices table — still used by the contract-aware
--     path for pricing data (description, unit_price_cents, etc.)
--   • create_recurring_invoices_due() function — kept for emergency manual
--     run if needed (just no longer scheduled)
--
-- To re-enable the calendar cron later if needed:
--   SELECT cron.schedule(
--     'create-recurring-invoices-daily',
--     '0 17 * * *',
--     $$ SELECT public.create_recurring_invoices_due(); $$
--   );
-- ============================================================================

BEGIN;

SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname = 'create-recurring-invoices-daily';

-- Verify only Oracle + lifecycle cron remain
SELECT jobname, schedule, command FROM cron.job ORDER BY jobname;

COMMIT;
