-- ============================================================================
-- Membership Change approval RPCs (Phase 3)
-- Atomic, server-side approval/rejection for the membership_change_requests
-- engine. Mirrors the app's onApprove + onFinalize logic in ONE call.
--
-- Per the Master Engineering Manual:
--   - Active contracts are immutable; changes go through future drafts
--   - Replaces existing future draft if one exists
--   - Writes recurring patterns to the new draft
--   - SKIPS inventory generation (drafts don't get inventory until promoted by
--     pg_cron's run_contract_lifecycle_tick)
--   - Records approved_by + reviewed_at atomically with status change
--
-- Deploy: paste this entire file into Supabase Dashboard → SQL Editor → Run.
-- ============================================================================

-- ─── APPROVE ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_approve_membership_change(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_req public.membership_change_requests%ROWTYPE;
  v_current public.contracts%ROWTYPE;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_new_minutes int;
  v_renewal_mode text;
  v_policy_version text;
  v_draft_id uuid;
  v_replaced_count int := 0;
  v_pattern_count int := 0;
  v_slot jsonb;
  v_dow int;
  v_start_t text;
  v_dur int;
BEGIN
  -- 1. Verify caller is admin/owner.
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT role::text INTO v_caller_role FROM public.profiles WHERE user_id = v_caller_id;
  IF UPPER(COALESCE(v_caller_role, '')) NOT IN ('OWNER','ADMIN','SUPERADMIN') THEN
    RAISE EXCEPTION 'Forbidden — admin/owner role required (caller role: %)', v_caller_role;
  END IF;

  -- 2. Load the request.
  SELECT * INTO v_req FROM public.membership_change_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request not found: %', p_request_id;
  END IF;
  IF v_req.status NOT IN ('pending','client_accepted_review','awaiting_client_review') THEN
    RAISE EXCEPTION 'Request status is % — cannot approve', v_req.status;
  END IF;

  -- 3. Load the current contract (if linked).
  IF v_req.current_contract_id IS NOT NULL THEN
    SELECT * INTO v_current FROM public.contracts WHERE id = v_req.current_contract_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked current contract not found: %', v_req.current_contract_id;
    END IF;
  END IF;

  -- 4. Compute new contract window from the requested plan key.
  --    Plan keys follow the pattern '{months}mo_{hours}h' e.g. '1mo_24h', '2mo_40h'.
  IF v_req.requested_plan_key IS NULL THEN
    RAISE EXCEPTION 'Request has no requested_plan_key';
  END IF;

  -- Parse plan key (defensive — fall back to 1 month / 40 hours).
  DECLARE
    v_months int := 1;
    v_hours  int := 40;
  BEGIN
    v_months := COALESCE(NULLIF(SUBSTRING(v_req.requested_plan_key FROM '^([0-9]+)mo'), '')::int, 1);
    v_hours  := COALESCE(NULLIF(SUBSTRING(v_req.requested_plan_key FROM '_([0-9]+)h$'), '')::int, 40);
    v_new_minutes := v_hours * 60;
    -- New contract starts when current ends (or now() if no current contract).
    v_new_start := COALESCE(v_current.end_at, NOW());
    v_new_end   := v_new_start + (v_months || ' months')::interval;
  END;

  -- 5. Inherit renewal_mode + policy_version from current contract (if any).
  v_renewal_mode := COALESCE(v_current.renewal_mode, 'manual');
  v_policy_version := COALESCE(v_current.policy_version, 'v1');

  -- 6. Replace any existing draft contract for this client at this start time.
  --    (Per manual: lifecycle replaces drafts; we delete then recreate atomically.)
  DELETE FROM public.contracts
   WHERE client_id = v_req.client_id
     AND status = 'draft'
     AND start_at = v_new_start
  RETURNING id INTO v_draft_id; -- captures one if many

  GET DIAGNOSTICS v_replaced_count = ROW_COUNT;

  -- 7. Insert the new draft contract.
  INSERT INTO public.contracts (
    client_id, status, start_at, end_at, included_minutes,
    policy_version, renewal_mode, notes, created_by
  )
  VALUES (
    v_req.client_id, 'draft', v_new_start, v_new_end, v_new_minutes,
    v_policy_version, v_renewal_mode,
    'membership_change_approved_from:' || COALESCE(v_req.current_contract_id::text, 'none')
      || ' planKey:' || v_req.requested_plan_key
      || ' policy:' || v_policy_version,
    v_caller_id
  )
  RETURNING id INTO v_draft_id;

  -- 8. Write recurring patterns to the new draft, from reviewed_schedule
  --    (admin's reviewed slots) — falls back to requested_schedule if reviewed not set.
  --    Both are jsonb arrays of { day_of_week, start_time_local, duration_minutes, timezone? }
  DECLARE
    v_schedule jsonb := COALESCE(v_req.reviewed_schedule, v_req.requested_schedule, '[]'::jsonb);
  BEGIN
    IF jsonb_typeof(v_schedule) = 'array' THEN
      FOR v_slot IN SELECT * FROM jsonb_array_elements(v_schedule) LOOP
        -- Defensive parsing: tolerate either { day_of_week } or { day }
        v_dow := COALESCE(
          NULLIF(v_slot->>'day_of_week','')::int,
          NULL
        );
        IF v_dow IS NULL THEN
          -- Try to map text day to int (Sun=0..Sat=6)
          DECLARE v_day_text text := UPPER(COALESCE(v_slot->>'day',''));
          BEGIN
            v_dow := CASE v_day_text
              WHEN 'SUN' THEN 0 WHEN 'SUNDAY' THEN 0
              WHEN 'MON' THEN 1 WHEN 'MONDAY' THEN 1
              WHEN 'TUE' THEN 2 WHEN 'TUESDAY' THEN 2
              WHEN 'WED' THEN 3 WHEN 'WEDNESDAY' THEN 3
              WHEN 'THU' THEN 4 WHEN 'THURSDAY' THEN 4
              WHEN 'FRI' THEN 5 WHEN 'FRIDAY' THEN 5
              WHEN 'SAT' THEN 6 WHEN 'SATURDAY' THEN 6
              ELSE NULL
            END;
          END;
        END IF;
        v_start_t := COALESCE(v_slot->>'start_time_local', v_slot->>'start_time', NULL);
        v_dur     := COALESCE(NULLIF(v_slot->>'duration_minutes','')::int, 60);

        IF v_dow IS NULL OR v_start_t IS NULL THEN
          CONTINUE; -- skip malformed slot rather than failing the whole approval
        END IF;

        INSERT INTO public.contract_recurring_patterns
          (contract_id, day_of_week, start_time_local, duration_minutes, timezone)
        VALUES (
          v_draft_id, v_dow, v_start_t::time, v_dur,
          COALESCE(v_slot->>'timezone', 'America/Vancouver')
        );
        v_pattern_count := v_pattern_count + 1;
      END LOOP;
    END IF;
  END;

  -- 9. Inventory is NOT generated here — pg_cron's run_contract_lifecycle_tick
  --    will generate inventory once the draft is promoted to active at the
  --    contract boundary. (Per manual section 5.3 + 8.4 fix #3.)

  -- 10. Mark request approved.
  UPDATE public.membership_change_requests
     SET status = 'approved',
         approved_by = v_caller_id,
         reviewed_at = NOW(),
         admin_response = 'approved · replaced_draft_count=' || v_replaced_count
                         || ' · draft_contract_id=' || v_draft_id::text
                         || ' · patterns=' || v_pattern_count
   WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'draft_contract_id', v_draft_id,
    'replaced_drafts', v_replaced_count,
    'patterns_written', v_pattern_count,
    'new_start_at', v_new_start,
    'new_end_at', v_new_end,
    'new_included_minutes', v_new_minutes
  );
END;
$$;

-- ─── REJECT ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_reject_membership_change(
  p_request_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_caller_role text;
  v_updated_count int;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  SELECT role::text INTO v_caller_role FROM public.profiles WHERE user_id = v_caller_id;
  IF UPPER(COALESCE(v_caller_role, '')) NOT IN ('OWNER','ADMIN','SUPERADMIN') THEN
    RAISE EXCEPTION 'Forbidden — admin/owner role required';
  END IF;

  UPDATE public.membership_change_requests
     SET status = 'rejected',
         rejected_by = v_caller_id,
         reviewed_at = NOW(),
         rejection_reason = COALESCE(NULLIF(TRIM(p_reason), ''), 'Rejected by admin'),
         admin_response = COALESCE(NULLIF(TRIM(p_reason), ''), 'Rejected by admin')
   WHERE id = p_request_id
     AND status IN ('pending','client_accepted_review','awaiting_client_review');

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count = 0 THEN
    RAISE EXCEPTION 'Request not found or not in a rejectable state: %', p_request_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'request_id', p_request_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_approve_membership_change(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_membership_change(uuid, text) TO authenticated;
