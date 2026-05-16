-- ============================================================
-- Phase 19c.1 — Bookkeeping foundation (FINAL, idempotent)
-- ============================================================
-- Audit-grade financial layer for Private Mentorship. Builds
-- on top of the existing invoices / invoice_lines tables.
-- Creates sales_receipts + paycheques + their numbering +
-- audit triggers + a unified read view.
--
-- Run safely from a clean OR partial state — every operation
-- is CREATE IF NOT EXISTS / OR REPLACE / DROP IF EXISTS.
--
-- VERIFICATION QUERIES AT BOTTOM.
-- ============================================================


-- 0. sales_receipts + sales_receipt_lines (created if missing)
CREATE TABLE IF NOT EXISTS public.sales_receipts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               timestamptz DEFAULT now() NOT NULL,
  client_id                uuid NOT NULL REFERENCES public.clients(id),
  receipt_number           text,
  receipt_date             date NOT NULL DEFAULT current_date,
  total_amount             numeric(12,2) DEFAULT 0 NOT NULL,
  payment_mode             text DEFAULT 'cash' NOT NULL,
  reference                text,
  notes                    text,
  terms                    text,
  customer_notes           text,
  terms_conditions         text,
  deleted_at               timestamptz,
  salesperson_name         text,
  billing_email            text,
  billing_phone            text,
  billing_address_line1    text,
  billing_address_line2    text,
  billing_city             text,
  billing_province         text,
  billing_postal_code      text,
  billing_country          text,
  voided_at                timestamptz,
  void_reason              text,
  reissued_from_receipt_id uuid,
  reissued_to_receipt_id   uuid
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sales_receipts_reissued_from_fk') THEN
    ALTER TABLE public.sales_receipts
      ADD CONSTRAINT sales_receipts_reissued_from_fk
      FOREIGN KEY (reissued_from_receipt_id) REFERENCES public.sales_receipts(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sales_receipts_reissued_to_fk') THEN
    ALTER TABLE public.sales_receipts
      ADD CONSTRAINT sales_receipts_reissued_to_fk
      FOREIGN KEY (reissued_to_receipt_id) REFERENCES public.sales_receipts(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_receipts_client_id    ON public.sales_receipts(client_id);
CREATE INDEX IF NOT EXISTS idx_sales_receipts_receipt_date ON public.sales_receipts(receipt_date DESC);

CREATE TABLE IF NOT EXISTS public.sales_receipt_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz DEFAULT now() NOT NULL,
  receipt_id      uuid NOT NULL REFERENCES public.sales_receipts(id) ON DELETE CASCADE,
  line_index      integer DEFAULT 0 NOT NULL,
  description     text NOT NULL,
  quantity        numeric(12,2) DEFAULT 1 NOT NULL,
  unit_price      numeric(12,2) DEFAULT 0 NOT NULL,
  line_total      numeric(12,2) GENERATED ALWAYS AS ((quantity * unit_price)) STORED,
  hourly_rate     numeric,
  hours           numeric
);
CREATE INDEX IF NOT EXISTS idx_sales_receipt_lines_receipt_id ON public.sales_receipt_lines(receipt_id);

ALTER TABLE public.sales_receipts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_receipt_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_receipts_admin_all ON public.sales_receipts;
CREATE POLICY sales_receipts_admin_all ON public.sales_receipts
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS sales_receipts_client_select_own ON public.sales_receipts;
CREATE POLICY sales_receipts_client_select_own ON public.sales_receipts
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.clients c
             WHERE c.id = sales_receipts.client_id AND c.profile_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.family_assignments fa
                WHERE fa.client_id = sales_receipts.client_id AND fa.user_id = auth.uid())
  );

DROP POLICY IF EXISTS sales_receipt_lines_admin_all ON public.sales_receipt_lines;
CREATE POLICY sales_receipt_lines_admin_all ON public.sales_receipt_lines
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());


-- 1. Receipt auto-numbering (RCP-000001 …)
CREATE SEQUENCE IF NOT EXISTS public.sales_receipts_receipt_number_seq
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE OR REPLACE FUNCTION public.sales_receipts_set_receipt_number()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  IF NEW.receipt_number IS NULL OR NEW.receipt_number = '' THEN
    n := nextval('public.sales_receipts_receipt_number_seq');
    NEW.receipt_number := 'RCP-' || lpad(n::text, 6, '0');
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sales_receipts_set_receipt_number ON public.sales_receipts;
CREATE TRIGGER trg_sales_receipts_set_receipt_number
  BEFORE INSERT ON public.sales_receipts
  FOR EACH ROW EXECUTE FUNCTION public.sales_receipts_set_receipt_number();


