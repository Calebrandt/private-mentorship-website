-- ============================================================================
-- System Message Web Push fan-out
-- ============================================================================
-- After this SQL deploys, every time a system message is posted to a family
-- conversation (cancel/reschedule/membership/end-of-service approvals etc.),
-- all OTHER participants in that conversation get an OS-level Web Push
-- notification — even with their browser closed.
--
-- BEFORE RUNNING:
--   1. Confirm the pg_net extension is enabled (Supabase has it on by default).
--      Check in Supabase Dashboard → Database → Extensions → search "pg_net".
--   2. Choose ONE of these auth strategies for letting Postgres call your
--      edge function:
--
--      EASY: Disable JWT verification on the send-web-push function.
--        Supabase Dashboard → Edge Functions → send-web-push → Settings
--        → toggle OFF "Verify JWT with legacy secret" → Save.
--
--      SECURE: Store the project service-role key as a Postgres setting:
--        ALTER DATABASE postgres
--          SET app.settings.supabase_service_role = 'eyJhbG…YOUR_KEY…';
--        (Get the key from Supabase Dashboard → Settings → API → service_role.)
--
--   The function below picks up the setting if present, otherwise sends
--   without auth. Either path works.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._post_system_message_for_client(
  p_client_id uuid,
  p_subject text,
  p_body text,
  p_event_type text,
  p_actor_user_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_convo_id uuid;
  v_actor uuid;
  v_msg_id uuid;
  v_recipients uuid[];
  v_url text;
  v_auth text;
  v_headers jsonb;
BEGIN
  IF p_client_id IS NULL THEN RETURN NULL; END IF;

  -- Resolve the family CLIENT_SHARED conversation for this client
  SELECT id INTO v_convo_id FROM public.conversations
   WHERE type = 'CLIENT_SHARED' AND client_id = p_client_id LIMIT 1;
  IF v_convo_id IS NULL THEN RETURN NULL; END IF;

  -- Resolve who's posting the message (actor)
  v_actor := p_actor_user_id;
  IF v_actor IS NULL THEN
    SELECT created_by INTO v_actor FROM public.conversations WHERE id = v_convo_id;
  END IF;
  IF v_actor IS NULL THEN
    SELECT profile_id INTO v_actor FROM public.conversation_participants
     WHERE conversation_id = v_convo_id
       AND UPPER(role) IN ('ADMIN','OWNER','ASSISTANT')
     LIMIT 1;
  END IF;
  IF v_actor IS NULL THEN RETURN NULL; END IF;

  -- Insert the system message (unchanged behaviour)
  INSERT INTO public.conversation_messages
    (conversation_id, profile_id, body, subject, message_type, event_type)
  VALUES
    (v_convo_id, v_actor, p_body, p_subject, 'system', p_event_type)
  RETURNING id INTO v_msg_id;

  -- ── NEW: fan out OS-level Web Push to all participants except the actor ──
  SELECT array_agg(profile_id) INTO v_recipients
    FROM public.conversation_participants
   WHERE conversation_id = v_convo_id
     AND profile_id IS DISTINCT FROM v_actor;

  IF v_recipients IS NOT NULL AND array_length(v_recipients, 1) > 0 THEN
    BEGIN
      v_url := 'https://llkicgphkvciumfzhbkk.supabase.co/functions/v1/send-web-push';
      v_auth := COALESCE(current_setting('app.settings.supabase_service_role', true), '');
      v_headers := jsonb_build_object('Content-Type', 'application/json');
      IF v_auth <> '' THEN
        v_headers := v_headers || jsonb_build_object('Authorization', 'Bearer ' || v_auth);
      END IF;

      PERFORM net.http_post(
        url := v_url,
        body := jsonb_build_object(
          'source', 'direct',
          'userIds', to_jsonb(v_recipients),
          'title', p_subject,
          'body', LEFT(p_body, 220),
          'type', 'message',
          'data', jsonb_build_object(
            'conversationId', v_convo_id,
            'messageId', v_msg_id,
            'eventType', p_event_type,
            'url', '/messages.html?c=' || v_convo_id::text
          )
        ),
        headers := v_headers
      );
    EXCEPTION WHEN OTHERS THEN
      -- Don't let push failure block the system message itself.
      RAISE NOTICE '[push] system-message fan-out failed: %', SQLERRM;
    END;
  END IF;

  RETURN v_msg_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public._post_system_message_for_client(uuid, text, text, text, uuid) TO authenticated;
