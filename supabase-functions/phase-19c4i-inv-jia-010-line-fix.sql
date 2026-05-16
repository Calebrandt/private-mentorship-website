-- ============================================================================
-- phase-19c4i-inv-jia-010-line-fix.sql  (revised — correct column names)
-- ----------------------------------------------------------------------------
-- Surgical fix for INV-JIA-010 — the line items got hand-entered with all
-- prices at 0 and the entire "24 hours of English Tutoring (2-month plan)"
-- string packed into the description. Invoice header total (108000 cents
-- = $1,080) is correct, but the line items don't reconcile against the
-- header, which any client / CRA auditor will flag immediately.
--
-- CORRECTED COLUMN NAMES — invoice_lines uses *_cents (int) columns, not
-- numeric-dollars like sales_receipt_lines. Specifically:
--   description           text
--   quantity              numeric
--   unit_price_cents      int          (NOT unit_price)
--   line_total_cents      int          (NOT a generated column — supply it)
--   hourly_rate_cents     int          (NOT hourly_rate)
--   hours                 numeric
--   position              int
--
-- Audit trail: the `log_financial_change` BEFORE trigger fires on every
-- UPDATE/INSERT/DELETE on invoices + invoice_lines. Both edits below are
-- captured in audit_logs — this is a recorded admin correction, not a
-- bypass.
-- ============================================================================

BEGIN;

-- ─── 1. Confirm the invoice exists + report current state ─────────────────
DO $$
DECLARE
  v_invoice_id   uuid;
  v_line_count   int;
  v_curr_subject text;
  v_curr_total   int;
BEGIN
  SELECT id, subject::text, total_cents
    INTO v_invoice_id, v_curr_subject, v_curr_total
  FROM public.invoices
  WHERE invoice_number = 'INV-JIA-010'
  LIMIT 1;

  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'INV-JIA-010 not found — aborting';
  END IF;

  SELECT count(*) INTO v_line_count FROM public.invoice_lines WHERE invoice_id = v_invoice_id;

  RAISE NOTICE 'Found INV-JIA-010 → id=%, current subject="%", header total_cents=%, line count=%',
    v_invoice_id, v_curr_subject, v_curr_total, v_line_count;
END $$;


-- ─── 2. Replace all line items with one clean, plan-catalog-conforming row ─
WITH inv AS (
  SELECT id FROM public.invoices WHERE invoice_number = 'INV-JIA-010'
)
DELETE FROM public.invoice_lines
WHERE invoice_id = (SELECT id FROM inv);

INSERT INTO public.invoice_lines (
  invoice_id,
  position,
  description,
  quantity,
  unit_price_cents,
  line_total_cents,
  hourly_rate_cents,
  hours
)
SELECT
  i.id,
  1,
  '2-month Standard plan — 24 reserved hours',
  24,           -- quantity (hours)
  4500,         -- unit_price_cents  → $45.00/hr
  108000,       -- line_total_cents  → 24 * $45.00 = $1,080.00
  4500,         -- hourly_rate_cents → mirrors unit_price for readability
  24            -- hours             → mirrors quantity for the hours ledger
FROM public.invoices i
WHERE i.invoice_number = 'INV-JIA-010';


-- ─── 3. Update the subject so it reads cleanly on the new PDF ─────────────
UPDATE public.invoices
   SET subject = '2-month Standard plan — 24 reserved hours'
 WHERE invoice_number = 'INV-JIA-010';


-- ─── 4. Verify reconciliation (header total === sum of line totals) ───────
SELECT
  'AFTER FIX' AS check_label,
  i.invoice_number,
  i.subject,
  (i.total_cents / 100.0)::numeric(10,2)                  AS header_total,
  count(l.id)                                             AS line_count,
  COALESCE(sum(l.line_total_cents), 0)::int               AS lines_sum_cents,
  (COALESCE(sum(l.line_total_cents), 0) / 100.0)::numeric(10,2) AS lines_sum,
  CASE
    WHEN i.total_cents = COALESCE(sum(l.line_total_cents), 0)
    THEN '✓ reconciles'
    ELSE '✗ mismatch — investigate'
  END AS reconciliation
FROM public.invoices i
LEFT JOIN public.invoice_lines l ON l.invoice_id = i.id
WHERE i.invoice_number = 'INV-JIA-010'
GROUP BY i.id, i.invoice_number, i.subject, i.total_cents;


-- ─── 5. Show the new line item ───────────────────────────────────────────
SELECT
  'NEW LINE ITEM' AS check_label,
  position,
  description,
  quantity,
  (unit_price_cents / 100.0)::numeric(10,2)  AS unit_price,
  (line_total_cents / 100.0)::numeric(10,2)  AS line_total,
  (hourly_rate_cents / 100.0)::numeric(10,2) AS hourly_rate,
  hours
FROM public.invoice_lines
WHERE invoice_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-JIA-010')
ORDER BY position;


-- ─── 6. Confirm the trigger captured the change ───────────────────────────
SELECT
  'AUDIT TRAIL' AS check_label,
  created_at,
  action,
  entity_type,
  entity_id::text
FROM public.audit_logs
WHERE entity_id IN (
  SELECT id FROM public.invoices WHERE invoice_number = 'INV-JIA-010'
  UNION
  SELECT id FROM public.invoice_lines
   WHERE invoice_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-JIA-010')
)
ORDER BY created_at DESC
LIMIT 10;

COMMIT;
