-- ============================================================================
-- Phase 4: End of Service RPCs
-- "Cancel after current term" — preserves all history; just stops future
-- continuity by setting renewal_mode='manual' and deleting any future draft
-- contracts. Per the Master Engineering Manual section 3.5/10:
--   - Current contract continues normally to its end_at
--   - No new draft is created at the boundary
--   - History (contracts, hours_ledger, appointments) is fully preserved
--   - Reversible — client can reactivate auto-renew before the contract ends
-- ============================================================================

-- ─── REQUEST END OF SERVICE ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_request_end_of_service()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_client_id uuid;
  v_contract public.contracts%ROWTYPE;
  v_drafts_removed int := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Resolve client_id from the authenticated user (service recipient routing)
  SELECT id INTO v_client_id FROM public.clients WHERE profile_id = v_user_id LIMIT 1;
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'No client record found for current user';
  END IF;

  -- Find the active contract
  SELECT * INTO v_contract FROM public.contracts
   WHERE client_id = v_client_id
     AND status = 'active'
     AND start_at <= NOW()
     AND end_at >= NOW()
   ORDER BY start_at DESC
   LIMIT 1;
  IF v_contract.id IS NULL THEN
    RAISE EXCEPTION 'No active contract to end';
  END IF;

  -- Stop future continuity: switch to manual renewal so lifecycle won't auto-renew
  UPDATE public.contracts
     SET renewal_mode = 'manual',
         notes = COALESCE(notes, '')
                  || CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END
                  || '[end_of_service requested at ' || NOW()::text
                  || ' by user=' || v_user_id::text || ']'
   WHERE id = v_contract.id;

  -- Remove any draft contracts so the boundary doesn't auto-promote one
  DELETE FROM public.contracts
   WHERE client_id = v_client_id
     AND status = 'draft';
  GET DIAGNOSTICS v_drafts_removed = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'contract_id', v_contract.id,
    'contract_end_at', v_contract.end_at,
    'drafts_removed', v_drafts_removed
  );
END;
$$;

-- ─── REACTIVATE AUTO-RENEW (undo the above) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_reactivate_auto_renew()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_client_id uuid;
  v_contract_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT id INTO v_client_id FROM public.clients WHERE profile_id = v_user_id LIMIT 1;
  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'No client record found for current user';
  END IF;

  SELECT id INTO v_contract_id FROM public.contracts
   WHERE client_id = v_client_id
     AND status = 'active'
     AND start_at <= NOW()
     AND end_at >= NOW()
   ORDER BY start_at DESC
   LIMIT 1;
  IF v_contract_id IS NULL THEN
    RAISE EXCEPTION 'No active contract to reactivate';
  END IF;

  UPDATE public.contracts
     SET renewal_mode = 'auto',
         notes = COALESCE(notes, '')
                  || CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END
                  || '[auto_renew_reactivated at ' || NOW()::text
                  || ' by user=' || v_user_id::text || ']'
   WHERE id = v_contract_id;

  RETURN jsonb_build_object('ok', true, 'contract_id', v_contract_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.client_request_end_of_service() TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_reactivate_auto_renew() TO authenticated;
