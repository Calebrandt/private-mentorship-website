// ════════════════════════════════════════════════════════════════
// Deep-link flash + page-wide text highlight
//
// When a page is opened from the master search, the URL has:
//   • a hash like #inv-<id>, #appt-<id>, #lesson-<id> — the
//     specific row the user clicked
//   • optionally ?q=<search-term> — what they typed
//
// What this script does:
//   1. Highlights EVERY occurrence of the query text anywhere on
//      the page (browser Cmd-F style) — wraps each in <mark
//      class="deep-link-mark">. Persists ~6 seconds then quietly
//      unwraps.
//   2. If the hash matches an element, also scrolls it into view
//      centered and pulses an amber outline (the "flash") for
//      ~2.6 seconds so the user knows which specific row to focus on.
//
// Because the page renders data async (Supabase fetches after auth),
// we re-run the highlight every time the DOM changes for up to 8s,
// then settle. Each run only marks NEW text — already-marked nodes
// are skipped so we don't keep re-wrapping the same characters.
//
// Companion CSS in js/sidebar.css under .deep-link-flash and
// .deep-link-mark.
// ════════════════════════════════════════════════════════════════

(function () {
  if (window.__pmDeepLinkFlashWired) return;
  window.__pmDeepLinkFlashWired = true;

  const SETTLE_MS       = 8000;      // keep re-highlighting as new rows render
  const MARK_VISIBLE_MS = 6000;      // then unwrap after this many ms idle
  const MIN_QUERY_LEN   = 2;         // don't highlight single letters

  // ── URL params ─────────────────────────────────────────────────
  function getQuery() {
    try {
      const q = new URLSearchParams(location.search).get('q');
      return q ? q.trim() : '';
    } catch (_) { return ''; }
  }

  // ── Highlighting ───────────────────────────────────────────────
  const SKIP = new Set([
    'SCRIPT','STYLE','TEXTAREA','INPUT','MARK','BUTTON','SELECT','OPTION',
    'NOSCRIPT','SVG','PATH','LINE','CIRCLE','RECT','POLYLINE','POLYGON',
  ]);

  // Walk text nodes under `root`, wrap each case-insensitive occurrence
  // of `needle` in <mark class="deep-link-mark">. Skips nodes already
  // inside a <mark.deep-link-mark> so re-running is idempotent.
  // Also skips the topbar's search input and the dropdown.
  function highlightText(root, needle, wrappers) {
    if (!root || !needle) return;
    const lowerNeedle = needle.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        let p = node.parentNode;
        while (p && p.nodeType === 1) {
          const tag = p.tagName;
          if (SKIP.has(tag)) return NodeFilter.FILTER_REJECT;
          // Don't highlight the topbar search input area or the dropdown
          if (p.classList && (
              p.classList.contains('nx-search') ||
              p.classList.contains('ms-panel') ||
              p.classList.contains('deep-link-mark'))) {
            return NodeFilter.FILTER_REJECT;
          }
          p = p.parentNode;
        }
        return node.nodeValue.toLowerCase().includes(lowerNeedle)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });

    const matches = [];
    let node;
    while ((node = walker.nextNode())) matches.push(node);
    if (!matches.length) return;

    const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    matches.forEach(textNode => {
      const text = textNode.nodeValue;
      const parent = textNode.parentNode;
      if (!parent) return;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      text.replace(re, (m, idx) => {
        if (idx > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, idx)));
        const mark = document.createElement('mark');
        mark.className = 'deep-link-mark';
        mark.textContent = m;
        frag.appendChild(mark);
        wrappers.push(mark);
        lastIdx = idx + m.length;
      });
      if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
      parent.replaceChild(frag, textNode);
    });
  }

  function unhighlight(wrappers) {
    (wrappers || []).forEach(m => {
      if (!m.parentNode) return;
      const txt = document.createTextNode(m.textContent || '');
      m.parentNode.replaceChild(txt, m);
    });
    // Normalize merged text nodes so future re-highlights work cleanly
    try { document.body && document.body.normalize(); } catch (_) {}
  }

  // ── Row flash (scroll + amber pulse) ───────────────────────────
  function flashRow(targetId) {
    if (!targetId) return false;
    const el = document.getElementById(targetId);
    if (!el) return false;
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    catch (_) { el.scrollIntoView(); }
    el.classList.add('deep-link-flash');
    setTimeout(() => el.classList.remove('deep-link-flash'), 2800);
    return true;
  }

  // ── Orchestrator ────────────────────────────────────────────────
  function start() {
    const hash  = (location.hash || '').replace(/^#/, '');
    const query = getQuery();
    if (!hash && (!query || query.length < MIN_QUERY_LEN)) return;

    const wrappers = [];            // every <mark> we've inserted
    let rowFlashed = false;         // only flash once
    let lastChangeAt = Date.now();
    let unmarkScheduled = null;

    const tick = () => {
      // Try to flash the row (once it's in the DOM)
      if (!rowFlashed && hash && flashRow(hash)) {
        rowFlashed = true;
      }
      // Re-highlight (idempotent — already-marked nodes are skipped)
      if (query && query.length >= MIN_QUERY_LEN) {
        const before = wrappers.length;
        highlightText(document.body, query, wrappers);
        if (wrappers.length > before) lastChangeAt = Date.now();
      }
      // Schedule the eventual unmark
      if (unmarkScheduled) clearTimeout(unmarkScheduled);
      unmarkScheduled = setTimeout(() => unhighlight(wrappers), MARK_VISIBLE_MS);
    };

    tick(); // immediate first pass

    // Keep re-tickling for up to SETTLE_MS to catch async-rendered rows
    const giveUpAt = Date.now() + SETTLE_MS;
    const obs = new MutationObserver(() => {
      tick();
      if (Date.now() > giveUpAt) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), SETTLE_MS);
  }

  window.addEventListener('hashchange', start);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
