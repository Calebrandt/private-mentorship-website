// ════════════════════════════════════════════════════════════════
// Master search — drop-in for every page that has a .nx-search input.
//
// Wires the topbar's "Search sessions, messages, documents…" input
// to a real search engine that hits BOTH:
//   • a static index of pages + sections (so "schedule", "invoices",
//     "lesson journal" etc. always navigate even before any data
//     loads)
//   • the signed-in user's own dynamic data via window.pmHiring
//     (sessions, invoices, contracts, conversations, clients,
//     lesson logs — scoped by role)
//
// Shows a categorized dropdown below the input. Keyboard nav:
// ↑ ↓ to move, Enter to open, Esc to close. Click outside to close.
// Matching text is highlighted in each result. Results deep-link
// to the right page via URL hash where possible.
//
// Role detection: filename pattern (client-*, assistant-*, admin-*)
// falls back to profile.role lookup if the URL doesn't disambiguate.
// ════════════════════════════════════════════════════════════════

(function () {
  if (window.__pmMasterSearchWired) return;     // idempotent
  window.__pmMasterSearchWired = true;

  // ── Helpers ─────────────────────────────────────────────────────
  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }
  function highlight(text, query) {
    if (!query) return escapeHtml(text);
    const safe = escapeHtml(text);
    // Escape regex metachars in query
    const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safe.replace(new RegExp(q, 'gi'), m => `<mark class="ms-mark">${m}</mark>`);
  }
  function detectRoleFromUrl() {
    const p = (location.pathname.split('/').pop() || '').toLowerCase();
    if (p.startsWith('client-'))    return 'client';
    if (p.startsWith('assistant-')) return 'assistant';
    if (p.startsWith('admin-'))     return 'admin';
    return null;
  }
  // Sync best-effort guess from URL or cached profile. Used as initial
  // value before the async detectRole() resolves.
  function detectRoleSync() {
    const fromUrl = detectRoleFromUrl();
    if (fromUrl) return fromUrl;
    try {
      const cached = window.__pmCachedProfile;
      if (cached?.role) {
        const r = String(cached.role).toUpperCase();
        if (r.includes('CLIENT'))    return 'client';
        if (r.includes('ASSISTANT')) return 'assistant';
        if (r.includes('ADMIN') || r.includes('OWNER')) return 'admin';
      }
    } catch (_) {}
    return 'client';   // sensible default
  }
  // True role detection: URL pattern wins; if ambiguous (messages.html,
  // signin.html etc.) we fetch the user's profile and decide from role.
  // Memoized so we only ever fetch once.
  let _roleCache = null;
  async function detectRole() {
    if (_roleCache) return _roleCache;
    const fromUrl = detectRoleFromUrl();
    if (fromUrl) { _roleCache = fromUrl; return _roleCache; }
    // Ambiguous page — try profile.role
    try {
      const profile = await window.pmHiring?.fetchCurrentUserProfile?.();
      if (profile) {
        window.__pmCachedProfile = profile;
        const r = String(profile.role || '').toUpperCase();
        if (r.includes('ADMIN') || r.includes('OWNER')) _roleCache = 'admin';
        else if (r.includes('ASSISTANT'))                _roleCache = 'assistant';
        else                                              _roleCache = 'client';
        return _roleCache;
      }
    } catch (_) {}
    _roleCache = 'client';
    return _roleCache;
  }
  function fmtDate(iso) {
    if (!iso) return '';
    const s = String(iso);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    try { return new Date(s).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (_) { return s; }
  }
  function fmtMoney(cents) {
    const n = Number(cents || 0) / 100;
    return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  }

  // ── Icons (small inline SVG) ────────────────────────────────────
  const ICONS = {
    page:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>',
    session:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    invoice:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>',
    contract: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12h6"/><path d="M9 16h6"/><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    message:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    client:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    section:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
  };

  // ── Static page index ────────────────────────────────────────────
  const PAGE_INDEX = {
    client: [
      { url: 'client-dashboard.html',      title: 'Dashboard',         keywords: 'home overview snapshot kpis hours available remaining used upcoming',
        sections: ['Hours available', 'Hours remaining', 'Hours used', 'Upcoming sessions', 'Active engagements'] },
      { url: 'client-contract.html',       title: 'Contract details',  keywords: 'plan membership subscription renewal billing reserved schedule',
        sections: ['Current plan', 'Reserved schedule', 'Service period', 'Billing', 'Payment history'] },
      { url: 'client-hours.html',          title: 'Hours & Billing',   keywords: 'hours billing invoices payments ledger activity banked saved',
        sections: ['Hours remaining', 'Hours used', 'Total paid', 'Open invoices', 'Hours activity', 'Invoices', 'Banked hours'] },
      { url: 'client-schedule.html',       title: 'Schedule',          keywords: 'calendar sessions appointments bookings weekly pattern',
        sections: ['This week', 'Upcoming sessions', 'Past sessions'] },
      { url: 'client-membership.html',     title: 'Membership',        keywords: 'plan tier upgrade pricing standard executive 24 40 hours switch',
        sections: ['Plans', 'Pricing', 'Switch plan'] },
      { url: 'client-lesson-journal.html', title: 'Lesson Journal',    keywords: 'lessons notes progress logs files attachments tutoring',
        sections: ['Recent lessons'] },
      { url: 'client-education.html',      title: 'Education',         keywords: 'resources files documents plans library guide',
        sections: [] },
      { url: 'client-assistants.html',     title: 'Your Assistant',    keywords: 'assistant roster picks meet introductions matching family',
        sections: ['Browse the roster', 'My picks'] },
      { url: 'client-gift.html',           title: 'Gift Service',      keywords: 'gift present family give',
        sections: [] },
      { url: 'messages.html',              title: 'Messages',          keywords: 'chat conversation inbox assistant',
        sections: [] },
    ],
    assistant: [
      { url: 'assistant-dashboard.html',     title: 'Dashboard',        keywords: 'home overview kpis families earnings money clients hours',
        sections: ['Earned this month', 'Active engagements', 'My families', 'Upcoming renewals'] },
      { url: 'assistant-clients.html',       title: 'My Clients',       keywords: 'families clients engagements roster active',
        sections: [] },
      { url: 'assistant-schedule.html',      title: 'Schedule',         keywords: 'calendar sessions appointments bookings week',
        sections: ['This week', 'Upcoming'] },
      { url: 'assistant-availability.html',  title: 'Availability',     keywords: 'time off free time blocks weekly',
        sections: [] },
      { url: 'assistant-hours.html',         title: 'Hours',            keywords: 'time tracking logged hours payouts',
        sections: [] },
      { url: 'assistant-lesson-tracker.html',title: 'Lesson Tracker',   keywords: 'lessons notes progress logs files attachments',
        sections: [] },
      { url: 'assistant-profile.html',       title: 'Profile',          keywords: 'account settings bio photo password',
        sections: [] },
      { url: 'assistant-resources.html',     title: 'Resources',        keywords: 'library documents help guides templates',
        sections: [] },
      { url: 'assistant-help.html',          title: 'Help',             keywords: 'support faq question contact',
        sections: [] },
      { url: 'messages.html',                title: 'Messages',         keywords: 'chat conversation inbox families',
        sections: [] },
    ],
    admin: [
      { url: 'admin-dashboard.html',           title: 'Dashboard',           keywords: 'overview kpis pipeline' },
      { url: 'admin-application.html',         title: 'Applications',        keywords: 'apply candidates new hires hiring' },
      { url: 'admin-hiring.html',              title: 'Hiring',              keywords: 'pipeline candidates onboarding' },
      { url: 'admin-assistant-profiles.html',  title: 'Assistant Profiles',  keywords: 'assistants directory roster' },
      { url: 'admin-create-client.html',       title: 'Create Client',       keywords: 'new family onboarding' },
      { url: 'admin-freezes.html',             title: 'Freezes',             keywords: 'pause membership freeze' },
      { url: 'admin-intro-requests.html',      title: 'Intro Requests',      keywords: 'introductions meet 30 min' },
      { url: 'admin-membership-requests.html', title: 'Membership Requests', keywords: 'plan change switch' },
      { url: 'admin-schedule-requests.html',   title: 'Schedule Requests',   keywords: 'reschedule slot change' },
      { url: 'messages.html',                  title: 'Messages',            keywords: 'chat inbox' },
    ],
  };

  // ── Dynamic data cache (per-role, 30s TTL) ──────────────────────
  const CACHE = { role: null, fetchedAt: 0, data: null };
  const CACHE_TTL_MS = 30 * 1000;
  const FETCH_TIMEOUT_MS = 5000;     // give each fetcher up to 5s

  // Safe call helper: returns a Promise that ALWAYS resolves to `fallback`
  // on any failure — missing function, sync throw, async rejection, OR
  // timeout. One bad fetcher can't ever hang the whole loadDynamic.
  function safeCall(fn, args, fallback) {
    if (typeof fn !== 'function') return Promise.resolve(fallback);
    return new Promise((resolve) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      const timer = setTimeout(() => done(fallback), FETCH_TIMEOUT_MS);
      try {
        Promise.resolve(fn(args))
          .then(v => { clearTimeout(timer); done(v == null ? fallback : v); })
          .catch(err => {
            clearTimeout(timer);
            console.warn('master-search: fetcher failed', fn.name || '(anon)', err);
            done(fallback);
          });
      } catch (err) {
        clearTimeout(timer);
        console.warn('master-search: fetcher threw sync', fn.name || '(anon)', err);
        done(fallback);
      }
    });
  }

  async function loadDynamic(role) {
    if (!window.pmHiring) return {};
    const now = Date.now();
    if (CACHE.role === role && CACHE.data && (now - CACHE.fetchedAt) < CACHE_TTL_MS) {
      return CACHE.data;
    }
    const out = {
      sessions: [], invoices: [], contracts: [], conversations: [],
      clients: [], lessonLogs: [],
      applications: [], assistantProfiles: [], scheduleRequests: [], membershipRequests: [],
    };
    const pm = window.pmHiring;

    try {
      if (role === 'client') {
        const client = await safeCall(pm.fetchMyClientRecord, undefined, null);
        const [ws, invoices, contracts, convos, lessonHistory] = await Promise.all([
          client?.id ? safeCall(pm.fetchAssistantClientWorkspace, client.id, null) : Promise.resolve(null),
          safeCall(pm.fetchMyInvoices, 24, []),
          safeCall(pm.fetchMyContracts, undefined, []),
          safeCall(pm.fetchMyConversations, 30, []),
          // Lifetime lesson history (limit 500). Each row has focus_area,
          // key_concepts, next_session_notes, feedback, appointment_title
          // — full-text searchable. RLS scopes this to the family.
          client?.id ? safeCall(pm.fetchLessonHistory, client.id, []) : Promise.resolve([]),
        ]);
        if (ws) {
          out.sessions = [
            ...(ws.upcomingAppointments || []).map(a => ({ ...a, _bucket: 'upcoming' })),
            ...(ws.recentAppointments   || []).map(a => ({ ...a, _bucket: 'past' })),
          ];
        }
        out.invoices      = invoices || [];
        out.contracts     = contracts || [];
        out.conversations = convos || [];
        out.lessonLogs    = lessonHistory || [];
      } else if (role === 'assistant') {
        const start = new Date(); start.setDate(start.getDate() - 60);
        const end   = new Date(); end.setDate(end.getDate() + 30);
        const [clients, range] = await Promise.all([
          safeCall(pm.fetchMyAssignedClients, { statuses: ['active','draft'] }, []),
          safeCall(pm.fetchAssistantAppointmentsRange, { startIso: start.toISOString(), endIso: end.toISOString() }, null),
        ]);
        out.clients  = clients || [];
        out.sessions = (range?.appointments || []).map(a => ({ ...a }));
        // Assistant lesson history: lifetime per assigned client, merged.
        // 200 logs per client is plenty; capped via the fetcher's default.
        try {
          const lessonResults = await Promise.all(
            (out.clients || []).map(c =>
              safeCall(pm.fetchLessonHistory, c.id || c.client_id, [])
            )
          );
          out.lessonLogs = lessonResults.flat();
        } catch (_) { out.lessonLogs = []; }
      } else if (role === 'admin') {
        // Admin can see the whole org. First batch — top-level lists.
        const [apps, clients, profiles, schedReq, memReq] = await Promise.all([
          safeCall(pm.adminListApplications,       { status: 'active' }, []),
          safeCall(pm.adminListClients,            { limit: 200 },       []),
          safeCall(pm.adminListAssistantProfiles,  undefined,            []),
          safeCall(pm.adminListScheduleRequests,   { statuses: ['pending'], limit: 100 }, { requests: [] }),
          safeCall(pm.adminListMembershipRequests, { limit: 100 },       []),
        ]);
        out.applications       = apps || [];
        out.clients            = clients || [];
        out.assistantProfiles  = profiles || [];
        out.scheduleRequests   = (schedReq && schedReq.requests) || schedReq || [];
        out.membershipRequests = memReq || [];

        // Second batch — fan out per-client to grab everything searchable
        // for the whole org. RLS already gives admin read access. Capped
        // to the first 40 clients to keep the parallel fan-out reasonable.
        const clientList = (clients || []).slice(0, 40);
        const nameById = new Map();
        clientList.forEach(c => nameById.set(c.id || c.client_id, c.full_name || c.client_name || c.name || ''));
        try {
          const [lessonResults, invoiceResults, workspaceResults] = await Promise.all([
            Promise.all(clientList.map(c => safeCall(pm.fetchLessonHistory,        c.id || c.client_id, []))),
            Promise.all(clientList.map(c => safeCall(pm.fetchClientPaymentHistory, c.id || c.client_id, []))),
            // Workspace gives us each client's active contract + upcoming +
            // recent appointments in one round-trip per client.
            Promise.all(clientList.map(c => safeCall(pm.fetchAssistantClientWorkspace, c.id || c.client_id, null))),
          ]);
          out.lessonLogs = lessonResults.flat();
          out.invoices = invoiceResults.flat().map(inv => ({
            ...inv,
            _clientName: nameById.get(inv.client_id) || '',
          }));
          // Flatten contracts + sessions out of every workspace
          const contracts = [];
          const sessions  = [];
          workspaceResults.forEach((ws, i) => {
            if (!ws) return;
            const cid = clientList[i] && (clientList[i].id || clientList[i].client_id);
            const cname = nameById.get(cid) || '';
            if (ws.contract) {
              contracts.push({ ...ws.contract, client_id: cid, _clientName: cname });
            }
            (ws.upcomingAppointments || []).forEach(a => sessions.push({ ...a, client_id: cid, _clientName: cname, _bucket: 'upcoming' }));
            (ws.recentAppointments   || []).forEach(a => sessions.push({ ...a, client_id: cid, _clientName: cname, _bucket: 'past' }));
          });
          out.contracts = contracts;
          out.sessions  = sessions;
        } catch (_) {
          // If the fan-out fails, the top-level lists still work
        }
      }

      // Self-record — always add the signed-in user as a searchable
      // result so admins/assistants can find "my account / my profile"
      // by typing their own name or email.
      try {
        const me = await safeCall(pm.getCurrentUser, undefined, null);
        const myProfile = await safeCall(pm.fetchCurrentUserProfile, undefined, null);
        if (me) {
          out._self = {
            id: me.id,
            email: me.email,
            full_name: myProfile?.full_name || me.email?.split('@')[0] || 'You',
            role: myProfile?.role || '',
          };
        }
      } catch (_) {}
    } catch (e) {
      console.warn('master-search: dynamic load failed', e);
    }

    CACHE.role = role;
    CACHE.fetchedAt = now;
    CACHE.data = out;
    return out;
  }

  // ── Search/match ────────────────────────────────────────────────
  function matches(haystack, q) {
    if (!q) return false;
    if (!haystack) return false;
    return String(haystack).toLowerCase().includes(q);
  }

  function search(query, role, dyn) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return null;
    const qEnc = encodeURIComponent(query.trim());     // for the &q=… deep-link param

    const results = {
      pages: [], sessions: [], invoices: [], contracts: [], messages: [],
      clients: [], lessonLogs: [],
      applications: [], assistantProfiles: [], scheduleRequests: [], membershipRequests: [],
    };
    // Per-section try wrapper — one bad data shape can't kill everything else.
    const tryEach = (label, arr, fn) => {
      try { (arr || []).forEach(fn); }
      catch (err) { console.warn('master-search: section failed (' + label + ')', err); }
    };
    // Helper to append &q=… (the search query) to any deep-link URL so the
    // landing page can also do in-page text highlighting.
    const withQ = (url) => url + (url.includes('?') ? '&' : '?') + 'q=' + qEnc;

    // Pages (static)
    tryEach('pages', PAGE_INDEX[role], p => {
      const blob = `${p.title} ${p.keywords || ''} ${(p.sections || []).join(' ')}`.toLowerCase();
      if (blob.includes(q)) {
        const matchedSection = (p.sections || []).find(s => s.toLowerCase().includes(q));
        results.pages.push({
          icon: ICONS.page,
          title: p.title,
          subtitle: matchedSection || 'Page',
          url: withQ(p.url),
        });
      }
    });

    // Sessions
    tryEach('sessions', dyn.sessions, a => {
      const hrs = a.duration_minutes ? (a.duration_minutes / 60) : 0;
      const blob = `${a.title || ''} ${a.notes || ''} ${a.kind || ''} ${a.status || ''} ${a._clientName || ''} ${hrs}h ${hrs}`.toLowerCase();
      const dateStr = fmtDate(a.starts_at);
      if (blob.includes(q) || dateStr.toLowerCase().includes(q)) {
        const url = role === 'client' ? 'client-schedule.html' : 'assistant-schedule.html';
        const subtitleParts = [];
        if (a._clientName) subtitleParts.push(a._clientName);
        subtitleParts.push(dateStr);
        if (hrs) subtitleParts.push(hrs + 'h');
        if (a.status) subtitleParts.push(a.status);
        results.sessions.push({
          icon: ICONS.session,
          title: a.title || 'Session',
          subtitle: subtitleParts.join(' · '),
          url: withQ(`${url}#appt-${a.id}`),
          _preview: { kind: 'session', data: a },
        });
      }
    });

    // Invoices (client + admin) — also match against formatted money so
    // searches like "1200" or "1,200" or "$1,200" find the right ones.
    tryEach('invoices', dyn.invoices, inv => {
      const label = inv.invoice_number || ('Invoice ' + (inv.id || '').slice(0, 8));
      const cents = Number(inv.total_cents || inv.amount_paid_cents || 0);
      const dollars = cents / 100;
      const moneyBlob = [
        fmtMoney(cents),                                    // "$1,200"
        dollars.toFixed(0),                                  // "1200"
        dollars.toLocaleString('en-CA'),                     // "1,200"
        dollars.toString(),                                  // "1200"
      ].join(' ').toLowerCase();
      const blob = `${label} ${inv.subject || ''} ${inv.customer_notes || ''} ${inv.status || ''} ${inv._clientName || ''} ${moneyBlob}`.toLowerCase();
      const dateStr = fmtDate(inv.invoice_date);
      if (blob.includes(q) || dateStr.toLowerCase().includes(q)) {
        const subtitleParts = [];
        if (inv._clientName) subtitleParts.push(inv._clientName);
        subtitleParts.push(dateStr);
        subtitleParts.push(fmtMoney(inv.total_cents || inv.amount_paid_cents));
        if (inv.status) subtitleParts.push(inv.status);
        results.invoices.push({
          icon: ICONS.invoice,
          title: label,
          subtitle: subtitleParts.join(' · '),
          // Admin doesn't have client-hours.html — fall back to a general invoice view
          url: withQ(role === 'admin' ? `admin-dashboard.html#inv-${inv.id}` : `client-hours.html#inv-${inv.id}`),
          _preview: {
            kind: 'invoice',
            data: inv,
            clientName: inv._clientName || '',
          },
        });
      }
    });

    // Contracts (client + admin)
    tryEach('contracts', dyn.contracts, c => {
      const label = c._label || (c.status ? c.status[0].toUpperCase() + c.status.slice(1) + ' contract' : 'Contract');
      // Include hours, money equivalents, client name (admin) for broad matching
      const hrs = c.included_hours || (c.included_minutes ? c.included_minutes / 60 : 0);
      const blob = `${label} ${c.status || ''} ${c.assistant_name || ''} ${c._clientName || ''} ${hrs}h ${hrs}`.toLowerCase();
      const dateStr = `${fmtDate(c.start_at)} – ${fmtDate(c.end_at)}`;
      if (blob.includes(q) || dateStr.toLowerCase().includes(q)) {
        const subtitleParts = [];
        if (c._clientName) subtitleParts.push(c._clientName);
        subtitleParts.push(dateStr);
        if (hrs) subtitleParts.push(hrs + 'h');
        if (c.status) subtitleParts.push(c.status);
        results.contracts.push({
          icon: ICONS.contract,
          title: label,
          subtitle: subtitleParts.join(' · '),
          url: withQ(`client-contract.html#contract-${c.id}`),
        });
      }
    });

    // Lesson logs — full-text search across appointment_title, focus_area,
    // key_concepts, next_session_notes, feedback. Lifetime, not year-scoped.
    tryEach('lessonLogs', dyn.lessonLogs, l => {
      const blob = `${l.appointment_title || ''} ${l.focus_area || ''} ${l.key_concepts || ''} ${l.next_session_notes || ''} ${l.feedback || ''} ${l.lesson_assistant_name || ''}`.toLowerCase();
      const dateStr = fmtDate(l.starts_at);
      if (blob.includes(q) || dateStr.toLowerCase().includes(q)) {
        const year = l.starts_at ? new Date(l.starts_at).getFullYear() : null;
        // Client → own journal page; assistant/admin → lesson tracker
        // scoped to the specific client via ?clientId=…
        const lessonUrl = role === 'client'
          ? `client-lesson-journal.html?year=${year || ''}#lesson-${encodeURIComponent(l.appointment_id || '')}`
          : `assistant-lesson-tracker.html?clientId=${encodeURIComponent(l.client_id || '')}&year=${year || ''}#lesson-${encodeURIComponent(l.appointment_id || '')}`;
        const snippet = [l.focus_area, l.key_concepts, l.next_session_notes, l.feedback]
          .find(s => s && String(s).toLowerCase().includes(q)) || l.key_concepts || l.focus_area || '';
        // For admin/assistant context, prepend the client name to the
        // subtitle so it's obvious WHO the lesson belongs to.
        const clientPrefix = (role === 'admin' || role === 'assistant')
          ? ((dyn.clients || []).find(c => (c.id || c.client_id) === l.client_id)?.full_name || '')
          : '';
        const subtitleParts = [];
        if (clientPrefix) subtitleParts.push(clientPrefix);
        subtitleParts.push(dateStr);
        if (snippet) subtitleParts.push(String(snippet).slice(0, 80));
        results.lessonLogs.push({
          icon: ICONS.page,
          title: l.appointment_title || 'Lesson',
          subtitle: subtitleParts.join(' · '),
          url: withQ(lessonUrl),
          // For preview pane — keep the full data
          _preview: {
            kind: 'lesson',
            data: l,
            clientName: clientPrefix,
          },
        });
      }
    });

    // Conversations / messages
    tryEach('messages', dyn.conversations, conv => {
      const blob = `${conv.title || ''} ${conv.other_name || ''} ${conv.last_message_text || ''}`.toLowerCase();
      if (blob.includes(q)) {
        results.messages.push({
          icon: ICONS.message,
          title: conv.title || conv.other_name || 'Conversation',
          subtitle: conv.last_message_text || 'Open conversation',
          url: withQ(`messages.html?c=${encodeURIComponent(conv.id || '')}`),
        });
      }
    });

    // Self ("Your account") — let the user find their own page by name
    // or email. Always pinned at the top of Pages.
    try {
      if (dyn._self) {
        const me = dyn._self;
        const blob = `${me.full_name || ''} ${me.email || ''} my account profile you self`.toLowerCase();
        if (blob.includes(q)) {
          const myPage = role === 'client' ? 'client-dashboard.html'
                       : role === 'assistant' ? 'assistant-profile.html'
                       : 'admin-dashboard.html';
          results.pages.unshift({
            icon: ICONS.client,
            title: `${me.full_name} (You)`,
            subtitle: me.email + (me.role ? ' · ' + me.role : ''),
            url: withQ(myPage),
          });
        }
      }
    } catch (_) {}

    // Clients — for admin/assistant, the Clients section acts as a
    // "browse by family" view. We include every client who has either
    // (a) a direct name/email/status match OR (b) any matching item
    // under them (lessons, invoices, sessions, contracts). Each row
    // exposes a dossier in the preview pane.
    // For clients (single-user role) this just shows themselves.
    tryEach('clients', dyn.clients, c => {
      const cid = c.id || c.client_id;
      const name = c.full_name || c.client_name || c.name || '';
      const blob = `${name} ${c.email || ''} ${c.contract_status || ''} ${(cid || '').slice(0,8)}`.toLowerCase();
      const directMatch = blob.includes(q);

      // Rollup — what matched FOR this client across other sections
      const clientLessons   = (dyn.lessonLogs   || []).filter(l => {
        if (l.client_id !== cid) return false;
        const lblob = `${l.appointment_title || ''} ${l.focus_area || ''} ${l.key_concepts || ''} ${l.next_session_notes || ''} ${l.feedback || ''}`.toLowerCase();
        return lblob.includes(q) || fmtDate(l.starts_at).toLowerCase().includes(q);
      });
      const clientInvoices  = (dyn.invoices     || []).filter(i => {
        if (i.client_id !== cid) return false;
        const cents = Number(i.total_cents || i.amount_paid_cents || 0);
        const moneyBlob = [fmtMoney(cents), (cents/100).toString(), (cents/100).toLocaleString('en-CA')].join(' ').toLowerCase();
        const iblob = `${i.invoice_number || ''} ${i.subject || ''} ${i.customer_notes || ''} ${i.status || ''} ${moneyBlob}`.toLowerCase();
        return iblob.includes(q) || fmtDate(i.invoice_date).toLowerCase().includes(q);
      });
      const clientSessions  = (dyn.sessions     || []).filter(s => {
        if (s.client_id !== cid) return false;
        const hrs = s.duration_minutes ? (s.duration_minutes / 60) : 0;
        const sblob = `${s.title || ''} ${s.notes || ''} ${s.kind || ''} ${s.status || ''} ${hrs}h`.toLowerCase();
        return sblob.includes(q) || fmtDate(s.starts_at).toLowerCase().includes(q);
      });
      const clientContracts = (dyn.contracts    || []).filter(k => {
        if (k.client_id !== cid) return false;
        const hrs = k.included_hours || (k.included_minutes ? k.included_minutes / 60 : 0);
        const kblob = `${k._label || ''} ${k.status || ''} ${k.assistant_name || ''} ${hrs}h`.toLowerCase();
        return kblob.includes(q) || fmtDate(k.start_at).toLowerCase().includes(q) || fmtDate(k.end_at).toLowerCase().includes(q);
      });
      const rollupCount = clientLessons.length + clientInvoices.length + clientSessions.length + clientContracts.length;

      if (!directMatch && rollupCount === 0) return;     // nothing relevant for this client

      const isAdmin = role === 'admin';
      // Subtitle reflects WHY they're in the list — match count breakdown
      // when it's a rollup-only hit, or "Client" when it's a direct match.
      const subtitleParts = [];
      if (clientLessons.length)   subtitleParts.push(`${clientLessons.length} lesson${clientLessons.length === 1 ? '' : 's'}`);
      if (clientSessions.length)  subtitleParts.push(`${clientSessions.length} session${clientSessions.length === 1 ? '' : 's'}`);
      if (clientInvoices.length)  subtitleParts.push(`${clientInvoices.length} invoice${clientInvoices.length === 1 ? '' : 's'}`);
      if (clientContracts.length) subtitleParts.push(`${clientContracts.length} contract${clientContracts.length === 1 ? '' : 's'}`);
      const subtitle = subtitleParts.length
        ? subtitleParts.join(' · ')
        : (c.contract_status ? `Contract: ${c.contract_status}` : 'Client');

      results.clients.push({
        icon: ICONS.client,
        title: name,
        subtitle,
        // Hidden field used to sort the section by relevance
        _rank: rollupCount + (directMatch ? 1 : 0),
        url: withQ(isAdmin
          ? `admin-create-client.html?id=${encodeURIComponent(cid || '')}`
          : `assistant-client.html?client_id=${encodeURIComponent(cid || '')}`),
        _preview: {
          kind: 'client',
          data: c,
          rollup: {
            lessons:   clientLessons.slice(0, 5),
            invoices:  clientInvoices.slice(0, 5),
            sessions:  clientSessions.slice(0, 5),
            contracts: clientContracts.slice(0, 3),
            counts: {
              lessons: clientLessons.length, invoices: clientInvoices.length,
              sessions: clientSessions.length, contracts: clientContracts.length,
            },
          },
        },
      });
    });
    // Sort Clients section by relevance (most matches first)
    results.clients.sort((a, b) => (b._rank || 0) - (a._rank || 0));

    // Admin-only: applications, assistant profiles, schedule requests, membership requests
    tryEach('applications', dyn.applications, a => {
      const name = a.applicant_full_name || a.full_name || a.email || 'Applicant';
      const blob = `${name} ${a.email || ''} ${a.status || ''}`.toLowerCase();
      if (blob.includes(q)) {
        results.applications.push({
          icon: ICONS.client,
          title: name,
          subtitle: `Application · ${a.status || 'active'}`,
          url: withQ(`admin-application.html?id=${encodeURIComponent(a.id || '')}`),
        });
      }
    });
    tryEach('assistantProfiles', dyn.assistantProfiles, p => {
      const name = p.display_name || p.full_name || 'Assistant';
      const langs = Array.isArray(p.languages) ? p.languages.join(' ') : String(p.languages || '');
      const blob = `${name} ${p.city || ''} ${langs} ${p.bio || ''} ${p.experience_summary || ''} ${p.education_summary || ''}`.toLowerCase();
      const directMatch = blob.includes(q);
      // Rollup: lessons taught by this assistant (matched via name)
      const taughtLessons = (dyn.lessonLogs || []).filter(l => {
        if (!l.lesson_assistant_name) return false;
        if (!String(l.lesson_assistant_name).toLowerCase().includes(name.toLowerCase())) return false;
        const lblob = `${l.appointment_title || ''} ${l.focus_area || ''} ${l.key_concepts || ''} ${l.next_session_notes || ''} ${l.feedback || ''}`.toLowerCase();
        return lblob.includes(q) || fmtDate(l.starts_at).toLowerCase().includes(q);
      });
      if (!directMatch && taughtLessons.length === 0) return;
      const subtitleParts = [];
      if (p.city) subtitleParts.push(p.city);
      if (langs) subtitleParts.push(langs);
      if (taughtLessons.length) subtitleParts.push(`${taughtLessons.length} matching lesson${taughtLessons.length === 1 ? '' : 's'}`);
      results.assistantProfiles.push({
        icon: ICONS.client,
        title: name,
        subtitle: subtitleParts.length ? subtitleParts.join(' · ') : 'Assistant',
        _rank: taughtLessons.length + (directMatch ? 1 : 0),
        url: withQ(`admin-assistant-profiles.html?id=${encodeURIComponent(p.assistant_id || p.id || '')}`),
        _preview: {
          kind: 'assistant',
          data: p,
          taughtLessons: taughtLessons.slice(0, 5),
          taughtCount: taughtLessons.length,
        },
      });
    });
    results.assistantProfiles.sort((a, b) => (b._rank || 0) - (a._rank || 0));
    tryEach('scheduleRequests', dyn.scheduleRequests, r => {
      const title = r.request_type ? `${r.request_type} request` : 'Schedule request';
      const blob = `${title} ${r.status || ''} ${r.client_name || ''}`.toLowerCase();
      if (blob.includes(q)) {
        results.scheduleRequests.push({
          icon: ICONS.session,
          title: title,
          subtitle: `${r.status || 'pending'}${r.client_name ? ' · ' + r.client_name : ''}`,
          url: withQ(`admin-schedule-requests.html#req-${r.id || ''}`),
        });
      }
    });
    tryEach('membershipRequests', dyn.membershipRequests, r => {
      const title = `${r.requested_plan_key || 'Membership'} change`;
      const blob = `${title} ${r.status || ''} ${r.client_name || ''}`.toLowerCase();
      if (blob.includes(q)) {
        results.membershipRequests.push({
          icon: ICONS.contract,
          title: title,
          subtitle: `${r.status || 'pending'}${r.client_name ? ' · ' + r.client_name : ''}`,
          url: withQ(`admin-membership-requests.html#req-${r.id || ''}`),
        });
      }
    });

    return results;
  }

  function totalCount(r) {
    if (!r) return 0;
    return (r.pages.length + r.sessions.length + r.invoices.length + r.contracts.length
          + r.messages.length + r.clients.length + r.lessonLogs.length
          + (r.applications?.length || 0) + (r.assistantProfiles?.length || 0)
          + (r.scheduleRequests?.length || 0) + (r.membershipRequests?.length || 0));
  }

  // How many items to show per section before the "+N more" link appears.
  // 15 is a sweet spot — enough that common queries feel useful but not
  // overwhelming. The "+N more" reveals the rest within the same section.
  const SECTION_INITIAL_CAP = 15;

  // ── Preview pane ────────────────────────────────────────────────
  // Renders the full body of a single result (lesson, invoice, session)
  // inline next to the dropdown so the user can peek without navigating.
  // Spy-tool vibe for admin, but also useful for client/assistant.
  function renderPreview(previewEl, item, query) {
    if (!previewEl) return;
    if (!item || !item._preview) {
      previewEl.innerHTML = '<div class="ms-preview__empty">Hover or arrow-key over a result to preview it here.</div>';
      return;
    }
    const { kind, data, clientName } = item._preview;
    const h = (s) => highlight(s == null ? '' : String(s), query);
    let html = '';
    if (kind === 'lesson') {
      const dateStr = fmtDate(data.starts_at);
      html = `
        <div class="ms-preview__head">
          <div class="ms-preview__kind">Lesson</div>
          <h4 class="ms-preview__title">${h(data.appointment_title || 'Lesson')}</h4>
          <div class="ms-preview__meta">${clientName ? h(clientName) + ' · ' : ''}${h(dateStr)}${data.duration_minutes ? ' · ' + (data.duration_minutes / 60) + 'h' : ''}</div>
        </div>
        ${data.focus_area ? `<div class="ms-preview__sec"><div class="ms-preview__label">Focus area</div><div class="ms-preview__body">${h(data.focus_area)}</div></div>` : ''}
        ${data.key_concepts ? `<div class="ms-preview__sec"><div class="ms-preview__label">Key concepts</div><div class="ms-preview__body">${h(data.key_concepts)}</div></div>` : ''}
        ${data.feedback ? `<div class="ms-preview__sec"><div class="ms-preview__label">Feedback</div><div class="ms-preview__body">${h(data.feedback)}</div></div>` : ''}
        ${data.next_session_notes ? `<div class="ms-preview__sec"><div class="ms-preview__label">Next session notes</div><div class="ms-preview__body">${h(data.next_session_notes)}</div></div>` : ''}
        ${data.lesson_assistant_name ? `<div class="ms-preview__foot">Logged by ${h(data.lesson_assistant_name)}</div>` : ''}
      `;
    } else if (kind === 'invoice') {
      const dateStr = fmtDate(data.invoice_date);
      html = `
        <div class="ms-preview__head">
          <div class="ms-preview__kind">Invoice</div>
          <h4 class="ms-preview__title">${h(data.invoice_number || ('Invoice ' + (data.id || '').slice(0, 8)))}</h4>
          <div class="ms-preview__meta">${clientName ? h(clientName) + ' · ' : ''}${h(dateStr)} · ${h(fmtMoney(data.total_cents || data.amount_paid_cents))} · ${h(data.status || '')}</div>
        </div>
        ${data.subject ? `<div class="ms-preview__sec"><div class="ms-preview__label">Subject</div><div class="ms-preview__body">${h(data.subject)}</div></div>` : ''}
        ${data.customer_notes ? `<div class="ms-preview__sec"><div class="ms-preview__label">Customer note</div><div class="ms-preview__body">${h(data.customer_notes)}</div></div>` : ''}
        ${data.contract ? `<div class="ms-preview__sec"><div class="ms-preview__label">Linked contract</div><div class="ms-preview__body">${h(fmtDate(data.contract.start_at))} – ${h(fmtDate(data.contract.end_at))}</div></div>` : ''}
      `;
    } else if (kind === 'client') {
      const r = item._preview.rollup || { counts: {} };
      const c = data;
      const name = c.full_name || c.client_name || c.name || 'Client';
      const cid  = c.id || c.client_id || '';
      const open = (u) => `<a class="ms-preview__link" href="${escapeHtml(u)}">${h('Open ' + name + ' →')}</a>`;
      const miniRow = (lbl, sub) => `<div class="ms-preview__minirow"><div class="ms-preview__mini-title">${h(lbl)}</div><div class="ms-preview__mini-sub">${h(sub)}</div></div>`;
      html = `
        <div class="ms-preview__head">
          <div class="ms-preview__kind">Client</div>
          <h4 class="ms-preview__title">${h(name)}</h4>
          <div class="ms-preview__meta">${h(c.email || '')}${c.contract_status ? ' · ' + h(c.contract_status) : ''}</div>
        </div>
        <div class="ms-preview__stats">
          <div class="ms-preview__stat"><strong>${r.counts.lessons || 0}</strong> lessons</div>
          <div class="ms-preview__stat"><strong>${r.counts.invoices || 0}</strong> invoices</div>
          <div class="ms-preview__stat"><strong>${r.counts.sessions || 0}</strong> sessions</div>
          <div class="ms-preview__stat"><strong>${r.counts.contracts || 0}</strong> contracts</div>
        </div>
        ${(r.lessons || []).length ? `<div class="ms-preview__sec"><div class="ms-preview__label">Recent matching lessons</div>${
          r.lessons.map(l => miniRow(l.appointment_title || 'Lesson', fmtDate(l.starts_at) + (l.focus_area ? ' · ' + l.focus_area : ''))).join('')
        }</div>` : ''}
        ${(r.invoices || []).length ? `<div class="ms-preview__sec"><div class="ms-preview__label">Recent matching invoices</div>${
          r.invoices.map(i => miniRow(i.invoice_number || ('Invoice ' + (i.id || '').slice(0,8)), fmtDate(i.invoice_date) + ' · ' + fmtMoney(i.total_cents || i.amount_paid_cents))).join('')
        }</div>` : ''}
        ${(r.sessions || []).length ? `<div class="ms-preview__sec"><div class="ms-preview__label">Recent matching sessions</div>${
          r.sessions.map(s => miniRow(s.title || 'Session', fmtDate(s.starts_at) + (s.status ? ' · ' + s.status : ''))).join('')
        }</div>` : ''}
        <div class="ms-preview__foot">${open(item.url)}</div>
      `;
    } else if (kind === 'assistant') {
      const p = data;
      const name = p.display_name || p.full_name || 'Assistant';
      const taught = item._preview.taughtLessons || [];
      const taughtCount = item._preview.taughtCount || 0;
      const miniRow = (lbl, sub) => `<div class="ms-preview__minirow"><div class="ms-preview__mini-title">${h(lbl)}</div><div class="ms-preview__mini-sub">${h(sub)}</div></div>`;
      html = `
        <div class="ms-preview__head">
          <div class="ms-preview__kind">Assistant</div>
          <h4 class="ms-preview__title">${h(name)}</h4>
          <div class="ms-preview__meta">${p.city ? h(p.city) + ' · ' : ''}${h(Array.isArray(p.languages) ? p.languages.join(', ') : (p.languages || ''))}</div>
        </div>
        ${taughtCount ? `<div class="ms-preview__stats">
          <div class="ms-preview__stat"><strong>${taughtCount}</strong> matching lessons</div>
        </div>` : ''}
        ${taught.length ? `<div class="ms-preview__sec"><div class="ms-preview__label">Recent matching lessons</div>${
          taught.map(l => miniRow(l.appointment_title || 'Lesson', fmtDate(l.starts_at) + (l.focus_area ? ' · ' + l.focus_area : ''))).join('')
        }</div>` : ''}
        ${p.bio ? `<div class="ms-preview__sec"><div class="ms-preview__label">Bio</div><div class="ms-preview__body">${h(p.bio)}</div></div>` : ''}
        ${p.experience_summary ? `<div class="ms-preview__sec"><div class="ms-preview__label">Experience</div><div class="ms-preview__body">${h(p.experience_summary)}</div></div>` : ''}
        ${p.education_summary ? `<div class="ms-preview__sec"><div class="ms-preview__label">Education</div><div class="ms-preview__body">${h(p.education_summary)}</div></div>` : ''}
        <div class="ms-preview__foot"><a class="ms-preview__link" href="${escapeHtml(item.url)}">${h('Open ' + name + ' →')}</a></div>
      `;
    } else if (kind === 'session') {
      const s = data;
      const dateStr = fmtDate(s.starts_at);
      html = `
        <div class="ms-preview__head">
          <div class="ms-preview__kind">Session</div>
          <h4 class="ms-preview__title">${h(s.title || 'Session')}</h4>
          <div class="ms-preview__meta">${h(dateStr)}${s.duration_minutes ? ' · ' + (s.duration_minutes / 60) + 'h' : ''}${s.status ? ' · ' + h(s.status) : ''}</div>
        </div>
        ${s.notes ? `<div class="ms-preview__sec"><div class="ms-preview__label">Notes</div><div class="ms-preview__body">${h(s.notes)}</div></div>` : ''}
        <div class="ms-preview__foot"><a class="ms-preview__link" href="${escapeHtml(item.url)}">${h('Open session →')}</a></div>
      `;
    } else {
      // Generic fallback
      html = `
        <div class="ms-preview__head">
          <h4 class="ms-preview__title">${h(item.title || '')}</h4>
          <div class="ms-preview__meta">${h(item.subtitle || '')}</div>
        </div>
        <div class="ms-preview__foot"><a class="ms-preview__link" href="${escapeHtml(item.url)}">Open →</a></div>
      `;
    }
    previewEl.innerHTML = html;
  }

  // ── Render dropdown ─────────────────────────────────────────────
  function renderDropdown(panel, results, query, state) {
    const sections = [
      { key: 'pages',              label: 'Pages',               items: results.pages },
      { key: 'clients',            label: 'Clients',             items: results.clients },
      { key: 'applications',       label: 'Applications',        items: results.applications },
      { key: 'assistantProfiles',  label: 'Assistants',          items: results.assistantProfiles },
      { key: 'lessonLogs',         label: 'Lessons',             items: results.lessonLogs },
      { key: 'sessions',           label: 'Sessions',            items: results.sessions },
      { key: 'invoices',           label: 'Invoices',            items: results.invoices },
      { key: 'contracts',          label: 'Contracts',           items: results.contracts },
      { key: 'scheduleRequests',   label: 'Schedule requests',   items: results.scheduleRequests },
      { key: 'membershipRequests', label: 'Membership requests', items: results.membershipRequests },
      { key: 'messages',           label: 'Messages',            items: results.messages },
    ].filter(s => s.items && s.items.length);

    if (!sections.length) {
      panel.innerHTML = `<div class="ms-empty">No matches for <strong>${escapeHtml(query)}</strong></div>`;
      state.flat = [];
      return;
    }

    // Top summary strip — total matches across all sections + per-category
    // counts as clickable chips that scroll the panel to that section.
    const total = sections.reduce((s, x) => s + x.items.length, 0);
    let html = `<div class="ms-summary">
      <div class="ms-summary__total"><strong>${total}</strong> ${total === 1 ? 'match' : 'matches'} for <em>"${escapeHtml(query)}"</em></div>
      <div class="ms-summary__chips">
        ${sections.map(s => `<a href="#ms-sec-${s.key}" class="ms-chip" data-jump="${s.key}">${s.label} <span class="ms-chip__n">${s.items.length}</span></a>`).join('')}
      </div>
    </div>`;

    const flat = [];
    sections.forEach(section => {
      const cap = state.expanded?.[section.key] ? section.items.length : SECTION_INITIAL_CAP;
      const shown = section.items.slice(0, cap);
      const hiddenCount = section.items.length - shown.length;
      html += `<div class="ms-section" id="ms-sec-${section.key}">
        <div class="ms-section__head">
          <span>${section.label}</span>
          <span class="ms-section__count">${section.items.length}</span>
        </div>`;
      shown.forEach(item => {
        const idx = flat.length;
        flat.push(item);
        html += `<a class="ms-item" data-idx="${idx}" href="${escapeHtml(item.url)}">
          <span class="ms-item__icon">${item.icon}</span>
          <span class="ms-item__body">
            <span class="ms-item__title">${highlight(item.title, query)}</span>
            <span class="ms-item__sub">${highlight(item.subtitle || '', query)}</span>
          </span>
        </a>`;
      });
      if (hiddenCount > 0) {
        html += `<button type="button" class="ms-more" data-expand="${section.key}">Show ${hiddenCount} more in ${section.label}</button>`;
      }
      html += `</div>`;
    });
    panel.innerHTML = html;
    state.flat = flat;

    // Wire "show more" expand
    panel.querySelectorAll('[data-expand]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const key = btn.dataset.expand;
        state.expanded = state.expanded || {};
        state.expanded[key] = true;
        renderDropdown(panel, results, query, state);
        // Re-wire hover handlers in caller (run does this)
      });
    });
    // Wire chip jumps — smooth scroll to section within the panel
    panel.querySelectorAll('[data-jump]').forEach(chip => {
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        const tgt = panel.querySelector('#ms-sec-' + chip.dataset.jump);
        if (tgt) tgt.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ── Wire up an input ────────────────────────────────────────────
  function wireSearch(input) {
    if (!input || input.__pmMsWired) return;
    input.__pmMsWired = true;

    // Start with sync-best-guess role; resolve true role async and swap.
    let role = detectRoleSync();
    detectRole().then(r => { role = r; });
    const wrap = input.closest('.nx-search');
    if (!wrap) return;

    // Inject the dropdown wrapper as a sibling of the input. Split into
    // two columns: results on the left, preview pane on the right.
    const panelWrap = document.createElement('div');
    panelWrap.className = 'ms-panel';
    panelWrap.hidden = true;
    panelWrap.innerHTML = `
      <div class="ms-panel__results"></div>
      <div class="ms-panel__preview"><div class="ms-preview__empty">Hover or arrow-key over a result to preview it here.</div></div>
    `;
    wrap.appendChild(panelWrap);
    const panel       = panelWrap.querySelector('.ms-panel__results');
    const previewEl   = panelWrap.querySelector('.ms-panel__preview');

    const state = { open: false, flat: [], selectedIdx: -1, query: '' };

    function close() {
      state.open = false;
      state.selectedIdx = -1;
      panelWrap.hidden = true;
      panelWrap.classList.remove('is-shown');
    }
    function open() {
      state.open = true;
      panelWrap.hidden = false;
      panelWrap.classList.add('is-shown');
    }
    function setSelected(idx) {
      state.selectedIdx = idx;
      panel.querySelectorAll('.ms-item').forEach((el, i) => {
        el.classList.toggle('is-selected', i === idx);
        if (i === idx) el.scrollIntoView({ block: 'nearest' });
      });
      // Update preview pane to match
      if (idx >= 0 && state.flat[idx]) {
        renderPreview(previewEl, state.flat[idx], state.query);
      }
    }

    const run = debounce(async (q) => {
      state.query = q;
      if (!q) {
        close();
        return;
      }
      // Loading state on first run only
      if (!CACHE.data) {
        panel.innerHTML = `<div class="ms-empty">Searching…</div>`;
        open();
      }
      try {
        const dyn = await loadDynamic(role);
        // Bail if user typed something else while we were loading
        if (state.query !== q) return;
        const results = search(q, role, dyn);
        open();
        renderDropdown(panel, results, q, state);
        // Wire hover-to-preview on each item
        panel.querySelectorAll('.ms-item').forEach((el, i) => {
          el.addEventListener('mouseenter', () => {
            state.selectedIdx = i;
            panel.querySelectorAll('.ms-item').forEach((e2, j) => e2.classList.toggle('is-selected', j === i));
            if (state.flat[i]) renderPreview(previewEl, state.flat[i], state.query);
          });
        });
        // Auto-select first result so the preview shows something immediately
        if (state.flat.length > 0) {
          renderPreview(previewEl, state.flat[0], state.query);
        } else {
          renderPreview(previewEl, null, state.query);
        }
      } catch (err) {
        console.warn('master-search: render failed', err);
        if (state.query !== q) return;
        panel.innerHTML = `<div class="ms-empty">Search hit an error. Try again.</div>`;
        open();
      }
    }, 220);

    input.addEventListener('input', () => run(input.value));
    input.addEventListener('focus', () => {
      if (state.query && CACHE.data && totalCount(search(state.query, role, CACHE.data)) > 0) open();
    });
    input.addEventListener('keydown', (e) => {
      if (!state.open) return;
      if (e.key === 'ArrowDown')   { e.preventDefault(); setSelected(Math.min(state.flat.length - 1, state.selectedIdx + 1)); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); setSelected(Math.max(0, state.selectedIdx - 1)); }
      else if (e.key === 'Enter')  {
        if (state.selectedIdx >= 0 && state.flat[state.selectedIdx]) {
          e.preventDefault();
          location.href = state.flat[state.selectedIdx].url;
        }
      }
      else if (e.key === 'Escape') { close(); input.blur(); }
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) close();
    });
  }

  // ── Bootstrap ────────────────────────────────────────────────────
  function bootstrap() {
    document.querySelectorAll('.nx-search input[type="search"]').forEach(wireSearch);
    // Watch for late-added topbars (sidebar mount etc.)
    if (typeof MutationObserver !== 'undefined') {
      const obs = new MutationObserver(() => {
        document.querySelectorAll('.nx-search input[type="search"]:not([__pmMsWired])').forEach(wireSearch);
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
