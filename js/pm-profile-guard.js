/* ════════════════════════════════════════════════════════════════
 * Private Mentorship — Profile Guard
 * Redirects profile-page visitors who haven't applied or signed in
 * to apply.html. Drop-in for /assistants/*.html files.
 *
 * Bypass codes are accepted for development/demo:
 *   - any of `pm-roster-2026`, `assistant`, `roster` in sessionStorage
 *   - `?preview=true` in the URL
 *   - localStorage `pm_client_applied === 'true'` (set by apply.html on submit)
 * ════════════════════════════════════════════════════════════════ */
(function(){
  if (window.__pmProfileGuardRan) return;
  window.__pmProfileGuardRan = true;

  function hasAccess(){
    try {
      // 1) Family applied via apply.html
      if (localStorage.getItem('pm_client_applied') === 'true') return true;
      // 2) Dev preview override
      if (new URLSearchParams(window.location.search).get('preview') === 'true') return true;
      // 3) Roster/admin passcode set elsewhere
      var unlock = sessionStorage.getItem('pm_profile_unlocked');
      if (unlock === '1') return true;
    } catch(e){}
    return false;
  }

  if (hasAccess()) return;

  // Inject a soft-block overlay rather than a hard redirect, so the visitor
  // sees a moment of explanation instead of a jarring page change.
  var assistantName = (document.title || '').split('—')[0].trim() || 'this Assistant';

  function showGate(){
    var css = ''
      + 'body.pm-locked{overflow:hidden;}'
      + '.pm-lock{position:fixed;inset:0;z-index:9999;background:rgba(26,26,26,0.92);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Inter,system-ui,-apple-system,sans-serif;}'
      + '.pm-lock__card{background:#faf7f1;max-width:480px;width:100%;padding:42px 38px 36px;border:1px solid #e8e3da;box-shadow:0 30px 60px -20px rgba(0,0,0,0.5);}'
      + '.pm-lock__eyebrow{font-size:11px;letter-spacing:.32em;text-transform:uppercase;color:#a07c3c;font-weight:600;margin-bottom:14px;}'
      + '.pm-lock__h{font-family:Fraunces,Georgia,serif;font-size:28px;font-weight:300;letter-spacing:-.018em;line-height:1.18;margin:0 0 14px;color:#1a1a1a;}'
      + '.pm-lock__sub{font-size:14px;color:#6a6a6a;line-height:1.7;margin:0 0 26px;}'
      + '.pm-lock__actions{display:flex;flex-direction:column;gap:10px;}'
      + '.pm-lock__cta{display:flex;align-items:center;justify-content:center;gap:10px;padding:15px 24px;background:#1a1a1a;color:#fff;font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:500;text-decoration:none;transition:background .2s ease;}'
      + '.pm-lock__cta:hover{background:#2a2a2a;}'
      + '.pm-lock__alt{display:flex;align-items:center;justify-content:center;gap:10px;padding:14px 24px;border:1px solid #d8d4cc;color:#1a1a1a;font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:500;text-decoration:none;transition:background .2s ease;background:transparent;}'
      + '.pm-lock__alt:hover{background:#1a1a1a;color:#fff;}'
      + '.pm-lock__note{margin-top:24px;padding-top:18px;border-top:1px solid #ebe7df;font-size:11.5px;color:#9a9a9a;line-height:1.6;text-align:center;}';

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.body.classList.add('pm-locked');

    var overlay = document.createElement('div');
    overlay.className = 'pm-lock';
    overlay.innerHTML = ''
      + '<div class="pm-lock__card">'
      +   '<div class="pm-lock__eyebrow">Roster · Private Access</div>'
      +   '<h1 class="pm-lock__h">Individual Assistant profiles are reserved for applied families.</h1>'
      +   '<p class="pm-lock__sub">Out of respect for our Assistants\' privacy and our Clients\', individual profiles, photos, and full names are accessible only inside the Client Dashboard after applying. The application takes about ten minutes.</p>'
      +   '<div class="pm-lock__actions">'
      +     '<a class="pm-lock__cta" href="../apply.html">Apply to Unlock the Roster</a>'
      +     '<a class="pm-lock__alt" href="../assistants.html">← Back to the Public Roster</a>'
      +   '</div>'
      +   '<p class="pm-lock__note">Already applied? Once your Client Dashboard is set up, you will sign in there to view this profile.</p>'
      + '</div>';

    document.body.appendChild(overlay);
  }

  // Wait for body to exist if we ran before DOMContentLoaded
  if (document.body) {
    showGate();
  } else {
    document.addEventListener('DOMContentLoaded', showGate);
  }
})();
