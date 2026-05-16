// Shared topbar userpod populator.
// Looks for #nxUserAvatar + #nxUserName in the .nx-topbar and fills them
// with the signed-in user's first name and initial.
//
// Drop-in for any page that has the canonical client topbar.
// No-op if the elements aren't in the DOM.

(function () {
  function initials(name) {
    var s = String(name || '').trim();
    if (!s) return 'C';
    return s.split(/\s+/).map(function (p) { return p[0] || ''; }).join('').slice(0, 1).toUpperCase() || 'C';
  }

  async function populate() {
    var avatarEl = document.getElementById('nxUserAvatar');
    var nameEl   = document.getElementById('nxUserName');
    if (!avatarEl && !nameEl) return;          // nothing to fill
    if (!window.pmHiring) return;              // auth API not ready yet — caller retries

    try {
      var user = await window.pmHiring.getCurrentUser();
      if (!user) return;
      var profile = null;
      try { profile = await window.pmHiring.fetchCurrentUserProfile(); } catch (_) {}
      var fullName = (profile && profile.full_name) || (user && user.email && user.email.split('@')[0]) || 'Client';
      // Prefer first name; fall back to whole label
      var firstName = String(fullName).split(/\s+/)[0] || fullName;
      if (nameEl)   nameEl.textContent   = firstName;
      if (avatarEl) avatarEl.textContent = initials(firstName);
    } catch (_) {
      // Silent — the topbar still shows the default placeholder.
    }
  }

  // pmHiring may load after this script — poll briefly until it appears,
  // then populate. Bail after ~6 seconds.
  function start() {
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (window.pmHiring) {
        clearInterval(iv);
        populate();
      } else if (tries > 60) {
        clearInterval(iv);
      }
    }, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
