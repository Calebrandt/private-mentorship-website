/* ════════════════════════════════════════════════════════════════
 * Private Mentorship — Admin Gate
 * Placeholder client-side gate. Replaces with real role-based auth later.
 * Access codes (case-insensitive): pm-admin-2026, admin, founder
 * Unlock persists via sessionStorage (clears on tab close).
 * ════════════════════════════════════════════════════════════════ */
(function(){
  var ADMIN_CODES = ['pm-admin-2026', 'admin', 'founder'];
  var STORAGE_KEY = 'pm_admin_unlocked';

  function isUnlocked(){
    try { return sessionStorage.getItem(STORAGE_KEY) === '1'; } catch(e){ return false; }
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

  if (isUnlocked()) unlock();

  function wireForm(){
    var form = document.getElementById('pmGateForm');
    var input = document.getElementById('pmGateCode');
    var error = document.getElementById('pmGateError');
    if (!form) return;
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var val = (input.value || '').trim().toLowerCase();
      if (ADMIN_CODES.indexOf(val) !== -1) {
        error.textContent = '';
        unlock();
      } else {
        error.textContent = 'Admin code not recognized.';
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
      if (confirm('Sign out of the admin area?')) {
        lock();
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
