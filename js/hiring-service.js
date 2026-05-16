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
    // NOTE: profiles PK is user_id (not id). Earlier code queried `id=eq.X`
    // and silently failed on every page that called this — fixed 2026-05-15.
    const { data, error } = await sb()
      .from('profiles')
      .select('user_id, role, email, phone_number_e164, phone_verified, full_name')
      .eq('user_id', user.id)
      .maybeSingle();
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
    const empty = { activeEngagements: 0, hoursThisMonth: 0, upcomingSessions: 0, moneyThisMonth: 0 };
    if (!user) return empty;
    const out = { ...empty };

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

    // Hours this month — sum duration_minutes of appointments whose
    // STARTS_AT is in this calendar month (status completed).
    //
    // Previous version summed |minutes_delta| from hours_ledger where
    // ledger.created_at >= start-of-month. That was wrong: bulk
    // historical imports / reconciliations write fresh created_at
    // timestamps for OLD sessions, so on import day every imported
    // session was counted as "this month". Got 849.3h instead of the
    // few dozen actually delivered in May.
    //
    // Filter by the session's start_at (when work actually happened),
    // not the ledger row's creation timestamp.
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);
    const firstOfNextMonth = new Date(firstOfMonth);
    firstOfNextMonth.setMonth(firstOfNextMonth.getMonth() + 1);
    try {
      // Include both 'completed' and 'scheduled' — historical imports
      // may not have been flipped to completed, so a strict
      // status='completed' filter undercounts. Exclude cancelled /
      // late_cancelled / no_show because those didn't actually happen.
      // Also fall back to (ends_at - starts_at) when duration_minutes
      // is NULL so partial-import data still counts.
      const { data: monthAppts } = await sb()
        .from('appointments')
        .select('duration_minutes, starts_at, ends_at')
        .in('status', ['completed', 'scheduled'])
        .gte('starts_at', firstOfMonth.toISOString())
        .lt('starts_at', firstOfNextMonth.toISOString());
      const totalMinutes = (monthAppts || []).reduce((s, a) => {
        let mins = Number(a.duration_minutes) || 0;
        if (!mins && a.starts_at && a.ends_at) {
          mins = Math.max(0, Math.round((new Date(a.ends_at) - new Date(a.starts_at)) / 60000));
        }
        return s + mins;
      }, 0);
      out.hoursThisMonth = Math.round((totalMinutes / 60) * 10) / 10;
    } catch (_) {}

    // Money this month — sum of invoice payments collected in this
    // calendar month (status != void). Reflects cash collected: best
    // single-number answer to "what did I earn so far this month".
    // Falls back to total_cents when amount_paid_cents is missing.
    try {
      const { data: invoices } = await sb()
        .from('invoices')
        .select('status, amount_paid_cents, total_cents, paid_at')
        .gte('paid_at', firstOfMonth.toISOString())
        .lt('paid_at', firstOfNextMonth.toISOString())
        .neq('status', 'void');
      const totalCents = (invoices || []).reduce(
        (s, i) => s + (Number(i.amount_paid_cents) || Number(i.total_cents) || 0), 0
      );
      out.moneyThisMonth = Math.round(totalCents / 100);
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
      // Strategy: just trust RLS. Query every contract.client_id the
      // current user is allowed to SEE — that union is the family set
      // we want. This works even when assistant_id is NULL or wrong on
      // the contract (legacy imports — Michael's 2025/2026 contracts
      // came in like this), because Postgres-level RLS already decides
      // what's visible. Appointments has its own RLS, so over-fetching
      // here is fine — the second query will gate any unrelated rows.
      //
      // Previous attempts:
      //   v1: filter by contracts.assistant_id = me  → missed Michael
      //       (his assistant_id was NULL from the import)
      //   v2: union family_assignments.client_id + owned contracts →
      //       still missed Michael because Caleb wasn't in
      //       family_assignments for him AND assistant_id was NULL
      //   v3 (this one): bare select on contracts, let RLS decide.
      const { data: visibleContracts } = await sb()
        .from('contracts').select('client_id');
      const clientIds = [...new Set(
        (visibleContracts || []).map(c => c.client_id).filter(Boolean)
      )];
      if (!clientIds.length) return [];

      // Query appointments by client_id (no assistant_id dependency).
      let q = sb()
        .from('appointments')
        .select('id, contract_id, client_id, starts_at, ends_at, duration_minutes, status, kind, title, notes, cancelled_at, cancel_reason, is_complimentary')
        .in('client_id', clientIds)
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

      // Enrich with client info for display.
      const enrichIds = [...new Set((appts || []).map(a => a.client_id).filter(Boolean))];
      const { data: clients } = enrichIds.length
        ? await sb().from('clients').select('id, full_name').in('id', enrichIds)
        : { data: [] };
      const clientsById = {};
      (clients || []).forEach(c => { clientsById[c.id] = c; });

      return (appts || []).map(a => ({
        ...a,
        client: (a.client_id && clientsById[a.client_id]) || null,
      }));
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

  // ─── Phase 3: Assistant-side schedule change requests ───────────────────
  // These mirror the client-side submit* functions but resolve client_id
  // from the appointment (assistants don't have a clients row of their own)
  // and set assistant_id = auth.uid() as required by the
  // schedule_change_requests_assistant_insert RLS policy.
  //
  // All three insert into schedule_change_requests. The existing admin queue
  // at admin-schedule-requests.html handles approval via the existing
  // admin_approve_schedule_request RPC.
  //
  // Reschedule + Extra accept an array of 1-3 alternate slots, persisted in
  // proposed_schedule.slots. The first slot also fills the canonical
  // requested_date / requested_start / requested_end so existing admin code
  // keeps working; the admin UI's slot picker reads proposed_schedule.slots
  // to let the admin choose which one to approve.

  // Helper: resolve a slot {startsAtIso, durationMin} into a normalized shape.
  function _normalizeSlot(s, idx) {
    if (!s || !s.startsAtIso) throw new Error(`Slot ${idx+1}: start time is required`);
    const start = new Date(s.startsAtIso);
    if (Number.isNaN(start.getTime())) throw new Error(`Slot ${idx+1}: invalid start time`);
    const dur = Number(s.durationMin);
    if (!dur || dur <= 0) throw new Error(`Slot ${idx+1}: invalid duration`);
    return { starts_at: start.toISOString(), duration_min: dur };
  }
  // Helper: derive canonical SQL date/time strings from a normalized slot.
  function _slotCanonicalFields(slot) {
    const start = new Date(slot.starts_at);
    const end   = new Date(start.getTime() + slot.duration_min * 60000);
    return {
      requested_date:  start.toISOString().slice(0, 10),
      requested_start: start.toTimeString().slice(0, 8),
      requested_end:   end.toTimeString().slice(0, 8),
    };
  }
  // Helper: resolve client_id from the appointment if not supplied.
  async function _resolveClientIdFromAppt({ appointmentId, appointment }) {
    if (appointment?.client_id) return appointment.client_id;
    if (!appointmentId) return null;
    const { data } = await sb()
      .from('appointments')
      .select('client_id')
      .eq('id', appointmentId)
      .maybeSingle();
    return data?.client_id || null;
  }

  // Phase 3.5: assistant cancellation goes through the SECURITY DEFINER RPC,
  // not the approval queue. Cancellations don't need admin approval — no one
  // can force an appointment. Family is not charged hours even on late
  // cancels (the assistant initiated, the family is held harmless).
  //
  // Function name preserved for backward compatibility with existing UI
  // callers, but behavior is now: immediate cancel, no schedule_change_request
  // row written.
  async function assistantSubmitCancelRequest({ appointmentId, appointment, reason = '' }) {
    if (!appointmentId && !appointment?.id) throw new Error('appointmentId is required');
    const id = appointmentId || appointment.id;
    const { data, error } = await sb().rpc('assistant_cancel_appointment', {
      p_appointment_id: id,
      p_reason: String(reason || '').trim() || null,
    });
    if (error) throw error;
    return data; // returns the updated appointment row
  }

  async function assistantSubmitRescheduleRequest({
    appointmentId, appointment, slots = [], reason = '',
  }) {
    if (!appointmentId && !appointment?.id) throw new Error('appointmentId is required');
    if (!Array.isArray(slots) || slots.length === 0) {
      throw new Error('At least one proposed slot is required');
    }
    if (slots.length > 3) throw new Error('At most 3 proposed slots');
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in');

    const normalized = slots.map((s, i) => _normalizeSlot(s, i));
    const clientId = await _resolveClientIdFromAppt({ appointmentId, appointment });
    if (!clientId) throw new Error('Could not resolve client for this appointment');
    const primary = _slotCanonicalFields(normalized[0]);

    const payload = {
      client_id: clientId,
      assistant_id: user.id,
      appointment_id: appointmentId || appointment.id,
      requested_date: primary.requested_date,
      requested_start: primary.requested_start,
      requested_end: primary.requested_end,
      reason: String(reason || '').trim() || null,
      status: 'pending',
      request_type: 'reschedule',
      proposed_schedule: { slots: normalized, source: 'assistant_web_phase3' },
    };
    const { data, error } = await sb()
      .from('schedule_change_requests')
      .insert([payload])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function assistantSubmitExtraAppointmentRequest({
    clientId, slots = [], reason = '', isComplimentary = false,
  }) {
    if (!clientId) throw new Error('clientId is required');
    if (!Array.isArray(slots) || slots.length === 0) {
      throw new Error('At least one proposed slot is required');
    }
    if (slots.length > 3) throw new Error('At most 3 proposed slots');
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in');

    const normalized = slots.map((s, i) => _normalizeSlot(s, i));
    const primary = _slotCanonicalFields(normalized[0]);

    const payload = {
      client_id: clientId,
      assistant_id: user.id,
      appointment_id: null,
      requested_date: primary.requested_date,
      requested_start: primary.requested_start,
      requested_end: primary.requested_end,
      reason: String(reason || '').trim() || null,
      status: 'pending',
      request_type: 'extra',
      // Phase 10: is_complimentary flag carried through to admin approval,
      // which sets it on the created appointment. UI displays a "Comp"
      // badge on flagged appointments + skips hours deduction at completion.
      proposed_schedule: {
        slots: normalized,
        source: 'assistant_web_phase3',
        is_complimentary: !!isComplimentary,
      },
    };
    const { data, error } = await sb()
      .from('schedule_change_requests')
      .insert([payload])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // Pending requests filed BY this assistant (so we can badge appointments).
  async function fetchAssistantPendingScheduleRequests() {
    const user = await getCurrentUser();
    if (!user) return [];
    try {
      const { data, error } = await sb()
        .from('schedule_change_requests')
        .select('id, appointment_id, client_id, request_type, status, requested_date, requested_start, proposed_schedule, reason, created_at')
        .eq('assistant_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) return [];
      return data || [];
    } catch (_) { return []; }
  }

  // Phase 3.5: admin badge count for the "Schedule Requests" sidebar entry.
  // Counts only PENDING requests of types that still need approval —
  // reschedule + extra. Cancellations are immediate now and don't queue.
  async function adminFetchPendingScheduleRequestsCount() {
    try {
      const { count, error } = await sb()
        .from('schedule_change_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .in('request_type', ['reschedule', 'extra']);
      if (error) return 0;
      return Number(count) || 0;
    } catch (_) { return 0; }
  }

  // Count pending membership change requests (plan + schedule combined).
  // Per adminListMembershipRequests default: 'pending', 'client_accepted_review',
  // and 'awaiting_client_review' all count as "open / needs eyes."
  async function adminFetchPendingMembershipRequestsCount() {
    try {
      const { count, error } = await sb()
        .from('membership_change_requests')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'client_accepted_review', 'awaiting_client_review']);
      if (error) return 0;
      return Number(count) || 0;
    } catch (_) { return 0; }
  }

  // Count applications submitted by candidates that need admin review.
  // applicants.status enum: draft / submitted / under_review / correction_requested
  // / rejected / accepted / archived. "Needs admin attention" = submitted +
  // under_review (correction_requested is waiting on the applicant).
  async function adminFetchPendingApplicationsCount() {
    try {
      const { count, error } = await sb()
        .from('applicants')
        .select('id', { count: 'exact', head: true })
        .in('status', ['submitted', 'under_review']);
      if (error) return 0;
      return Number(count) || 0;
    } catch (_) { return 0; }
  }

  // ─── Phase 12: Bank-hours (carryover store) ─────────────────────────
  // Reads client_bank_balance and contract_carryover_events. UI surfaces
  // banked hours so families can use leftover minutes after a contract
  // expires, instead of having them silently vanish.

  async function fetchClientBankSummary(clientId) {
    if (!clientId) return { banked_minutes: 0, banked_hours: 0 };
    try {
      const { data, error } = await sb().rpc('get_client_bank_summary', {
        p_client_id: clientId,
      });
      if (error) { console.warn('fetchClientBankSummary', error); return null; }
      return data || { banked_minutes: 0, banked_hours: 0 };
    } catch (_) { return null; }
  }

  async function fetchMyBankSummary() {
    try {
      const clientId = await _myClientId();
      if (!clientId) return null;
      return await fetchClientBankSummary(clientId);
    } catch (_) { return null; }
  }

  async function fetchClientBankHistory(clientId, { limit = 50 } = {}) {
    if (!clientId) return [];
    try {
      const { data, error } = await sb()
        .from('contract_carryover_events')
        .select('id, source_contract_id, minutes_delta, reason, meta, created_at, created_by')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) return [];
      return data || [];
    } catch (_) { return []; }
  }

  async function adminAdjustBankBalance({ clientId, minutesDelta, reason = null }) {
    if (!clientId) throw new Error('clientId required');
    if (!minutesDelta || Number.isNaN(Number(minutesDelta))) throw new Error('minutesDelta required');
    const { data, error } = await sb().rpc('admin_adjust_bank_balance', {
      p_client_id: clientId,
      p_minutes_delta: Number(minutesDelta),
      p_reason: reason,
    });
    if (error) throw error;
    return data;
  }

  // Phase 12.1: per-appointment spend breakdown.
  // Returns { contract_minutes_used, bank_minutes_used, uncovered_minutes,
  // is_complimentary, session_duration_minutes }. Used by the assistant
  // workspace to show "Used X from contract + Y from bank" on completed
  // session rows so the spend story is visible (not just a balance drop).
  async function fetchAppointmentSpend(appointmentId) {
    if (!appointmentId) return null;
    try {
      const { data, error } = await sb().rpc('get_appointment_spend', {
        p_appointment_id: appointmentId,
      });
      if (error) { console.warn('fetchAppointmentSpend', error); return null; }
      return data || null;
    } catch (_) { return null; }
  }

  // Convenience: fetch spend for many appointments in parallel.
  // Returns Map<appointmentId, spendObj>. Skips non-completed rows since
  // their spend is always zero anyway.
  async function fetchAppointmentSpendBatch(appointments) {
    const out = new Map();
    if (!Array.isArray(appointments) || !appointments.length) return out;
    const completed = appointments.filter(a => (a?.status || '').toLowerCase() === 'completed');
    if (!completed.length) return out;
    const results = await Promise.all(
      completed.map(a => fetchAppointmentSpend(a.id).then(s => [a.id, s]).catch(() => [a.id, null]))
    );
    for (const [id, spend] of results) {
      if (spend) out.set(id, spend);
    }
    return out;
  }

  // Phase 12.2: assistant nudges family to use their banked hours.
  // Posts a templated message to the family's CLIENT_SHARED conversation
  // thread (the same one used by messages.html). Family receives it as
  // a regular message + notification — no new infrastructure.
  //
  // Templates the assistant can pick from. Owner's framing:
  //   "not a warning (sounds rude) — more like a friendly catch-up."
  const BANK_NUDGE_TEMPLATES = {
    longer: (hrs) =>
      `Hey! I noticed you have ${hrs} hour${hrs===1?'':'s'} banked from previous contracts. ` +
      `Want to use some of that for a longer session sometime soon? Even an extra 30-60 minutes ` +
      `can make a big difference if there's something specific to dig into.`,
    extra: (hrs) =>
      `Quick note: you have ${hrs} hour${hrs===1?'':'s'} banked from past contracts that I want ` +
      `to make sure don't sit unused. Would you like to schedule an extra session this week ` +
      `or next? Even an hour outside the regular schedule helps.`,
    outing: (hrs) =>
      `Hi — you've got ${hrs} banked hour${hrs===1?'':'s'} from previous contracts. ` +
      `If there's ever a chance for a special outing — life skills practice, community ` +
      `errands together, a longer field trip somewhere — this would be a great way to put ` +
      `those hours to use. Let me know if anything comes to mind.`,
    study: (hrs) =>
      `Quick check-in: you have ${hrs} hour${hrs===1?'':'s'} banked. With exams / projects ` +
      `coming up, this could be a good time to schedule extra focused study sessions. ` +
      `Want me to suggest some times?`,
    sports: (hrs) =>
      `Heads up — you've got ${hrs} hour${hrs===1?'':'s'} banked. If we want to do more ` +
      `active time (outdoor activities, sports, longer movement-based sessions), this is ` +
      `the perfect way to use them. Let me know!`,
    custom: null, // assistant writes their own body
  };

  async function assistantSuggestBankHoursUsage({
    clientId, template = 'longer', customBody = null,
  }) {
    if (!clientId) throw new Error('clientId is required');
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in');

    // 1. How many banked hours does this family have?
    const summary = await fetchClientBankSummary(clientId);
    const bankedHrs = Math.round((summary?.banked_hours || 0));
    if (bankedHrs <= 0) {
      throw new Error('This family has no banked hours to suggest using.');
    }

    // 2. Build the message body from template (or use custom)
    let body;
    if (customBody && customBody.trim()) {
      body = customBody.trim();
    } else {
      const fn = BANK_NUDGE_TEMPLATES[template] || BANK_NUDGE_TEMPLATES.longer;
      body = fn(bankedHrs);
    }

    // 3. Find or create the CLIENT_SHARED conversation for this client.
    //    Existing message infrastructure (pmMessages.createOrGetClientConversation)
    //    does this; pass the assistant as creator + the assistant + the family
    //    leader (the client.profile_id) as members.
    const { data: client } = await sb()
      .from('clients')
      .select('id, profile_id, full_name')
      .eq('id', clientId)
      .maybeSingle();
    if (!client?.id) throw new Error('Client not found');

    // pmMessages is the global messaging-service exported by messages-service.js.
    // createOrGetClientConversation resolves family members internally from
    // family_assignments — we just pass clientId + creator.
    const messagesService = window.pmMessages;
    if (!messagesService?.createOrGetClientConversation || !messagesService?.sendMessage) {
      throw new Error('Messaging service not loaded — refresh the page.');
    }
    const convo = await messagesService.createOrGetClientConversation({
      clientId,
      creatorUserId: user.id,
    });
    if (!convo?.id) throw new Error('Could not find/create conversation');

    // 4. Send the message
    const subject = '💛 Banked hours — suggestion';
    const result = await messagesService.sendMessage({
      conversationId: convo.id,
      userId: user.id,
      body,
      subject,
    });

    return {
      ok: true,
      conversation_id: convo.id,
      message_id: result?.id,
      banked_hrs_at_send: bankedHrs,
      template_used: customBody ? 'custom' : template,
    };
  }

  // ─── Phase 18: Lesson Tracker (post-session journal) ─────────────────
  // Each completed appointment gets a session_lesson_logs row. Assistant
  // writes after the session: focus area, key concepts, status/type,
  // feedback, rating. Files + URL links attach via session_lesson_files.
  // Family reads. RLS handles all permissions.

  // Fetch the lesson log for one appointment + its non-deleted files.
  async function fetchLessonLog(appointmentId) {
    if (!appointmentId) return null;
    try {
      const { data: log, error: logErr } = await sb()
        .from('session_lesson_logs')
        .select('id, appointment_id, client_id, assistant_id, assistant_display_name, focus_area, key_concepts, status_label, type_label, next_session_notes, feedback, rating, created_at, updated_at')
        .eq('appointment_id', appointmentId)
        .maybeSingle();
      if (logErr) { console.warn('fetchLessonLog log:', logErr); return null; }
      if (!log) return null;
      const { data: files, error: fileErr } = await sb()
        .from('session_lesson_files')
        .select('id, lesson_log_id, kind, display_name, storage_path, external_url, mime_type, size_bytes, description, uploaded_by, uploaded_by_role, uploaded_by_display_name, uploaded_at')
        .eq('lesson_log_id', log.id)
        .is('deleted_at', null)
        .order('uploaded_at', { ascending: true });
      if (fileErr) console.warn('fetchLessonLog files:', fileErr);
      return { ...log, files: files || [] };
    } catch (e) { console.warn('fetchLessonLog threw:', e); return null; }
  }

  // Create or update a lesson log. The unique constraint on appointment_id
  // means upserting on conflict is the right pattern.
  async function upsertLessonLog({
    appointmentId, clientId,
    focusArea = null, keyConcepts = null,
    statusLabel = null, typeLabel = null,
    nextSessionNotes = null, feedback = null,
    rating = null,
  }) {
    if (!appointmentId) throw new Error('appointmentId required');
    if (!clientId) throw new Error('clientId required');
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in');
    // Display name from profiles (denormalized snapshot — also a trigger fallback exists)
    let displayName = null;
    try {
      const { data: prof } = await sb().from('profiles').select('full_name').eq('user_id', user.id).maybeSingle();
      displayName = prof?.full_name || null;
    } catch (_) {}
    const payload = {
      appointment_id: appointmentId,
      client_id: clientId,
      assistant_id: user.id,
      assistant_display_name: displayName,
      focus_area: focusArea,
      key_concepts: keyConcepts,
      status_label: statusLabel,
      type_label: typeLabel,
      next_session_notes: nextSessionNotes,
      feedback: feedback,
      rating: rating == null ? null : Math.max(0, Math.min(5, Number(rating))),
      updated_by: user.id,
    };
    // Check if existing row to decide insert vs update path
    const { data: existing } = await sb()
      .from('session_lesson_logs').select('id').eq('appointment_id', appointmentId).maybeSingle();
    if (existing?.id) {
      const { data, error } = await sb()
        .from('session_lesson_logs').update(payload).eq('id', existing.id).select().single();
      if (error) throw error;
      return data;
    }
    payload.created_by = user.id;
    const { data, error } = await sb()
      .from('session_lesson_logs').insert(payload).select().single();
    if (error) throw error;
    return data;
  }

  // Add a URL link to an existing lesson log.
  async function addLessonUrl({ lessonLogId, displayName, url, description = null }) {
    if (!lessonLogId) throw new Error('lessonLogId required');
    if (!url || !url.trim()) throw new Error('url required');
    const trimmedUrl = url.trim();
    const safeName = (displayName && displayName.trim()) || trimmedUrl;
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in');
    // Detect family vs assistant from family_assignments
    let role = 'assistant';
    try {
      const { data } = await sb()
        .from('family_assignments').select('role').eq('user_id', user.id).limit(1).maybeSingle();
      if (data?.role === 'OWNER') role = 'family';
    } catch (_) {}
    const { data, error } = await sb()
      .from('session_lesson_files')
      .insert({
        lesson_log_id: lessonLogId,
        kind: 'url',
        display_name: safeName,
        external_url: trimmedUrl,
        description,
        uploaded_by: user.id,
        uploaded_by_role: role,
      })
      .select().single();
    if (error) throw error;
    return data;
  }

  // Soft-delete a file/URL row (assistants own everything; family can only
  // soft-delete their own uploads via RLS).
  async function softDeleteLessonFile(fileId) {
    if (!fileId) throw new Error('fileId required');
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in');
    const { error } = await sb()
      .from('session_lesson_files')
      .update({ deleted_at: new Date().toISOString(), deleted_by: user.id })
      .eq('id', fileId);
    if (error) throw error;
    return true;
  }

  // Fetch the lesson history for one client (most recent first).
  // Used by both the assistant's "Lesson history" pane and the family's
  // read-only journal view.
  async function fetchLessonHistory(clientId, { year = null, limit = 200 } = {}) {
    if (!clientId) return [];
    try {
      let q = sb()
        .from('v_appointment_with_lesson')
        .select('appointment_id, client_id, starts_at, ends_at, duration_minutes, appointment_status, appointment_title, is_complimentary, lesson_log_id, lesson_assistant_id, lesson_assistant_name, focus_area, key_concepts, status_label, type_label, next_session_notes, feedback, rating, lesson_logged_at, active_file_count, taught_by_substitute')
        .eq('client_id', clientId)
        .not('lesson_log_id', 'is', null)
        .order('starts_at', { ascending: false })
        .limit(limit);
      if (year) {
        q = q.gte('starts_at', `${year}-01-01`).lt('starts_at', `${Number(year) + 1}-01-01`);
      }
      const { data, error } = await q;
      if (error) { console.warn('fetchLessonHistory:', error); return []; }
      return data || [];
    } catch (e) { console.warn('fetchLessonHistory threw:', e); return []; }
  }

  // Phase 18b.1: PRIVATE internal notes (assistant-only, family CANNOT read).
  // Lives in a separate table with strict RLS — family/client have zero
  // policies on it so the row is invisible to them at the DB level.
  async function fetchLessonInternalNote(lessonLogId) {
    if (!lessonLogId) return null;
    try {
      const { data, error } = await sb()
        .from('session_lesson_internal_notes')
        .select('lesson_log_id, body, updated_at, updated_by')
        .eq('lesson_log_id', lessonLogId)
        .maybeSingle();
      if (error) { console.warn('fetchLessonInternalNote:', error); return null; }
      return data || null;
    } catch (_) { return null; }
  }

  // Phase 18d: upload a real file to the lesson-files Storage bucket and
  // create a matching session_lesson_files row.
  // Path scheme: {client_id}/{lesson_log_id}/{file-uuid}-{cleanName}
  async function uploadLessonFile({ lessonLogId, clientId, file, description = null }) {
    if (!lessonLogId) throw new Error('lessonLogId required');
    if (!clientId) throw new Error('clientId required');
    if (!file) throw new Error('file required');
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in');
    // Detect family vs assistant from family_assignments
    let role = 'assistant';
    try {
      const { data } = await sb()
        .from('family_assignments').select('role').eq('user_id', user.id).limit(1).maybeSingle();
      if (data?.role === 'OWNER') role = 'family';
    } catch (_) {}
    // Sanitize filename + build storage path
    const cleanName = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
    const fileUuid = (crypto?.randomUUID && crypto.randomUUID()) || (Date.now() + '-' + Math.random().toString(36).slice(2, 10));
    const storagePath = `${clientId}/${lessonLogId}/${fileUuid}-${cleanName}`;
    // Upload to Storage
    const { error: upErr } = await sb().storage
      .from('lesson-files')
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      });
    if (upErr) throw upErr;
    // Insert metadata row
    const { data: row, error: rowErr } = await sb()
      .from('session_lesson_files')
      .insert({
        lesson_log_id: lessonLogId,
        kind: 'file',
        display_name: file.name || cleanName,
        storage_path: storagePath,
        mime_type: file.type || null,
        size_bytes: file.size || null,
        description,
        uploaded_by: user.id,
        uploaded_by_role: role,
      })
      .select().single();
    if (rowErr) {
      // Best-effort cleanup of the orphan blob if metadata insert failed
      try { await sb().storage.from('lesson-files').remove([storagePath]); } catch (_) {}
      throw rowErr;
    }
    return row;
  }

  // Get a temporary signed URL for downloading a stored lesson file.
  // Returns null for legacy placeholder paths (those from Phase 18e
  // historical backfill that start with "legacy/google-drive/").
  async function getLessonFileSignedUrl(storagePath, expiresInSeconds = 3600) {
    if (!storagePath) return null;
    if (storagePath.startsWith('legacy/')) return null; // historical placeholder
    try {
      const { data, error } = await sb().storage
        .from('lesson-files')
        .createSignedUrl(storagePath, expiresInSeconds);
      if (error) { console.warn('getLessonFileSignedUrl:', error); return null; }
      return data?.signedUrl || null;
    } catch (_) { return null; }
  }

  // Phase 18b.3: fetch the previous N lesson logs for this client (older
  // than the given appointment) so the assistant gets quick context on
  // what was covered last time. Includes private internal notes (RLS
  // protects them — family can't read this RPC's output anyway since they
  // wouldn't query for it, and the internal_notes table denies them).
  async function fetchRecentLessonContext({ clientId, beforeAppointmentId = null, limit = 3 }) {
    if (!clientId) return [];
    try {
      // Resolve the anchor date
      let beforeDate = null;
      if (beforeAppointmentId) {
        const { data: a } = await sb()
          .from('appointments').select('starts_at').eq('id', beforeAppointmentId).maybeSingle();
        beforeDate = a?.starts_at || null;
      }
      let q = sb()
        .from('v_appointment_with_lesson')
        .select('appointment_id, starts_at, focus_area, key_concepts, status_label, type_label, rating, lesson_log_id, lesson_assistant_name, taught_by_substitute, active_file_count')
        .eq('client_id', clientId)
        .not('lesson_log_id', 'is', null)
        .order('starts_at', { ascending: false })
        .limit(limit);
      if (beforeDate) q = q.lt('starts_at', beforeDate);
      const { data: recent, error } = await q;
      if (error) { console.warn('fetchRecentLessonContext:', error); return []; }
      const rows = recent || [];
      if (!rows.length) return [];
      // Hydrate with private internal notes
      const logIds = rows.map(r => r.lesson_log_id).filter(Boolean);
      let notesByLog = new Map();
      if (logIds.length) {
        const { data: notes } = await sb()
          .from('session_lesson_internal_notes')
          .select('lesson_log_id, body')
          .in('lesson_log_id', logIds);
        (notes || []).forEach(n => notesByLog.set(n.lesson_log_id, n.body));
      }
      return rows.map(r => ({ ...r, internal_note_body: notesByLog.get(r.lesson_log_id) || null }));
    } catch (e) { console.warn('fetchRecentLessonContext threw:', e); return []; }
  }

  async function upsertLessonInternalNote({ lessonLogId, body }) {
    if (!lessonLogId) throw new Error('lessonLogId required');
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in');
    const trimmed = (body || '').trim() || null;
    // Try update first; if 0 rows touched, insert
    const { data: existing } = await sb()
      .from('session_lesson_internal_notes')
      .select('lesson_log_id').eq('lesson_log_id', lessonLogId).maybeSingle();
    if (existing) {
      const { data, error } = await sb()
        .from('session_lesson_internal_notes')
        .update({ body: trimmed, updated_by: user.id })
        .eq('lesson_log_id', lessonLogId)
        .select().single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await sb()
      .from('session_lesson_internal_notes')
      .insert({ lesson_log_id: lessonLogId, body: trimmed, updated_by: user.id })
      .select().single();
    if (error) throw error;
    return data;
  }

  // Bulk-fetch lesson logs for a set of appointments (used by row preview
  // in assistant-schedule.html "Needs your attention" + "Recent history").
  async function fetchLessonLogsForAppointments(appointmentIds) {
    if (!Array.isArray(appointmentIds) || !appointmentIds.length) return new Map();
    try {
      const { data, error } = await sb()
        .from('session_lesson_logs')
        .select('id, appointment_id, focus_area, status_label, rating, assistant_display_name')
        .in('appointment_id', appointmentIds);
      if (error) return new Map();
      const m = new Map();
      (data || []).forEach(row => m.set(row.appointment_id, row));
      return m;
    } catch (_) { return new Map(); }
  }

  // ─── Phase 7: Change-token status (counter + warnings) ──────────────
  // Reads v_contract_balance + contract_policy_limits via the
  // get_contract_token_status RPC. Returns {tokens_used, tokens_total,
  // tokens_remaining, over_budget}. UI shows this on schedule pages
  // and warns when families are about to (or already did) exceed the
  // 3-free-changes budget.

  async function fetchContractTokenStatus(contractId) {
    if (!contractId) return { tokens_used: 0, tokens_total: 0, tokens_remaining: 0, over_budget: false };
    try {
      const { data, error } = await sb().rpc('get_contract_token_status', {
        p_contract_id: contractId,
      });
      if (error) { console.warn('fetchContractTokenStatus', error); return null; }
      return data || null;
    } catch (_) { return null; }
  }

  // Convenience wrapper: resolves the signed-in client's active contract
  // first, then fetches its token status. Used by client-schedule.html.
  async function fetchMyContractTokenStatus() {
    try {
      const contract = await fetchMyActiveContract();
      if (!contract?.id) return null;
      return await fetchContractTokenStatus(contract.id);
    } catch (_) { return null; }
  }

  // ─── Phase 6: Contract pause / freeze ───────────────────────────────
  // Admin-initiated. Family asks via Messages, admin clicks the button.
  // Cancels reserved appointments in window (no hours forfeit) and pushes
  // contract.end_at out by the freeze length so families don't lose time.

  async function adminFreezeContract({ contractId, startsOn, endsOn, reason = null }) {
    if (!contractId || !startsOn || !endsOn) throw new Error('contractId, startsOn, endsOn required');
    const { data, error } = await sb().rpc('admin_freeze_contract', {
      p_contract_id: contractId,
      p_starts_on: startsOn,
      p_ends_on: endsOn,
      p_reason: reason,
    });
    if (error) throw error;
    return data;
  }

  async function adminUnfreezeContract(freezeId) {
    if (!freezeId) throw new Error('freezeId required');
    const { data, error } = await sb().rpc('admin_unfreeze_contract', {
      p_freeze_id: freezeId,
    });
    if (error) throw error;
    return data;
  }

  // List freezes. Pass contractId to scope to one contract; otherwise lists
  // every freeze the caller can see via RLS (admins see all; clients see
  // their own; assistants see their own).
  async function fetchContractFreezes({ contractId = null, includeEnded = true } = {}) {
    let q = sb()
      .from('contract_freezes')
      .select('id, contract_id, starts_on, ends_on, reason, created_at, ended_early_at, ended_by')
      .order('starts_on', { ascending: false });
    if (contractId) q = q.eq('contract_id', contractId);
    if (!includeEnded) q = q.is('ended_early_at', null);
    const { data, error } = await q;
    if (error) { console.warn('fetchContractFreezes', error); return []; }
    return data || [];
  }

  // Admin: list contracts (light shape) for the freeze-management UI.
  async function adminListContractsForFreezeUI() {
    try {
      const { data: contracts, error } = await sb()
        .from('contracts')
        .select('id, client_id, status, start_at, end_at, included_minutes, assistant_id, assistant_name')
        .in('status', ['active', 'draft'])
        .order('start_at', { ascending: false });
      if (error) throw error;
      const rows = contracts || [];
      if (!rows.length) return [];
      const clientIds = [...new Set(rows.map(r => r.client_id))].filter(Boolean);
      const { data: clients } = clientIds.length
        ? await sb().from('clients').select('id, full_name').in('id', clientIds)
        : { data: [] };
      const clientsById = {};
      (clients || []).forEach(c => { clientsById[c.id] = c; });
      return rows.map(r => ({ ...r, client: clientsById[r.client_id] || null }));
    } catch (e) { console.warn('adminListContractsForFreezeUI', e); return []; }
  }

  // ─── Phase 5: Assistant availability windows ─────────────────────────
  // Two tables, mirrored 1:1 in this service layer:
  //   assistant_availability_windows  — recurring weekly time blocks
  //   assistant_availability_blackouts — date-range exceptions
  // Plus a soft-check `checkAssistantAvailable` that calls the RPC for use
  // in the booking modals (informational only — doesn't block submission).

  async function fetchMyAvailabilityWindows() {
    const user = await getCurrentUser();
    if (!user) return [];
    try {
      const { data, error } = await sb()
        .from('assistant_availability_windows')
        .select('id, weekday, start_time, end_time, active_from, active_until, notes, created_at')
        .eq('assistant_id', user.id)
        .order('weekday', { ascending: true })
        .order('start_time', { ascending: true });
      if (error) { console.warn('fetchMyAvailabilityWindows', error); return []; }
      return data || [];
    } catch (_) { return []; }
  }

  async function addAvailabilityWindow({ weekday, startTime, endTime, activeFrom = null, activeUntil = null, notes = null }) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in');
    if (weekday == null || weekday < 0 || weekday > 6) throw new Error('Invalid weekday');
    if (!startTime || !endTime) throw new Error('Start and end times are required');
    if (startTime >= endTime) throw new Error('End time must be after start time');
    const { data, error } = await sb()
      .from('assistant_availability_windows')
      .insert([{
        assistant_id: user.id,
        weekday: Number(weekday),
        start_time: startTime,
        end_time: endTime,
        active_from: activeFrom,
        active_until: activeUntil,
        notes: notes || null,
      }])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function removeAvailabilityWindow(id) {
    if (!id) throw new Error('id is required');
    const { error } = await sb()
      .from('assistant_availability_windows')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  }

  async function fetchMyAvailabilityBlackouts() {
    const user = await getCurrentUser();
    if (!user) return [];
    try {
      const { data, error } = await sb()
        .from('assistant_availability_blackouts')
        .select('id, starts_on, ends_on, reason, created_at')
        .eq('assistant_id', user.id)
        .order('starts_on', { ascending: true });
      if (error) { console.warn('fetchMyAvailabilityBlackouts', error); return []; }
      return data || [];
    } catch (_) { return []; }
  }

  async function addAvailabilityBlackout({ startsOn, endsOn, reason = null }) {
    const user = await getCurrentUser();
    if (!user) throw new Error('Not signed in');
    if (!startsOn || !endsOn) throw new Error('Both start and end dates are required');
    if (endsOn < startsOn) throw new Error('End date must be on or after start date');
    const { data, error } = await sb()
      .from('assistant_availability_blackouts')
      .insert([{
        assistant_id: user.id,
        starts_on: startsOn,
        ends_on: endsOn,
        reason: reason || null,
      }])
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function removeAvailabilityBlackout(id) {
    if (!id) throw new Error('id is required');
    const { error } = await sb()
      .from('assistant_availability_blackouts')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  }

  // Soft check — returns true if the assistant is available at this time
  // per their published windows + blackouts. Defaults to TRUE if they
  // haven't published anything (so the rest of the system still works
  // before availability data exists).
  async function checkAssistantAvailable({ assistantId, startsAtIso, durationMin }) {
    if (!assistantId || !startsAtIso || !durationMin) return true;
    try {
      const { data, error } = await sb().rpc('is_assistant_available_at', {
        p_assistant_id: assistantId,
        p_starts_at: startsAtIso,
        p_duration_minutes: Number(durationMin),
      });
      if (error) { console.warn('checkAssistantAvailable', error); return true; }
      return Boolean(data);
    } catch (_) { return true; }
  }

  // Assistant: count of past-but-still-scheduled appointments that need the
  // assistant to mark complete or no-show. Drives the My Schedule sidebar
  // badge so the assistant sees it without needing to open the page.
  async function fetchAssistantNeedsAttentionCount() {
    const user = await getCurrentUser();
    if (!user) return 0;
    try {
      const { count, error } = await sb()
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('assistant_id', user.id)
        .eq('status', 'scheduled')
        .lt('starts_at', new Date().toISOString());
      if (error) return 0;
      return Number(count) || 0;
    } catch (_) { return 0; }
  }

  // Unread message count for the signed-in user, across all conversations
  // they participate in. Used by the Messages sidebar badge for every role.
  // Definition: messages I haven't read AND that weren't sent by me.
  // read_by is a jsonb array of user_ids (auth.uid strings).
  async function fetchMyUnreadMessagesCount() {
    const user = await getCurrentUser();
    if (!user) return 0;
    try {
      const { data: parts } = await sb()
        .from('conversation_participants')
        .select('conversation_id')
        .eq('profile_id', user.id);
      const convIds = (parts || []).map(p => p.conversation_id);
      if (!convIds.length) return 0;

      const { data: msgs } = await sb()
        .from('conversation_messages')
        .select('id, read_by')
        .in('conversation_id', convIds)
        .neq('profile_id', user.id);
      if (!msgs) return 0;

      let unread = 0;
      for (const m of msgs) {
        const readBy = Array.isArray(m.read_by) ? m.read_by : [];
        if (!readBy.includes(user.id)) unread++;
      }
      return unread;
    } catch (_) { return 0; }
  }

  // Phase 3.5: read-only audit log of recent cancellations (assistant- or
  // client-initiated). Surfaced on admin-schedule-requests.html as a separate
  // section below the approval inbox since they no longer flow through it.
  async function adminFetchRecentCancellations({ limit = 50 } = {}) {
    try {
      const { data: appts, error } = await sb()
        .from('appointments')
        .select('id, client_id, assistant_id, contract_id, starts_at, ends_at, duration_minutes, status, title, notes, cancelled_at, cancelled_by, cancel_reason')
        .in('status', ['cancelled', 'late_cancelled'])
        .not('cancelled_at', 'is', null)
        .order('cancelled_at', { ascending: false })
        .limit(limit);
      if (error) return { rows: [] };
      const rows = appts || [];
      if (!rows.length) return { rows: [] };

      // Resolve client names
      const clientIds = [...new Set(rows.map(r => r.client_id))].filter(Boolean);
      const { data: clients } = clientIds.length
        ? await sb().from('clients').select('id, full_name').in('id', clientIds)
        : { data: [] };
      const clientsById = {};
      (clients || []).forEach(c => { clientsById[c.id] = c; });

      // Resolve canceller display name via profiles
      const cancellerIds = [...new Set(rows.map(r => r.cancelled_by))].filter(Boolean);
      const { data: profs } = cancellerIds.length
        ? await sb().from('profiles').select('user_id, full_name, role').in('user_id', cancellerIds)
        : { data: [] };
      const profsByUserId = {};
      (profs || []).forEach(p => { profsByUserId[p.user_id] = p; });

      return {
        rows: rows.map(r => ({
          ...r,
          client: clientsById[r.client_id] || null,
          canceller: r.cancelled_by ? (profsByUserId[r.cancelled_by] || null) : null,
        })),
      };
    } catch (_) {
      return { rows: [] };
    }
  }

  // List the families this assistant is engaged with — DEDUPED to one row
  // per client. Picks the most-relevant contract per family: active first,
  // then draft. (A family with both — active May contract + draft June
  // renewal — used to show twice. Fixed 2026-05-16.)
  // Default statuses match the contract_status enum: active + draft.
  // Pass `statuses` to override.
  async function fetchMyAssignedClients({ statuses = ['active','draft'] } = {}) {
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
      // Dedupe: pick best contract per client (active > draft; if same status,
      // most recent start_at wins because we ordered DESC above).
      const STATUS_RANK = { active: 0, draft: 1, paused: 2 };
      const bestByClient = new Map();
      for (const c of (contracts || [])) {
        const existing = bestByClient.get(c.client_id);
        if (!existing) { bestByClient.set(c.client_id, c); continue; }
        const aRank = STATUS_RANK[(c.status || '').toLowerCase()] ?? 99;
        const bRank = STATUS_RANK[(existing.status || '').toLowerCase()] ?? 99;
        if (aRank < bRank) bestByClient.set(c.client_id, c);
      }
      return Array.from(bestByClient.values()).map(c => ({
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
      // Phase 19d: positive ledger entries that came INTO this contract
      // (carryovers from prior contract, top-ups, refunds). Needed so the
      // assistant sees the TRUE remaining balance, not just included - used.
      hoursToppedUpMinutes: 0,
      hoursRemainingMinutes: 0,
    };

    try {
      const { data: client } = await sb()
        .from('clients').select('id, profile_id, full_name')
        .eq('id', clientId).maybeSingle();
      out.client = client || { id: clientId };
    } catch (_) {}

    try {
      // Pick the contract the assistant SHOULD be looking at right now.
      // Priority (highest first):
      //   1. Active contract whose service window contains today.
      //   2. Any other active contract (active but starts tomorrow, etc.).
      //   3. Recently expired contract (ended within last 45 days) — when
      //      we're in the gap between expiry and the next renewal start,
      //      THIS is where the family's live balance still lives.
      //   4. Latest draft (future renewal — only relevant if nothing else).
      //
      // Three previous bugs this rewrite addresses:
      //   • Original: sorted ['active','draft'] by start_at DESC and took
      //     first → future-dated DRAFT beat the active contract.
      //   • Fix v1: didn't include 'expired', so a contract that expired
      //     today (or last week) fell off entirely and the picker landed
      //     on the empty future draft → Hours remaining showed 40 (the
      //     draft's untouched plan size) instead of the real 6.75 left.
      //   • Date parsing: new Date('2026-05-15') is UTC midnight → that's
      //     2026-05-14 17:00 Pacific, so a contract ending today looked
      //     already-past to `new Date(end_at) >= now`. Now we treat end_at
      //     as end-of-day local.
      //   • assistant_id filter: legacy/imported contracts sometimes have
      //     NULL or a different assistant_id, which dropped them from the
      //     query entirely. RLS already gates visibility, so we no longer
      //     require an exact assistant_id match here — we still PREFER
      //     contracts owned by this assistant when there's a tie.
      const { data: candidates } = await sb()
        .from('contracts')
        .select('id, client_id, assistant_id, status, start_at, end_at, included_minutes, renewal_mode, notes')
        .eq('client_id', clientId)
        // contract_status enum: draft/active/expired/completed/cancelled
        .in('status', ['active','draft','expired'])
        .order('start_at', { ascending: false });
      const rows = Array.isArray(candidates) ? candidates : [];

      // Date helpers that ignore timezone surprises. Parse YYYY-MM-DD as
      // a local date so contracts ending "today" aren't treated as expired.
      const parseLocalDate = (s) => {
        if (!s) return null;
        const str = String(s);
        const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d;
      };
      const startOf = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x; };
      const endOf   = (d) => { const x = new Date(d); x.setHours(23,59,59,999); return x; };
      const today = new Date();
      const todayStart = startOf(today);
      const todayEnd   = endOf(today);

      const containsToday = (r) => {
        const s = parseLocalDate(r.start_at);
        const e = parseLocalDate(r.end_at);
        if (!s || !e) return false;
        return startOf(s) <= todayEnd && endOf(e) >= todayStart;
      };
      // Prefer contracts assigned to me; when there's no match, accept any.
      const mine = (r) => !user?.id || r.assistant_id === user.id;
      const pickFrom = (filter) => rows.find(r => filter(r) && mine(r))
                                 || rows.find(filter);

      const pickActiveNow = pickFrom(r => r.status === 'active' && containsToday(r));
      const pickAnyActive = pickFrom(r => r.status === 'active');
      // "Recently expired" — ended within last 45 days. Catches the gap
      // between an expiring contract and the next renewal starting.
      const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;
      const pickRecentlyExpired = pickFrom(r => {
        if (r.status !== 'expired') return false;
        const e = parseLocalDate(r.end_at);
        if (!e) return false;
        return (todayStart - endOf(e)) <= FORTY_FIVE_DAYS_MS;
      });
      const pickDraft = pickFrom(r => r.status === 'draft');
      out.contract = pickActiveNow || pickAnyActive || pickRecentlyExpired || pickDraft || null;
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
      // Hours topped up = sum of positive minutes_delta (carryovers INTO this contract,
      //   admin top-ups, refunds, etc.). Counted separately so the UI can show
      //   "you started with 40h + 2.75h carried over" instead of pretending the
      //   contract just has 42.75h plain.
      // Hours remaining = included_minutes + sum(all deltas)
      //   (positive deltas add, negative deltas subtract — same as how the
      //   ledger naturally accumulates). This is the source of truth for
      //   "how many hours does this family have left RIGHT NOW".
      try {
        const { data: ledger } = await sb()
          .from('hours_ledger')
          .select('minutes_delta')
          .eq('contract_id', out.contract.id);
        let usedMin = 0;
        let toppedUpMin = 0;
        let netDeltaMin = 0;
        (ledger || []).forEach(r => {
          const v = Number(r.minutes_delta) || 0;
          netDeltaMin += v;
          if (v < 0) usedMin += Math.abs(v);
          else if (v > 0) toppedUpMin += v;
        });
        out.hoursUsedMinutes = Math.round(usedMin);
        out.hoursToppedUpMinutes = Math.round(toppedUpMin);
        const included = Number(out.contract.included_minutes) || 0;
        out.hoursRemainingMinutes = Math.round(included + netDeltaMin);
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
      // Phase 8: per-assistant timezone for availability calculations.
      // Defaults to America/Vancouver if not provided.
      timezone: patch.timezone || 'America/Vancouver',
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
    // Case 1 — the client themselves (clients.profile_id matches their auth uid).
    const { data: direct } = await sb().from('clients')
      .select('id, full_name, display_name, hours_balance, active_plan_id, plan_started_at, created_at')
      .eq('profile_id', u.user.id)
      .maybeSingle();
    if (direct) return direct;
    // Case 2 — a FAMILY MEMBER (OWNER role in family_assignments). Family
    // members like the parent or sibling sign in and need to see their
    // client's record. Falls back to the family_assignments lookup so
    // every page using fetchMyClientRecord/_myClientId still works for them.
    try {
      const { data: fa } = await sb().from('family_assignments')
        .select('client_id')
        .eq('user_id', u.user.id)
        .eq('role', 'OWNER')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (fa?.client_id) {
        const { data: viaFamily } = await sb().from('clients')
          .select('id, full_name, display_name, hours_balance, active_plan_id, plan_started_at, created_at')
          .eq('id', fa.client_id)
          .maybeSingle();
        return viaFamily || null;
      }
    } catch (_) {}
    return null;
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

  // Phase 19b: Full payment history for one client (lifetime, both family
  // and assistant views). Returns invoices + line items + optional linked
  // contract details (start_at, end_at, status, included_minutes) so the UI
  // can render a unified Payment History table without separate roundtrips.
  async function fetchClientPaymentHistory(clientId) {
    if (!clientId) return [];
    try {
      // Pull every invoice for the client (including voids — we filter visually)
      const { data: invoices, error: invErr } = await sb()
        .from('invoices')
        .select('id, contract_id, status, invoice_number, invoice_date, total_cents, amount_paid_cents, balance_due_cents, currency, subject, customer_notes, billing_name, client_name, issued_at')
        .eq('client_id', clientId)
        .order('invoice_date', { ascending: false });
      if (invErr) { console.warn('fetchClientPaymentHistory invoices:', invErr); return []; }
      const rows = invoices || [];
      if (!rows.length) return [];

      // Pull line items in one shot
      const invoiceIds = rows.map(r => r.id);
      const { data: lines } = await sb()
        .from('invoice_lines')
        .select('id, invoice_id, position, description, quantity, hours, hourly_rate_cents, unit_price_cents, line_total_cents')
        .in('invoice_id', invoiceIds)
        .order('position', { ascending: true });
      const linesByInvoice = new Map();
      (lines || []).forEach(l => {
        if (!linesByInvoice.has(l.invoice_id)) linesByInvoice.set(l.invoice_id, []);
        linesByInvoice.get(l.invoice_id).push(l);
      });

      // Pull linked contracts in one shot (only for invoices that have contract_id)
      const contractIds = [...new Set(rows.map(r => r.contract_id).filter(Boolean))];
      let contractsById = new Map();
      if (contractIds.length) {
        const { data: contracts } = await sb()
          .from('contracts')
          .select('id, status, start_at, end_at, included_minutes')
          .in('id', contractIds);
        (contracts || []).forEach(c => contractsById.set(c.id, c));
      }

      return rows.map(r => ({
        ...r,
        line_items: linesByInvoice.get(r.id) || [],
        contract: r.contract_id ? (contractsById.get(r.contract_id) || null) : null,
      }));
    } catch (e) { console.warn('fetchClientPaymentHistory threw:', e); return []; }
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

  // Client-side cancellation — Phase 3.5 business rule applied to clients too:
  // "no one can be forced to do appointments. cancellation doesn't need approval."
  //
  // Previously inserted a row into schedule_change_requests with status='pending'
  // and waited for admin approval. Now calls the existing cancel_own_appointment
  // SECURITY DEFINER RPC which: validates the caller is the appointment's owning
  // client (clients.profile_id = auth.uid()), flips status to 'cancelled' (or
  // 'late_cancelled' if <24h away), and records cancelled_at / cancelled_by /
  // cancel_reason — atomically, no admin step. No automatic hours forfeit.
  //
  // Function signature preserved for the existing client-schedule.html caller.
  async function submitCancelRequest({ appointmentId, appointment, reason = '' }) {
    if (!appointmentId && !appointment?.id) throw new Error('submitCancelRequest: appointmentId is required');
    const id = appointmentId || appointment.id;
    const { data, error } = await sb().rpc('cancel_own_appointment', {
      p_appointment_id: id,
      p_cancel_reason: String(reason || '').trim() || null,
    });
    if (error) throw error;
    return data; // returns the updated appointment row
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
    // scheduler Phase 3 — schedule change requests (assistant)
    assistantSubmitCancelRequest, assistantSubmitRescheduleRequest,
    assistantSubmitExtraAppointmentRequest, fetchAssistantPendingScheduleRequests,
    // scheduler Phase 3.5 — admin badges + cancellations audit
    adminFetchPendingScheduleRequestsCount, adminFetchRecentCancellations,
    adminFetchPendingMembershipRequestsCount, adminFetchPendingApplicationsCount,
    // sidebar badges — messages unread (any role)
    fetchMyUnreadMessagesCount,
    // sidebar badge — assistant My Schedule
    fetchAssistantNeedsAttentionCount,
    // scheduler Phase 5 — availability windows + blackouts
    fetchMyAvailabilityWindows, addAvailabilityWindow, removeAvailabilityWindow,
    fetchMyAvailabilityBlackouts, addAvailabilityBlackout, removeAvailabilityBlackout,
    checkAssistantAvailable,
    // Phase 6 — contract pause / freeze
    adminFreezeContract, adminUnfreezeContract,
    fetchContractFreezes, adminListContractsForFreezeUI,
    // Phase 7 — change-token status (3-free policy)
    fetchContractTokenStatus, fetchMyContractTokenStatus,
    // Phase 12 — bank-hours (leftover carryover)
    fetchClientBankSummary, fetchMyBankSummary, fetchClientBankHistory,
    adminAdjustBankBalance,
    // Phase 12.1 — bank-hours spend (per-appointment breakdown)
    fetchAppointmentSpend, fetchAppointmentSpendBatch,
    // Phase 12.2 — assistant nudges family to use banked hours
    assistantSuggestBankHoursUsage,
    // Phase 18 — Lesson Tracker (post-session journal)
    fetchLessonLog, upsertLessonLog, addLessonUrl, softDeleteLessonFile,
    fetchLessonHistory, fetchLessonLogsForAppointments,
    fetchLessonInternalNote, upsertLessonInternalNote,
    // Phase 18b.3 — Recent-session context for prep
    fetchRecentLessonContext,
    // Phase 18d — Real file uploads via Supabase Storage
    uploadLessonFile, getLessonFileSignedUrl,
    // assistant-side (Phase 3)
    updateMyAssistantProfile, fetchMyAssistantHoursLedger,
    // admin: clients
    adminCreateClientAccount, adminListClients, adminFetchHomeKpis, adminFetchMonthlyStats,
    // client (self)
    fetchMyClientRecord, fetchMyConversations, fetchMyContracts, fetchMyInvoices,
    fetchClientPaymentHistory,
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
