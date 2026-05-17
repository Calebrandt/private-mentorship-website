-- ============================================================================
-- phase-19c10b-hours-running-low.sql
-- ----------------------------------------------------------------------------
-- Phase 19c.10b — proactive renewal nudge based on HOUR USAGE, not just the
-- calendar countdown. Real scenario this catches:
--
--   Ryan is on a 1-month / 24-hour plan. He blasts through 21 hours by
--   day 14 — but his contract doesn't end until day 30. The existing
--   contract_expiring_soon detector wouldn't fire for another 13 days,
--   and by then Ryan can't book any sessions because he's out of hours.
--
-- This detector fires at 75% utilization (warning) and 90% (critical).
-- Says: 'They're about to run out — send the next-term invoice EARLY.'
-- Action reuses create_renewal_invoice from Phase 19c.9.
--
-- Guards:
--   • Skips contracts already inside the contract_expiring_soon window
--     (≤3 days to end_at) — that detector handles those cases cleanly
--   • Skips frozen contracts
--   • Idempotent: won't double-create if a live hours_running_low thread
--     exists for the same contract
-- ============================================================================

BEGIN;

-- 1. Scenario seed
INSERT INTO public.assistant_scenarios (scenario_key, label, icon)
VALUES ('hours_running_low', 'Hours running low', '⏱️')
ON CONFLICT (scenario_key) DO NOTHING;


-- 2. Detector
CREATE OR REPLACE FUNCTION public.assistant_detect_hours_running_low(
  p_owner_user_id uuid
)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_row          record;
  v_thread_id    uuid;
  v_count        int := 0;
  v_used_hrs     numeric;
  v_total_hrs    numeric;
  v_left_hrs     numeric;
  v_pct          int;
  v_tier         text;
  v_days_to_end  int;
BEGIN
  FOR v_row IN
    SELECT
      ctr.id            AS contract_id,
      ctr.client_id,
      ctr.end_at,
      ctr.included_minutes,
      COALESCE(SUM(CASE WHEN hl.minutes_delta < 0 THEN -hl.minutes_delta ELSE 0 END), 0)::int AS used_minutes,
      COALESCE(c.billing_contact_name, c.full_name) AS recipient_label,
      cri.id            AS recurring_id,
      cri.quantity,
      cri.unit_price_cents
    FROM public.contracts ctr
    JOIN public.clients c ON c.id = ctr.client_id
    LEFT JOIN public.hours_ledger hl ON hl.contract_id = ctr.id
    LEFT JOIN public.client_recurring_invoices cri
           ON cri.client_id = ctr.client_id AND cri.enabled = true
    WHERE ctr.status = 'active'
      AND ctr.included_minutes > 0
      -- Stay out of contract_expiring_soon's ≤3-day window
      AND ctr.end_at::date > current_date + interval '3 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.contract_freezes f
        WHERE f.contract_id = ctr.id
          AND f.starts_on <= current_date
          AND (f.ends_on IS NULL OR f.ends_on > current_date)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.assistant_threads t
        WHERE t.contract_id = ctr.id
          AND t.scenario_key = 'hours_running_low'
          AND t.status IN ('open','awaiting_user','snoozed')
          AND t.owner_user_id = p_owner_user_id
      )
    GROUP BY ctr.id, ctr.client_id, ctr.end_at, ctr.included_minutes,
             c.billing_contact_name, c.full_name,
             cri.id, cri.quantity, cri.unit_price_cents
    HAVING COALESCE(SUM(CASE WHEN hl.minutes_delta < 0 THEN -hl.minutes_delta ELSE 0 END), 0)
           >= (ctr.included_minutes * 0.75)
  LOOP
    v_used_hrs    := ROUND(v_row.used_minutes / 60.0, 1);
    v_total_hrs   := ROUND(v_row.included_minutes / 60.0, 1);
    v_left_hrs    := ROUND((v_row.included_minutes - v_row.used_minutes) / 60.0, 1);
    v_pct         := ROUND((v_row.used_minutes::numeric / v_row.included_minutes::numeric) * 100)::int;
    v_tier        := CASE WHEN v_pct >= 90 THEN 'critical' ELSE 'warning' END;
    v_days_to_end := (v_row.end_at::date - current_date)::int;

    INSERT INTO public.assistant_threads (
      owner_user_id, scenario_key, title, subtitle,
      contract_id, client_id, status, context
    ) VALUES (
      p_owner_user_id, 'hours_running_low',
      COALESCE(v_row.recipient_label, 'Client') ||
        ' at ' || v_used_hrs || ' / ' || v_total_hrs || ' hrs · ' || v_left_hrs || ' left',
      v_pct || '% used · contract ends ' || to_char(v_row.end_at, 'Mon DD') ||
        CASE WHEN v_tier = 'critical' THEN ' · urgent' ELSE '' END,
      v_row.contract_id, v_row.client_id, 'awaiting_user',
      jsonb_build_object(
        'contract_id',    v_row.contract_id,
        'used_minutes',   v_row.used_minutes,
        'total_minutes',  v_row.included_minutes,
        'percent_used',   v_pct,
        'tier',           v_tier,
        'days_to_end',    v_days_to_end
      )
    ) RETURNING id INTO v_thread_id;

    INSERT INTO public.assistant_messages (thread_id, role, content_type, content)
    VALUES (v_thread_id, 'bot', 'text',
      CASE WHEN v_tier = 'critical' THEN
        '⚠️ ' || COALESCE(v_row.recipient_label, 'this family') ||
        ' is at ' || v_pct || '% of their plan (' || v_used_hrs || ' of ' || v_total_hrs ||
        ' hrs used, only ' || v_left_hrs || ' left). Contract still has ' || v_days_to_end ||
        ' days but they''re about to run out of hours. Send the next-term invoice NOW so ' ||
        'they don''t hit zero mid-month?'
      ELSE
        COALESCE(v_row.recipient_label, 'this family') ||
        ' has used ' || v_pct || '% of their hours (' || v_used_hrs || ' of ' || v_total_hrs ||
        ', ' || v_left_hrs || ' left). Contract ends on ' || to_char(v_row.end_at, 'Mon DD') ||
        ' (' || v_days_to_end || ' days). Want me to send the next-term invoice early so it''s ' ||
        'paid before they hit the wall?'
      END
    );

    IF v_row.recurring_id IS NOT NULL THEN
      INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
      VALUES (v_thread_id, 'bot', 'actions', NULL,
        jsonb_build_object('actions', jsonb_build_array(
          jsonb_build_object('key','create_renewal_invoice', 'label','Send renewal invoice now', 'style','primary'),
          jsonb_build_object('key','snooze_3d',              'label','Wait 3 days',               'style','ghost'),
          jsonb_build_object('key','dismiss',                'label','Stop tracking',             'style','ghost')
        )));
    ELSE
      INSERT INTO public.assistant_messages (thread_id, role, content_type, content, metadata)
      VALUES (v_thread_id, 'bot', 'actions', NULL,
        jsonb_build_object('actions', jsonb_build_array(
          jsonb_build_object('key','snooze_3d', 'label','Wait 3 days',    'style','ghost'),
          jsonb_build_object('key','dismiss',   'label','Stop tracking',  'style','ghost')
        )));
    END IF;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$func$;


