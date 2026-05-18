-- ─────────────────────────────────────────────────────────────────────────
-- Phase 19c.14a — Auto-mirror auth.users INTO public.users
-- ─────────────────────────────────────────────────────────────────────────
-- Problem this fixes:
--   public.users is the LEGACY user table from the original app. Its
--   role column has a CHECK constraint ('admin' | 'assistant' | 'parent').
--   Modern code resolves identity via profiles.user_id tied to auth.uid()
--   and largely ignores public.users — but a few legacy FKs still point
--   at it. The most painful one: audit_logs.user_id → public.users(id).
--
--   Every audit_logs INSERT that stamps user_id with auth.uid() — without
--   a guarantee that auth.uid() exists in public.users — risks an FK
--   violation. We already shipped a defensive trigger in 19c.13 that
--   NULLs out ghost UIDs (BEFORE INSERT on audit_logs), and on 2026-05-17
--   we manually backfilled Caleb's row into public.users to unblock him.
--
--   But that backfill is a workaround. The real fix is to make sure EVERY
--   new auth.users row is automatically mirrored to public.users so the
--   FK is always satisfied. That's this phase.
--
-- What this does:
--   1. Creates a SECURITY DEFINER trigger function that inserts a matching
--      public.users row on every AFTER INSERT to auth.users. Idempotent
--      (ON CONFLICT DO NOTHING) and EXCEPTION-safe (NEVER blocks signups
--      — if the mirror fails for any reason, the signup still succeeds and
--      we log a warning).
--   2. Installs the trigger on auth.users.
--   3. Backfills any existing auth.users row that's missing from public.users
--      (using metadata.role if present and valid, otherwise default 'parent').
--   4. Reports counts so you can verify the sync worked.
--
-- Role determination:
--   - If raw_user_meta_data has a 'role' field with a value in
--     ('admin', 'assistant', 'parent'), use it.
--   - Otherwise default to 'parent' (the most common signup case;
--     admin/assistant accounts can be promoted manually after).
--   - Never write an invalid role — would trip the CHECK constraint.
--
-- Safe to re-run. Drops + recreates trigger; backfill is idempotent.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Trigger function
CREATE OR REPLACE FUNCTION public.sync_auth_user_to_public_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text;
BEGIN
  -- Pull role from signup metadata if present + valid; otherwise default.
  v_role := NEW.raw_user_meta_data ->> 'role';
  IF v_role IS NULL OR v_role NOT IN ('admin', 'assistant', 'parent') THEN
    v_role := 'parent';
  END IF;

  INSERT INTO public.users (id, email, role)
  VALUES (NEW.id, NEW.email, v_role)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- DEFENSIVE: never let mirror failure block a real signup. If something
  -- goes wrong (schema drift, permission issue, etc.) we log it and return
  -- NEW so auth.users INSERT completes. The audit_logs ghost-guard from
  -- 19c.13 will still NULL out the user_id at write time if the public.users
  -- row is missing — so nothing breaks even if this trigger silently fails.
  RAISE WARNING 'sync_auth_user_to_public_users failed for % (%): %',
    NEW.id, NEW.email, SQLERRM;
  RETURN NEW;
END;
$$;

-- 2. Install on auth.users (drop first for idempotency)
DROP TRIGGER IF EXISTS on_auth_user_created_sync_public ON auth.users;

CREATE TRIGGER on_auth_user_created_sync_public
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_auth_user_to_public_users();

-- 3. Backfill: any auth.users row missing from public.users gets mirrored now.
--    Validates role before insert so the CHECK constraint never trips.
INSERT INTO public.users (id, email, role)
SELECT
  u.id,
  u.email,
  CASE
    WHEN COALESCE(u.raw_user_meta_data ->> 'role', '') IN ('admin','assistant','parent')
      THEN u.raw_user_meta_data ->> 'role'
    ELSE 'parent'
  END AS role
FROM auth.users u
LEFT JOIN public.users pu ON pu.id = u.id
WHERE pu.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- 4. Verify: counts should match, and missing_from_public should be 0.
SELECT
  (SELECT COUNT(*) FROM auth.users)    AS auth_users_count,
  (SELECT COUNT(*) FROM public.users)  AS public_users_count,
  (SELECT COUNT(*) FROM auth.users u
     WHERE NOT EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = u.id)
  )                                    AS missing_from_public;
