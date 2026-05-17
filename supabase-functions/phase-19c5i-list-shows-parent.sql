-- ============================================================================
-- phase-19c5i-list-shows-parent.sql
-- ----------------------------------------------------------------------------
-- The Financials list (Invoices / Receipts tabs) currently shows the STUDENT
-- name in the "Client" column. Invoices and receipts don't go to the kids —
-- they go to the parent/guardian. Update the v_financial_documents view so
-- the party_name column prefers the parent's contact name when set, falling
-- back to the student's full_name otherwise. Paycheques unchanged (those
-- correctly show the assistant's name).
--
-- Also: per Caleb, Michael Yang's billing contact should be Daniel Yang
-- (the brother who actually manages the account), not Hai Gen.
-- ============================================================================

BEGIN;

-- ─── 1. Switch Michael Yang's contact name to Daniel Yang ─────────────────
UPDATE public.clients
SET billing_contact_name = 'Daniel Yang'
WHERE full_name ILIKE '%michael yang%';


-- ─── 2. Recreate v_financial_documents so party_name = parent → student ──
DROP VIEW IF EXISTS public.v_financial_documents;

CREATE VIEW public.v_financial_documents AS
SELECT 'invoice'::text         AS doc_type,
       i.id                    AS doc_id,
       i.invoice_number::text  AS doc_number,
       i.invoice_date          AS doc_date,
       i.client_id             AS party_id,
       'client'::text          AS party_role,
       -- ★ THE CHANGE: prefer billing_contact_name when set
       COALESCE(NULLIF(c.billing_contact_name, ''), c.full_name)::text AS party_name,
       i.total_cents           AS gross_cents,
       i.amount_paid_cents     AS paid_cents,
       i.balance_due_cents     AS balance_cents,
       i.currency::text        AS currency,
       i.status::text          AS status,
       i.subject::text         AS subject,
       i.customer_notes::text  AS notes,
       i.created_at            AS created_at,
       i.voided_at             AS voided_at
FROM public.invoices i
LEFT JOIN public.clients c ON c.id = i.client_id

UNION ALL

SELECT 'receipt'::text, r.id, r.receipt_number::text, r.receipt_date, r.client_id, 'client'::text,
       COALESCE(NULLIF(c.billing_contact_name, ''), c.full_name)::text,
       (r.total_amount * 100)::int, (r.total_amount * 100)::int, 0, 'CAD'::text,
       (CASE WHEN r.voided_at IS NULL THEN 'paid' ELSE 'void' END)::text,
       NULL::text, r.notes::text, r.created_at, r.voided_at
FROM public.sales_receipts r
LEFT JOIN public.clients c ON c.id = r.client_id

UNION ALL

-- Paycheques unchanged — those go to the assistant by name
SELECT 'paycheque'::text, p.id, p.paycheque_number::text, p.pay_date, p.assistant_id, 'assistant'::text,
       pf.full_name::text, p.net_cents, p.net_cents, 0, p.currency::text, p.status::text,
       NULL::text, p.notes::text, p.created_at, p.voided_at
FROM public.paycheques p
LEFT JOIN public.profiles pf ON pf.user_id = p.assistant_id;


-- ─── 3. Verify Michael Yang now shows Daniel Yang in the list ────────────
SELECT doc_type, doc_number, doc_date, party_name, status,
       gross_cents, balance_cents
FROM public.v_financial_documents
WHERE party_name ILIKE '%yang%'
   OR party_name ILIKE '%jiang%'
   OR party_name ILIKE '%roe%'
   OR party_name ILIKE '%zhou%'
   OR party_name ILIKE '%hai%'
ORDER BY doc_date DESC
LIMIT 20;

COMMIT;
