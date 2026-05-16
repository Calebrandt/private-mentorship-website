// ════════════════════════════════════════════════════════════════
// Deep-link flash — when a page is opened with a URL hash like
// #inv-<id>, #appt-<id>, #contract-<id>, etc., scroll the matching
// element into view (when it appears in the DOM) and flash a brief
// highlight so the user immediately sees which row was targeted.
//
// The page's own data-rendering script populates the rows
// asynchronously (after fetching from Supabase), so we can't just
// look for the element on DOMContentLoaded. We use MutationObserver
// to watch for it appearing — for up to 8 seconds — then trigger
// the flash. Idempotent and safe.
//
// Companion CSS in js/sidebar.css under .deep-link-flash.
// ════════════════════════════════════════════════════════════════

(function () {
  if (window.__pmDeepLinkFlashWired) return;
  window.__pmDeepLinkFlashWired = true;

  const TIMEOUT_MS = 8000;     // give the page up to 8s to render the row

  function trigger(targetId) {
    if (!targetId) return;
    const el = document.getElementById(targetId);
    if (!el) return false;

    // Smooth scroll into view, slightly above center so the row is
    // clearly visible (not right at the edge of the viewport).
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (_) {
      el.scrollIntoView();
    }

    // Apply flash class. CSS handles the animation; we remove after.
    el.classList.add('deep-link-flash');
    setTimeout(() => el.classList.remove('deep-link-flash'), 2200);
    return true;
  }

  function start() {
    const hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return;

    // If the element is already in the DOM, fire immediately.
    if (trigger(hash)) return;

    // Otherwise, watch for it to appear.
    const giveUpAt = Date.now() + TIMEOUT_MS;
    const obs = new MutationObserver(() => {
      if (trigger(hash) || Date.now() > giveUpAt) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });

    // Hard stop after the timeout in case nothing ever shows up.
    setTimeout(() => obs.disconnect(), TIMEOUT_MS);
  }

  // Also re-fire when the hash changes after initial load (e.g. user
  // clicks a search result that points at the page they're already on).
  window.addEventListener('hashchange', start);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
