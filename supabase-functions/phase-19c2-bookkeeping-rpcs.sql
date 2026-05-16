-- ============================================================
-- Phase 19c.2 — Atomic bookkeeping RPCs
-- ============================================================
-- The actual business logic that makes one button do everything:
--
--   issue_invoice                 → admin creates an invoice
--   record_payment_received       → admin marks an invoice paid,
--                                    creates a sales_receipt,
--                                    optionally creates a NEW
--                                    contract + carryover ledger
--                                    entry — all atomic
--   issue_paycheque               → admin pays an assistant
--   void_invoice / _receipt / _paycheque  → soft-void with reason
--   reissue_invoice               → void old + clone-as-new
--
-- Every RPC:
--   • SECURITY DEFINER + SET search_path=public — runs with the
--     definer's privileges so RLS doesn't get in the way
--   • Calls is_admin() at the top — non-admins get rejected
--   • Wraps everything in an implicit transaction (PL/pgSQL
--     functions are atomic by default — one error rolls all back)
--   • Returns jsonb so the JS service layer gets every id back
--     in one round-trip
--   • Audit-logs every change automatically via the triggers
--     installed in 19c.1 (no extra work needed here)
--
-- Run ONCE in Supabase SQL editor. Idempotent (OR REPLACE).
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- issue_invoice
-- ─────────────────────────────────────────────────────────────
-- p_lines is a jsonb array of:
--   { "description": "Standard 24-hr plan",
--     "quantity": 1,
--     "unit_price_cents": 120000,
--     "hours": 24,
--     "hourly_rate_cents": 5000 }
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_invoice(
  p_client_id       uuid,
  p_lines           jsonb,
  p_invoice_date    date    DEFAULT current_date,
  p_due_date        date    DEFAULT NULL,
  p_subject         text    DEFAULT NULL,
  p_customer_notes  text    DEFAULT NULL,
  p_terms           text    DEFAULT 'Due on Receipt',
  p_currency        text    DEFAULT 'CAD',
  p_salesperson     text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_invoice_id      uuid;
  v_invoice_number  text;
  v_subtotal_cents  int := 0;
  v_line            jsonb;
  v_line_total      int;
  v_pos             int := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can issue invoices' USING ERRCODE = '42501';
  END IF;
  IF p_client_id IS NULL THEN
    RAISE EXCEPTION 'client_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required' USING ERRCODE = '22023';
  END IF;

  -- Pre-compute subtotal so we can store totals in one go
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_subtotal_cents := v_subtotal_cents
      + COALESCE((v_line->>'unit_price_cents')::int, 0)
      * COALESCE((v_line->>'quantity')::int, 1);
  END LOOP;

  -- Insert invoice header (auto-numbered via existing trigger)
  INSERT INTO public.invoices (
    client_id, status, invoice_date, due_date, terms,
    subject, customer_notes, currency, salesperson_name,
    subtotal_cents, tax_cents, total_cents,
    amount_paid_cents, balance_due_cents, amount_cents
  ) VALUES (
    p_client_id, 'open', p_invoice_date, COALESCE(p_due_date, p_invoice_date), p_terms,
    p_subject, p_customer_notes, p_currency, p_salesperson,
    v_subtotal_cents, 0, v_subtotal_cents,
    0, v_subtotal_cents, v_subtotal_cents
  )
  RETURNING id, invoice_number INTO v_invoice_id, v_invoice_number;

  -- Insert line items
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_line_total :=
      COALESCE((v_line->>'unit_price_cents')::int, 0)
      * COALESCE((v_line->>'quantity')::int, 1);
    INSERT INTO public.invoice_lines (
      invoice_id, position, description, quantity,
      unit_price_cents, line_total_cents, hours, hourly_rate_cents
    ) VALUES (
      v_invoice_id, v_pos,
      COALESCE(v_line->>'description', 'Service'),
      COALESCE((v_line->>'quantity')::numeric, 1),
      COALESCE((v_line->>'unit_price_cents')::int, 0),
      v_line_total,
      NULLIF(v_line->>'hours','')::numeric,
      NULLIF(v_line->>'hourly_rate_cents','')::int
    );
    v_pos := v_pos + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'invoice_id', v_invoice_id,
    'invoice_number', v_invoice_number,
    'total_cents', v_subtotal_cents
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.issue_invoice(uuid, jsonb, date, date, text, text, text, text, text) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- record_payment_received
-- ─────────────────────────────────────────────────────────────
-- Atomically:
--   • Inserts sales_receipts row (auto-numbered RCP-NNNNNN)
--   • Copies the invoice's lines into sales_receipt_lines
--   • Updates invoice.amount_paid_cents += payment, balance_due_cents -=
--     If balance hits 0 → status becomes 'paid'
--     Otherwise stays 'open' (partial payment supported)
--   • Optionally creates a NEW contract row (if p_create_contract_args
--     provided) and writes carryover to hours_ledger
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_payment_received(
  p_invoice_id              uuid,
  p_amount_cents            int,
  p_payment_mode            text    DEFAULT 'cash',
  p_reference               text    DEFAULT NULL,
  p_notes                   text    DEFAULT NULL,
  p_receipt_date            date    DEFAULT current_date,
  p_create_contract_args    jsonb   DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_invoice            record;
  v_receipt_id         uuid;
  v_receipt_number     text;
  v_new_paid           int;
  v_new_balance        int;
  v_new_status         text;
  v_contract_id        uuid;
  v_ledger_id          uuid;
  v_carry_hours        numeric := 0;
  v_included_minutes   int;
  v_start              date;
  v_end                date;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can record payments' USING ERRCODE = '42501';
  END IF;
  IF p_invoice_id IS NULL OR p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'invoice_id and positive amount_cents are required' USING ERRCODE = '22023';
  END IF;

  -- Lock the invoice row so concurrent payments can't double-count
  SELECT * INTO v_invoice
  FROM public.invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found: %', p_invoice_id USING ERRCODE = '22023';
  END IF;
  IF v_invoice.status = 'void' THEN
    RAISE EXCEPTION 'Cannot pay a voided invoice' USING ERRCODE = '22023';
  END IF;

  -- 1) Create the sales_receipt (auto-numbered)
  INSERT INTO public.sales_receipts (
    client_id, invoice_id, receipt_date, total_amount,
    payment_mode, reference, notes
  ) VALUES (
    v_invoice.client_id, p_invoice_id, p_receipt_date, (p_amount_cents / 100.0),
    p_payment_mode, p_reference, p_notes
  )
  RETURNING id, receipt_number INTO v_receipt_id, v_receipt_number;

  -- 2) Copy invoice lines into receipt lines (1:1 mirror)
  INSERT INTO public.sales_receipt_lines (
    receipt_id, line_index, description, quantity, unit_price, hourly_rate, hours
  )
  SELECT v_receipt_id, position,
         description, quantity, (unit_price_cents / 100.0),
         CASE WHEN hourly_rate_cents IS NULL THEN NULL ELSE hourly_rate_cents / 100.0 END,
         hours
  FROM public.invoice_lines
  WHERE invoice_id = p_invoice_id
  ORDER BY position;

  -- 3) Update the invoice's running totals + status
  v_new_paid    := COALESCE(v_invoice.amount_paid_cents, 0) + p_amount_cents;
  v_new_balance := GREATEST(0, COALESCE(v_invoice.total_cents, 0) - v_new_paid);
  v_new_status  := CASE WHEN v_new_balance = 0 THEN 'paid' ELSE 'open' END;

  UPDATE public.invoices
     SET amount_paid_cents = v_new_paid,
         balance_due_cents = v_new_balance,
         status            = v_new_status::invoice_status,
         updated_at        = now()
   WHERE id = p_invoice_id;

  -- 4) Optionally create a new contract + carryover ledger entry
  --    p_create_contract_args:
  --    { "included_hours": 24,
  --      "start_at": "2026-05-15",
  --      "end_at":   "2026-06-14",
  --      "carry_hours": 2.75,         -- optional, defaults 0
  --      "assistant_id": "<uuid>",    -- optional
  --      "renewal_mode": "auto"       -- optional
  --    }
  IF p_create_contract_args IS NOT NULL THEN
    v_included_minutes := (COALESCE((p_create_contract_args->>'included_hours')::numeric, 0) * 60)::int;
    v_start := COALESCE((p_create_contract_args->>'start_at')::date, current_date);
    v_end   := COALESCE((p_create_contract_args->>'end_at')::date,   v_start + INTERVAL '1 month');
    v_carry_hours := COALESCE((p_create_contract_args->>'carry_hours')::numeric, 0);

    INSERT INTO public.contracts (
      client_id, status, start_at, end_at,
      included_minutes, renewal_mode, assistant_id,
      created_by, activated_at
    ) VALUES (
      v_invoice.client_id,
      'active',
      v_start::timestamptz,
      (v_end + INTERVAL '1 day' - INTERVAL '1 second')::timestamptz,
      v_included_minutes,
      COALESCE(p_create_contract_args->>'renewal_mode', 'auto'),
      NULLIF(p_create_contract_args->>'assistant_id','')::uuid,
      auth.uid(),
      now()
    )
    RETURNING id INTO v_contract_id;

    -- Carryover ledger entry, if any
    IF v_carry_hours > 0 THEN
      INSERT INTO public.hours_ledger (client_id, delta_hours, reason)
      VALUES (
        v_invoice.client_id,
        v_carry_hours,
        'Carryover from previous contract (invoice ' || v_invoice.invoice_number || ')'
      )
      RETURNING id INTO v_ledger_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'receipt_id',       v_receipt_id,
    'receipt_number',   v_receipt_number,
    'invoice_status',   v_new_status,
    'amount_paid_cents', v_new_paid,
    'balance_cents',    v_new_balance,
    'contract_id',      v_contract_id,
    'ledger_entry_id',  v_ledger_id
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.record_payment_received(uuid, int, text, text, text, date, jsonb) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- issue_paycheque
-- ─────────────────────────────────────────────────────────────
-- p_lines is a jsonb array of:
--   { "description": "May 12 — Michael Yang (3h)",
--     "appointment_id": "<uuid>" (optional),
--     "hours": 3,
--     "hourly_rate_cents": 4500 }
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_paycheque(
  p_assistant_id     uuid,
  p_lines            jsonb,
  p_pay_date         date    DEFAULT current_date,
  p_period_start     date    DEFAULT NULL,
  p_period_end       date    DEFAULT NULL,
  p_payment_mode     text    DEFAULT 'e-transfer',
  p_reference        text    DEFAULT NULL,
  p_notes            text    DEFAULT NULL,
  p_deductions_cents int     DEFAULT 0,
  p_currency         text    DEFAULT 'CAD'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_paycheque_id     uuid;
  v_paycheque_number text;
  v_gross_cents      int := 0;
  v_hours_total      numeric := 0;
  v_line             jsonb;
  v_line_total       int;
  v_hours            numeric;
  v_rate_cents       int;
  v_pos              int := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can issue paycheques' USING ERRCODE = '42501';
  END IF;
  IF p_assistant_id IS NULL THEN
    RAISE EXCEPTION 'assistant_id is required' USING ERRCODE = '22023';
  END IF;
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one line item is required' USING ERRCODE = '22023';
  END IF;

  -- Pre-compute gross + total hours
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_hours       := COALESCE((v_line->>'hours')::numeric, 0);
    v_rate_cents  := COALESCE((v_line->>'hourly_rate_cents')::int, 0);
    v_gross_cents := v_gross_cents + (v_hours * v_rate_cents)::int;
    v_hours_total := v_hours_total + v_hours;
  END LOOP;

  -- Insert paycheque header (auto-numbered via trigger)
  INSERT INTO public.paycheques (
    assistant_id, pay_date, period_start, period_end,
    hours_worked, gross_cents, deductions_cents, net_cents,
    currency, payment_mode, reference, notes,
    status, created_by
  ) VALUES (
    p_assistant_id, p_pay_date, p_period_start, p_period_end,
    v_hours_total, v_gross_cents, p_deductions_cents,
    GREATEST(0, v_gross_cents - p_deductions_cents),
    p_currency, p_payment_mode, p_reference, p_notes,
    'issued', auth.uid()
  )
  RETURNING id, paycheque_number INTO v_paycheque_id, v_paycheque_number;

  -- Insert line items
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_hours       := COALESCE((v_line->>'hours')::numeric, 0);
    v_rate_cents  := COALESCE((v_line->>'hourly_rate_cents')::int, 0);
    v_line_total  := (v_hours * v_rate_cents)::int;
    INSERT INTO public.paycheque_lines (
      paycheque_id, position, appointment_id, description,
      hours, hourly_rate_cents, line_total_cents
    ) VALUES (
      v_paycheque_id, v_pos,
      NULLIF(v_line->>'appointment_id','')::uuid,
      COALESCE(v_line->>'description', 'Hours worked'),
      v_hours, v_rate_cents, v_line_total
    );
    v_pos := v_pos + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'paycheque_id',     v_paycheque_id,
    'paycheque_number', v_paycheque_number,
    'gross_cents',      v_gross_cents,
    'net_cents',        GREATEST(0, v_gross_cents - p_deductions_cents)
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.issue_paycheque(uuid, jsonb, date, date, date, text, text, text, int, text) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- void_invoice / void_receipt / void_paycheque
-- ─────────────────────────────────────────────────────────────
-- Soft-void: writes voided_at + reason, flips status to 'void'.
-- Does NOT delete — keeps the audit trail intact (CRA needs it).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_invoice(p_invoice_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can void invoices' USING ERRCODE = '42501';
  END IF;
  UPDATE public.invoices
     SET status      = 'void'::invoice_status,
         voided_at   = now(),
         void_reason = p_reason,
         updated_at  = now()
   WHERE id = p_invoice_id AND voided_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found or already voided' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('ok', true, 'invoice_id', p_invoice_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.void_invoice(uuid, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.void_receipt(p_receipt_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_invoice_id uuid;
  v_amount     numeric;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can void receipts' USING ERRCODE = '42501';
  END IF;

  -- Roll back the invoice's paid amount if this receipt was linked
  SELECT invoice_id, total_amount INTO v_invoice_id, v_amount
  FROM public.sales_receipts WHERE id = p_receipt_id AND voided_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found or already voided' USING ERRCODE = '22023';
  END IF;

  UPDATE public.sales_receipts
     SET voided_at = now(), void_reason = p_reason
   WHERE id = p_receipt_id;

  IF v_invoice_id IS NOT NULL THEN
    UPDATE public.invoices
       SET amount_paid_cents = GREATEST(0, amount_paid_cents - (v_amount * 100)::int),
           balance_due_cents = LEAST(total_cents, balance_due_cents + (v_amount * 100)::int),
           status            = CASE
                                  WHEN balance_due_cents + (v_amount * 100)::int > 0 THEN 'open'::invoice_status
                                  ELSE status
                                END,
           updated_at        = now()
     WHERE id = v_invoice_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'receipt_id', p_receipt_id, 'invoice_id', v_invoice_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.void_receipt(uuid, text) TO authenticated;


CREATE OR REPLACE FUNCTION public.void_paycheque(p_paycheque_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can void paycheques' USING ERRCODE = '42501';
  END IF;
  UPDATE public.paycheques
     SET status = 'void', voided_at = now(), void_reason = p_reason, updated_at = now()
   WHERE id = p_paycheque_id AND voided_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paycheque not found or already voided' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('ok', true, 'paycheque_id', p_paycheque_id);
END; $$;
GRANT EXECUTE ON FUNCTION public.void_paycheque(uuid, text) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- reissue_invoice
-- ─────────────────────────────────────────────────────────────
-- Voids the old invoice + creates a brand-new one with the same
-- client + lines + subject + notes. Linked via reissued_from /
-- reissued_to ... but wait, invoices table doesn't have those
-- columns; only sales_receipts does. We track linkage via the
-- void_reason text instead ("Reissued as INV-000123").
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reissue_invoice(p_invoice_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_old        record;
  v_new_id     uuid;
  v_new_number text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can reissue invoices' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found' USING ERRCODE = '22023';
  END IF;
  IF v_old.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice already voided' USING ERRCODE = '22023';
  END IF;

  -- Clone the header
  INSERT INTO public.invoices (
    client_id, status, invoice_date, due_date, terms,
    subject, customer_notes, currency, salesperson_name,
    subtotal_cents, tax_cents, total_cents,
    amount_paid_cents, balance_due_cents, amount_cents
  ) VALUES (
    v_old.client_id, 'open', current_date, current_date, v_old.terms,
    v_old.subject, v_old.customer_notes, v_old.currency, v_old.salesperson_name,
    v_old.subtotal_cents, v_old.tax_cents, v_old.total_cents,
    0, v_old.total_cents, v_old.total_cents
  )
  RETURNING id, invoice_number INTO v_new_id, v_new_number;

  -- Clone the lines
  INSERT INTO public.invoice_lines (
    invoice_id, position, description, quantity,
    unit_price_cents, line_total_cents, hours, hourly_rate_cents
  )
  SELECT v_new_id, position, description, quantity,
         unit_price_cents, line_total_cents, hours, hourly_rate_cents
  FROM public.invoice_lines
  WHERE invoice_id = p_invoice_id
  ORDER BY position;

  -- Void the old
  UPDATE public.invoices
     SET status      = 'void'::invoice_status,
         voided_at   = now(),
         void_reason = COALESCE(p_reason, 'Reissued') || ' (reissued as ' || v_new_number || ')',
         updated_at  = now()
   WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'ok', true,
    'old_invoice_id', p_invoice_id,
    'new_invoice_id', v_new_id,
    'new_invoice_number', v_new_number
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.reissue_invoice(uuid, text) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- Verify all RPCs were installed
-- ─────────────────────────────────────────────────────────────
SELECT 'rpcs_installed' AS check_type,
       string_agg(proname, ', ' ORDER BY proname) AS values
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('issue_invoice','record_payment_received','issue_paycheque',
                  'void_invoice','void_receipt','void_paycheque','reissue_invoice');
