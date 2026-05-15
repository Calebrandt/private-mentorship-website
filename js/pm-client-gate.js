/* ════════════════════════════════════════════════════════════════
 * Private Mentorship — Client Dashboard Gate
 * Placeholder client-side gate. Replaces with Supabase auth later.
 *
 * Unlock conditions (any one):
 *   - localStorage.pm_client_applied === 'true'  (set by apply.html on submit)
 *   - sessionStorage.pm_client_unlocked === '1'  (gate passcode entered)
 *
 * Test passcodes (case-insensitive): pm-client-2026, client, demo
 * ════════════════════════════════════════════════════════════════ */
(function(){
  var CLIENT_CODES = ['pm-client-2026', 'client', 'demo'];
  var STORAGE_KEY = 'pm_client_unlocked';

  function isUnlocked(){
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === '1') return true;
      if (localStorage.getItem('pm_client_applied') === 'true') return true;
    } catch(e){}
    return false;
  }
  function unlock(){
    document.body.classList.remove('pm-gated-body');
    document.body.classList.add('pm-unlocked');
    try { sessionStorage.setItem(STORAGE_KEY, '1'); } catch(e){}
  }
  function lock(){
    document.body.classList.remove('pm-unlocked');
    document.body.classList.add('pm-gated-body');
    try { sessionStorage.removeItem(STORAGE_KEY); } catch(e){}
  }

  if (isUnlocked()) {
    unlock();
  }

  function wireForm(){
    var form = document.getElementById('pmGateForm');
    var input = document.getElementById('pmGateCode');
    var error = document.getElementById('pmGateError');
    if (!form) return;
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var val = (input.value || '').trim().toLowerCase();
      if (CLIENT_CODES.indexOf(val) !== -1) {
        error.textContent = '';
        unlock();
      } else {
        error.textContent = 'That access code was not recognized. Apply now if you have not yet.';
        input.focus();
        input.select();
      }
    });
    setTimeout(function(){ input.focus(); }, 100);
  }

  function wireSignOut(){
    var btn = document.getElementById('pmSignOut');
    if (!btn) return;
    btn.addEventListener('click', function(){
      if (confirm('Sign out of the Client Dashboard?')) {
        lock();
        try {
          localStorage.removeItem('pm_client_applied');
          localStorage.removeItem('pm_client_applied_at');
        } catch(e){}
        window.location.href = '../index.html';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function(){ wireForm(); wireSignOut(); });
  } else {
    wireForm();
    wireSignOut();
  }
})();
