-- ─────────────────────────────────────────────────────────────────────────
-- Phase 9: Restore apply_hours_ledger trigger
-- ─────────────────────────────────────────────────────────────────────────
-- Audit caught: clients.hours_balance is a stored field that NO trigger
-- updates. Every cancel/forfeit correctly writes hours_ledger rows, and
-- v_contract_balance.remaining_minutes reflects those writes immediately,
-- but clients.hours_balance just sits at whatever it was initialized to.
--
-- 9 UI surfaces and 2 service-layer functions read clients.hours_balance:
--   • client-schedule.html (right-column "X hours remaining" + token math)
--   • client-dashboard.html (Hours KPI)
--   • client-contract.html (contract details)
--   • client-hours.html (Hours KPI)
--   • admin-dashboard.html (client roster column)
--   • hiring-service.js: fetchMyClientRecord, adminListClients,
--     admin total-hours aggregation
--
-- Likely cause: the original trigger was dropped during the migration
-- from the legacy schema (delta_hours / appointment_instances) to the
-- canonical schema (minutes_delta / appointments / v_contract_balance).
-- The view became the source of truth; the stored column was orphaned.
--
-- Fix: restore the trigger so clients.hours_balance follows the ledger,
-- + a one-time backfill so existing client rows are correct on day one.
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_hours_ledger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_client uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_target_client := OLD.client_id;
  ELSE
    v_target_client := NEW.client_id;
  END IF;

  IF v_target_client IS NULL THEN RETURN NULL; END IF;

  UPDATE public.clients c
     SET hours_balance = (
       SELECT GREATEST(0, COALESCE(SUM(v.remaining_minutes), 0)::numeric / 60.0)
         FROM public.v_contract_balance v
         WHERE v.client_id = c.id
           AND v.status = 'active'
     )
   WHERE c.id = v_target_client;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_hours_ledger ON public.hours_ledger;
CREATE TRIGGER trg_apply_hours_ledger
  AFTER INSERT OR UPDATE OR DELETE ON public.hours_ledger
  FOR EACH ROW EXECUTE FUNCTION public.apply_hours_ledger();

-- One-time backfill: re-sync every client's hours_balance from the ledger
-- to repair any drift accumulated while the trigger was absent.
UPDATE public.clients c
   SET hours_balance = (
     SELECT GREATEST(0, COALESCE(SUM(v.remaining_minutes), 0)::numeric / 60.0)
       FROM public.v_contract_balance v
       WHERE v.client_id = c.id
         AND v.status = 'active'
   );
