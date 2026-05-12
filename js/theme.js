// Site-wide light/dark theme.
// Sets [data-pm-theme="light" | "dark"] on <html>, persists to localStorage.
// IMPORTANT: include this script in <head> so the attribute is set before
// first paint — avoids any flash of wrong theme.
//
// API:   window.pmTheme.get() → 'light' | 'dark'
//        window.pmTheme.set('light' | 'dark')
//        window.pmTheme.toggle()
//
// Auto-wiring: any element with [data-pm-theme-toggle] gets a click handler.
// Cross-tab sync via the storage event (so switching theme on one tab updates the others).

(function () {
  var KEY = 'pmTheme';
  var ATTR = 'data-pm-theme';
  var html = document.documentElement;

  function read() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }
  function save(v) {
    try { localStorage.setItem(KEY, v); } catch (_) {}
  }

  function apply(theme) {
    if (theme !== 'light' && theme !== 'dark') theme = 'dark';
    html.setAttribute(ATTR, theme);
    // Back-compat for any existing CSS using the old dashboard attribute
    html.setAttribute('data-dash-theme', theme);
    // Also sync messages.html's body.theme-light class so its existing CSS
    // responds when theme is toggled from the sidebar.
    if (document.body) {
      document.body.classList.toggle('theme-light', theme === 'light');
    } else {
      // Body not parsed yet — defer until DOM ready
      document.addEventListener('DOMContentLoaded', function () {
        document.body.classList.toggle('theme-light', html.getAttribute(ATTR) === 'light');
      }, { once: true });
    }
  }

  function initial() {
    var saved = read();
    if (saved === 'light' || saved === 'dark') return saved;
    // One-time migration from the older dashboard-only key
    try {
      var old = localStorage.getItem('pmDashTheme');
      if (old === 'light' || old === 'dark') {
        save(old);
        localStorage.removeItem('pmDashTheme');
        return old;
      }
    } catch (_) {}
    // No saved pref — respect OS preference for first visit
    try {
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
    } catch (_) {}
    return 'dark';
  }

  apply(initial());

  function get() { return html.getAttribute(ATTR) || 'dark'; }
  function set(v) { apply(v); save(v); fire(v); }
  function toggle() { set(get() === 'light' ? 'dark' : 'light'); }

  function fire(v) {
    try { window.dispatchEvent(new CustomEvent('pm-theme-change', { detail: { theme: v } })); } catch (_) {}
  }

  // Wire any [data-pm-theme-toggle] element after DOM is ready,
  // and also re-scan when the sidebar/calendar inject markup later.
  function wire(root) {
    var nodes = (root || document).querySelectorAll('[data-pm-theme-toggle]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.__pmThemeWired) continue;
      el.__pmThemeWired = true;
      el.addEventListener('click', function (e) {
        e.preventDefault();
        toggle();
      });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wire(); });
  } else {
    wire();
  }

  // Watch for late-added toggles (sidebar.js renders one after auth)
  if (typeof MutationObserver !== 'undefined') {
    var obs = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        for (var j = 0; j < (m.addedNodes || []).length; j++) {
          var n = m.addedNodes[j];
          if (n && n.nodeType === 1) wire(n);
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Cross-tab sync
  window.addEventListener('storage', function (e) {
    if (e.key === KEY && (e.newValue === 'light' || e.newValue === 'dark')) apply(e.newValue);
  });

  window.pmTheme = { get: get, set: set, toggle: toggle };
})();