-- 3. Wire into assistant_scan_now
CREATE OR REPLACE FUNCTION public.assistant_scan_now()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $func$
DECLARE
  v_uid                uuid;
  v_owner_id           uuid;
  v_inv_ready          int := 0;
  v_contract_wait      int := 0;
  v_overdue            int := 0;
  v_pay_expected       int := 0;
  v_contract_expiring  int := 0;
  v_hours_low          int := 0;
  v_total              int := 0;
  v_open_count         int := 0;
  v_notify_url         text;
  v_notify_secret      text;
  v_notify_request_id  bigint;
BEGIN
  v_uid := auth.uid();

  IF v_uid IS NULL THEN
    SELECT user_id INTO v_owner_id FROM public.profiles
    WHERE lower(role::text) IN ('owner','superadmin')
    ORDER BY created_at LIMIT 1;
  ELSE
    v_owner_id := v_uid;
  END IF;

  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No owner user found');
  END IF;

  v_inv_ready         := public.assistant_detect_invoice_ready_to_send(v_owner_id);
  v_contract_wait     := public.assistant_detect_contract_waiting_payment(v_owner_id);
  v_overdue           := public.assistant_detect_invoice_overdue(v_owner_id);
  v_pay_expected      := public.assistant_detect_payment_expected(v_owner_id);
  v_contract_expiring := public.assistant_detect_contract_expiring_soon(v_owner_id);
  v_hours_low         := public.assistant_detect_hours_running_low(v_owner_id);
  v_total := v_inv_ready + v_contract_wait + v_overdue + v_pay_expected + v_contract_expiring + v_hours_low;

  SELECT count(*) INTO v_open_count
  FROM public.assistant_threads
  WHERE owner_user_id = v_owner_id
    AND status IN ('open', 'awaiting_user');

  IF v_uid IS NULL AND v_open_count > 0 THEN
    BEGIN
      SELECT notify_url, cron_secret INTO v_notify_url, v_notify_secret
      FROM public.oracle_config WHERE id = 1;
      IF v_notify_url IS NOT NULL AND v_notify_secret IS NOT NULL THEN
        SELECT net.http_post(
          url := v_notify_url,
          headers := jsonb_build_object('Content-Type','application/json',
                                        'x-oracle-cron-secret', v_notify_secret),
          body := jsonb_build_object('owner_user_id', v_owner_id, 'source', 'cron')
        ) INTO v_notify_request_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN v_notify_request_id := NULL; END;
  END IF;

  RETURN jsonb_build_object(
    'ok',                          true,
    'owner_user_id',               v_owner_id,
    'invoice_ready_threads',       v_inv_ready,
    'contract_waiting_threads',    v_contract_wait,
    'invoice_overdue_threads',     v_overdue,
    'payment_expected_threads',    v_pay_expected,
    'contract_expiring_threads',   v_contract_expiring,
    'hours_running_low_threads',   v_hours_low,
    'total_threads_created',       v_total,
    'open_thread_count',           v_open_count,
    'notify_request_id',           v_notify_request_id,
    'run_at',                      now()
  );
END;
$func$;

COMMIT;