-- 2. Receipt → invoice link
ALTER TABLE public.sales_receipts
  ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id);
CREATE INDEX IF NOT EXISTS idx_sales_receipts_invoice_id ON public.sales_receipts(invoice_id);


-- 3. Paycheques (assistant payouts)
-- assistant_id + created_by reference auth.users(id) directly so the
-- migration is independent of the profiles table's column naming.
CREATE TABLE IF NOT EXISTS public.paycheques (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paycheque_number    text UNIQUE,
  assistant_id        uuid NOT NULL REFERENCES auth.users(id),
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
  reissued_from_id    uuid,
  reissued_to_id      uuid,
  voided_at           timestamptz,
  void_reason         text,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz DEFAULT now() NOT NULL,
  updated_at          timestamptz DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='paycheques_reissued_from_fk') THEN
    ALTER TABLE public.paycheques
      ADD CONSTRAINT paycheques_reissued_from_fk FOREIGN KEY (reissued_from_id) REFERENCES public.paycheques(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='paycheques_reissued_to_fk') THEN
    ALTER TABLE public.paycheques
      ADD CONSTRAINT paycheques_reissued_to_fk FOREIGN KEY (reissued_to_id) REFERENCES public.paycheques(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_paycheques_assistant_id ON public.paycheques(assistant_id);
CREATE INDEX IF NOT EXISTS idx_paycheques_pay_date     ON public.paycheques(pay_date DESC);
CREATE INDEX IF NOT EXISTS idx_paycheques_status       ON public.paycheques(status);

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

CREATE SEQUENCE IF NOT EXISTS public.paycheques_paycheque_number_seq
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE OR REPLACE FUNCTION public.paycheques_set_paycheque_number()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  IF NEW.paycheque_number IS NULL OR NEW.paycheque_number = '' THEN
    n := nextval('public.paycheques_paycheque_number_seq');
    NEW.paycheque_number := 'PAY-' || lpad(n::text, 6, '0');
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_paycheques_set_paycheque_number ON public.paycheques;
CREATE TRIGGER trg_paycheques_set_paycheque_number
  BEFORE INSERT ON public.paycheques
  FOR EACH ROW EXECUTE FUNCTION public.paycheques_set_paycheque_number();

CREATE OR REPLACE FUNCTION public.set_updated_at_paycheques()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_paycheques_updated_at ON public.paycheques;
CREATE TRIGGER trg_paycheques_updated_at
  BEFORE UPDATE ON public.paycheques
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_paycheques();

ALTER TABLE public.paycheques      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paycheque_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS paycheques_admin_all ON public.paycheques;
CREATE POLICY paycheques_admin_all ON public.paycheques
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS paycheque_lines_admin_all ON public.paycheque_lines;
CREATE POLICY paycheque_lines_admin_all ON public.paycheque_lines
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS paycheques_assistant_select_own ON public.paycheques;
CREATE POLICY paycheques_assistant_select_own ON public.paycheques
  FOR SELECT TO authenticated
  USING (assistant_id = auth.uid());

DROP POLICY IF EXISTS paycheque_lines_assistant_select_own ON public.paycheque_lines;
CREATE POLICY paycheque_lines_assistant_select_own ON public.paycheque_lines
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.paycheques p
                  WHERE p.id = paycheque_lines.paycheque_id AND p.assistant_id = auth.uid()));


-- 4. Auto audit-log on every financial change
CREATE OR REPLACE FUNCTION public.log_financial_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_action text; v_entity_id uuid; v_details jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created'; v_entity_id := NEW.id;
    v_details := jsonb_build_object('new', row_to_json(NEW)::jsonb);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'updated'; v_entity_id := NEW.id;
    v_details := jsonb_build_object('old', row_to_json(OLD)::jsonb, 'new', row_to_json(NEW)::jsonb);
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'deleted'; v_entity_id := OLD.id;
    v_details := jsonb_build_object('old', row_to_json(OLD)::jsonb);
  END IF;
  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
  VALUES (auth.uid(), TG_TABLE_NAME || '.' || v_action, TG_TABLE_NAME, v_entity_id, v_details);
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;

