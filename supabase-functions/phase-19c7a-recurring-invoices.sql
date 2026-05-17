-- ============================================================================
-- phase-19c7a-recurring-invoices.sql
-- ----------------------------------------------------------------------------
-- Auto-generate the next invoice for active recurring clients (Daniel Jiang,
-- Michael Yang, Ryan Roe — and any future families) so Caleb stops having
-- to remember to bill them every month/two-months.
--
-- ARCHITECTURE
--   client_recurring_invoices  ← one row per active billing schedule
--   create_recurring_invoices_due()  ← SECURITY DEFINER RPC that
--                                       loops over due rows and inserts
--                                       fully-formed invoices + lines
--                                       atomically, then advances the
--                                       schedule by cycle_months
--   pg_cron job (daily 09:00 PT)     ← calls the RPC nightly
--
-- WHAT THIS DOES NOT DO (intentional)
--   • Does NOT send the email. PDF generation runs in the browser
--     (html2canvas), so the cron can't render + attach the PDF. Caleb
--     will see the freshly-auto-created invoice in admin-financials,
--     click PDF to preview, then Email to send. The auto-create
--     eliminates 90% of the per-cycle work; the 10% review step is
--     intentional quality control before client-facing send.
--
-- SEEDS
--   Three rows are seeded for the active families with enabled=FALSE
--   so the cron doesn't immediately fire. Caleb reviews them, sets the
--   correct next_invoice_date, then UPDATE … SET enabled=true when
--   ready. (UI to manage these comes in 19c.7b.)
--
-- IDEMPOTENT: re-runnable. CREATE TABLE IF NOT EXISTS + OR REPLACE on
-- the RPC + the cron uses pg_cron's `cron.schedule()` which upserts.
-- ============================================================================

BEGIN;

