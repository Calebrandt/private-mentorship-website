-- ============================================================================
-- phase-19c8c1-cron-email-firing.sql
-- ----------------------------------------------------------------------------
-- Makes assistant_scan_now() automatically fire the digest email via
-- pg_net at the end of each scan. Cron fires at 16:00 UTC (9 AM PT)
-- → Caleb wakes up to the digest in his inbox. No clicks required.
--
-- Generates a shared secret used by Postgres → edge function. Same
-- secret must also be added to the oracle-notify function's secrets
-- in the Supabase dashboard.
--
-- AFTER RUNNING THIS, Caleb must:
--   1. Copy the returned secret (oracle_cron_secret_copy_this column)
--   2. Add it as ORACLE_CRON_SECRET in Supabase Function secrets
--   3. Redeploy oracle-notify with the cron-bypass code
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS _oracle_setup;
CREATE TEMP TABLE _oracle_setup (secret text);

DO $$
DECLARE
  v_secret text := 'oracle-cron-' || encode(gen_random_bytes(24), 'hex');
  v_url    text := 'https://llkicgphkvciumfzhbkk.supabase.co/functions/v1/oracle-notify';
BEGIN
  EXECUTE format('ALTER DATABASE postgres SET app.oracle_notify_url   = %L', v_url);
  EXECUTE format('ALTER DATABASE postgres SET app.oracle_cron_secret  = %L', v_secret);
  EXECUTE format('SET app.oracle_notify_url  = %L', v_url);
  EXECUTE format('SET app.oracle_cron_secret = %L', v_secret);
  INSERT INTO _oracle_setup VALUES (v_secret);
END $$;


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
    SELECT user_id INTO v_owner_id FROM public.profiles
    WHERE role IN ('OWNER','SUPERADMIN','SuperAdmin','Owner')
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
      v_notify_url    := current_setting('app.oracle_notify_url',  true);
      v_notify_secret := current_setting('app.oracle_cron_secret', true);

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


SELECT secret AS oracle_cron_secret_copy_this FROM _oracle_setup;

COMMIT;
