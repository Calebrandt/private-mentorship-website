-- ============================================================
-- Phase 19c.1 — Bookkeeping foundation
-- ============================================================
-- Audit-grade financial layer. Auto-numbered receipts +
-- paycheques, link receipts to invoices, append-only audit log
-- on every money-touching change.
--
-- Builds on top of existing schema. Does NOT modify the existing
-- invoices / invoice_lines / sales_receipts / sales_receipt_lines
-- tables beyond a single non-destructive column add (the
-- invoice_id link).
--
-- After this migration runs, the system has:
--   • Sequential RCP-NNNNNN numbering on every receipt
--   • Sequential PAY-NNNNNN numbering on every paycheque
--   • Receipt → invoice traceability
--   • Paycheques table for assistant payouts
--   • Auto-audit-log writes on every INSERT/UPDATE/DELETE of
--     invoices, receipts, paycheques
--   • A unified read view (v_financial_documents) so the admin
--     financials page can list everything chronologically in
--     one query
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. RECEIPT AUTO-NUMBERING (matches invoice pattern)
-- ─────────────────────────────────────────────────────────────

-- Sequence + format function: RCP-000001, RCP-000002, …
CREATE SEQUENCE IF NOT EXISTS public.sales_receipts_receipt_number_seq
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE OR REPLACE FUNCTION public.sales_receipts_set_receipt_number()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  -- Only auto-assign if not already provided
  IF NEW.receipt_number IS NULL OR NEW.receipt_number = '' THEN
    n := nextval('public.sales_receipts_receipt_number_seq');
    NEW.receipt_number := 'RCP-' || lpad(n::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_receipts_set_receipt_number ON public.sales_receipts;
CREATE TRIGGER trg_sales_receipts_set_receipt_number
  BEFORE INSERT ON public.sales_receipts
  FOR EACH ROW EXECUTE FUNCTION public.sales_receipts_set_receipt_number();


-- ─────────────────────────────────────────────────────────────
-- 2. RECEIPT → INVOICE LINK
-- ─────────────────────────────────────────────────────────────
-- Lets us answer "which invoice did this receipt pay for?"
-- Nullable so cash-paid one-offs (gift card sale etc.) still work.

ALTER TABLE public.sales_receipts
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id);

CREATE INDEX IF NOT EXISTS idx_sales_receipts_invoice_id
  ON public.sales_receipts(invoice_id);


-- ─────────────────────────────────────────────────────────────
-- 3. PAYCHEQUES (assistant payouts)
-- ─────────────────────────────────────────────────────────────
-- Mirrors invoice structure but flows the opposite way:
-- money goes FROM PM TO an assistant. Auto-numbered, append-only.