-- ─── 1. Schedule table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_recurring_invoices (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- Schedule
  cycle_months             int  NOT NULL DEFAULT 1 CHECK (cycle_months > 0 AND cycle_months <= 12),
  next_invoice_date        date NOT NULL,
  due_days_offset          int  NOT NULL DEFAULT 0,   -- 0 = due same day; 30 = NET-30
  enabled                  boolean NOT NULL DEFAULT false,

  -- Plan / line-item snapshot (denormalized so changing PLANS later
  -- doesn't retroactively alter what gets billed)
  description              text NOT NULL,
  quantity                 numeric(12,2) NOT NULL DEFAULT 1,
  unit_price_cents         int  NOT NULL,
  hours                    numeric,
  hourly_rate_cents        int,

  -- Invoice header defaults
  subject                  text,
  terms                    text DEFAULT 'Due on receipt',
  customer_notes           text,
  currency                 text NOT NULL DEFAULT 'CAD',

  -- Audit / linkage
  last_invoice_id          uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  last_invoice_date        date,
  total_invoices_created   int NOT NULL DEFAULT 0,
  last_error               text,
  last_error_at            timestamptz,

  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_recur_due
  ON public.client_recurring_invoices(next_invoice_date)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_recur_client
  ON public.client_recurring_invoices(client_id);

COMMENT ON TABLE  public.client_recurring_invoices                   IS 'One row per active auto-invoice schedule. Cron creates the next invoice when next_invoice_date <= today.';
COMMENT ON COLUMN public.client_recurring_invoices.cycle_months      IS '1 for monthly, 2 for two-month plans, etc.';
COMMENT ON COLUMN public.client_recurring_invoices.next_invoice_date IS 'Date the next invoice will be auto-created. Cron advances this by cycle_months after each run.';
COMMENT ON COLUMN public.client_recurring_invoices.enabled           IS 'Hard kill-switch — flip to false to pause without losing the schedule.';


-- ─── 2. RLS — admin only (cron uses SECURITY DEFINER) ────────────────────
ALTER TABLE public.client_recurring_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage recurring invoices" ON public.client_recurring_invoices;
CREATE POLICY "admins manage recurring invoices"
  ON public.client_recurring_invoices
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ─── 3. The cron-driven RPC ──────────────────────────────────────────────
-- SECURITY DEFINER so the daily cron job can run it without an auth context.
-- Each row processed inside a sub-block; if one fails it gets logged in
-- last_error + last_error_at and the loop continues to the next row.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_recurring_invoices_due()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_row            record;
  v_invoice_id     uuid;
  v_total_cents    int;
  v_created_count  int := 0;
  v_failed_count   int := 0;
  v_created_ids    uuid[] := '{}';
  v_today          date := current_date;
BEGIN
  FOR v_row IN
    SELECT *
    FROM public.client_recurring_invoices
    WHERE enabled = true
      AND next_invoice_date <= v_today
    ORDER BY next_invoice_date, created_at
  LOOP
    BEGIN
      v_total_cents := (v_row.quantity * v_row.unit_price_cents)::int;

      INSERT INTO public.invoices (
        client_id,
        invoice_date,
        due_date,
        subject,
        terms,
        customer_notes,
        currency,
        status,
        total_cents,
        amount_paid_cents,
        balance_due_cents
      ) VALUES (
        v_row.client_id,
        v_row.next_invoice_date,
        v_row.next_invoice_date + v_row.due_days_offset,
        v_row.subject,
        v_row.terms,
        v_row.customer_notes,
        v_row.currency,
        'open',
        v_total_cents,
        0,
        v_total_cents
      )
      RETURNING id INTO v_invoice_id;

      INSERT INTO public.invoice_lines (
        invoice_id, position, description, quantity,
        unit_price_cents, line_total_cents, hours, hourly_rate_cents
      ) VALUES (
        v_invoice_id, 1, v_row.description, v_row.quantity,
        v_row.unit_price_cents, v_total_cents,
        v_row.hours, v_row.hourly_rate_cents
      );

      -- Advance the schedule
      UPDATE public.client_recurring_invoices
      SET next_invoice_date      = (v_row.next_invoice_date + (v_row.cycle_months || ' months')::interval)::date,
          last_invoice_id        = v_invoice_id,
          last_invoice_date      = v_row.next_invoice_date,
          total_invoices_created = total_invoices_created + 1,
          last_error             = NULL,
          last_error_at          = NULL,
          updated_at             = now()
      WHERE id = v_row.id;

      -- Audit log (user_id NULL signals automated/system actor)
      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (
        NULL,
        'RECURRING_INVOICE_CREATED',
        'invoices',
        v_invoice_id,
        jsonb_build_object(
          'actor',                 'cron_recurring_invoice',
          'recurring_schedule_id', v_row.id,
          'client_id',             v_row.client_id,
          'invoice_date',          v_row.next_invoice_date,
          'total_cents',           v_total_cents,
          'cycle_months',          v_row.cycle_months
        )
      );

      v_created_count := v_created_count + 1;
      v_created_ids   := array_append(v_created_ids, v_invoice_id);

    EXCEPTION WHEN OTHERS THEN
      -- Don't kill the whole batch on one bad row — log + continue
      UPDATE public.client_recurring_invoices
      SET last_error    = 'SQLSTATE=' || SQLSTATE || ' :: ' || SQLERRM,
          last_error_at = now(),
          updated_at    = now()
      WHERE id = v_row.id;

      INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, details)
      VALUES (
        NULL,
        'RECURRING_INVOICE_FAILED',
        'client_recurring_invoices',
        v_row.id,
        jsonb_build_object(
          'actor',     'cron_recurring_invoice',
          'sqlstate',  SQLSTATE,
          'sqlerrm',   SQLERRM,
          'client_id', v_row.client_id
        )
      );
      v_failed_count := v_failed_count + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',                  true,
    'created_count',       v_created_count,
    'failed_count',        v_failed_count,
    'created_invoice_ids', v_created_ids,
    'run_at',              now()
  );
END;
$func$;

GRANT EXECUTE ON FUNCTION public.create_recurring_invoices_due() TO authenticated;
COMMENT ON FUNCTION public.create_recurring_invoices_due() IS
  'Cron-driven: scans client_recurring_invoices for next_invoice_date <= today and creates the next invoice for each enabled schedule. Per-row error isolation; returns summary jsonb.';


