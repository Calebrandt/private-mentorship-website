-- =============================================================
-- Phase 19t — Create family-side auth accounts for Daniel Jiang
--             and Ryan Roe, link via families + family_assignments
-- =============================================================
-- Context: Michael Yang's family (Linda Chen / Daniel Yang) signed
-- up through the normal flow. Daniel Jiang and Ryan Roe were
-- onboarded historically through Caleb directly — their billing-
-- contact parents never got accounts.
--
-- After 19s the data layer was correct for all three families, but
-- the family-side dashboards/journal stayed empty for Daniel + Ryan
-- because there was no auth user to RLS-scope against.
--
-- This migration:
--   1. Creates auth.users + auth.identities rows for the two moms
--      directly in SQL (no email sent, account pre-confirmed)
--   2. Creates a families row for each
--   3. Creates a family_assignments OWNER/FAMILY_LEADER row each
--   4. Initial password (set inline below) was changed to
--      'Caleb123!' afterwards via a separate UPDATE
--
-- Executed: 2026-05-16. Do NOT re-run — the auth.users rows
-- already exist and the script will fail with a unique constraint
-- violation on email. Kept here as a record of what was done.
--
-- The handle_new_user trigger family fires automatically on
-- auth.users INSERT, so public.profiles rows for both moms were
-- auto-created. No manual profile insert needed.
-- =============================================================

DO $$
DECLARE
  v_yaxi_user   uuid;
  v_eileen_user uuid;
  v_daniel_jiang_client uuid;
  v_ryan_roe_client     uuid;
  v_jiang_family uuid := gen_random_uuid();
  v_roe_family   uuid := gen_random_uuid();
BEGIN
  -- ── Lookups ────────────────────────────────────────────────────
  SELECT id INTO v_daniel_jiang_client
    FROM public.clients WHERE full_name ILIKE 'Daniel Jiang' LIMIT 1;
  SELECT id INTO v_ryan_roe_client
    FROM public.clients WHERE full_name ILIKE 'Ryan Roe' LIMIT 1;

  IF v_daniel_jiang_client IS NULL THEN
    RAISE EXCEPTION 'Daniel Jiang client row not found';
  END IF;
  IF v_ryan_roe_client IS NULL THEN
    RAISE EXCEPTION 'Ryan Roe client row not found';
  END IF;

  -- ── 1) AUTH USER: Yaxi Jiang (Daniel Jiang's mom) ──────────────
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated','authenticated',
    'jiangyaxi87@gmail.com',
    crypt('Jiang2026!', gen_salt('bf')),  -- replaced with 'Caleb123!' afterwards
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Yaxi Jiang"}'::jsonb,
    now(), now(),
    '', '', '', ''
  )
  RETURNING id INTO v_yaxi_user;

  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  )
  VALUES (
    v_yaxi_user::text,
    v_yaxi_user,
    jsonb_build_object('sub', v_yaxi_user::text, 'email', 'jiangyaxi87@gmail.com', 'email_verified', true, 'phone_verified', false),
    'email',
    NULL, now(), now()
  );

  -- ── 2) AUTH USER: Eileen Zhou (Ryan Roe's mom) ─────────────────
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    gen_random_uuid(),
    'authenticated','authenticated',
    'eileenzhoucc@gmail.com',
    crypt('Zhou2026!', gen_salt('bf')),  -- replaced with 'Caleb123!' afterwards
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Eileen Zhou"}'::jsonb,
    now(), now(),
    '', '', '', ''
  )
  RETURNING id INTO v_eileen_user;

  INSERT INTO auth.identities (
    provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  )
  VALUES (
    v_eileen_user::text,
    v_eileen_user,
    jsonb_build_object('sub', v_eileen_user::text, 'email', 'eileenzhoucc@gmail.com', 'email_verified', true, 'phone_verified', false),
    'email',
    NULL, now(), now()
  );

  -- ── 3) FAMILIES rows ───────────────────────────────────────────
  INSERT INTO public.families (id, name, contact_name, owner_id)
  VALUES
    (v_jiang_family, 'Jiang Family', 'Yaxi Jiang',   v_yaxi_user),
    (v_roe_family,   'Roe Family',   'Eileen Zhou',  v_eileen_user);

  -- ── 4) FAMILY_ASSIGNMENTS (OWNER / FAMILY_LEADER) ──────────────
  INSERT INTO public.family_assignments
    (family_id, user_id, role, client_id, designation, display_name)
  VALUES
    (v_jiang_family, v_yaxi_user,   'OWNER', v_daniel_jiang_client, 'FAMILY_LEADER', 'Yaxi Jiang'),
    (v_roe_family,   v_eileen_user, 'OWNER', v_ryan_roe_client,     'FAMILY_LEADER', 'Eileen Zhou');

  RAISE NOTICE 'DONE.';
  RAISE NOTICE '  Yaxi Jiang   auth_id = %', v_yaxi_user;
  RAISE NOTICE '  Eileen Zhou  auth_id = %', v_eileen_user;
  RAISE NOTICE '  Jiang Family id      = %', v_jiang_family;
  RAISE NOTICE '  Roe Family   id      = %', v_roe_family;
END $$;


-- ── 5) Post-run password unification (executed separately) ───────
-- After the moms verified they could sign in with their temp
-- passwords, both were unified to 'Caleb123!' to make support
-- conversations simpler. They were told to change from the account
-- menu after first sign-in.
--
--   UPDATE auth.users
--   SET encrypted_password = crypt('Caleb123!', gen_salt('bf')),
--       updated_at = now()
--   WHERE email IN ('jiangyaxi87@gmail.com', 'eileenzhoucc@gmail.com');


-- ── 6) Verification query ────────────────────────────────────────
-- After the migration, this should return 4 rows (2 OWNER + 2
-- ASSISTANT) for Daniel Jiang and Ryan Roe combined.
--
--   SELECT
--     c.full_name AS client,
--     fa.role, fa.designation, fa.display_name,
--     u.email,
--     u.email_confirmed_at IS NOT NULL AS can_sign_in
--   FROM public.family_assignments fa
--   JOIN public.clients c ON c.id = fa.client_id
--   JOIN auth.users     u ON u.id = fa.user_id
--   WHERE c.full_name ILIKE ANY (ARRAY['%daniel jiang%','%ryan roe%'])
--   ORDER BY c.full_name;