CREATE TABLE IF NOT EXISTS public.paycheques (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paycheque_number    text UNIQUE,
  assistant_id        uuid NOT NULL REFERENCES public.profiles(id),
  pay_date            date NOT NULL DEFAULT current_date,
  period_start        date,
  period_end          date,
  hours_worked        numeric(12,2) DEFAULT 0,
  hourly_rate_cents   integer DEFAULT 0,
  gross_cents         integer DEFAULT 0,
  deductions_cents    integer DEFAULT 0,
  net_cents           integer DEFAULT 0,
  currency            text DEFAULT 'CAD',
  payment_mode        text DEFAULT 'e-transfer',
  reference           text,
  notes               text,
  status              text NOT NULL DEFAULT 'issued'
                      CHECK (status IN ('issued','paid','void','reissued')),
  reissued_from_id    uuid REFERENCES public.paycheques(id),
  reissued_to_id      uuid REFERENCES public.paycheques(id),
  voided_at           timestamptz,
  void_reason         text,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz DEFAULT now() NOT NULL,
  updated_at          timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paycheques_assistant_id ON public.paycheques(assistant_id);
CREATE INDEX IF NOT EXISTS idx_paycheques_pay_date     ON public.paycheques(pay_date DESC);
CREATE INDEX IF NOT EXISTS idx_paycheques_status       ON public.paycheques(status);

-- Per-session line items (one line per appointment the assistant worked)
CREATE TABLE IF NOT EXISTS public.paycheque_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paycheque_id        uuid NOT NULL REFERENCES public.paycheques(id) ON DELETE CASCADE,
  position            integer DEFAULT 0,
  appointment_id      uuid REFERENCES public.appointments(id),
  description         text NOT NULL,
  hours               numeric(12,2) DEFAULT 0,
  hourly_rate_cents   integer DEFAULT 0,
  line_total_cents    integer DEFAULT 0,
  created_at          timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paycheque_lines_paycheque_id ON public.paycheque_lines(paycheque_id);

-- Auto-numbering for paycheques (PAY-000001 …)
CREATE SEQUENCE IF NOT EXISTS public.paycheques_paycheque_number_seq
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE OR REPLACE FUNCTION public.paycheques_set_paycheque_number()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  n bigint;
BEGIN
  IF NEW.paycheque_number IS NULL OR NEW.paycheque_number = '' THEN
    n := nextval('public.paycheques_paycheque_number_seq');
    NEW.paycheque_number := 'PAY-' || lpad(n::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_paycheques_set_paycheque_number ON public.paycheques;
CREATE TRIGGER trg_paycheques_set_paycheque_number
  BEFORE INSERT ON public.paycheques
  FOR EACH ROW EXECUTE FUNCTION public.paycheques_set_paycheque_number();

-- Touch updated_at on every change
CREATE OR REPLACE FUNCTION public.set_updated_at_paycheques()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_paycheques_updated_at ON public.paycheques;
CREATE TRIGGER trg_paycheques_updated_at
  BEFORE UPDATE ON public.paycheques
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_paycheques();

-- RLS — admin only (assistants will see their own via a separate
-- policy later; for now, admin-only is the safe default)
ALTER TABLE public.paycheques        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paycheque_lines   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS paycheques_admin_all ON public.paycheques;
CREATE POLICY paycheques_admin_all ON public.paycheques
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS paycheque_lines_admin_all ON public.paycheque_lines;
CREATE POLICY paycheque_lines_admin_all ON public.paycheque_lines
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Assistants can read their own paycheques (so they can see
-- what they got paid + download PDFs eventually)
DROP POLICY IF EXISTS paycheques_assistant_select_own ON public.paycheques;
CREATE POLICY paycheques_assistant_select_own ON public.paycheques
  FOR SELECT TO authenticated
  USING (assistant_id = auth.uid());

DROP POLICY IF EXISTS paycheque_lines_assistant_select_own ON public.paycheque_lines;
CREATE POLICY paycheque_lines_assistant_select_own ON public.paycheque_lines
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.paycheques p
     WHERE p.id = paycheque_lines.paycheque_id
       AND p.assistant_id = auth.uid()
  ));


-- ─────────────────────────────────────────────────────────────
-- 4. APPEND-ONLY AUDIT LOG ON FINANCIAL CHANGES
-- ─────────────────────────────────────────────────────────────
-- One trigger function per table — writes a row into the
-- existing public.audit_logs table on every INSERT/UPDATE/DELETE.
-- The `details` jsonb captures both OLD and NEW for full diff
-- traceability (CRA-style).

CREATE OR REPLACE FUNCTION public.log_financial_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_action text;
  v_entity_id uuid;
  v_details jsonb;
BEGIN
  -- Determine action
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    v_entity_id := NEW.id;
    v_details := jsonb_build_object('new', row_to_json(NEW)::jsonb);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'updated';
    v_entity_id := NEW.id;
    v_details := jsonb_build_object(
      'old', row_to_json(OLD)::jsonb,
      'new', row_to_json(NEW)::jsonb
    );
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'deleted';
    v_entity_id := OLD.id;
    v_details := jsonb_build_object('old', row_to_json(OLD)::jsonb);
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), TG_TABLE_NAME || '.' || v_action, TG_TABLE_NAME, v_entity_id, v_details);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

-- Apply to every financial table. Drop-then-create makes the
-- migration safe to re-run.
DROP TRIGGER IF EXISTS trg_invoices_audit              ON public.invoices;
DROP TRIGGER IF EXISTS trg_invoice_lines_audit         ON public.invoice_lines;
DROP TRIGGER IF EXISTS trg_sales_receipts_audit        ON public.sales_receipts;
DROP TRIGGER IF EXISTS trg_sales_receipt_lines_audit   ON public.sales_receipt_lines;
DROP TRIGGER IF EXISTS trg_paycheques_audit            ON public.paycheques;
DROP TRIGGER IF EXISTS trg_paycheque_lines_audit       ON public.paycheque_lines;

CREATE TRIGGER trg_invoices_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.log_financial_change();

CREATE TRIGGER trg_invoice_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice_lines
  FOR EACH ROW EXECUTE FUNCTION public.log_financial_change();

