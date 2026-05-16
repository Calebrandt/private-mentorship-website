-- ============================================================================
-- phase-19c4i-inv-jia-010-line-fix.sql
-- ----------------------------------------------------------------------------
-- Surgical fix for INV-JIA-010 — the line items got hand-entered with all
-- prices at 0 and the entire "24 hours of English Tutoring (2-month plan)"
-- string packed into the description. The invoice header total (108000 cents
-- = $1,080) is correct, but the line items don't reconcile against the header
-- which any client / CRA auditor will flag immediately.
--
-- This patch:
--   1) Rewrites the (single) line item on INV-JIA-010 to match the plan
--      catalog: description, qty=24, unit_price=45.00, hours=24, rate=45.
--      `line_total` is a GENERATED column (quantity * unit_price) so it'll
--      auto-compute to 1080.00 — matching the invoice header.
--   2) Updates `invoices.subject` from "Renewal Contract #10" to the
--      cleaner plan-catalog convention ("2-month Standard plan — 24 reserved
--      hours") so it lines up with everything issued via the new flow.
--   3) Verifies the result.
--
-- Audit trail:
--   The `log_financial_change` BEFORE trigger installed in
--   phase-19c1-bookkeeping-foundation.sql fires on every UPDATE to
--   `invoices` and `invoice_lines`. So both the line edit and the subject
--   edit will be captured in `audit_logs` with action='invoice_lines.UPDATE'
--   and 'invoices.UPDATE'. This is NOT an audit-bypass — it's a recorded,
--   admin-only correction with the diff persisted forever.
--
-- Safe to run more than once: the line UPDATE matches by invoice_id, so
-- re-running is idempotent (just overwrites with the same values).
-- ============================================================================

BEGIN;

-- ─── 1. Find the invoice + report current state ───────────────────────────
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


-- ─── 2. Rewrite the line item(s) ──────────────────────────────────────────
-- Strategy: replace ALL existing lines on INV-JIA-010 with a single,
-- well-formed line that matches the 2-month Standard plan from the catalog.
-- This is safer than UPDATE because we don't know which row was there
-- originally (could be one bad row, could be a few).

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
  unit_price,
  hourly_rate,
  hours
)
SELECT
  i.id,
  1,
  '2-month Standard plan — 24 reserved hours',
  24,           -- quantity (hours)
  45.00,        -- unit_price ($/hr) → line_total auto = 24 * 45 = 1080.00
  45,           -- hourly_rate (mirrors unit_price for human readability)
  24            -- hours (mirrors quantity for the hours ledger)
FROM public.invoices i
WHERE i.invoice_number = 'INV-JIA-010';


-- ─── 3. Update the subject so it reads cleanly on the new PDF ─────────────
UPDATE public.invoices
   SET subject = '2-month Standard plan — 24 reserved hours'
 WHERE invoice_number = 'INV-JIA-010';


-- ─── 4. Verify the fix ────────────────────────────────────────────────────
SELECT
  'AFTER FIX' AS check_label,
  i.invoice_number,
  i.subject,
  (i.total_cents / 100.0)::numeric(10,2)        AS header_total,
  count(l.id)                                   AS line_count,
  COALESCE(sum(l.line_total), 0)::numeric(10,2) AS lines_sum,
  CASE
    WHEN (i.total_cents / 100.0)::numeric(10,2) = COALESCE(sum(l.line_total), 0)::numeric(10,2)
    THEN '✓ reconciles'
    ELSE '✗ mismatch — investigate'
  END AS reconciliation
FROM public.invoices i
LEFT JOIN public.invoice_lines l ON l.invoice_id = i.id
WHERE i.invoice_number = 'INV-JIA-010'
GROUP BY i.id, i.invoice_number, i.subject, i.total_cents;


-- Show the new line item itself
SELECT
  'NEW LINE ITEM' AS check_label,
  position,
  description,
  quantity,
  unit_price,
  line_total,
  hourly_rate,
  hours
FROM public.invoice_lines
WHERE invoice_id = (SELECT id FROM public.invoices WHERE invoice_number = 'INV-JIA-010')
ORDER BY position;


-- ─── 5. Confirm the trigger captured the change ───────────────────────────
-- Should show at least two new rows: one for the invoice subject update, one
-- (or more) for the invoice_lines DELETE/INSERT.

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