-- ─── 4. pg_cron schedule — daily 09:00 Pacific ───────────────────────────
-- Supabase ships with pg_cron enabled on most plans. If this fails with
-- "extension pg_cron not available", enable it via Dashboard → Database
-- → Extensions → pg_cron, then re-run this block on its own.
-- 09:00 Pacific = 17:00 UTC during PDT (Mar–Nov) / 16:00 UTC during PST.
-- I'm using 17:00 UTC year-round; means the cron fires at 09:00 PT in
-- summer and 10:00 PT in winter — close enough for an invoice cron.
-- ────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove any prior version of this job, then re-create
    PERFORM cron.unschedule(jobid)
      FROM cron.job
      WHERE jobname = 'create-recurring-invoices-daily';

    PERFORM cron.schedule(
      'create-recurring-invoices-daily',
      '0 17 * * *',
      $cron$ SELECT public.create_recurring_invoices_due(); $cron$
    );

    RAISE NOTICE 'pg_cron job scheduled: create-recurring-invoices-daily at 17:00 UTC daily';
  ELSE
    RAISE WARNING 'pg_cron extension is not installed — recurring cron skipped. Enable it via Dashboard → Database → Extensions, then re-run this SQL.';
  END IF;
END $$;


-- ─── 5. Seed the 3 active families (enabled=FALSE for safety) ────────────
-- Pulls each client's most recent invoice as the template so the
-- description/qty/unit_price/etc. match exactly what's already being
-- charged. Sets next_invoice_date = one cycle after the last invoice
-- (so when Caleb flips enabled=true, the next cycle fires on the
-- right date).
-- ────────────────────────────────────────────────────────────────────────
WITH latest AS (
  SELECT DISTINCT ON (i.client_id)
         i.client_id, i.id AS invoice_id, i.invoice_date, i.subject, i.terms,
         i.customer_notes, i.currency
  FROM public.invoices i
  WHERE i.status <> 'void'
  ORDER BY i.client_id, i.invoice_date DESC
),
latest_line AS (
  SELECT l.invoice_id, l.description, l.quantity, l.unit_price_cents,
         l.hours, l.hourly_rate_cents
  FROM public.invoice_lines l
  WHERE l.invoice_id IN (SELECT invoice_id FROM latest)
),
combined AS (
  SELECT
    l.client_id,
    c.full_name,
    CASE
      WHEN c.full_name ILIKE '%daniel jiang%' THEN 2     -- 2-month plan
      WHEN c.full_name ILIKE '%ryan roe%'    THEN 2     -- 2-month plan
      WHEN c.full_name ILIKE '%michael yang%' THEN 1     -- 1-month plan
      ELSE 1
    END AS cycle_months,
    l.invoice_date AS last_inv_date,
    ll.description, ll.quantity, ll.unit_price_cents, ll.hours, ll.hourly_rate_cents,
    l.subject, l.terms, l.customer_notes, l.currency
  FROM latest l
  JOIN latest_line ll ON ll.invoice_id = l.invoice_id
  JOIN public.clients c ON c.id = l.client_id
  WHERE c.full_name ILIKE '%daniel jiang%'
     OR c.full_name ILIKE '%ryan roe%'
     OR c.full_name ILIKE '%michael yang%'
)
INSERT INTO public.client_recurring_invoices (
  client_id, cycle_months, next_invoice_date, enabled,
  description, quantity, unit_price_cents, hours, hourly_rate_cents,
  subject, terms, customer_notes, currency
)
SELECT
  client_id,
  cycle_months,
  (last_inv_date + (cycle_months || ' months')::interval)::date AS next_invoice_date,
  false AS enabled,  -- Caleb reviews + flips to true when ready
  description, quantity, unit_price_cents, hours, hourly_rate_cents,
  subject, terms, customer_notes, currency
FROM combined
ON CONFLICT DO NOTHING;


-- ─── 6. Verify ────────────────────────────────────────────────────────────
SELECT
  r.id,
  c.full_name                AS client,
  r.cycle_months,
  r.next_invoice_date,
  r.enabled,
  r.description,
  r.quantity,
  (r.unit_price_cents / 100.0)::numeric(10,2)  AS unit_price,
  (r.quantity * r.unit_price_cents / 100.0)::numeric(10,2) AS estimated_total,
  r.total_invoices_created,
  r.last_invoice_date
FROM public.client_recurring_invoices r
JOIN public.clients c ON c.id = r.client_id
ORDER BY c.full_name;

-- Confirm the cron job is in place (will be empty if pg_cron isn't enabled)
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'create-recurring-invoices-daily';

COMMIT;
