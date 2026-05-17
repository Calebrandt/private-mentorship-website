-- ============================================================================
-- phase-19c7a-fix-audit-fk.sql
-- ----------------------------------------------------------------------------
-- The log_financial_change trigger from 19c.1 inserts auth.uid() into
-- audit_logs.user_id. In some contexts (notably pg_cron runs and our
-- create_recurring_invoices_due RPC) auth.uid() can return a UUID that
-- isn't a valid auth.users row — which trips the FK constraint
-- audit_logs_user_id_fkey (SQLSTATE 23503), rolls back the whole sub-
-- transaction, and prevents the invoice from being created.
--
-- Fix: make the trigger defensive — only stamp user_id if auth.uid()
-- points to a real auth.users row. Otherwise insert NULL (system actor).
--
-- Also: clear any stale last_error on the recurring schedules so the
-- next cron run starts fresh.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.log_financial_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_action    text;
  v_entity_id uuid;
  v_details   jsonb;
  v_uid       uuid;
BEGIN
  -- Map TG_OP → human-friendly action label + capture diff payload
  IF TG_OP = 'INSERT' THEN
    v_action    := 'created';
    v_entity_id := NEW.id;
    v_details   := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action    := 'updated';
    v_entity_id := NEW.id;
    v_details   := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
  ELSE -- DELETE
    v_action    := 'deleted';
    v_entity_id := OLD.id;
    v_details   := to_jsonb(OLD);
  END IF;

  -- DEFENSIVE: only stamp user_id if it points to a real auth.users row.
  -- Otherwise insert NULL (= system actor). Prevents 23503 FK violations
  -- when triggered from pg_cron / SECURITY DEFINER contexts where
  -- auth.uid() can return values not present in auth.users.
  v_uid := auth.uid();
  IF v_uid IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid) THEN
    v_uid := NULL;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (v_uid, TG_TABLE_NAME || '.' || v_action, TG_TABLE_NAME, v_entity_id, v_details);

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$func$;


-- Clear the stale last_error from Michael's row so the next cron run starts clean
UPDATE public.client_recurring_invoices
SET last_error    = NULL,
    last_error_at = NULL,
    updated_at    = now()
WHERE last_error IS NOT NULL;


-- Verify
SELECT c.full_name, r.next_invoice_date, r.enabled,
       r.total_invoices_created, r.last_error
FROM public.client_recurring_invoices r
JOIN public.clients c ON c.id = r.client_id
ORDER BY c.full_name;

COMMIT;
