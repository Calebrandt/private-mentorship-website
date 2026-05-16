// Reusable right-side calendar.
// Auto-mounts into:
//   • <div id="pmCalendar"></div> placeholder if present (replaces it), OR
//   • appends to <body> in fixed-positioning mode (host gets body.pm-has-calendar offset)
//
// Styles live in js/sidebar.css under the .dash-cal* prefix.

(function () {
  function html(initials, name, email) {
    return ''
      + '<aside class="dash-cal" aria-label="Calendar">'
      +   '<button class="dash-cal-close" id="dashCalClose" type="button" title="Hide calendar" aria-label="Hide calendar">'
      +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
      +   '</button>'
      +   '<div class="dash-cal-user" role="button">'
      +     '<span class="dash-cal-user__avatar" id="dashCalUserAvatar">' + initials + '</span>'
      +     '<span class="dash-cal-user__body">'
      +       '<span class="dash-cal-user__name" id="dashCalUserName">' + name + '</span>'
      +       '<span class="dash-cal-user__email" id="dashCalUserEmail">' + email + '</span>'
      +     '</span>'
      +     '<svg class="dash-cal-user__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="7 15 12 20 17 15"/><polyline points="7 9 12 4 17 9"/></svg>'
      +   '</div>'
      +   '<div class="dash-cal-month">'
      +     '<div class="dash-cal-month__head">'
      +       '<button class="dash-cal-month__nav" type="button" id="dashCalPrev" aria-label="Previous month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>'
      +       '<span class="dash-cal-month__label" id="dashCalLabel">—</span>'
      +       '<button class="dash-cal-month__nav" type="button" id="dashCalNext" aria-label="Next month"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>'
      +     '</div>'
      +     '<div class="dash-cal-grid" id="dashCalGrid"></div>'
      +   '</div>'
      +   '<div class="dash-cal-section">'
      +     '<div class="dash-cal-section__head">'
      +       '<span class="dash-cal-section__title">My Calendars</span>'
      +       '<svg class="dash-cal-section__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
      +     '</div>'
      +     '<ul class="dash-cal-section__list">'
      +       '<li class="dash-cal-section__row is-on"><span class="dash-cal-checkbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span class="dash-cal-section__label">Sessions</span></li>'
      +       '<li class="dash-cal-section__row is-on"><span class="dash-cal-checkbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span class="dash-cal-section__label">Personal</span></li>'
      +       '<li class="dash-cal-section__row"><span class="dash-cal-checkbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span class="dash-cal-section__label">Family</span></li>'
      +     '</ul>'
      +   '</div>'
      +   '<div class="dash-cal-section">'
      +     '<div class="dash-cal-section__head">'
      +       '<span class="dash-cal-section__title">Favorites</span>'
      +       '<svg class="dash-cal-section__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>'
      +     '</div>'
      +     '<ul class="dash-cal-section__list">'
      +       '<li class="dash-cal-section__row is-on"><span class="dash-cal-checkbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span class="dash-cal-section__label">Holidays</span></li>'
      +       '<li class="dash-cal-section__row is-on"><span class="dash-cal-checkbox"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span><span class="dash-cal-section__label">Birthdays</span></li>'
      +     '</ul>'
      +   '</div>'
      + '</aside>';
  }

  function wireMonth() {
    var view = new Date(); view.setDate(1);
    var today = new Date();
    var todayKey = today.getFullYear() + '-' + (today.getMonth()+1) + '-' + today.getDate();
    function render(){
      var label = document.getElementById('dashCalLabel');
      var grid  = document.getElementById('dashCalGrid');
      if (!label || !grid) return;
      var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      label.textContent = months[view.getMonth()] + ' ' + view.getFullYear();
      grid.innerHTML = '';
      ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(function(d){
        var el = document.createElement('div'); el.className = 'dash-cal-grid__dow'; el.textContent = d; grid.appendChild(el);
      });
      var y = view.getFullYear(), m = view.getMonth();
      var firstDow = new Date(y, m, 1).getDay();
      var daysInMonth = new Date(y, m+1, 0).getDate();
      var prevMonthDays = new Date(y, m, 0).getDate();
      for (var i = 0; i < 42; i++) {
        var dayEl = document.createElement('div');
        dayEl.className = 'dash-cal-grid__day';
        var dayNum, dY = y, dM = m;
        if (i < firstDow) { dayNum = prevMonthDays - firstDow + i + 1; dM = m - 1; if (dM < 0) { dM = 11; dY = y - 1; } dayEl.classList.add('dash-cal-grid__day--other'); }
        else if (i >= firstDow + daysInMonth) { dayNum = i - firstDow - daysInMonth + 1; dM = m + 1; if (dM > 11) { dM = 0; dY = y + 1; } dayEl.classList.add('dash-cal-grid__day--other'); }
        else { dayNum = i - firstDow + 1; }
        dayEl.textContent = dayNum;
        var key = dY + '-' + (dM+1) + '-' + dayNum;
        if (key === todayKey) dayEl.classList.add('dash-cal-grid__day--today');
        grid.appendChild(dayEl);
      }
    }
    var p = document.getElementById('dashCalPrev'); if (p) p.addEventListener('click', function(){ view.setMonth(view.getMonth() - 1); render(); });
    var n = document.getElementById('dashCalNext'); if (n) n.addEventListener('click', function(){ view.setMonth(view.getMonth() + 1); render(); });
    render();
  }

  function wireSections() {
    document.querySelectorAll('.dash-cal-section__head').forEach(function(head){
      head.addEventListener('click', function(){ head.closest('.dash-cal-section').classList.toggle('is-collapsed'); });
    });
    document.querySelectorAll('.dash-cal-section__row').forEach(function(row){
      row.addEventListener('click', function(e){ e.stopPropagation(); row.classList.toggle('is-on'); });
    });
  }

  function initials(name) {
    return (name || 'Client').split(/\s+/).map(function(s){ return s[0] || ''; }).slice(0,2).join('').toUpperCase() || 'C';
  }

  async function populateUser() {
    try {
      if (!window.pmHiring) return;
      var user = await window.pmHiring.getCurrentUser();
      if (!user) return;
      var profile = null;
      try { profile = await window.pmHiring.fetchCurrentUserProfile(); } catch (_) {}
      var name = (profile && profile.full_name) || (user && user.email) || 'Client';
      var email = (user && user.email) || '';
      var ini = initials(name);
      var n = document.getElementById('dashCalUserName');     if (n) n.textContent = name;
      var e = document.getElementById('dashCalUserEmail');    if (e) e.textContent = email;
      var a = document.getElementById('dashCalUserAvatar');   if (a) a.textContent = ini.charAt(0);
    } catch (_) {}
  }

  // ── Phase 19r: collapse / show toggle ─────────────────────────────
  // Persists across navigation via localStorage. When collapsed:
  //   • body gets .pm-cal-collapsed → CSS hides the aside + flattens
  //     the .dash-shell grid to 1fr so the main content fills width
  //   • a small floating "show calendar" pill appears on the right edge
  // Toggle live across tabs via the storage event.
  var COLLAPSE_KEY = 'pmCalCollapsed';
  function isCollapsed() {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (_) { return false; }
  }
  function applyCollapse(collapsed) {
    document.body.classList.toggle('pm-cal-collapsed', !!collapsed);
    // Reflect on the floating "show" pill if present
    var pill = document.getElementById('dashCalShowPill');
    if (pill) pill.hidden = !collapsed;
  }
  function setCollapsed(v) {
    try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch (_) {}
    applyCollapse(v);
  }
  function injectShowPill() {
    if (document.getElementById('dashCalShowPill')) return;
    var btn = document.createElement('button');
    btn.id = 'dashCalShowPill';
    btn.className = 'dash-cal-show-pill';
    btn.type = 'button';
    btn.title = 'Show calendar';
    btn.setAttribute('aria-label', 'Show calendar');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>';
    btn.addEventListener('click', function(){ setCollapsed(false); });
    document.body.appendChild(btn);
    btn.hidden = !isCollapsed();
  }

  async function mount() {
    var placeholder = document.getElementById('pmCalendar');
    var markup = html('C', 'Client', '');
    if (placeholder) {
      placeholder.outerHTML = markup;
    } else {
      // No placeholder — fixed-position mode. Add body class so page can offset.
      document.body.insertAdjacentHTML('beforeend', markup);
      var added = document.body.lastElementChild;
      if (added && added.classList) added.classList.add('dash-cal--fixed');
      document.body.classList.add('pm-has-calendar');
    }
    wireMonth();
    wireSections();
    populateUser();

    // Close button → collapse
    var closeBtn = document.getElementById('dashCalClose');
    if (closeBtn) closeBtn.addEventListener('click', function(){ setCollapsed(true); });

    injectShowPill();
    applyCollapse(isCollapsed());
  }

  // Cross-tab sync for collapse state
  window.addEventListener('storage', function(e){
    if (e.key === COLLAPSE_KEY) applyCollapse(e.newValue === '1');
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
