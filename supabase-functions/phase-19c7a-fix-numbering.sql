-- ============================================================================
-- phase-19c7a-fix-numbering.sql
-- ----------------------------------------------------------------------------
-- The recurring-invoice cron in 19c.7a does a raw INSERT into invoices
-- (instead of going through the issue_invoice RPC), which bypassed the
-- INV-XXX-NNN numbering logic — the first auto-created invoice landed
-- with invoice_number = NULL. Caleb saw it as an empty Number cell in
-- the list.
--
-- Fix: a BEFORE INSERT trigger on invoices that fills in the number
-- when it's missing, using the same scheme as issue_invoice:
--   INV-{LAST3OFCLIENTLASTNAME}-{nextSeqForThatPrefix}
--   e.g.  INV-YAN-019, INV-JIA-011, INV-ROE-015
--
-- This trigger is safe for the existing issue_invoice path too — that
-- RPC explicitly sets invoice_number, so the IF NULL check just no-ops.
--
-- Also backfills the one auto-created invoice that landed without a
-- number so it gets the proper INV-YAN-019 (next in the YAN sequence).
-- ============================================================================

BEGIN;

-- 1. Numbering trigger ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
AS $func$
DECLARE
  v_client_name text;
  v_last_name   text;
  v_prefix      text;
  v_next_seq    int;
BEGIN
  -- No-op when the caller already provided a number (issue_invoice path)
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    SELECT full_name INTO v_client_name FROM public.clients WHERE id = NEW.client_id;

    -- Last word of the client's full name → first 3 chars uppercased.
    -- e.g. "Michael Yang" → "Yang" → "YAN"
    v_last_name := split_part(
      trim(coalesce(v_client_name, 'Unknown')), ' ',
      greatest(1, array_length(string_to_array(trim(coalesce(v_client_name, 'Unknown')), ' '), 1))
    );
    v_prefix := upper(left(v_last_name, 3));

    -- Next sequence number for THIS prefix only
    SELECT COALESCE(MAX(NULLIF(substring(invoice_number FROM '-(\d+)$'), '')::int), 0) + 1
    INTO v_next_seq
    FROM public.invoices
    WHERE invoice_number LIKE 'INV-' || v_prefix || '-%';

    NEW.invoice_number := 'INV-' || v_prefix || '-' || lpad(v_next_seq::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_invoices_assign_number ON public.invoices;
CREATE TRIGGER trg_invoices_assign_number
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_invoice_number();


-- 2. Backfill the auto-created invoice from the first cron run ─────────
UPDATE public.invoices
SET invoice_number = (
  SELECT 'INV-YAN-' || lpad(
    (COALESCE(MAX(NULLIF(substring(invoice_number FROM '-(\d+)$'), '')::int), 0) + 1)::text,
    3, '0')
  FROM public.invoices
  WHERE invoice_number LIKE 'INV-YAN-%'
)
WHERE invoice_number IS NULL OR invoice_number = '';


-- 3. Verify
SELECT invoice_number, invoice_date, total_cents,
       (SELECT full_name FROM public.clients WHERE id = invoices.client_id) AS student
FROM public.invoices
WHERE invoice_date >= current_date - 1
ORDER BY created_at DESC
LIMIT 5;

COMMIT;
