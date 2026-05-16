-- ─────────────────────────────────────────────────────────────────────────
-- Phase 18d: Lesson file uploads via Supabase Storage
-- ─────────────────────────────────────────────────────────────────────────
-- Creates the `lesson-files` private bucket + storage RLS policies.
--
-- PATH SCHEME: lesson-files/{client_id}/{lesson_log_id}/{file-uuid}-{filename}
--   - Client_id in the path lets us authorize without joining tables
--   - lesson_log_id groups files by session
--   - file-uuid prefix prevents filename collisions
--
-- LIMITS: 50 MB per file. Common doc/image/PDF MIME types only.
--
-- PERMISSIONS:
--   - INSERT: assistant assigned to the client (path[1] = client_id check)
--   - SELECT (signed URLs): assistant OR family member of the client
--   - DELETE: assistant OR admin (soft-delete in session_lesson_files
--     marks the metadata row deleted; actual blob stays for audit)
--
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- ─── 1. Create the bucket (private, 50MB max, common file types) ────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lesson-files',
  'lesson-files',
  false,
  52428800,  -- 50 MB
  ARRAY[
    'image/png','image/jpeg','image/gif','image/webp','image/heic',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','text/csv','text/markdown',
    'application/zip','application/x-zip-compressed'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ─── 2. Storage RLS policies on storage.objects ─────────────────────────
-- Path format: {client_id}/{lesson_log_id}/{file-uuid}-{filename}
-- (storage.foldername returns text[], position [1] is the client_id)

-- Admins can do anything in this bucket
DROP POLICY IF EXISTS lesson_files_admin_all ON storage.objects;
CREATE POLICY lesson_files_admin_all ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'lesson-files' AND public.is_staff())
  WITH CHECK (bucket_id = 'lesson-files' AND public.is_staff());

-- Assistant assigned to the client can INSERT (upload) + SELECT (signed URL) + UPDATE + DELETE
DROP POLICY IF EXISTS lesson_files_assistant_insert ON storage.objects;
CREATE POLICY lesson_files_assistant_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lesson-files'
    AND public.is_my_assistant_client(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS lesson_files_assistant_select ON storage.objects;
CREATE POLICY lesson_files_assistant_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'lesson-files'
    AND public.is_my_assistant_client(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS lesson_files_assistant_update ON storage.objects;
CREATE POLICY lesson_files_assistant_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'lesson-files'
    AND public.is_my_assistant_client(((storage.foldername(name))[1])::uuid)
  )
  WITH CHECK (
    bucket_id = 'lesson-files'
    AND public.is_my_assistant_client(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS lesson_files_assistant_delete ON storage.objects;
CREATE POLICY lesson_files_assistant_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'lesson-files'
    AND public.is_my_assistant_client(((storage.foldername(name))[1])::uuid)
  );

-- Family (OWNER role in family_assignments) can SELECT (signed URL)
DROP POLICY IF EXISTS lesson_files_family_select ON storage.objects;
CREATE POLICY lesson_files_family_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'lesson-files'
    AND EXISTS (
      SELECT 1 FROM public.family_assignments fa
       WHERE fa.client_id = ((storage.foldername(name))[1])::uuid
         AND fa.user_id = auth.uid()
         AND fa.role = 'OWNER'
    )
  );

-- Client themselves (profile_id) can SELECT
DROP POLICY IF EXISTS lesson_files_client_select ON storage.objects;
CREATE POLICY lesson_files_client_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'lesson-files'
    AND EXISTS (
      SELECT 1 FROM public.clients c
       WHERE c.id = ((storage.foldername(name))[1])::uuid
         AND c.profile_id = auth.uid()
    )
  );

-- Family can INSERT their own materials too (matches the
-- session_lesson_files RLS that allows uploaded_by_role='family')
DROP POLICY IF EXISTS lesson_files_family_insert ON storage.objects;
CREATE POLICY lesson_files_family_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'lesson-files'
    AND (
      EXISTS (SELECT 1 FROM public.family_assignments fa
               WHERE fa.client_id = ((storage.foldername(name))[1])::uuid
                 AND fa.user_id = auth.uid() AND fa.role = 'OWNER')
      OR
      EXISTS (SELECT 1 FROM public.clients c
               WHERE c.id = ((storage.foldername(name))[1])::uuid
                 AND c.profile_id = auth.uid())
    )
  );


-- ─── 3. Verification ────────────────────────────────────────────────────
SELECT
  EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'lesson-files') AS bucket_exists,
  (SELECT file_size_limit FROM storage.buckets WHERE id = 'lesson-files') AS max_size_bytes,
  (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'lesson_files_%') AS storage_policy_count;
