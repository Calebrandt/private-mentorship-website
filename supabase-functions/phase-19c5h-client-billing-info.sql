-- ============================================================================
-- phase-19c5h-client-billing-info.sql
-- ----------------------------------------------------------------------------
-- Populate billing contact info for the 3 active families so invoices &
-- receipts auto-render the BILLED TO section with the parent/guardian
-- details that should appear on every document.
--
-- The clients table already has `email` + `phone` columns; we add three
-- new optional columns for the data the existing schema doesn't cover:
--   billing_contact_name      — parent / guardian name (e.g. "Yaxi Jiang")
--   billing_email_secondary   — second guardian email (e.g. dad)
--   billing_address           — single-line postal address
--
-- All three are nullable so existing data is unaffected. The PDF
-- generator falls back gracefully when any field is empty.
--
-- DATA PROVIDED BY CALEB
--   • Daniel Jiang  ← Yaxi Jiang (jiangyaxi87@gmail.com, 778-996-1911)
--                     also Danbing7777@gmail.com (second guardian)
--   • Ryan Roe      ← Eileen Zhou (eileenzhoucc@gmail.com, 672-558-8867)
--                     Address: Burnaby, Brentwood
--   • Michael Yang  ← Hai Gen / Daniel Yang (danielyang.ubc@gmail.com)
--                     Address: 3549 W 50 Ave, Vancouver, BC
--
-- Idempotent — safe to re-run; ALTER uses IF NOT EXISTS, UPDATEs are
-- straight value sets.
-- ============================================================================

BEGIN;

-- ─── 1. Extend the clients table with the 3 new billing fields ───────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS billing_contact_name    text,
  ADD COLUMN IF NOT EXISTS billing_email_secondary text,
  ADD COLUMN IF NOT EXISTS billing_address         text;

COMMENT ON COLUMN public.clients.billing_contact_name    IS 'Parent / guardian name shown on invoices ("c/o Yaxi Jiang")';
COMMENT ON COLUMN public.clients.billing_email_secondary IS 'Second guardian email shown alongside primary on invoices';
COMMENT ON COLUMN public.clients.billing_address         IS 'Single-line postal address shown on invoices';


-- ─── 2. Preview the rows we're about to update ───────────────────────────
SELECT
  'BEFORE' AS state,
  id,
  full_name,
  email,
  phone,
  billing_contact_name,
  billing_email_secondary,
  billing_address
FROM public.clients
WHERE full_name ILIKE '%daniel jiang%'
   OR full_name ILIKE '%ryan roe%'
   OR full_name ILIKE '%michael yang%'
   OR full_name ILIKE '%hai gen%';


-- ─── 3. Daniel Jiang (parent: Yaxi Jiang) ────────────────────────────────
UPDATE public.clients
SET email                   = 'jiangyaxi87@gmail.com',
    phone                   = '778-996-1911',
    billing_contact_name    = 'Yaxi Jiang',
    billing_email_secondary = 'Danbing7777@gmail.com'
WHERE full_name ILIKE '%daniel jiang%';


-- ─── 4. Ryan Roe (parent: Eileen Zhou) ───────────────────────────────────
UPDATE public.clients
SET email                = 'eileenzhoucc@gmail.com',
    phone                = '672-558-8867',
    billing_contact_name = 'Eileen Zhou',
    billing_address      = 'Burnaby, Brentwood'
WHERE full_name ILIKE '%ryan roe%';


-- ─── 5. Michael Yang (parent: Hai Gen / Daniel Yang) ─────────────────────
UPDATE public.clients
SET email                = 'danielyang.ubc@gmail.com',
    billing_contact_name = 'Hai Gen',
    billing_address      = '3549 W 50 Ave, Vancouver, BC'
WHERE full_name ILIKE '%michael yang%' OR full_name ILIKE '%hai gen%';


-- ─── 6. Verify ───────────────────────────────────────────────────────────
SELECT
  'AFTER' AS state,
  id,
  full_name,
  email,
  phone,
  billing_contact_name,
  billing_email_secondary,
  billing_address
FROM public.clients
WHERE full_name ILIKE '%daniel jiang%'
   OR full_name ILIKE '%ryan roe%'
   OR full_name ILIKE '%michael yang%'
   OR full_name ILIKE '%hai gen%'
ORDER BY full_name;

COMMIT;
