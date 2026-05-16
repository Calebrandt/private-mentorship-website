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
  function detectRole() {
    const p = (location.pathname.split('/').pop() || '').toLowerCase();
    if (p.startsWith('client-'))    return 'client';
    if (p.startsWith('assistant-')) return 'assistant';
    if (p.startsWith('admin-'))     return 'admin';
    // messages.html and others: try to read from a previously cached profile
    try {
      const cached = window.__pmCachedProfile;
      if (cached?.role) {
        const r = String(cached.role).toUpperCase();
        if (r.includes('CLIENT'))    return 'client';
        if (r.includes('ASSISTANT')) return 'assistant';
        if (r.includes('ADMIN') || r.includes('OWNER')) return 'admin';
      }
    } catch (_) {}
    return 'client';   // sensible default for messages.html on a client
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

  async function loadDynamic(role) {
    if (!window.pmHiring) return {};
    const now = Date.now();
    if (CACHE.role === role && CACHE.data && (now - CACHE.fetchedAt) < CACHE_TTL_MS) {
      return CACHE.data;
    }
    const out = { sessions: [], invoices: [], contracts: [], conversations: [], clients: [], lessonLogs: [] };

    try {
      if (role === 'client') {
        const client = await window.pmHiring.fetchMyClientRecord?.().catch(() => null);
        const [ws, invoices, contracts, convos] = await Promise.all([
          client?.id ? window.pmHiring.fetchAssistantClientWorkspace(client.id).catch(() => null) : Promise.resolve(null),
          window.pmHiring.fetchMyInvoices?.(24).catch(() => []),
          window.pmHiring.fetchMyContracts?.().catch(() => []),
          window.pmHiring.fetchMyConversations?.(30).catch(() => []),
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
      } else if (role === 'assistant') {
        const [clients] = await Promise.all([
          window.pmHiring.fetchMyAssignedClients?.({ statuses: ['active','draft'] }).catch(() => []),
        ]);
        out.clients = clients || [];
        // For sessions on the assistant side, pull a 90-day window
        try {
          const start = new Date(); start.setDate(start.getDate() - 60);
          const end   = new Date(); end.setDate(end.getDate() + 30);
          const range = await window.pmHiring.fetchAssistantAppointmentsRange?.({
            startIso: start.toISOString(),
            endIso:   end.toISOString(),
          }).catch(() => null);
          out.sessions = (range?.appointments || []).map(a => ({ ...a }));
        } catch (_) {}
      }
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

    const results = { pages: [], sessions: [], invoices: [], contracts: [], messages: [], clients: [], lessonLogs: [] };

    // Pages (static)
    (PAGE_INDEX[role] || []).forEach(p => {
      const blob = `${p.title} ${p.keywords || ''} ${(p.sections || []).join(' ')}`.toLowerCase();
      if (blob.includes(q)) {
        // Try to find a matching section so the subtitle hints at WHY this page matched
        const matchedSection = (p.sections || []).find(s => s.toLowerCase().includes(q));
        results.pages.push({
          icon: ICONS.page,
          title: p.title,
          subtitle: matchedSection || 'Page',
          url: p.url,
        });
      }
    });

    // Sessions
    (dyn.sessions || []).forEach(a => {
      const blob = `${a.title || ''} ${a.notes || ''} ${a.kind || ''} ${a.status || ''}`.toLowerCase();
      const dateStr = fmtDate(a.starts_at);
      if (blob.includes(q) || dateStr.toLowerCase().includes(q)) {
        const url = role === 'client' ? 'client-schedule.html' : 'assistant-schedule.html';
        results.sessions.push({
          icon: ICONS.session,
          title: a.title || 'Session',
          subtitle: `${dateStr}${a.duration_minutes ? ' · ' + (a.duration_minutes / 60) + 'h' : ''}${a.status ? ' · ' + a.status : ''}`,
          url: `${url}#appt-${a.id}`,
        });
      }
    });

    // Invoices (client only)
    (dyn.invoices || []).forEach(inv => {
      const label = inv.invoice_number || ('Invoice ' + (inv.id || '').slice(0, 8));
      const blob = `${label} ${inv.subject || ''} ${inv.customer_notes || ''} ${inv.status || ''}`.toLowerCase();
      const dateStr = fmtDate(inv.invoice_date);
      if (blob.includes(q) || dateStr.toLowerCase().includes(q)) {
        results.invoices.push({
          icon: ICONS.invoice,
          title: label,
          subtitle: `${dateStr} · ${fmtMoney(inv.total_cents || inv.amount_paid_cents)} · ${inv.status || ''}`,
          url: `client-hours.html#inv-${inv.id}`,
        });
      }
    });

    // Contracts
    (dyn.contracts || []).forEach(c => {
      const label = c._label || (c.status ? c.status[0].toUpperCase() + c.status.slice(1) + ' contract' : 'Contract');
      const blob = `${label} ${c.status || ''} ${c.assistant_name || ''}`.toLowerCase();
      const dateStr = `${fmtDate(c.start_at)} – ${fmtDate(c.end_at)}`;
      if (blob.includes(q) || dateStr.toLowerCase().includes(q)) {
        results.contracts.push({
          icon: ICONS.contract,
          title: label,
          subtitle: `${dateStr}${c.included_hours ? ' · ' + c.included_hours + 'h' : ''}`,
          url: `client-contract.html#contract-${c.id}`,
        });
      }
    });

    // Conversations / messages
    (dyn.conversations || []).forEach(conv => {
      const blob = `${conv.title || ''} ${conv.other_name || ''} ${conv.last_message_text || ''}`.toLowerCase();
      if (blob.includes(q)) {
        results.messages.push({
          icon: ICONS.message,
          title: conv.title || conv.other_name || 'Conversation',
          subtitle: conv.last_message_text || 'Open conversation',
          url: `messages.html?c=${encodeURIComponent(conv.id || '')}`,
        });
      }
    });

    // Clients (assistant only)
    (dyn.clients || []).forEach(c => {
      const name = c.full_name || c.client_name || c.name || '';
      const blob = `${name} ${c.email || ''}`.toLowerCase();
      if (blob.includes(q)) {
        results.clients.push({
          icon: ICONS.client,
          title: name,
          subtitle: c.contract_status ? `Contract: ${c.contract_status}` : 'Active engagement',
          url: `assistant-client.html?client_id=${encodeURIComponent(c.id || c.client_id || '')}`,
        });
      }
    });

    return results;
  }

  function totalCount(r) {
    if (!r) return 0;
    return (r.pages.length + r.sessions.length + r.invoices.length + r.contracts.length + r.messages.length + r.clients.length + r.lessonLogs.length);
  }

  // ── Render dropdown ─────────────────────────────────────────────
  function renderDropdown(panel, results, query, state) {
    const sections = [
      { key: 'pages',     label: 'Pages',         items: results.pages },
      { key: 'clients',   label: 'Clients',       items: results.clients },
      { key: 'sessions',  label: 'Sessions',      items: results.sessions },
      { key: 'invoices',  label: 'Invoices',      items: results.invoices },
      { key: 'contracts', label: 'Contracts',     items: results.contracts },
      { key: 'messages',  label: 'Messages',      items: results.messages },
    ].filter(s => s.items && s.items.length);

    if (!sections.length) {
      panel.innerHTML = `<div class="ms-empty">No matches for <strong>${escapeHtml(query)}</strong></div>`;
      state.flat = [];
      return;
    }

    let html = '';
    const flat = [];
    sections.forEach(section => {
      html += `<div class="ms-section"><div class="ms-section__head">${section.label}</div>`;
      section.items.slice(0, 5).forEach(item => {
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
      html += `</div>`;
    });
    panel.innerHTML = html;
    state.flat = flat;
  }

  // ── Wire up an input ────────────────────────────────────────────
  function wireSearch(input) {
    if (!input || input.__pmMsWired) return;
    input.__pmMsWired = true;

    const role = detectRole();
    const wrap = input.closest('.nx-search');
    if (!wrap) return;

    // Inject the dropdown panel as a sibling of the input
    const panel = document.createElement('div');
    panel.className = 'ms-panel';
    panel.hidden = true;
    wrap.appendChild(panel);

    const state = { open: false, flat: [], selectedIdx: -1, query: '' };

    function close() {
      state.open = false;
      state.selectedIdx = -1;
      panel.hidden = true;
      panel.classList.remove('is-shown');
    }
    function open() {
      state.open = true;
      panel.hidden = false;
      panel.classList.add('is-shown');
    }
    function setSelected(idx) {
      state.selectedIdx = idx;
      panel.querySelectorAll('.ms-item').forEach((el, i) => {
        el.classList.toggle('is-selected', i === idx);
        if (i === idx) el.scrollIntoView({ block: 'nearest' });
      });
    }

    const run = debounce(async (q) => {
      state.query = q;
      if (!q) {
        close();
        return;
      }
      // Loading state on first run
      if (!CACHE.data) {
        panel.innerHTML = `<div class="ms-empty">Searching…</div>`;
        open();
      }
      const dyn = await loadDynamic(role);
      // Bail if user typed something else while we were loading
      if (state.query !== q) return;
      const results = search(q, role, dyn);
      open();
      renderDropdown(panel, results, q, state);
    }, 220);

    input.addEventListener('input', () => run(input.value));
    input.addEventListener('focus', () => {
      if (state.query && totalCount(search(state.query, role, CACHE.data || {})) > 0) open();
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
