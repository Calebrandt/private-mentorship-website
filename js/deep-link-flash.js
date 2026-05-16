// ════════════════════════════════════════════════════════════════
// Deep-link flash + in-page text highlight
//
// When a page is opened with a URL hash like #inv-<id>, #appt-<id>,
// #contract-<id>, #lesson-<id>, this script:
//   1. Waits for the matching DOM element to appear (data is rendered
//      async after Supabase fetches — uses MutationObserver, gives up
//      after 8s)
//   2. Smoothly scrolls it into view centered
//   3. Pulses an amber outline+tint for ~2s so the user sees it
//   4. If the URL also has ?q=<search-term>, finds every occurrence
//      of that text INSIDE the matched element and wraps it in <mark>
//      so the user can see *what* they searched for, the way browser
//      Cmd-F does. Persists ~5s, then quietly unwraps.
//
// Companion CSS in js/sidebar.css under .deep-link-flash and
// .deep-link-mark.
// ════════════════════════════════════════════════════════════════

(function () {
  if (window.__pmDeepLinkFlashWired) return;
  window.__pmDeepLinkFlashWired = true;

  const TIMEOUT_MS = 8000;
  const MARK_VISIBLE_MS = 5000;

  // Find the `q` (query) URL param — case-insensitive, trimmed.
  function getQuery() {
    try {
      const q = new URLSearchParams(location.search).get('q');
      return q ? q.trim() : '';
    } catch (_) { return ''; }
  }

  // Walk text nodes inside `root`, wrap every case-insensitive
  // occurrence of `needle` in <mark class="deep-link-mark">. Skips
  // script/style/textarea/input. Returns the list of wrapper elements
  // (so we can unwrap them later).
  function highlightText(root, needle) {
    if (!root || !needle) return [];
    const wrappers = [];
    const SKIP = new Set(['SCRIPT','STYLE','TEXTAREA','INPUT','MARK','BUTTON','SELECT','OPTION']);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
        let p = node.parentNode;
        while (p && p !== root) {
          if (p.nodeType === 1 && SKIP.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          p = p.parentNode;
        }
        return node.nodeValue.toLowerCase().includes(needle.toLowerCase())
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    const matches = [];
    let node;
    while ((node = walker.nextNode())) matches.push(node);

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
    return wrappers;
  }

  // Undo highlightText — replace each <mark> with its text content
  function unhighlight(wrappers) {
    (wrappers || []).forEach(m => {
      if (!m.parentNode) return;
      const txt = document.createTextNode(m.textContent || '');
      m.parentNode.replaceChild(txt, m);
    });
  }

  function trigger(targetId, query) {
    if (!targetId) return false;
    const el = document.getElementById(targetId);
    if (!el) return false;

    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    catch (_) { el.scrollIntoView(); }

    el.classList.add('deep-link-flash');
    setTimeout(() => el.classList.remove('deep-link-flash'), 2200);

    // Cmd-F style text highlight inside the targeted row
    if (query) {
      const wrappers = highlightText(el, query);
      if (wrappers.length) {
        setTimeout(() => unhighlight(wrappers), MARK_VISIBLE_MS);
      }
    }
    return true;
  }

  function start() {
    const hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return;
    const query = getQuery();

    if (trigger(hash, query)) return;

    const giveUpAt = Date.now() + TIMEOUT_MS;
    const obs = new MutationObserver(() => {
      if (trigger(hash, query) || Date.now() > giveUpAt) obs.disconnect();
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), TIMEOUT_MS);
  }

  window.addEventListener('hashchange', start);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
