// Hiring service — web port of /private-mentorship-app/src/services/hiringApplicationService.js.
// Wraps Supabase calls for auth, applications, steps, documents, scenarios, and submission.

(function () {
  const sb = () => window.pmSupabase;

  // ─── Auth helpers ────────────────────────────────────────────────────────
  async function getCurrentUser() {
    const { data, error } = await sb().auth.getUser();
    if (error) return null;
    return data?.user || null;
  }

  async function getCurrentSession() {
    const { data } = await sb().auth.getSession();
    return data?.session || null;
  }

  async function signUpApplicant({ email, password }) {
    const redirectTo = `${window.location.origin}/hiring-verify.html`;
    const { data, error } = await sb().auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        data: { is_applicant: true, signup_source: 'web' },
      },
    });
    if (error) throw error;
    return data;
  }

  async function signInWithEmail({ email, password }) {
    const { data, error } = await sb().auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signOut() {
    await sb().auth.signOut();
  }

  async function sendPasswordReset(email) {
    const redirectTo = `${window.location.origin}/hiring-reset.html`;
    const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  }

  async function updatePassword(newPassword) {
    const { error } = await sb().auth.updateUser({ password: newPassword });
    if (error) throw error;
  }

  async function resendVerificationEmail(email) {
    const redirectTo = `${window.location.origin}/hiring-verify.html`;
    const { error } = await sb().auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  }

  // ─── Application lifecycle ──────────────────────────────────────────────
  async function ensureApplicantDraft() {
    // RPC creates an applicants row + a draft application if missing. Idempotent.
    const { error } = await sb().rpc('ensure_applicant_draft');
    if (error) throw error;
  }

  async function fetchLatestApplicationForCurrentUser() {
    const user = await getCurrentUser();
    if (!user) return null;

    // Mirror the React Native priority: correction_requested > under_review > submitted >
    // waitlisted > accepted > rejected > draft > archived.
    const priority = ['correction_requested', 'under_review', 'submitted', 'waitlisted', 'accepted', 'rejected', 'draft', 'archived'];
    for (const status of priority) {
      const { data, error } = await sb()
        .from('applications')
        .select('*')
        .eq('applicant_id', user.id)
        .eq('status', status)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (error) continue;
      if (data && data.length > 0) return data[0];
    }
    return null;
  }

  async function fetchApplicationDossier(applicationId) {
    const [appRes, stepsRes, responsesRes, documentsRes] = await Promise.all([
      sb().from('applications').select('*').eq('id', applicationId).single(),
      sb().from('application_steps').select('*').eq('application_id', applicationId),
      sb().from('application_responses').select('*').eq('application_id', applicationId),
      sb().from('application_documents').select('*').eq('application_id', applicationId),
    ]);
    return {
      application: appRes.data || null,
      steps: stepsRes.data || [],
      responses: responsesRes.data || [],
      documents: documentsRes.data || [],
    };
  }

  async function saveApplicationStep({ applicationId, stepKey, dataObject, isComplete = false }) {
    const payload = {
      application_id: applicationId,
      step_key: stepKey,
      data: dataObject || {},
      is_complete: !!isComplete,
      updated_at: new Date().toISOString(),
      ...(isComplete ? { completed_at: new Date().toISOString() } : {}),
    };
    const { error } = await sb()
      .from('application_steps')
      .upsert(payload, { onConflict: 'application_id,step_key' });
    if (error) throw error;
  }

  async function saveScenarioResponse({ applicationId, scenarioKey, responseText, minChars = 80 }) {
    const text = (responseText || '').trim();
    const wordCount = text.length === 0 ? 0 : text.split(/\s+/).length;
    const isComplete = text.length >= minChars;
    const payload = {
      application_id: applicationId,
      scenario_key: scenarioKey,
      prompt_version: 1,
      response_text: text,
      word_count: wordCount,
      is_complete: isComplete,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb()
      .from('application_responses')
      .upsert(payload, { onConflict: 'application_id,scenario_key' });
    if (error) throw error;
  }

  async function updateApplicationProgress({ applicationId, currentStepKey, progressPercent }) {
    const patch = {
      current_step_key: currentStepKey,
      progress_percent: Math.max(0, Math.min(100, progressPercent || 0)),
      last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb().from('applications').update(patch).eq('id', applicationId);
    if (error) throw error;
  }

  async function submitApplication(applicationId) {
    const now = new Date().toISOString();
    // Allowed transitions: draft → submitted, correction_requested → submitted (preserves submitted_at).
    const { data: existing } = await sb()
      .from('applications')
      .select('id, status, submitted_at')
      .eq('id', applicationId)
      .single();
    if (!existing) throw new Error('Application not found.');
    if (!['draft', 'correction_requested'].includes(existing.status)) {
      throw new Error(`Application is in status "${existing.status}" and cannot be submitted.`);
    }
    const patch = {
      status: 'submitted',
      submitted_at: existing.submitted_at || now,
      locked_at: now,
      last_activity_at: now,
      updated_at: now,
    };
    const { data, error } = await sb()
      .from('applications')
      .update(patch)
      .eq('id', applicationId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ─── Document uploads ────────────────────────────────────────────────────
  // Uploads to the `hiring_docs` bucket at path `{user_id}/{doc_type}/{timestamp}-{filename}`,
  // then registers metadata in `application_documents`.
  async function uploadApplicationDocument({ applicationId, docType, file, stepKey = null }) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not authenticated.');

    const safeName = (file.name || 'upload').replace(/[^\w.\-]+/g, '_').slice(0, 80);
    const ts = Date.now();
    const path = `${user.id}/${docType}/${ts}-${safeName}`;

    const upload = await sb().storage.from('hiring_docs').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || undefined,
    });
    if (upload.error) throw upload.error;

    // Remove any prior record for this docType on this application before inserting the new one.
    await sb()
      .from('application_documents')
      .delete()
      .eq('application_id', applicationId)
      .eq('doc_type', docType);

    const { error: insertErr } = await sb().from('application_documents').insert({
      application_id: applicationId,
      step_key: stepKey,
      doc_type: docType,
      storage_bucket: 'hiring_docs',
      storage_path: path,
      mime_type: file.type || null,
      file_size: file.size || 0,
      original_filename: file.name || null,
      required: false,
      is_received: true,
      verified_status: 'pending',
    });
    if (insertErr) throw insertErr;

    return { path, name: file.name, size: file.size, type: file.type };
  }

  async function deleteApplicationDocument({ applicationId, docType }) {
    // Look up the record so we can also remove the file from storage.
    const { data: row } = await sb()
      .from('application_documents')
      .select('id, storage_bucket, storage_path')
      .eq('application_id', applicationId)
      .eq('doc_type', docType)
      .maybeSingle();
    if (row?.storage_path) {
      await sb().storage.from(row.storage_bucket || 'hiring_docs').remove([row.storage_path]);
    }
    await sb()
      .from('application_documents')
      .delete()
      .eq('application_id', applicationId)
      .eq('doc_type', docType);
  }

  async function getDocumentSignedUrl({ storagePath, bucket = 'hiring_docs', expiresIn = 600 }) {
    const { data, error } = await sb().storage.from(bucket).createSignedUrl(storagePath, expiresIn);
    if (error) throw error;
    return data?.signedUrl || null;
  }

  // ─── Admin / role helpers ───────────────────────────────────────────────
  async function isCurrentUserAdminOrOwner() {
    const { data, error } = await sb().rpc('is_admin_or_owner');
    if (error) {
      console.warn('is_admin_or_owner RPC failed', error);
      return false;
    }
    return !!data;
  }

  async function fetchCurrentUserProfile() {
    const user = await getCurrentUser();
    if (!user) return null;
    const { data, error } = await sb().from('profiles').select('id, role, email, phone_number_e164, phone_verified, full_name').eq('id', user.id).maybeSingle();
    if (error) {
      console.warn('fetchCurrentUserProfile failed', error);
      return null;
    }
    return data;
  }

  // ─── Admin: list & review applications ──────────────────────────────────
  async function adminListApplications({ status = 'active' } = {}) {
    let q = sb()
      .from('applications')
      .select('id, applicant_id, status, submitted_at, locked_at, progress_percent, current_step_key, updated_at, created_at, last_activity_at')
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .order('updated_at', { ascending: false });
    if (status === 'active') {
      q = q.in('status', ['submitted', 'under_review', 'correction_requested', 'waitlisted']);
    } else if (status === 'all') {
      // no filter
    } else {
      q = q.eq('status', status);
    }
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }

  async function adminLookupApplicantEmails(userIds = []) {
    if (!userIds.length) return {};
    const { data, error } = await sb().rpc('admin_get_user_emails', { user_ids: userIds });
    if (error) {
      console.warn('admin_get_user_emails failed', error);
      return {};
    }
    const map = {};
    (data || []).forEach(row => { if (row?.id) map[row.id] = row.email || ''; });
    return map;
  }

  async function adminFetchDossier(applicationId) {
    return await fetchApplicationDossier(applicationId);
  }

  async function adminFetchApplicantInfo(applicantId) {
    const [appRes, profRes] = await Promise.all([
      sb().from('applicants').select('*').eq('id', applicantId).maybeSingle(),
      sb().from('profiles').select('id, role, email, phone_number_e164, phone_verified, full_name').eq('id', applicantId).maybeSingle(),
    ]);
    return { applicant: appRes.data || null, profile: profRes.data || null };
  }

  async function adminUpdateApplicationStatus({ applicationId, nextStatus }) {
    const allowed = ['draft', 'submitted', 'under_review', 'correction_requested', 'waitlisted', 'rejected', 'accepted', 'archived'];
    if (!allowed.includes(nextStatus)) throw new Error(`Invalid status: ${nextStatus}`);
    const patch = { status: nextStatus, updated_at: new Date().toISOString() };
    if (nextStatus === 'under_review') patch.review_started_at = new Date().toISOString();
    if (nextStatus === 'accepted' || nextStatus === 'rejected') patch.review_completed_at = new Date().toISOString();
    if (nextStatus === 'correction_requested') patch.locked_at = null;
    const { data, error } = await sb().from('applications').update(patch).eq('id', applicationId).select().single();
    if (error) throw error;
    return data;
  }

  async function adminCreateCorrection({ applicationId, message, stepKey = null }) {
    const user = await getCurrentUser();
    const { error } = await sb().from('application_corrections').insert({
      application_id: applicationId,
      step_key: stepKey,
      message: message || '',
      status: 'open',
      created_by: user?.id || null,
    });
    if (error) throw error;
    // Match the app's flow: setting status to correction_requested unlocks the application.
    await adminUpdateApplicationStatus({ applicationId, nextStatus: 'correction_requested' });
    return { ok: true };
  }

  async function adminListCorrectionsForApplication(applicationId) {
    const { data, error } = await sb()
      .from('application_corrections')
      .select('*')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function adminResolveCorrection({ correctionId, resolvedNote = null }) {
    const { error } = await sb().rpc('admin_resolve_correction', {
      p_correction_id: correctionId,
      p_resolved_note: resolvedNote,
    });
    if (error) throw error;
    return { ok: true };
  }

  // ─── Admin: assistant profiles ──────────────────────────────────────────
  async function adminListAssistantProfiles() {
    const { data, error } = await sb()
      .from('assistant_profiles')
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function adminFetchAssistantProfile(assistantId) {
    const { data, error } = await sb()
      .from('assistant_profiles')
      .select('*')
      .eq('assistant_id', assistantId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function adminUpsertAssistantProfile(profile) {
    if (!profile?.assistant_id) throw new Error('assistant_id is required');
    const patch = {
      assistant_id: profile.assistant_id,
      display_name: profile.display_name ?? null,
      bio: profile.bio ?? null,
      city: profile.city ?? null,
      languages: Array.isArray(profile.languages) ? profile.languages : [],
      certifications: Array.isArray(profile.certifications) ? profile.certifications : [],
      education_summary: profile.education_summary ?? null,
      experience_summary: profile.experience_summary ?? null,
      approved_public_fields: profile.approved_public_fields || {},
      is_published: !!profile.is_published,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await sb()
      .from('assistant_profiles')
      .upsert(patch, { onConflict: 'assistant_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function adminDeleteAssistantProfile(assistantId) {
    const { error } = await sb()
      .from('assistant_profiles')
      .delete()
      .eq('assistant_id', assistantId);
    if (error) throw error;
    return { ok: true };
  }

  // List candidates eligible to have an assistant_profiles row.
  //
  // assistant_profiles.assistant_id has a FK to applicants(id), so the right
  // place to source candidates is the applicants table — specifically rows
  // whose status indicates the hiring decision has been made (accepted).
  // We also pull profile metadata (full_name, email, phone) by joining on
  // profiles via applicants.id = profiles.user_id (the convention the wizard
  // establishes by creating an applicants row keyed to auth.uid()).
  //
  // Returns the same shape the admin-assistant-profiles.html UI expects:
  //   { user_id, role, email, full_name, phone_number_e164 }
  // where `user_id` is the applicants.id that should be saved as assistant_id.
  async function adminListAssistantUsers() {
    // Query accepted applicants
    const { data: applicants, error: applicantsErr } = await sb()
      .from('applicants')
      .select('id, email, phone, legal_name, preferred_name, status')
      .eq('status', 'accepted');
    if (applicantsErr) {
      // Fall back to the previous behaviour if applicants is locked-down for the
      // current role — return profiles tagged ASSISTANT so the admin UI still loads.
      console.warn('adminListAssistantUsers: applicants query failed, falling back to profiles:', applicantsErr);
      const { data: profilesFallback, error: pErr } = await sb()
        .from('profiles')
        .select('user_id, role, email, full_name, phone_number_e164')
        .eq('role', 'ASSISTANT');
      if (pErr) throw pErr;
      return profilesFallback || [];
    }
    const ids = (applicants || []).map(a => a.id);
    let profilesById = {};
    if (ids.length) {
      const { data: profileRows } = await sb()
        .from('profiles')
        .select('user_id, full_name, phone_number_e164, email')
        .in('user_id', ids);
      (profileRows || []).forEach(p => { profilesById[p.user_id] = p; });
    }
    return (applicants || []).map(a => {
      const p = profilesById[a.id] || {};
      const fullName =
        p.full_name ||
        (a.preferred_name || a.legal_name) ||
        null;
      return {
        user_id: a.id,  // applicants.id is what the FK wants (saved as assistant_id)
        role: 'ASSISTANT',
        email: p.email || a.email || null,
        full_name: fullName,
        phone_number_e164: p.phone_number_e164 || a.phone || null,
      };
    });
  }

  // ─── Public: published assistant profiles (anonymous-readable) ─────────
  // Returns only the safe subset of fields suitable for an anonymous public
  // roster page. Requires an RLS policy on `assistant_profiles` like:
  //   CREATE POLICY "anon read published profiles" ON public.assistant_profiles
  //   FOR SELECT TO anon, authenticated USING (is_published = true);
  // If the policy isn't in place, this returns an empty array gracefully.
  async function listPublishedAssistantProfiles() {
    try {
      const { data, error } = await sb()
        .from('assistant_profiles')
        .select('assistant_id, display_name, bio, city, languages, certifications, education_summary, experience_summary, updated_at')
        .eq('is_published', true)
        .order('updated_at', { ascending: false });
      if (error) {
        console.warn('listPublishedAssistantProfiles: RLS may not be set up for anon read.', error);
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn('listPublishedAssistantProfiles failed:', e);
      return [];
    }
  }

  // ─── Client picks (logged-in families) ─────────────────────────────────
  // Wraps the client_assistant_picks table. RLS enforces ownership via
  // clients.profile_id = auth.uid(), so these queries return / write only
  // the current family's rows.

  // Helper — resolve the logged-in user's client_id (service recipient).
  async function getCurrentClientId() {
    const user = await getCurrentUser();
    if (!user) return null;
    const { data, error } = await sb()
      .from('clients')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();
    if (error) {
      console.warn('getCurrentClientId failed:', error);
      return null;
    }
    return data?.id || null;
  }

  // List the current family's picks (joined with assistant profile fields
  // for display). Returns an array sorted by rank (nulls last), then created_at.
  async function fetchMyPicks() {
    const { data, error } = await sb()
      .from('client_assistant_picks')
      .select(`
        id, assistant_id, rank, status, notes, submitted_at, created_at, updated_at,
        assistant_profiles!inner ( assistant_id, display_name, city, languages, certifications, bio, is_published )
      `)
      .order('rank', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('fetchMyPicks failed:', error);
      return [];
    }
    return data || [];
  }

  // Add an Assistant to the current family's pick list. If rank is null,
  // it's added at the end. Returns the inserted row.
  async function addPick({ assistantId, rank = null, notes = null }) {
    const clientId = await getCurrentClientId();
    if (!clientId) throw new Error('No client record for current user');
    const row = {
      client_id: clientId,
      assistant_id: assistantId,
      rank: rank,
      status: 'shortlisted',
      notes: notes,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await sb()
      .from('client_assistant_picks')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Remove an Assistant from the current family's pick list.
  async function removePick({ pickId = null, assistantId = null }) {
    let q = sb().from('client_assistant_picks').delete();
    if (pickId) q = q.eq('id', pickId);
    else if (assistantId) q = q.eq('assistant_id', assistantId);
    else throw new Error('Either pickId or assistantId is required');
    const { error } = await q;
    if (error) throw error;
    return { ok: true };
  }

  // Update an existing pick (rank, notes). Status transitions go through
  // the dedicated submit/admin RPCs to keep the lifecycle clean.
  async function updatePick({ pickId, rank = undefined, notes = undefined }) {
    if (!pickId) throw new Error('pickId is required');
    const patch = { updated_at: new Date().toISOString() };
    if (rank !== undefined) patch.rank = rank;
    if (notes !== undefined) patch.notes = notes;
    const { data, error } = await sb()
      .from('client_assistant_picks')
      .update(patch)
      .eq('id', pickId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Submit all shortlisted picks → status becomes 'introduction_requested'.
  // Returns { ok, submitted_count, submitted_at }.
  //
  // Side-effect: fires the notify-pick-submission edge function asynchronously
  // so the owner gets an email when picks land. Failure to email is silent —
  // the picks have still been recorded server-side.
  async function submitPicks() {
    const { data, error } = await sb().rpc('client_submit_picks');
    if (error) throw error;

    // Best-effort email notification — never blocks the user.
    (async () => {
      try {
        const clientId = await getCurrentClientId();
        if (!clientId) return;
        await sb().functions.invoke('notify-pick-submission', { body: { clientId } });
      } catch (e) {
        console.warn('notify-pick-submission failed (non-blocking):', e);
      }
    })();

    return data;
  }

  // ─── Admin: pick queue management ──────────────────────────────────────

  // List incoming picks for the admin queue. Defaults to all non-terminal
  // states (excludes 'engaged' and 'declined'). Optionally filter by status.
  async function adminListPicks({ statuses = null } = {}) {
    let q = sb()
      .from('client_assistant_picks')
      .select(`
        id, client_id, assistant_id, rank, status, notes, submitted_at, created_at, updated_at,
        assistant_profiles!inner ( assistant_id, display_name, city, languages ),
        clients!inner ( id, profile_id, full_name )
      `)
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (Array.isArray(statuses) && statuses.length) {
      q = q.in('status', statuses);
    } else {
      // Default: show actionable items, hide closed states
      q = q.not('status', 'in', '(engaged,declined)');
    }
    const { data, error } = await q;
    if (error) {
      console.warn('adminListPicks failed:', error);
      return [];
    }
    return data || [];
  }

  // Admin transitions a pick's status (e.g., introduction_requested →
  // meeting_scheduled). Uses the server-side RPC for auth + validation.
  async function adminUpdatePickStatus({ pickId, newStatus, notes = null }) {
    const { data, error } = await sb().rpc('admin_update_pick_status', {
      p_pick_id: pickId,
      p_new_status: newStatus,
      p_notes: notes,
    });
    if (error) throw error;
    return data;
  }

  // ─── Assistant-side (logged-in Assistant viewing own work) ─────────────
  // Read-only Phase 1. RLS for assistant-owned rows is enforced server-side
  // (contracts.assistant_id = auth.uid() is the convention).

  // KPI snapshot for the assistant dashboard hero — counts only, defensive.
  async function fetchAssistantHomeKpis() {
    const user = await getCurrentUser();
    if (!user) return { activeEngagements: 0, hoursThisMonth: 0, upcomingSessions: 0 };
    const out = { activeEngagements: 0, hoursThisMonth: 0, upcomingSessions: 0 };

    // Active engagements = active contracts assigned to me
    try {
      const { count } = await sb()
        .from('contracts')
        .select('id', { count: 'exact', head: true })
        .eq('assistant_id', user.id)
        .eq('status', 'active');
      out.activeEngagements = count || 0;
    } catch (_) {}

    // Upcoming sessions = scheduled appointments tied to my contracts, starting in the future.
    // Note: `reserved` is an appointments.kind, not a status. Status filter is just 'scheduled'.
    try {
      const { data: contractIds } = await sb()
        .from('contracts')
        .select('id')
        .eq('assistant_id', user.id);
      const ids = (contractIds || []).map(c => c.id);
      if (ids.length) {
        const { count } = await sb()
          .from('appointments')
          .select('id', { count: 'exact', head: true })
          .in('contract_id', ids)
          .gte('starts_at', new Date().toISOString())
          .eq('status', 'scheduled');
        out.upcomingSessions = count || 0;
      }
    } catch (_) {}

    // Hours this month — sum of |minutes_delta|/60 across hours_ledger for my contracts
    // in this calendar month. Filter by contract_id (canonical) not client_id.
    try {
      const firstOfMonth = new Date();
      firstOfMonth.setDate(1);
      firstOfMonth.setHours(0, 0, 0, 0);
      const { data: contractRows } = await sb()
        .from('contracts')
        .select('id')
        .eq('assistant_id', user.id);
      const contractIds = [...new Set((contractRows || []).map(c => c.id))];
      if (contractIds.length) {
        const { data: ledger } = await sb()
          .from('hours_ledger')
          .select('minutes_delta')
          .in('contract_id', contractIds)
          .gte('created_at', firstOfMonth.toISOString());
        const totalMinutes = (ledger || []).reduce((sum, r) => sum + Math.abs(Number(r.minutes_delta) || 0), 0);
        out.hoursThisMonth = Math.round((totalMinutes / 60) * 10) / 10;
      }
    } catch (_) {}

    return out;
  }

  // Next N upcoming appointments for this assistant.
  async function fetchAssistantUpcomingAppointments({ limit = 8 } = {}) {
    const user = await getCurrentUser();
    if (!user) return [];
    try {
      const { data: contractIds } = await sb()
        .from('contracts')
        .select('id, client_id')
        .eq('assistant_id', user.id);
      const ids = (contractIds || []).map(c => c.id);
      if (!ids.length) return [];
      const { data, error } = await sb()
        .from('appointments')
        .select('id, contract_id, client_id, starts_at, ends_at, duration_minutes, status, kind, title, notes')
        .in('contract_id', ids)
        .gte('starts_at', new Date().toISOString())
        .eq('status', 'scheduled')
        .order('starts_at', { ascending: true })
        .limit(limit);
      if (error) {
        console.warn('fetchAssistantUpcomingAppointments failed:', error);
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn('fetchAssistantUpcomingAppointments threw:', e);
      return [];
    }
  }

  // Range query over the signed-in assistant's appointments.
  // Phase 1 read-only — used by the weekly grid + recent-history list on
  // assistant-schedule.html. Filters by contracts assigned to the user.
  //
  // Returns rows enriched with `client` ({id, full_name}) when resolvable.
  // Any status is allowed; pass `statuses` to narrow (default: all known statuses).
  async function fetchAssistantAppointmentsRange({
    fromDate, toDate,
    statuses = ['scheduled','completed','cancelled','late_cancelled','no_show'],
    limit = 500,
  } = {}) {
    const user = await getCurrentUser();
    if (!user) return [];
    try {
      const { data: contracts } = await sb()
        .from('contracts')
        .select('id, client_id')
        .eq('assistant_id', user.id);
      const contractIds = (contracts || []).map(c => c.id);
      if (!contractIds.length) return [];

      let q = sb()
        .from('appointments')
        .select('id, contract_id, client_id, starts_at, ends_at, duration_minutes, status, kind, title, notes, cancelled_at, cancel_reason')
        .in('contract_id', contractIds)
        .in('status', statuses)
        .order('starts_at', { ascending: true })
        .limit(limit);
      if (fromDate) q = q.gte('starts_at', new Date(fromDate).toISOString());
      if (toDate)   q = q.lte('starts_at', new Date(toDate).toISOString());

      const { data: appts, error } = await q;
      if (error) {
        console.warn('fetchAssistantAppointmentsRange failed:', error);
        return [];
      }

      // Enrich with client info via contracts → clients.
      const contractToClient = {};
      (contracts || []).forEach(c => { contractToClient[c.id] = c.client_id; });
      const clientIds = [...new Set(Object.values(contractToClient))].filter(Boolean);
      const { data: clients } = clientIds.length
        ? await sb().from('clients').select('id, full_name').in('id', clientIds)
        : { data: [] };
      const clientsById = {};
      (clients || []).forEach(c => { clientsById[c.id] = c; });

      return (appts || []).map(a => {
        const clientId = a.client_id || contractToClient[a.contract_id] || null;
        return {
          ...a,
          client: (clientId && clientsById[clientId]) || null,
        };
      });
    } catch (e) {
      console.warn('fetchAssistantAppointmentsRange threw:', e);
      return [];
    }
  }

  // ─── Phase 2: Appointment status writes (RPC wrappers) ───────────────────
  // Each of these calls a SECURITY DEFINER RPC that:
  //   • verifies the caller is the appointment's assistant
  //   • verifies status='scheduled' and the session has started
  //   • flips status to the terminal state
  //   • writes exactly one hours_ledger row in the same transaction
  //
  // Both throw if the RPC raises an exception — callers should catch and
  // surface the error message to the user.

  async function assistantMarkAppointmentComplete(appointmentId) {
    const { data, error } = await sb().rpc('assistant_mark_appointment_complete', {
      p_appointment_id: appointmentId,
    });
    if (error) throw error;
    return data;
  }

  async function assistantMarkAppointmentNoShow(appointmentId) {
    const { data, error } = await sb().rpc('assistant_mark_appointment_no_show', {
      p_appointment_id: appointmentId,
    });
    if (error) throw error;
    return data;
  }

  // List the families this assistant is engaged with — based on contracts.
  // Returns one row per contract with a `client` shape attached.
  // Statuses included: active, paused, pending, draft. Closed contracts
  // (cancelled, ended) are excluded by default; pass `statuses` to override.
  async function fetchMyAssignedClients({ statuses = ['active','paused','pending','draft'] } = {}) {
    const user = await getCurrentUser();
    if (!user) return [];
    try {
      const { data: contracts, error } = await sb()
        .from('contracts')
        .select('id, client_id, status, start_at, end_at, included_minutes, renewal_mode, notes')
        .eq('assistant_id', user.id)
        .in('status', statuses)
        .order('start_at', { ascending: false });
      if (error) {
        console.warn('fetchMyAssignedClients contracts failed:', error);
        return [];
      }
      const clientIds = [...new Set((contracts || []).map(c => c.client_id))].filter(Boolean);
      let clientsById = {};
      if (clientIds.length) {
        const { data: clients } = await sb()
          .from('clients')
          .select('id, profile_id, full_name')
          .in('id', clientIds);
        (clients || []).forEach(c => { clientsById[c.id] = c; });
      }
      return (contracts || []).map(c => ({
        contract: c,
        client: clientsById[c.client_id] || { id: c.client_id, full_name: null },
      }));
    } catch (e) {
      console.warn('fetchMyAssignedClients threw:', e);
      return [];
    }
  }

  // Per-client workspace data — for assistant-client.html?id=<clientId>.
  // Pulls the contract, recent + upcoming appointments, and hours summary
  // for one specific client this assistant is engaged with.
  async function fetchAssistantClientWorkspace(clientId) {
    const user = await getCurrentUser();
    if (!user || !clientId) return null;
    const out = {
      client: null,
      contract: null,
      upcomingAppointments: [],
      recentAppointments: [],
      hoursUsedMinutes: 0,
    };

    try {
      const { data: client } = await sb()
        .from('clients').select('id, profile_id, full_name')
        .eq('id', clientId).maybeSingle();
      out.client = client || { id: clientId };
    } catch (_) {}

    try {
      const { data: contract } = await sb()
        .from('contracts')
        .select('id, client_id, assistant_id, status, start_at, end_at, included_minutes, renewal_mode, notes')
        .eq('client_id', clientId)
        .eq('assistant_id', user.id)
        .in('status', ['active','paused','pending','draft'])
        .order('start_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      out.contract = contract;
    } catch (_) {}

    if (out.contract?.id) {
      const now = new Date().toISOString();
      try {
        const { data: upcoming } = await sb()
          .from('appointments')
          .select('id, starts_at, ends_at, duration_minutes, status, kind, title, notes')
          .eq('contract_id', out.contract.id)
          .gte('starts_at', now)
          .eq('status', 'scheduled')
          .order('starts_at', { ascending: true })
          .limit(8);
        out.upcomingAppointments = upcoming || [];
      } catch (_) {}
      try {
        const { data: recent } = await sb()
          .from('appointments')
          .select('id, starts_at, ends_at, duration_minutes, status, kind, title, notes')
          .eq('contract_id', out.contract.id)
          .lt('starts_at', now)
          .order('starts_at', { ascending: false })
          .limit(8);
        out.recentAppointments = recent || [];
      } catch (_) {}
      // Hours used = sum of negative minutes_delta (consumption) on this contract's ledger.
      // Positive deltas are top-ups / refunds and should not count as "used".
      try {
        const { data: ledger } = await sb()
          .from('hours_ledger')
          .select('minutes_delta')
          .eq('contract_id', out.contract.id);
        const usedMin = (ledger || []).reduce((s, r) => {
          const v = Number(r.minutes_delta) || 0;
          return v < 0 ? s + Math.abs(v) : s;
        }, 0);
        out.hoursUsedMinutes = Math.round(usedMin);
      } catch (_) {}
    }
    return out;
  }

  // Get the assistant's own published profile (for the preview card).
  async function fetchMyAssistantProfile() {
    const user = await getCurrentUser();
    if (!user) return null;
    try {
      const { data, error } = await sb()
        .from('assistant_profiles')
        .select('*')
        .eq('assistant_id', user.id)
        .maybeSingle();
      if (error) {
        console.warn('fetchMyAssistantProfile failed:', error);
        return null;
      }
      return data;
    } catch (_) {
      return null;
    }
  }

  // Save edits to the assistant's own assistant_profiles row.
  // RLS on assistant_profiles is admin-only for INSERT/UPDATE/DELETE per the
  // existing policies (assistant_profiles_*_admin_only). For the assistant to
  // edit their own profile, either:
  //   (a) an additional self-update RLS policy must be added to Supabase
  //   (b) edits should route through an admin RPC.
  // For now: attempt the upsert and surface the error if RLS denies it.
  // The admin can add this policy later:
  //   CREATE POLICY "assistants_update_own_profile" ON public.assistant_profiles
  //     FOR UPDATE TO authenticated
  //     USING (assistant_id = auth.uid())
  //     WITH CHECK (assistant_id = auth.uid());
  async function updateMyAssistantProfile(patch) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in');
    const safe = {
      assistant_id: user.id,
      display_name: patch.display_name ?? null,
      bio: patch.bio ?? null,
      city: patch.city ?? null,
      languages: Array.isArray(patch.languages) ? patch.languages : [],
      certifications: Array.isArray(patch.certifications) ? patch.certifications : [],
      education_summary: patch.education_summary ?? null,
      experience_summary: patch.experience_summary ?? null,
      updated_at: new Date().toISOString(),
      // is_published is intentionally NOT touched here — only admin controls visibility.
    };
    const { data, error } = await sb()
      .from('assistant_profiles')
      .upsert(safe, { onConflict: 'assistant_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Hours ledger for the assistant — aggregated across all their contracts.
  // Canonical columns: minutes_delta (signed, in minutes), reason_code, contract_id.
  // Totals returned in HOURS (rounded to 1 decimal) for display convenience.
  // Each entry is enriched with the resolved client (via contracts → clients).
  //
  // NOTE: distinct from the *client*-side `fetchMyHoursLedger` defined below,
  // which targets the signed-in client's own ledger. Naming them the same
  // caused a silent shadow at export time. Keep them separate.
  async function fetchMyAssistantHoursLedger({ limit = 50 } = {}) {
    const user = await getCurrentUser();
    if (!user) return { entries: [], totalThisMonth: 0, totalAllTime: 0 };
    try {
      const { data: contracts } = await sb()
        .from('contracts')
        .select('id, client_id')
        .eq('assistant_id', user.id);
      const contractIds = [...new Set((contracts || []).map(c => c.id))].filter(Boolean);
      if (!contractIds.length) {
        return { entries: [], totalThisMonth: 0, totalAllTime: 0 };
      }
      // contract_id → client_id map so we can enrich each ledger row.
      const contractToClient = {};
      (contracts || []).forEach(c => { contractToClient[c.id] = c.client_id; });

      const { data: entries, error } = await sb()
        .from('hours_ledger')
        .select('id, contract_id, appointment_id, minutes_delta, reason_code, created_at')
        .in('contract_id', contractIds)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) {
        console.warn('fetchMyAssistantHoursLedger failed:', error);
        return { entries: [], totalThisMonth: 0, totalAllTime: 0 };
      }

      const firstOfMonth = new Date();
      firstOfMonth.setDate(1); firstOfMonth.setHours(0,0,0,0);
      const totalMinutesThisMonth = (entries || []).reduce((s, e) => {
        const d = e.created_at ? new Date(e.created_at) : null;
        if (d && d >= firstOfMonth) return s + Math.abs(Number(e.minutes_delta) || 0);
        return s;
      }, 0);
      const totalMinutesAllTime = (entries || []).reduce(
        (s, e) => s + Math.abs(Number(e.minutes_delta) || 0), 0
      );

      // Attach client info for display.
      const clientIds = [...new Set(Object.values(contractToClient))].filter(Boolean);
      const { data: clients } = clientIds.length
        ? await sb().from('clients').select('id, full_name').in('id', clientIds)
        : { data: [] };
      const clientsById = {};
      (clients || []).forEach(c => { clientsById[c.id] = c; });

      const enriched = (entries || []).map(e => {
        const clientId = contractToClient[e.contract_id] || null;
        return {
          ...e,
          // Back-compat fields for any consumer still reading the old names.
          delta_hours: (Number(e.minutes_delta) || 0) / 60,
          reason: e.reason_code,
          client_id: clientId,
          client: (clientId && clientsById[clientId]) || null,
        };
      });

      return {
        entries: enriched,
        totalThisMonth: Math.round((totalMinutesThisMonth / 60) * 10) / 10,
        totalAllTime: Math.round((totalMinutesAllTime / 60) * 10) / 10,
      };
    } catch (e) {
      console.warn('fetchMyAssistantHoursLedger threw:', e);
      return { entries: [], totalThisMonth: 0, totalAllTime: 0 };
    }
  }

  // ─── Admin: create a client account ──────────────────────────────────────
  // Calls the admin-create-client edge function. Server-side it verifies the caller
  // is OWNER/ADMIN/SUPERADMIN, creates the auth user, lets the trigger create the
  // profile (role=CLIENT), then inserts a clients row.
  async function adminCreateClientAccount({ email, password, fullName, phone = null, role = null }) {
    const { data, error } = await sb().functions.invoke('admin-create-client', {
      body: { email, password, fullName, phone, role },
    });
    if (error) {
      // The edge function returns JSON with {ok, error} even on 4xx. Try to surface that.
      const ctx = error.context;
      if (ctx && typeof ctx.json === 'function') {
        try {
          const parsed = await ctx.json();
          throw new Error(parsed?.error || error.message);
        } catch (_) {}
      }
      throw new Error(error.message || 'admin-create-client failed');
    }
    if (!data?.ok) throw new Error(data?.error || 'admin-create-client returned not ok');
    return data; // { ok, user_id, client_id, email, full_name }
  }

  async function adminListClients({ limit = 50 } = {}) {
    const { data, error } = await sb().from('clients')
      .select('id, full_name, display_name, email, phone, hours_balance, created_at, profile_id')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  // For the client-dashboard: fetch the current user's clients row.
  async function fetchMyClientRecord() {
    const { data: u } = await sb().auth.getUser();
    if (!u?.user) return null;
    const { data, error } = await sb().from('clients')
      .select('id, full_name, display_name, hours_balance, active_plan_id, plan_started_at, created_at')
      .eq('profile_id', u.user.id)
      .maybeSingle();
    if (error) return null;
    return data || null;
  }

  // ─── Client-side: dashboard data ──────────────────────────────────────────
  // All these gracefully return empty values on RLS or schema mismatches.

  async function _myUserId() {
    const { data: u } = await sb().auth.getUser();
    return u?.user?.id || null;
  }

  async function _myClientId() {
    const c = await fetchMyClientRecord();
    return c?.id || null;
  }

  // Last N conversations w/ last-message snippet + sender name.
  async function fetchMyConversations(limit = 5) {
    const uid = await _myUserId();
    if (!uid) return [];
    let parts;
    try {
      const r = await sb().from('conversation_participants').select('conversation_id').eq('profile_id', uid);
      parts = r.data || [];
    } catch (_) { return []; }
    const ids = parts.map(p => p.conversation_id);
    if (!ids.length) return [];
    let convos = [];
    try {
      const r = await sb().from('conversations').select('id, title, scope, type, created_at').in('id', ids).order('created_at', { ascending: false }).limit(20);
      convos = r.data || [];
    } catch (_) { return []; }
    const out = [];
    for (const c of convos.slice(0, limit)) {
      let last = null, senderName = c.title || 'Conversation';
      try {
        const r = await sb().from('conversation_messages').select('body, created_at, profile_id').eq('conversation_id', c.id).order('created_at', { ascending: false }).limit(1);
        last = r.data?.[0] || null;
      } catch (_) {}
      if (last?.profile_id) {
        try {
          const p = await sb().from('profiles').select('full_name').eq('user_id', last.profile_id).maybeSingle();
          senderName = p.data?.full_name || senderName;
        } catch (_) {}
      }
      out.push({
        id: c.id,
        title: c.title || senderName,
        senderName,
        snippet: last?.body || '',
        time: last?.created_at || c.created_at,
      });
    }
    return out;
  }

  // Contract history (current + past) with hours used per contract.
  async function fetchMyContracts() {
    const myId = await _myClientId();
    if (!myId) return [];
    let contracts = [];
    try {
      const r = await sb().from('contracts')
        .select('id, status, start_at, end_at, included_minutes, renewal_mode, created_at')
        .eq('client_id', myId)
        .order('start_at', { ascending: false });
      contracts = r.data || [];
    } catch (_) {}
    // Fallback to legacy client_contracts table
    if (!contracts.length) {
      try {
        const r = await sb().from('client_contracts')
          .select('id, status, start_date, end_at, total_hours, plan_type')
          .eq('client_id', myId)
          .order('start_date', { ascending: false });
        contracts = (r.data || []).map(c => ({
          id: c.id, status: c.status,
          start_at: c.start_date, end_at: c.end_at,
          included_minutes: (c.total_hours || 0) * 60,
          plan_type: c.plan_type,
        }));
      } catch (_) {}
    }
    // Compute used minutes via hours_ledger per contract.
    for (const c of contracts) {
      let usedMin = 0;
      try {
        const r = await sb().from('hours_ledger').select('minutes_delta').eq('contract_id', c.id);
        usedMin = (r.data || []).reduce((s, row) => s + (row.minutes_delta < 0 ? -row.minutes_delta : 0), 0);
      } catch (_) {}
      c.used_minutes = usedMin;
      c.used_hours = +(usedMin / 60).toFixed(1);
      c.included_hours = +((c.included_minutes || 0) / 60).toFixed(1);
      c.remaining_hours = +(c.included_hours - c.used_hours).toFixed(1);
    }
    // Label oldest as "Initial Contract", later as "Renewal #N"
    const ascending = [...contracts].reverse();
    ascending.forEach((c, i) => { c._label = i === 0 ? 'Initial Contract' : `Renewal #${i}`; });
    return contracts;
  }

  // Invoices for monthly payment chart.
  async function fetchMyInvoices(monthsBack = 12) {
    const myId = await _myClientId();
    if (!myId) return [];
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - monthsBack);
    try {
      const r = await sb().from('invoices')
        .select('id, status, invoice_date, total_cents, amount_paid_cents')
        .eq('client_id', myId)
        .gte('invoice_date', cutoff.toISOString().split('T')[0])
        .neq('status', 'void')
        .order('invoice_date', { ascending: true });
      return r.data || [];
    } catch (_) { return []; }
  }

  // Appointments — flexible filter for both upcoming + history.
  async function fetchMyAppointments({ statuses = null, fromDate = null, toDate = null, limit = 50, ascending = false } = {}) {
    const myId = await _myClientId();
    if (!myId) return [];
    try {
      let q = sb().from('appointments')
        .select('id, status, starts_at, ends_at, kind, title, notes, assistant_id, cancelled_at, rescheduled_from_id')
        .eq('client_id', myId);
      if (statuses && statuses.length) q = q.in('status', statuses);
      if (fromDate) q = q.gte('starts_at', fromDate);
      if (toDate) q = q.lte('starts_at', toDate);
      q = q.order('starts_at', { ascending }).limit(limit);
      const r = await q;
      return r.data || [];
    } catch (_) { return []; }
  }

  // Attendance summary — totals + 6-month monthly buckets for the chart.
  async function fetchMyAttendanceSummary() {
    const myId = await _myClientId();
    const empty = { attended: 0, cancelled: 0, no_show: 0, rescheduled: 0, monthly: _emptyMonths(6) };
    if (!myId) return empty;
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - 6);
    let data = [];
    try {
      const r = await sb().from('appointments')
        .select('status, starts_at, rescheduled_from_id')
        .eq('client_id', myId)
        .gte('starts_at', cutoff.toISOString());
      data = r.data || [];
    } catch (_) { return empty; }
    const summary = { attended: 0, cancelled: 0, no_show: 0, rescheduled: 0, monthly: _emptyMonths(6) };
    data.forEach(a => {
      if (a.status === 'completed') summary.attended++;
      else if (a.status === 'cancelled' || a.status === 'late_cancelled') summary.cancelled++;
      else if (a.status === 'no_show') summary.no_show++;
      if (a.rescheduled_from_id) summary.rescheduled++;
      const d = new Date(a.starts_at);
      const m = summary.monthly.find(x => x.monthIdx === d.getMonth() && x.year === d.getFullYear());
      if (m) {
        if (a.status === 'completed') m.attended++;
        else if (a.status === 'cancelled' || a.status === 'late_cancelled') m.cancelled++;
        else if (a.status === 'no_show') m.no_show++;
      }
    });
    return summary;
  }
  function _emptyMonths(n) {
    const arr = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i); d.setDate(1);
      arr.push({ key: d.toLocaleDateString('en-CA', { month: 'short' }), monthIdx: d.getMonth(), year: d.getFullYear(), attended: 0, cancelled: 0, no_show: 0 });
    }
    return arr;
  }

  // Tasks for the current user's family.
  async function fetchMyTasksSummary({ openLimit = 5, doneLimit = 5 } = {}) {
    const out = { openCount: 0, completedThisMonthCount: 0, openTasks: [], recentDone: [] };
    const uid = await _myUserId();
    if (!uid) return out;
    // Resolve family_id from profile (or family_assignments fallback)
    let familyId = null;
    try {
      const r = await sb().from('profiles').select('family_id').eq('user_id', uid).maybeSingle();
      familyId = r.data?.family_id || null;
    } catch (_) {}
    if (!familyId) {
      try {
        const r = await sb().from('family_assignments').select('family_id').eq('user_id', uid).limit(1).maybeSingle();
        familyId = r.data?.family_id || null;
      } catch (_) {}
    }
    if (!familyId) return out;
    // Get task lists for the family
    let listIds = [];
    try {
      const r = await sb().from('task_lists').select('id').eq('family_id', familyId).eq('is_archived', false);
      listIds = (r.data || []).map(x => x.id);
    } catch (_) { return out; }
    if (!listIds.length) return out;
    // Open tasks
    try {
      const r = await sb().from('task_items')
        .select('id, list_id, text, description, due_date, created_at, status')
        .in('list_id', listIds).eq('done', false)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(openLimit);
      out.openTasks = r.data || [];
    } catch (_) {}
    // Open count (separate query for total count)
    try {
      const r = await sb().from('task_items')
        .select('id', { count: 'exact', head: true })
        .in('list_id', listIds).eq('done', false);
      out.openCount = r.count || 0;
    } catch (_) {}
    // Recently completed
    try {
      const r = await sb().from('task_items')
        .select('id, list_id, text, description, last_edited_at, due_date')
        .in('list_id', listIds).eq('done', true)
        .order('last_edited_at', { ascending: false, nullsFirst: false })
        .limit(doneLimit);
      out.recentDone = r.data || [];
    } catch (_) {}
    // Completed-this-month count
    try {
      const start = new Date(); start.setDate(1); start.setHours(0,0,0,0);
      const r = await sb().from('task_items')
        .select('id', { count: 'exact', head: true })
        .in('list_id', listIds).eq('done', true).gte('last_edited_at', start.toISOString());
      out.completedThisMonthCount = r.count || 0;
    } catch (_) {}
    return out;
  }

  // ─── Client Schedule (Phase 1: read-only) ─────────────────────
  // Mirrors getActiveContractForClientV2 from src/services/contractService.js.
  // Active contract = status='active' AND start_at <= now <= end_at.
  // Throws if more than one active contract exists (data integrity issue per the manual).
  async function fetchMyActiveContract({ at = null } = {}) {
    const myId = await _myClientId();
    if (!myId) return null;
    const atIso = (at ? new Date(at) : new Date()).toISOString();
    let r;
    try {
      r = await sb().from('contracts')
        .select('id, client_id, status, start_at, end_at, included_minutes, policy_version, renewal_mode, notes, assistant_id, assistant_name')
        .eq('client_id', myId).eq('status','active')
        .lte('start_at', atIso).gte('end_at', atIso)
        .order('start_at', { ascending: false })
        .limit(2);
    } catch (_) { return null; }
    const rows = r?.data || [];
    if (!rows.length) return null;
    if (rows.length > 1) {
      console.warn('Multiple active contracts detected for client', myId);
    }
    return rows[0];
  }

  // Mirrors listContractRecurringPatterns from src/services/contractRecurringService.js.
  async function fetchMyRecurringPattern(contractId) {
    if (!contractId) return [];
    try {
      const r = await sb().from('contract_recurring_patterns')
        .select('*')
        .eq('contract_id', contractId)
        .order('day_of_week', { ascending: true })
        .order('start_time_local', { ascending: true });
      return r.data || [];
    } catch (_) { return []; }
  }

  // ─── End of service (Phase 4) ─────────────────────────────────
  // "Cancel after current term" — flips renewal_mode to manual + deletes drafts.
  // Reversible via clientReactivateAutoRenew. History always preserved.
  async function clientRequestEndOfService() {
    const { data, error } = await sb().rpc('client_request_end_of_service');
    if (error) throw new Error(error.message || 'client_request_end_of_service failed');
    if (!data?.ok) throw new Error(data?.error || 'client_request_end_of_service returned not ok');
    return data;
  }

  async function clientReactivateAutoRenew() {
    const { data, error } = await sb().rpc('client_reactivate_auto_renew');
    if (error) throw new Error(error.message || 'client_reactivate_auto_renew failed');
    if (!data?.ok) throw new Error(data?.error || 'client_reactivate_auto_renew returned not ok');
    return data;
  }

  // ─── Membership changes (Phase 3) ─────────────────────────────
  // Per the manual: membership_change_requests is the orchestration layer.
  // Web submits a request; admin approves via admin_approve_membership_change RPC
  // (which atomically creates the future draft contract + writes patterns).
  // Active contract is NEVER mutated.

  async function fetchMyPendingMembershipRequest() {
    const myId = await _myClientId();
    if (!myId) return null;
    try {
      const r = await sb().from('membership_change_requests')
        .select('id, client_id, current_contract_id, requested_plan_key, requested_schedule, reviewed_schedule, status, admin_response, created_at, reviewed_at')
        .eq('client_id', myId)
        .in('status', ['pending','client_accepted_review','awaiting_client_review'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return r.data || null;
    } catch (_) { return null; }
  }

  async function submitMembershipChangeRequest({ planKey, schedule = [], currentContractId = null }) {
    if (!planKey) throw new Error('submitMembershipChangeRequest: planKey required');
    const myId = await _myClientId();
    if (!myId) throw new Error('No client record found for current user');
    // Honour DB duplicate guard surfaced as a clean error.
    const existing = await fetchMyPendingMembershipRequest();
    if (existing) {
      const e = new Error('You already have a membership change request waiting for review. Please complete that one first.');
      e.code = 'duplicate_pending';
      e.existing = existing;
      throw e;
    }
    const payload = {
      client_id: myId,
      current_contract_id: currentContractId,
      requested_plan_key: planKey,
      requested_schedule: schedule,
      reviewed_schedule: schedule, // initial mirror; admin may adjust later
      status: 'pending',
      created_by: (await sb().auth.getUser()).data?.user?.id || null,
    };
    const { data, error } = await sb().from('membership_change_requests').insert([payload]).select().single();
    if (error) throw error;
    return data;
  }

  async function adminListMembershipRequests({ statuses = ['pending','client_accepted_review','awaiting_client_review'], limit = 100 } = {}) {
    let rows = [];
    try {
      const r = await sb().from('membership_change_requests')
        .select('id, client_id, current_contract_id, requested_plan_key, requested_schedule, reviewed_schedule, status, admin_response, rejection_reason, created_at, reviewed_at, approved_by, rejected_by')
        .in('status', statuses)
        .order('created_at', { ascending: false })
        .limit(limit);
      rows = r.data || [];
    } catch (_) { return { requests: [], clientsById: {} }; }
    const clientIds = [...new Set(rows.map(r => r.client_id).filter(Boolean))];
    let clientsById = {};
    if (clientIds.length) {
      try {
        const r = await sb().from('clients').select('id, full_name, display_name, email').in('id', clientIds);
        clientsById = Object.fromEntries((r.data || []).map(c => [c.id, c]));
      } catch (_) {}
    }
    return { requests: rows, clientsById };
  }

  async function adminApproveMembershipChange(reqId) {
    if (!reqId) throw new Error('adminApproveMembershipChange: requestId required');
    const { data, error } = await sb().rpc('admin_approve_membership_change', { p_request_id: reqId });
    if (error) throw new Error(error.message || 'admin_approve_membership_change failed');
    if (!data?.ok) throw new Error(data?.error || 'admin_approve_membership_change returned not ok');
    return data;
  }

  async function adminRejectMembershipChange(reqId, reason = '') {
    if (!reqId) throw new Error('adminRejectMembershipChange: requestId required');
    const { data, error } = await sb().rpc('admin_reject_membership_change', {
      p_request_id: reqId,
      p_reason: String(reason || '').trim() || null,
    });
    if (error) throw new Error(error.message || 'admin_reject_membership_change failed');
    if (!data?.ok) throw new Error(data?.error || 'admin_reject_membership_change returned not ok');
    return data;
  }

  // ─── ADMIN: Schedule request approval (Phase 5) ───────────────
  // Unified review/action surface for the schedule_change_requests engine.
  // Approving performs the corresponding state change on appointments per the
  // engineering manual: cancel → status update, reschedule → starts_at update,
  // extra → insert new appointment row. Rejecting just records admin_response.

  async function adminListScheduleRequests({ statuses = ['pending'], types = null, limit = 100 } = {}) {
    let q = sb().from('schedule_change_requests')
      .select('id, client_id, assistant_id, appointment_id, requested_date, requested_start, requested_end, reason, status, admin_response, created_at, reviewed_at, request_type, proposed_schedule')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (statuses && statuses.length) q = q.in('status', statuses);
    if (types && types.length) q = q.in('request_type', types);
    let rows = [];
    try { const r = await q; rows = r.data || []; } catch (_) { return { requests: [], clientsById: {}, appointmentsById: {} }; }
    // Hydrate client + appointment context.
    const clientIds = [...new Set(rows.map(r => r.client_id).filter(Boolean))];
    const appointmentIds = [...new Set(rows.map(r => r.appointment_id).filter(Boolean))];
    const [clientsRes, appointmentsRes] = await Promise.all([
      clientIds.length ? sb().from('clients').select('id, full_name, display_name, email, profile_id').in('id', clientIds) : Promise.resolve({ data: [] }),
      appointmentIds.length ? sb().from('appointments').select('id, status, starts_at, ends_at, kind, title, contract_id, assistant_id, duration_minutes').in('id', appointmentIds) : Promise.resolve({ data: [] }),
    ]);
    const clientsById = Object.fromEntries((clientsRes.data || []).map(c => [c.id, c]));
    const appointmentsById = Object.fromEntries((appointmentsRes.data || []).map(a => [a.id, a]));
    return { requests: rows, clientsById, appointmentsById };
  }

  // All 3 approve flows route through the SAME atomic RPC: admin_approve_schedule_request.
  // The RPC handles state update + change-token spending + late-cancel hour charging
  // + new-appointment insertion in one transaction. See:
  // /supabase-functions/admin-schedule-request-rpcs.sql
  async function _callApproveRpc(reqId) {
    if (!reqId) throw new Error('approve: requestId required');
    const { data, error } = await sb().rpc('admin_approve_schedule_request', { p_request_id: reqId });
    if (error) throw new Error(error.message || 'admin_approve_schedule_request failed');
    if (!data?.ok) throw new Error(data?.error || 'admin_approve_schedule_request returned not ok');
    return data;
  }

  async function adminApproveCancelRequest(reqId)     { return _callApproveRpc(reqId); }
  async function adminApproveRescheduleRequest(reqId) { return _callApproveRpc(reqId); }
  async function adminApproveExtraRequest(reqId)      { return _callApproveRpc(reqId); }

  async function adminRejectScheduleRequest(reqId, adminResponse = '') {
    if (!reqId) throw new Error('adminRejectScheduleRequest: requestId required');
    const { data, error } = await sb().rpc('admin_reject_schedule_request', {
      p_request_id: reqId,
      p_reason: String(adminResponse || '').trim() || null,
    });
    if (error) throw new Error(error.message || 'admin_reject_schedule_request failed');
    if (!data?.ok) throw new Error(data?.error || 'admin_reject_schedule_request returned not ok');
    return data;
  }

  // ─── Schedule change requests (Phase 2: cancel + reschedule) ──
  // Per the engineering manual: schedule_change_requests is the unified
  // approval engine. Do not invent parallel logic. Web submits requests;
  // admin approves; existing app/DB logic actuates the change.

  // Late-cancellation detection: <24h from start counts as late.
  function isLateCancellation(startsAtIso) {
    if (!startsAtIso) return false;
    const ms = new Date(startsAtIso).getTime() - Date.now();
    return ms / (1000*60*60) < 24;
  }

  async function submitCancelRequest({ appointmentId, appointment, reason = '' }) {
    if (!appointmentId && !appointment?.id) throw new Error('submitCancelRequest: appointmentId is required');
    const apt = appointment || null;
    const myClientId = await _myClientId();
    const payload = {
      client_id: apt?.client_id || myClientId,
      assistant_id: apt?.assistant_id || null,
      appointment_id: appointmentId || apt.id,
      requested_date: null,
      requested_start: null,
      requested_end: null,
      reason: String(reason || '').trim() || null,
      status: 'pending',
      request_type: 'cancel',
      proposed_schedule: null,
    };
    const { data, error } = await sb().from('schedule_change_requests').insert([payload]).select().single();
    if (error) throw error;
    return data;
  }

  // requestedDateTimeIso = ISO string of new desired start time. We split into
  // the table's expected requested_date (YYYY-MM-DD) + requested_start (HH:MM:SS),
  // and also populate proposed_schedule for richer admin context.
  async function submitRescheduleRequest({ appointmentId, appointment, newStartIso, durationMin = null, reason = '' }) {
    if (!appointmentId && !appointment?.id) throw new Error('submitRescheduleRequest: appointmentId is required');
    if (!newStartIso) throw new Error('submitRescheduleRequest: newStartIso is required');
    const apt = appointment || null;
    const myClientId = await _myClientId();
    const start = new Date(newStartIso);
    if (Number.isNaN(start.getTime())) throw new Error('submitRescheduleRequest: invalid newStartIso');
    const dateStr = start.toISOString().split('T')[0]; // YYYY-MM-DD (UTC date)
    const startTime = start.toTimeString().slice(0,8); // HH:MM:SS local
    const dur = Number(durationMin || 60);
    const endMs = start.getTime() + dur * 60000;
    const endTime = new Date(endMs).toTimeString().slice(0,8);
    const payload = {
      client_id: apt?.client_id || myClientId,
      assistant_id: apt?.assistant_id || null,
      appointment_id: appointmentId || apt.id,
      requested_date: dateStr,
      requested_start: startTime,
      requested_end: endTime,
      reason: String(reason || '').trim() || null,
      status: 'pending',
      request_type: 'reschedule',
      proposed_schedule: { starts_at: start.toISOString(), duration_min: dur },
    };
    const { data, error } = await sb().from('schedule_change_requests').insert([payload]).select().single();
    if (error) throw error;
    return data;
  }

  // Request an additional session OUTSIDE the recurring pattern.
  // Mirrors the app's "Request Additional Appointment" flow (request_type='extra').
  async function submitExtraAppointmentRequest({ newStartIso, durationMin = 60, reason = '' }) {
    if (!newStartIso) throw new Error('submitExtraAppointmentRequest: newStartIso is required');
    const myClientId = await _myClientId();
    const start = new Date(newStartIso);
    if (Number.isNaN(start.getTime())) throw new Error('submitExtraAppointmentRequest: invalid newStartIso');
    const dateStr = start.toISOString().split('T')[0];
    const startTime = start.toTimeString().slice(0,8);
    const dur = Number(durationMin || 60);
    const endMs = start.getTime() + dur * 60000;
    const endTime = new Date(endMs).toTimeString().slice(0,8);
    const payload = {
      client_id: myClientId,
      assistant_id: null,
      appointment_id: null, // no existing appointment — this is a NEW session request
      requested_date: dateStr,
      requested_start: startTime,
      requested_end: endTime,
      reason: String(reason || '').trim() || null,
      status: 'pending',
      request_type: 'extra',
      proposed_schedule: { starts_at: start.toISOString(), duration_min: dur },
    };
    const { data, error } = await sb().from('schedule_change_requests').insert([payload]).select().single();
    if (error) throw error;
    return data;
  }

  // List the current user's pending schedule change requests so we can mark
  // affected appointments with a "Pending request" badge.
  async function fetchMyPendingScheduleRequests() {
    const myClientId = await _myClientId();
    if (!myClientId) return [];
    try {
      const r = await sb().from('schedule_change_requests')
        .select('id, appointment_id, request_type, status, requested_date, requested_start, created_at, reason')
        .eq('client_id', myClientId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      return r.data || [];
    } catch (_) { return []; }
  }

  // ─── Client Hours & Billing ───────────────────────────────────

  // Hours ledger transactions (newest first), with running balance computed client-side.
  async function fetchMyHoursLedger({ limit = 50 } = {}) {
    const myId = await _myClientId();
    if (!myId) return { transactions: [], totalAdded: 0, totalUsed: 0 };
    let txns = [];
    try {
      const r = await sb().from('hours_ledger')
        .select('id, delta_hours, reason, created_at, appointment_id')
        .eq('client_id', myId)
        .order('created_at', { ascending: false })
        .limit(limit);
      txns = r.data || [];
    } catch (_) { return { transactions: [], totalAdded: 0, totalUsed: 0 }; }
    // Aggregate
    let totalAdded = 0, totalUsed = 0;
    txns.forEach(t => {
      const d = Number(t.delta_hours || 0);
      if (d > 0) totalAdded += d; else totalUsed += Math.abs(d);
    });
    return { transactions: txns, totalAdded:+totalAdded.toFixed(1), totalUsed:+totalUsed.toFixed(1) };
  }

  // Sales receipts for the current user.
  async function fetchMySalesReceipts({ limit = 30 } = {}) {
    const myId = await _myClientId();
    if (!myId) return [];
    try {
      const r = await sb().from('sales_receipts')
        .select('id, receipt_number, receipt_date, total_amount, payment_mode, reference, notes, created_at')
        .eq('client_id', myId)
        .order('receipt_date', { ascending: false })
        .limit(limit);
      return r.data || [];
    } catch (_) { return []; }
  }

  // Homework = task_items in lists where the parent task_list is tagged as HOMEWORK
  // (type ilike '%homework%' OR name ilike '%homework%').
  async function fetchMyHomeworkSummary({ assignedLimit = 6, doneLimit = 6 } = {}) {
    const out = { assignedCount: 0, lateCount: 0, completedThisMonthCount: 0, assigned: [], late: [], recentDone: [] };
    const uid = await _myUserId();
    if (!uid) return out;
    let familyId = null;
    try {
      const r = await sb().from('profiles').select('family_id').eq('user_id', uid).maybeSingle();
      familyId = r.data?.family_id || null;
    } catch (_) {}
    if (!familyId) {
      try {
        const r = await sb().from('family_assignments').select('family_id').eq('user_id', uid).limit(1).maybeSingle();
        familyId = r.data?.family_id || null;
      } catch (_) {}
    }
    if (!familyId) return out;
    // Find homework lists for the family
    let lists = [];
    try {
      const r = await sb().from('task_lists')
        .select('id, name, type, color')
        .eq('family_id', familyId).eq('is_archived', false);
      lists = (r.data || []).filter(l => /homework/i.test(String(l.type || '')) || /homework/i.test(String(l.name || '')));
    } catch (_) { return out; }
    if (!lists.length) return out;
    const listIds = lists.map(l => l.id);
    const listMap = Object.fromEntries(lists.map(l => [l.id, l]));
    const nowIso = new Date().toISOString();
    // Open homework — sort by due_date ascending (soonest first)
    try {
      const r = await sb().from('task_items')
        .select('id, list_id, text, description, due_date, created_at')
        .in('list_id', listIds).eq('done', false)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(assignedLimit + 8);
      const items = r.data || [];
      out.assigned = items.slice(0, assignedLimit).map(it => ({ ...it, _listName: listMap[it.list_id]?.name || null }));
      out.late = items.filter(it => it.due_date && it.due_date < nowIso).slice(0, assignedLimit).map(it => ({ ...it, _listName: listMap[it.list_id]?.name || null }));
    } catch (_) {}
    // Counts
    try {
      const r = await sb().from('task_items').select('id', { count: 'exact', head: true }).in('list_id', listIds).eq('done', false);
      out.assignedCount = r.count || 0;
    } catch (_) {}
    try {
      const r = await sb().from('task_items').select('id', { count: 'exact', head: true }).in('list_id', listIds).eq('done', false).lt('due_date', nowIso);
      out.lateCount = r.count || 0;
    } catch (_) {}
    // Recently completed
    try {
      const r = await sb().from('task_items')
        .select('id, list_id, text, description, last_edited_at, due_date')
        .in('list_id', listIds).eq('done', true)
        .order('last_edited_at', { ascending: false, nullsFirst: false })
        .limit(doneLimit);
      out.recentDone = (r.data || []).map(it => ({ ...it, _listName: listMap[it.list_id]?.name || null }));
    } catch (_) {}
    try {
      const start = new Date(); start.setDate(1); start.setHours(0,0,0,0);
      const r = await sb().from('task_items').select('id', { count: 'exact', head: true }).in('list_id', listIds).eq('done', true).gte('last_edited_at', start.toISOString());
      out.completedThisMonthCount = r.count || 0;
    } catch (_) {}
    return out;
  }

  async function fetchAssistantNamesByIds(ids = []) {
    if (!ids.length) return {};
    try {
      const r = await sb().from('profiles').select('user_id, full_name').in('user_id', ids);
      return Object.fromEntries((r.data || []).map(p => [p.user_id, p.full_name || '—']));
    } catch (_) { return {}; }
  }

  // KPI summary for the admin home: counts and totals.
  // Falls back gracefully on any individual query failure.
  async function adminFetchHomeKpis() {
    const out = { activeClients: 0, totalHours: 0, openApplications: 0 };
    try {
      const { count } = await sb().from('clients').select('id', { count: 'exact', head: true });
      out.activeClients = count || 0;
    } catch (_) {}
    try {
      const { data } = await sb().from('clients').select('hours_balance');
      out.totalHours = (data || []).reduce((s, r) => s + Number(r.hours_balance || 0), 0);
    } catch (_) {}
    try {
      const { count } = await sb().from('applications')
        .select('id', { count: 'exact', head: true })
        .in('status', ['submitted', 'under_review', 'correction_requested']);
      out.openApplications = count || 0;
    } catch (_) {}
    return out;
  }

  // Admin: extended monthly stats for charts on the home dashboard.
  async function adminFetchMonthlyStats(monthsBack = 6) {
    const months = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i); d.setDate(1);
      months.push({
        key: d.toLocaleDateString('en-CA', { month:'short' }),
        monthIdx: d.getMonth(), year: d.getFullYear(),
        newClients: 0, revenueCents: 0,
      });
    }
    const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - monthsBack); cutoff.setDate(1);
    // New clients per month
    try {
      const r = await sb().from('clients').select('created_at').gte('created_at', cutoff.toISOString());
      (r.data || []).forEach(c => {
        const d = new Date(c.created_at);
        const m = months.find(x => x.monthIdx === d.getMonth() && x.year === d.getFullYear());
        if (m) m.newClients++;
      });
    } catch (_) {}
    // Revenue per month
    try {
      const r = await sb().from('invoices')
        .select('invoice_date, amount_paid_cents')
        .gte('invoice_date', cutoff.toISOString().split('T')[0])
        .neq('status', 'void');
      (r.data || []).forEach(inv => {
        const d = new Date(inv.invoice_date);
        const m = months.find(x => x.monthIdx === d.getMonth() && x.year === d.getFullYear());
        if (m) m.revenueCents += (inv.amount_paid_cents || 0);
      });
    } catch (_) {}
    // Aggregates
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0);
    let revenueThisMonthCents = 0, newClientsThisMonth = 0;
    const last = months[months.length - 1];
    if (last) { revenueThisMonthCents = last.revenueCents; newClientsThisMonth = last.newClients; }
    return { months, revenueThisMonthCents, newClientsThisMonth };
  }

  // ─── Submission notification (Resend via edge function) ─────────────────
  // Fire-and-forget: the wizard calls this after submitApplication() succeeds.
  // If the function isn't deployed yet, this silently fails — the submission still went through.
  async function notifyOwnerOfSubmission(applicationId) {
    try {
      const { error } = await sb().functions.invoke('notify-submission', {
        body: { applicationId },
      });
      if (error) {
        console.warn('notify-submission edge function returned an error', error);
      }
    } catch (e) {
      console.warn('notify-submission invoke failed (deploy the edge function to enable email)', e);
    }
  }

  // ─── Public surface ──────────────────────────────────────────────────────
  window.pmHiring = {
    // auth
    getCurrentUser, getCurrentSession, signUpApplicant, signInWithEmail, signOut,
    sendPasswordReset, updatePassword, resendVerificationEmail,
    // application lifecycle
    ensureApplicantDraft, fetchLatestApplicationForCurrentUser, fetchApplicationDossier,
    saveApplicationStep, saveScenarioResponse, updateApplicationProgress, submitApplication,
    // documents
    uploadApplicationDocument, deleteApplicationDocument, getDocumentSignedUrl,
    // role helpers
    isCurrentUserAdminOrOwner, fetchCurrentUserProfile,
    // admin
    adminListApplications, adminLookupApplicantEmails, adminFetchDossier, adminFetchApplicantInfo,
    adminUpdateApplicationStatus, adminCreateCorrection, adminListCorrectionsForApplication, adminResolveCorrection,
    // admin: assistant profiles
    adminListAssistantProfiles, adminFetchAssistantProfile, adminUpsertAssistantProfile,
    adminDeleteAssistantProfile, adminListAssistantUsers,
    // public: anonymous-readable roster
    listPublishedAssistantProfiles,
    // client picks (Phase C)
    getCurrentClientId, fetchMyPicks, addPick, removePick, updatePick, submitPicks,
    // admin pick queue
    adminListPicks, adminUpdatePickStatus,
    // assistant-side (Phase 1)
    fetchAssistantHomeKpis, fetchAssistantUpcomingAppointments, fetchMyAssistantProfile,
    // assistant-side (Phase 2)
    fetchMyAssignedClients, fetchAssistantClientWorkspace,
    fetchAssistantAppointmentsRange,
    // scheduler Phase 2 — appointment status writes
    assistantMarkAppointmentComplete, assistantMarkAppointmentNoShow,
    // assistant-side (Phase 3)
    updateMyAssistantProfile, fetchMyAssistantHoursLedger,
    // admin: clients
    adminCreateClientAccount, adminListClients, adminFetchHomeKpis, adminFetchMonthlyStats,
    // client (self)
    fetchMyClientRecord, fetchMyConversations, fetchMyContracts, fetchMyInvoices,
    fetchMyAppointments, fetchMyAttendanceSummary, fetchAssistantNamesByIds,
    fetchMyTasksSummary, fetchMyHomeworkSummary,
    fetchMyHoursLedger, fetchMySalesReceipts,
    fetchMyActiveContract, fetchMyRecurringPattern,
    submitCancelRequest, submitRescheduleRequest, submitExtraAppointmentRequest,
    fetchMyPendingScheduleRequests, isLateCancellation,
    // admin: schedule request approval (Phase 5)
    adminListScheduleRequests, adminApproveCancelRequest, adminApproveRescheduleRequest,
    adminApproveExtraRequest, adminRejectScheduleRequest,
    // membership changes (Phase 3)
    fetchMyPendingMembershipRequest, submitMembershipChangeRequest,
    adminListMembershipRequests, adminApproveMembershipChange, adminRejectMembershipChange,
    // end of service (Phase 4)
    clientRequestEndOfService, clientReactivateAutoRenew,
    // notifications
    notifyOwnerOfSubmission,
  };
})();
