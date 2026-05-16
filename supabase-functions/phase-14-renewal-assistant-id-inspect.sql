-- ─────────────────────────────────────────────────────────────────────────
-- Phase 14 (inspection step): retrieve ensure_future_contract_drafts source
-- ─────────────────────────────────────────────────────────────────────────
-- The function is server-only (not tracked in this folder). To safely patch
-- it without losing any logic, dump the current source first, then paste it
-- back so we can write the corrected CREATE OR REPLACE in step 14.b.
--
-- ALSO: defensive backfill. Any contract draft currently sitting with a
-- NULL assistant_id where the same client has a non-null assistant_id on
-- an earlier contract gets repaired now. This patches damage already done
-- by the bug, independent of the function fix.
-- ─────────────────────────────────────────────────────────────────────────


-- STEP 1: Show me the function source. Paste the `definition` column back
-- in the chat so I can write the patched version.
SELECT pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname = 'ensure_future_contract_drafts';


-- STEP 2: How many draft contracts are currently broken? (NULL assistant_id
-- on a draft, but the client HAS a prior contract with an assistant_id we
-- could copy from.) Run this read-only first.
SELECT
  d.id            AS draft_contract_id,
  d.client_id,
  d.status,
  d.start_at,
  d.end_at,
  d.assistant_id  AS draft_assistant_id,
  (SELECT prev.assistant_id
     FROM public.contracts prev
    WHERE prev.client_id = d.client_id
      AND prev.assistant_id IS NOT NULL
      AND prev.created_at <= d.created_at
    ORDER BY prev.created_at DESC
    LIMIT 1)      AS would_inherit_assistant_id
FROM public.contracts d
WHERE d.assistant_id IS NULL
  AND d.status IN ('draft','active')
ORDER BY d.created_at DESC;


-- STEP 3: Defensive backfill (commented out — review STEP 2 first, then
-- uncomment and run to repair existing drafts).
-- This sets assistant_id on any draft/pending/active contract that's
-- currently NULL, copying from the most recent prior contract for the
-- same client that DID have an assistant_id.
--
-- UPDATE public.contracts d
--    SET assistant_id = sub.would_inherit
--   FROM (
--     SELECT
--       c.id,
--       (SELECT prev.assistant_id
--          FROM public.contracts prev
--         WHERE prev.client_id = c.client_id
--           AND prev.assistant_id IS NOT NULL
--           AND prev.created_at <= c.created_at
--         ORDER BY prev.created_at DESC
--         LIMIT 1) AS would_inherit
--     FROM public.contracts c
--    WHERE c.assistant_id IS NULL
--      AND c.status IN ('draft','pending','active')
--   ) sub
--  WHERE d.id = sub.id
--    AND sub.would_inherit IS NOT NULL;
