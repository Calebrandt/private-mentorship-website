-- ============================================================================
-- phase-19c8c1-cron-email-firing.sql  (v2 — table-backed config)
-- ----------------------------------------------------------------------------
-- Makes assistant_scan_now() automatically fire the digest email via
-- pg_net at the end of each scan. Cron fires at 16:00 UTC (9 AM PT)
-- → Caleb wakes up to the digest in his inbox. No clicks required.
--
-- v1 tried ALTER DATABASE postgres SET app.xxx — Supabase SQL Editor
-- doesn't have permission for that. v2 stores the URL + shared secret
-- in a tiny oracle_config table (RLS-locked, no policies) so only
-- SECURITY DEFINER functions can read it.
--
-- AFTER RUNNING THIS, Caleb must:
--   1. Copy the returned secret (oracle_cron_secret_copy_this column)
--   2. Add it as ORACLE_CRON_SECRET in Supabase Function secrets
--   3. Redeploy oracle-notify with the cron-bypass code
-- ============================================================================

BEGIN;

-- 1. Config table (single-row pattern)
CREATE TABLE IF NOT EXISTS public.oracle_config (
  id          int PRIMARY KEY DEFAULT 1,
  notify_url  text NOT NULL,
  cron_secret text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT oracle_config_singleton CHECK (id = 1)
);

ALTER TABLE public.oracle_config ENABLE ROW LEVEL SECURITY;
-- No policies → only SECURITY DEFINER functions can read it. Perfect.

-- 2. Generate + insert secret
DROP TABLE IF EXISTS _oracle_setup;
CREATE TEMP TABLE _oracle_setup (secret text);

DO $$
DECLARE
  v_secret text := 'oracle-cron-' || encode(gen_random_bytes(24), 'hex');
  v_url    text := 'https://llkicgphkvciumfzhbkk.supabase.co/functions/v1/oracle-notify';
BEGIN
  INSERT INTO public.oracle_config (id, notify_url, cron_secret)
  VALUES (1, v_url, v_secret)
  ON CONFLICT (id) DO UPDATE
    SET notify_url  = EXCLUDED.notify_url,
        cron_secret = EXCLUDED.cron_secret,
        updated_at  = now();

  INSERT INTO _oracle_setup VALUES (v_secret);
END $$;

-- 3. Updated scan function reads from table instead of current_setting()
CREATE OR REPLACE FUNCTION public.assistant_scan_now()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid               uuid;
  v_owner_id          uuid;
  v_inv_ready         int := 0;
  v_contract_wait     int := 0;
  v_total             int := 0;
  v_open_count        int := 0;
  v_notify_url        text;
  v_notify_secret     text;
  v_notify_request_id bigint;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    -- Cast to text so the user_role enum doesn't reject the IN-list
    -- before the comparison can run (enum only contains lowercase values).
    SELECT user_id INTO v_owner_id FROM public.profiles
    WHERE lower(role::text) IN ('owner','superadmin')
    ORDER BY created_at LIMIT 1;
  ELSE
    v_owner_id := v_uid;
  END IF;

  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No owner user found');
  END IF;

  v_inv_ready     := public.assistant_detect_invoice_ready_to_send(v_owner_id);
  v_contract_wait := public.assistant_detect_contract_waiting_payment(v_owner_id);
  v_total         := v_inv_ready + v_contract_wait;

  SELECT count(*) INTO v_open_count
  FROM public.assistant_threads
  WHERE owner_user_id = v_owner_id
    AND status IN ('open', 'awaiting_user');

  -- Fire digest email — only from cron context (auth.uid() IS NULL).
  -- The browser's FAB handles email firing for user-initiated scans.
  IF v_uid IS NULL AND v_open_count > 0 THEN
    BEGIN
      SELECT notify_url, cron_secret
        INTO v_notify_url, v_notify_secret
      FROM public.oracle_config
      WHERE id = 1;

      IF v_notify_url IS NOT NULL AND v_notify_secret IS NOT NULL THEN
        SELECT net.http_post(
          url     := v_notify_url,
          headers := jsonb_build_object(
                       'Content-Type',          'application/json',
                       'x-oracle-cron-secret',  v_notify_secret
                     ),
          body    := jsonb_build_object(
                       'owner_user_id', v_owner_id,
                       'source',        'cron'
                     )
        ) INTO v_notify_request_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_notify_request_id := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok',                       true,
    'owner_user_id',            v_owner_id,
    'invoice_ready_threads',    v_inv_ready,
    'contract_waiting_threads', v_contract_wait,
    'total_threads_created',    v_total,
    'open_thread_count',        v_open_count,
    'notify_request_id',        v_notify_request_id,
    'run_at',                   now()
  );
END;
$func$;
GRANT EXECUTE ON FUNCTION public.assistant_scan_now() TO authenticated;

-- 4. Return the secret so you can copy it
SELECT secret AS oracle_cron_secret_copy_this FROM _oracle_setup;

COMMIT;
