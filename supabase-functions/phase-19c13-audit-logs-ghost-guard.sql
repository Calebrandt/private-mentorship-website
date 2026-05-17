-- ============================================================================
-- phase-19c13-audit-logs-ghost-guard.sql
-- ----------------------------------------------------------------------------
-- Root-cause fix for the recurring 'audit_logs_user_id_fkey' violations.
--
-- Background: in some SECURITY DEFINER contexts (cron, edge functions,
-- nested RPC calls) auth.uid() can return a UID that's not in
-- auth.users. Every audit_logs INSERT that stamps user_id with that
-- ghost UID then trips the FK constraint and rolls back the parent
-- transaction.
--
-- We've patched individual functions (log_financial_change, several
-- assistant_action branches) to NULL-out ghost UIDs before insert. But
-- there are dozens of places that write audit_logs and any new code
-- can introduce the bug.
--
-- Bulletproof fix: a BEFORE INSERT trigger on audit_logs itself that
-- NULLs out user_id if it doesn't reference a real auth.users row.
-- ANY future audit insert (no matter who writes it) is now safe.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._audit_logs_nullify_ghost_user_id()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = NEW.user_id) THEN
    NEW.user_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_nullify_ghost ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_nullify_ghost
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public._audit_logs_nullify_ghost_user_id();

COMMIT;