CREATE TRIGGER trg_sales_receipts_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.sales_receipts
  FOR EACH ROW EXECUTE FUNCTION public.log_financial_change();

CREATE TRIGGER trg_sales_receipt_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.sales_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION public.log_financial_change();

CREATE TRIGGER trg_paycheques_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.paycheques
  FOR EACH ROW EXECUTE FUNCTION public.log_financial_change();

CREATE TRIGGER trg_paycheque_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.paycheque_lines
  FOR EACH ROW EXECUTE FUNCTION public.log_financial_change();


-- ─────────────────────────────────────────────────────────────
-- 5. UNIFIED FINANCIAL DOCUMENTS VIEW
-- ─────────────────────────────────────────────────────────────
-- One read for the admin financials list. Returns invoices,
-- receipts, paycheques as one chronological feed.

CREATE OR REPLACE VIEW public.v_financial_documents AS
SELECT
  'invoice'::text             AS doc_type,
  i.id                        AS doc_id,
  i.invoice_number            AS doc_number,
  i.invoice_date              AS doc_date,
  i.client_id                 AS party_id,
  'client'::text              AS party_role,
  c.full_name                 AS party_name,
  i.total_cents               AS gross_cents,
  i.amount_paid_cents         AS paid_cents,
  i.balance_due_cents         AS balance_cents,
  i.currency                  AS currency,
  i.status                    AS status,
  i.subject                   AS subject,
  i.customer_notes            AS notes,
  i.created_at                AS created_at,
  i.voided_at                 AS voided_at
FROM public.invoices i
LEFT JOIN public.clients c ON c.id = i.client_id

UNION ALL

SELECT
  'receipt'::text             AS doc_type,
  r.id                        AS doc_id,
  r.receipt_number            AS doc_number,
  r.receipt_date              AS doc_date,
  r.client_id                 AS party_id,
  'client'::text              AS party_role,
  c.full_name                 AS party_name,
  (r.total_amount * 100)::int AS gross_cents,
  (r.total_amount * 100)::int AS paid_cents,
  0                           AS balance_cents,
  'CAD'::text                 AS currency,
  CASE WHEN r.voided_at IS NULL THEN 'paid' ELSE 'void' END AS status,
  NULL::text                  AS subject,
  r.notes                     AS notes,
  r.created_at                AS created_at,
  r.voided_at                 AS voided_at
FROM public.sales_receipts r
LEFT JOIN public.clients c ON c.id = r.client_id

UNION ALL

SELECT
  'paycheque'::text           AS doc_type,
  p.id                        AS doc_id,
  p.paycheque_number          AS doc_number,
  p.pay_date                  AS doc_date,
  p.assistant_id              AS party_id,
  'assistant'::text           AS party_role,
  pf.full_name                AS party_name,
  p.net_cents                 AS gross_cents,
  p.net_cents                 AS paid_cents,
  0                           AS balance_cents,
  p.currency                  AS currency,
  p.status                    AS status,
  NULL::text                  AS subject,
  p.notes                     AS notes,
  p.created_at                AS created_at,
  p.voided_at                 AS voided_at
FROM public.paycheques p
LEFT JOIN public.profiles pf ON pf.id = p.assistant_id;

GRANT SELECT ON public.v_financial_documents TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- 6. VERIFICATION — run these after migration to confirm
-- ─────────────────────────────────────────────────────────────

-- Sequences exist?
SELECT 'sequences' AS check_type,
       string_agg(sequencename, ', ' ORDER BY sequencename) AS values
FROM pg_sequences
WHERE schemaname = 'public'
  AND sequencename IN ('invoices_invoice_number_seq',
                       'sales_receipts_receipt_number_seq',
                       'paycheques_paycheque_number_seq');

-- Triggers active?
SELECT 'triggers' AS check_type, count(*)::text AS values
FROM pg_trigger
WHERE tgname LIKE 'trg_%audit'
   OR tgname IN ('trg_invoices_set_invoice_number',
                 'trg_sales_receipts_set_receipt_number',
                 'trg_paycheques_set_paycheque_number');

-- View readable?
SELECT 'view' AS check_type, count(*)::text AS values
FROM public.v_financial_documents;

-- Paycheques table accessible (should be 0 rows initially)?
SELECT 'paycheques_count' AS check_type, count(*)::text AS values
FROM public.paycheques;