DROP TRIGGER IF EXISTS trg_invoices_audit              ON public.invoices;
DROP TRIGGER IF EXISTS trg_invoice_lines_audit         ON public.invoice_lines;
DROP TRIGGER IF EXISTS trg_sales_receipts_audit        ON public.sales_receipts;
DROP TRIGGER IF EXISTS trg_sales_receipt_lines_audit   ON public.sales_receipt_lines;
DROP TRIGGER IF EXISTS trg_paycheques_audit            ON public.paycheques;
DROP TRIGGER IF EXISTS trg_paycheque_lines_audit       ON public.paycheque_lines;

CREATE TRIGGER trg_invoices_audit              AFTER INSERT OR UPDATE OR DELETE ON public.invoices              FOR EACH ROW EXECUTE FUNCTION public.log_financial_change();
CREATE TRIGGER trg_invoice_lines_audit         AFTER INSERT OR UPDATE OR DELETE ON public.invoice_lines         FOR EACH ROW EXECUTE FUNCTION public.log_financial_change();
CREATE TRIGGER trg_sales_receipts_audit        AFTER INSERT OR UPDATE OR DELETE ON public.sales_receipts        FOR EACH ROW EXECUTE FUNCTION public.log_financial_change();
CREATE TRIGGER trg_sales_receipt_lines_audit   AFTER INSERT OR UPDATE OR DELETE ON public.sales_receipt_lines   FOR EACH ROW EXECUTE FUNCTION public.log_financial_change();
CREATE TRIGGER trg_paycheques_audit            AFTER INSERT OR UPDATE OR DELETE ON public.paycheques            FOR EACH ROW EXECUTE FUNCTION public.log_financial_change();
CREATE TRIGGER trg_paycheque_lines_audit       AFTER INSERT OR UPDATE OR DELETE ON public.paycheque_lines       FOR EACH ROW EXECUTE FUNCTION public.log_financial_change();


-- 5. Unified read view — ::text casts handle invoice_status enum
CREATE OR REPLACE VIEW public.v_financial_documents AS
SELECT 'invoice'::text         AS doc_type,
       i.id                    AS doc_id,
       i.invoice_number::text  AS doc_number,
       i.invoice_date          AS doc_date,
       i.client_id             AS party_id,
       'client'::text          AS party_role,
       c.full_name::text       AS party_name,
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
       c.full_name::text, (r.total_amount * 100)::int, (r.total_amount * 100)::int, 0, 'CAD'::text,
       (CASE WHEN r.voided_at IS NULL THEN 'paid' ELSE 'void' END)::text,
       NULL::text, r.notes::text, r.created_at, r.voided_at
FROM public.sales_receipts r
LEFT JOIN public.clients c ON c.id = r.client_id

UNION ALL

SELECT 'paycheque'::text, p.id, p.paycheque_number::text, p.pay_date, p.assistant_id, 'assistant'::text,
       pf.full_name::text, p.net_cents, p.net_cents, 0, p.currency::text, p.status::text,
       NULL::text, p.notes::text, p.created_at, p.voided_at
FROM public.paycheques p
LEFT JOIN public.profiles pf ON pf.user_id = p.assistant_id;

GRANT SELECT ON public.v_financial_documents TO authenticated;


-- 6. Verification
SELECT 'tables' AS check_type,
       string_agg(table_name, ', ' ORDER BY table_name) AS values
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('invoices','invoice_lines','sales_receipts','sales_receipt_lines','paycheques','paycheque_lines');

SELECT 'sequences' AS check_type,
       string_agg(sequencename, ', ' ORDER BY sequencename) AS values
FROM pg_sequences
WHERE schemaname = 'public'
  AND sequencename IN ('invoices_invoice_number_seq','sales_receipts_receipt_number_seq','paycheques_paycheque_number_seq');

SELECT 'audit_triggers' AS check_type, count(*)::text AS values
FROM pg_trigger WHERE tgname LIKE 'trg_%_audit';

SELECT 'view_rows' AS check_type, count(*)::text AS values FROM public.v_financial_documents;
