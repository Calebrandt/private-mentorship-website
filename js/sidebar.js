// Reusable sidebar component for Private Mentorship dashboards.
// Auto-renders the sidebar based on the current user's role.
// Host pages add: <body class="pm-has-sidebar"> + <div id="pmSidebar"></div>.

(function () {
  const ROLE_NAV = {
    admin: [
      { type: 'link', href: 'admin-dashboard.html', label: 'Dashboard', icon: 'dashboard' },
      { type: 'link', href: 'admin-clients.html', label: 'Clients', icon: 'users' },
      { type: 'link', href: 'admin-scheduling.html', label: 'Scheduling', icon: 'calendar' },
      { type: 'link', href: 'admin-hiring.html', label: 'Hiring', icon: 'briefcase', badge: null, match: ['admin-hiring.html', 'admin-application.html'] },
      { type: 'link', href: 'admin-financials.html', label: 'Financials', icon: 'dollar' },
      { type: 'link', href: 'messages.html', label: 'Messages', icon: 'message' },
      { type: 'divider' },
      {
        type: 'group', label: 'Tools', icon: 'tools',
        items: [
          { href: 'admin-schedule-requests.html', label: 'Schedule Requests', icon: 'inbox' },
          { href: 'admin-membership-requests.html', label: 'Membership Requests', icon: 'briefcase' },
          { href: 'admin-create-client.html', label: 'Create Client', icon: 'user-plus' },
          { href: 'admin-intro-requests.html', label: 'Intro Requests', icon: 'inbox' },
          { href: 'admin-membership-requests.html', label: 'Membership Requests', icon: 'inbox' },
          { href: 'admin-family-management.html', label: 'Family Management', icon: 'users' },
          { href: 'admin-education.html', label: 'Education / Homework', icon: 'book' },
          { href: 'admin-tasks.html', label: 'Tasks', icon: 'check' },
          { href: 'admin-notifications.html', label: 'Notifications', icon: 'bell' },
          { href: 'admin-assistant-profiles.html', label: 'Assistant Profiles', icon: 'user-circle' },
          { href: 'admin-audit-logs.html', label: 'Audit Logs', icon: 'file-clock' },
        ],
      },
    ],
    client: [
      { type: 'link', href: 'client-dashboard.html', label: 'Dashboard', icon: 'dashboard' },
      { type: 'link', href: 'messages.html', label: 'Inbox', icon: 'message' },
      { type: 'section', label: 'Daily' },
      { type: 'link', href: 'client-schedule.html', label: 'Schedule', icon: 'calendar' },
      { type: 'link', href: 'client-education.html', label: 'Education', icon: 'book' },
      { type: 'link', href: 'client-hours.html', label: 'Hours & Billing', icon: 'clock' },
      { type: 'section', label: 'Your Plan' },
      { type: 'link', href: 'client-membership.html', label: 'Membership', icon: 'briefcase' },
      { type: 'link', href: 'client-contract.html', label: 'Contract Details', icon: 'file-clock' },
      { type: 'section', label: 'People' },
      { type: 'link', href: 'client-assistants.html', label: 'My Assistant', icon: 'user-circle' },
      { type: 'link', href: 'client-account.html', label: 'My Family', icon: 'users' },
      { type: 'link', href: 'client-resources.html', label: 'Resources', icon: 'folder' },
    ],
  };

  const SETTINGS_LINK = { href: 'settings.html', label: 'Settings', icon: 'settings' };

  // Inline icon set (Lucide-style, simplified).
  const ICONS = {
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
    dollar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    'user-circle': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.66A8 8 0 0 1 17 20.66"/></svg>',
    'user-plus': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
    'file-clock': '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="15" r="3"/><path d="M12 13v2l1 1"/></svg>',
    message: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    chevs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="7 15 12 20 17 15"/><polyline points="7 9 12 4 17 9"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    moon: '<svg class="pm-sb-theme-toggle__moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
    sun: '<svg class="pm-sb-theme-toggle__sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.05" y2="7.05"/><line x1="16.95" y1="16.95" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.05" y2="16.95"/><line x1="16.95" y1="7.05" x2="19.07" y2="4.93"/></svg>',
  };

  function escapeHtml(s){ return (s || '').toString().replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":'&#39;'}[c])); }
  function currentPath(){ return (window.location.pathname.split('/').pop() || 'index.html').toLowerCase(); }

  function isLinkActive(item){
    const path = currentPath();
    if (item.match) return item.match.some(m => path === m.toLowerCase());
    return path === (item.href || '').toLowerCase();
  }

  function renderLink(item){
    const active = isLinkActive(item) ? ' is-active' : '';
    const badge = item.badge ? `<span class="pm-sb-link__badge">${escapeHtml(item.badge)}</span>` : '';
    return `<a class="pm-sb-link${active}" href="${escapeHtml(item.href)}">
      <span class="pm-sb-link__icon">${ICONS[item.icon] || ICONS.folder}</span>
      <span class="pm-sb-link__label">${escapeHtml(item.label)}</span>
      ${badge}
    </a>`;
  }

  function renderGroup(group){
    const items = (group.items || []).map(it => `<a class="pm-sb-link${isLinkActive(it) ? ' is-active' : ''}" href="${escapeHtml(it.href)}">
      <span class="pm-sb-link__icon">${ICONS[it.icon] || ICONS.folder}</span>
      <span class="pm-sb-link__label">${escapeHtml(it.label)}</span>
    </a>`).join('');
    const anyActive = (group.items || []).some(isLinkActive);
    return `<div class="pm-sb-group${anyActive ? ' is-open' : ''}">
      <button class="pm-sb-group__toggle" type="button" data-toggle-group>
        <span class="pm-sb-link__icon">${ICONS[group.icon] || ICONS.tools}</span>
        <span class="pm-sb-link__label">${escapeHtml(group.label)}</span>
        <span class="pm-sb-group__chev">${ICONS.chev}</span>
      </button>
      <div class="pm-sb-group__items">${items}</div>
    </div>`;
  }

  function renderNav(items){
    return items.map(item => {
      if (item.type === 'divider') return '<div class="pm-sb-divider"></div>';
      if (item.type === 'section') return `<div class="pm-sb-section-label">${escapeHtml(item.label)}</div>`;
      if (item.type === 'group') return renderGroup(item);
      return renderLink(item);
    }).join('');
  }

  function buildSidebar({ user, profile, role }){
    const orgInitial = 'PM';
    const orgName = 'Private Mentorship';
    const items = ROLE_NAV[role] || ROLE_NAV.client;
    const navHtml = renderNav(items);
    const settingsHtml = renderLink(SETTINGS_LINK);

    const displayName = (profile && profile.full_name) || (user && user.email) || 'Account';
    const email = (user && user.email) || '';
    const initials = (displayName.split(/\s+/).map(s => s[0] || '').slice(0, 2).join('') || 'U').toUpperCase();

    const triggerInitial = (initials || 'A').charAt(0);

    // Messages.html owns its own theme system (body.theme-light) — don't
    // render the sidebar theme toggle there, otherwise we'd ship a button
    // that does nothing (theme.js isn't loaded on that page).
    const isMessagesPage = currentPath() === 'messages.html';
    const themeToggleHtml = isMessagesPage ? '' : (
      `<button class="pm-sb-theme-toggle" type="button" data-pm-theme-toggle aria-label="Toggle light / dark theme">
        ${ICONS.moon}${ICONS.sun}
        <span class="pm-sb-theme-toggle__label">Theme</span>
      </button>`
    );
    return `<aside class="pm-sidebar" id="pmSidebarEl">
      <div class="pm-sb-top">
        <span class="pm-sb-top__avatar">${escapeHtml(orgInitial)}</span>
        <span class="pm-sb-top__label">${escapeHtml(orgName)}</span>
        <span class="pm-sb-top__chev">${ICONS.chevs}</span>
      </div>
      <div class="pm-sb-scroll">
        <ul class="pm-sb-list">${navHtml}</ul>
      </div>
      <div class="pm-sb-bottom">
        ${themeToggleHtml}
        ${settingsHtml}
        <button class="pm-sb-account" type="button" id="pmSidebarAcctBtn">
          <span class="pm-sb-account__avatar">${escapeHtml(triggerInitial)}</span>
          <span class="pm-sb-account__body">
            <span class="pm-sb-account__label">Account</span>
            <span class="pm-sb-account__chev">${ICONS.chevs}</span>
          </span>
        </button>
        <div class="pm-sb-popover" id="pmSidebarPopover" role="menu">
          <div class="pm-sb-popover__head">
            <span class="pm-sb-popover__avatar">${escapeHtml(initials)}</span>
            <span class="pm-sb-popover__body">
              <span class="pm-sb-popover__name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
              <span class="pm-sb-popover__email" title="${escapeHtml(email)}">${escapeHtml(email)}</span>
            </span>
          </div>
          <div class="pm-sb-popover__sep"></div>
          <a class="pm-sb-popover__item" href="account.html" role="menuitem">${ICONS['user-circle']}<span>Profile</span></a>
          <button class="pm-sb-popover__item pm-sb-popover__item--danger" id="pmSidebarSignOut" role="menuitem" type="button">
            ${ICONS.logout}<span>Sign out</span>
          </button>
        </div>
      </div>
    </aside>
    <button class="pm-sb-burger" id="pmSidebarBurger" type="button" aria-label="Open menu">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
    </button>
    <div class="pm-sb-scrim" id="pmSidebarScrim"></div>`;
  }

  async function detectRole(){
    if (!window.pmHiring) return 'client';
    try {
      const isAdmin = await window.pmHiring.isCurrentUserAdminOrOwner();
      if (isAdmin) return 'admin';
    } catch (_) {}
    try {
      const profile = await window.pmHiring.fetchCurrentUserProfile();
      if (profile && /^client$/i.test(String(profile.role || ''))) return 'client';
    } catch (_) {}
    return 'client';
  }

  function positionPopover(btn, popover){
    // Anchor popover above the avatar button, aligned to its left edge.
    // Uses `bottom` so we don't need to measure popover height.
    const r = btn.getBoundingClientRect();
    const left = Math.max(8, r.left);
    const bottomFromViewport = window.innerHeight - r.top + 5; // 5px gap above button
    popover.style.left = left + 'px';
    popover.style.top = 'auto';
    popover.style.bottom = bottomFromViewport + 'px';
  }

  function wire(){
    document.querySelectorAll('[data-toggle-group]').forEach(btn => {
      btn.addEventListener('click', () => btn.parentElement.classList.toggle('is-open'));
    });

    const acctBtn = document.getElementById('pmSidebarAcctBtn');
    const popover = document.getElementById('pmSidebarPopover');
    if (acctBtn && popover){
      // Move popover out of sidebar (which has overflow:hidden) so it isn't clipped.
      if (popover.parentElement !== document.body) document.body.appendChild(popover);

      const open = () => {
        positionPopover(acctBtn, popover);
        popover.classList.add('is-shown');
      };
      const close = () => popover.classList.remove('is-shown');
      const toggle = () => {
        if (popover.classList.contains('is-shown')) close(); else open();
      };

      acctBtn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
      // Close on outside click
      document.addEventListener('click', e => {
        if (!popover.classList.contains('is-shown')) return;
        if (popover.contains(e.target) || acctBtn.contains(e.target)) return;
        close();
      });
      // Close on ESC
      document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
      // Reposition on resize / scroll
      window.addEventListener('resize', () => { if (popover.classList.contains('is-shown')) positionPopover(acctBtn, popover); });
      window.addEventListener('scroll', () => { if (popover.classList.contains('is-shown')) positionPopover(acctBtn, popover); }, true);
    }

    const signOut = document.getElementById('pmSidebarSignOut');
    if (signOut) signOut.addEventListener('click', async () => {
      try { await window.pmHiring.signOut(); } catch (_) {}
      window.location.href = 'index.html';
    });
    const burger = document.getElementById('pmSidebarBurger');
    const scrim = document.getElementById('pmSidebarScrim');
    const sb = document.getElementById('pmSidebarEl');
    if (burger && sb){
      burger.addEventListener('click', () => { sb.classList.add('is-open'); if (scrim) scrim.classList.add('is-shown'); });
    }
    if (scrim) scrim.addEventListener('click', () => { sb.classList.remove('is-open'); scrim.classList.remove('is-shown'); });
  }

  async function mount(){
    const target = document.getElementById('pmSidebar');
    if (!target) return;

    let user = null, profile = null, role = 'client';
    try { user = await window.pmHiring.getCurrentUser(); } catch (_) {}
    if (!user){
      // No user → redirect to signin
      window.location.href = 'signin.html';
      return;
    }
    try { profile = await window.pmHiring.fetchCurrentUserProfile(); } catch (_) {}
    role = await detectRole();

    target.outerHTML = buildSidebar({ user, profile, role });
    document.body.classList.add('pm-has-sidebar');
    wire();
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
