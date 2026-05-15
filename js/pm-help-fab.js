/* ════════════════════════════════════════════════════════════════
 * Private Mentorship — Help FAB
 * Drop-in floating action button that opens a small help menu.
 * Include with: <script src="js/pm-help-fab.js" defer></script>
 * Or from a subfolder: <script src="../js/pm-help-fab.js" defer></script>
 * Auto-resolves the base path of the site for the help links.
 * ════════════════════════════════════════════════════════════════ */
(function(){
  if (window.__pmHelpFabLoaded) return;
  window.__pmHelpFabLoaded = true;

  // Detect base path: if the current page is in a subfolder (assistants/),
  // we need to prepend "../" to the help links so they resolve from the root.
  // We do this by parsing the current pathname.
  function resolveBase(){
    var path = window.location.pathname;
    // Count subfolders past the site root. Conservative approach:
    // if the path contains "/assistants/" anywhere (and the page is a profile),
    // prepend "../"; otherwise root.
    var parts = path.split('/').filter(function(p){ return p && !p.endsWith('.html'); });
    // parts.length == 0 means root (e.g., "/index.html")
    // parts.length == 1 means one folder deep (e.g., "/assistants/sarah-y.html")
    if (parts.length >= 1 && parts[parts.length - 1] !== '') {
      return '../';
    }
    return '';
  }

  var base = resolveBase();

  // ─── INJECT CSS ─────────────────────────────
  var css = ''
    + '.pm-fab{position:fixed;bottom:22px;right:22px;z-index:9000;font-family:Inter,system-ui,-apple-system,sans-serif;}'
    + '.pm-fab__btn{width:54px;height:54px;border-radius:50%;background:#1a1a1a;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px -8px rgba(0,0,0,0.5),0 4px 8px -4px rgba(0,0,0,0.3);transition:transform .2s ease, background .2s ease;outline:none;}'
    + '.pm-fab__btn:hover{background:#2a2a2a;transform:translateY(-2px);}'
    + '.pm-fab__btn:focus-visible{outline:2px solid #a07c3c;outline-offset:3px;}'
    + '.pm-fab__btn svg{width:22px;height:22px;transition:transform .25s ease;}'
    + '.pm-fab.is-open .pm-fab__btn svg{transform:rotate(45deg);}'
    + '.pm-fab__menu{position:absolute;bottom:66px;right:0;width:280px;background:#fff;border:1px solid #e8e3da;box-shadow:0 18px 40px -16px rgba(0,0,0,0.22),0 6px 14px -6px rgba(0,0,0,0.12);transform:translateY(8px) scale(.96);opacity:0;pointer-events:none;transition:opacity .2s ease, transform .25s cubic-bezier(.22,1,.36,1);transform-origin:bottom right;}'
    + '.pm-fab.is-open .pm-fab__menu{transform:translateY(0) scale(1);opacity:1;pointer-events:auto;}'
    + '.pm-fab__head{padding:18px 20px 14px;border-bottom:1px solid #ebe7df;}'
    + '.pm-fab__eyebrow{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#a07c3c;font-weight:600;margin-bottom:6px;}'
    + '.pm-fab__title{font-family:Fraunces,Georgia,serif;font-size:18px;font-weight:500;color:#1a1a1a;line-height:1.2;letter-spacing:-.01em;margin:0;}'
    + '.pm-fab__list{padding:8px 0 12px;}'
    + '.pm-fab__item{display:flex;align-items:center;gap:12px;padding:11px 20px;text-decoration:none;color:#1a1a1a;font-size:13.5px;line-height:1.4;transition:background .15s ease;border:none;width:100%;background:none;text-align:left;font-family:inherit;cursor:pointer;}'
    + '.pm-fab__item:hover{background:#faf7f1;}'
    + '.pm-fab__item-icon{width:32px;height:32px;flex-shrink:0;background:#f5f1ea;color:#6a6a6a;border-radius:50%;display:flex;align-items:center;justify-content:center;}'
    + '.pm-fab__item-icon svg{width:14px;height:14px;}'
    + '.pm-fab__item-text{display:flex;flex-direction:column;min-width:0;}'
    + '.pm-fab__item-title{font-weight:500;color:#1a1a1a;}'
    + '.pm-fab__item-sub{font-size:11.5px;color:#9a9a9a;margin-top:2px;}'
    + '.pm-fab__item--danger .pm-fab__item-icon{background:#fef1f0;color:#c93838;}'
    + '.pm-fab__item--danger .pm-fab__item-title{color:#c93838;}'
    + '.pm-fab__foot{padding:10px 20px 14px;border-top:1px solid #ebe7df;font-size:11px;color:#9a9a9a;letter-spacing:.04em;}'
    + '@media (max-width: 600px){.pm-fab{bottom:16px;right:16px;}.pm-fab__menu{width:calc(100vw - 32px);max-width:280px;right:0;}}'
    + '@media (prefers-reduced-motion: reduce){.pm-fab__btn,.pm-fab__menu,.pm-fab__btn svg{transition:none !important;}}';

  var style = document.createElement('style');
  style.id = 'pm-fab-styles';
  style.textContent = css;
  document.head.appendChild(style);

  // ─── INJECT DOM ─────────────────────────────
  var html = ''
    + '<button class="pm-fab__btn" id="pmFabBtn" type="button" aria-expanded="false" aria-controls="pmFabMenu" aria-label="Help and support">'
    +   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    +     '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'
    +   '</svg>'
    + '</button>'
    + '<div class="pm-fab__menu" id="pmFabMenu" role="menu">'
    +   '<div class="pm-fab__head">'
    +     '<div class="pm-fab__eyebrow">Help &amp; Support</div>'
    +     '<p class="pm-fab__title">How can we help?</p>'
    +   '</div>'
    +   '<div class="pm-fab__list">'
    +     '<a class="pm-fab__item" role="menuitem" href="' + base + 'family-help.html">'
    +       '<span class="pm-fab__item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21l1.5-4.5A8 8 0 1 1 8 20l-5 1z"/></svg></span>'
    +       '<span class="pm-fab__item-text"><span class="pm-fab__item-title">For Families</span><span class="pm-fab__item-sub">FAQ &amp; support</span></span>'
    +     '</a>'
    +     '<a class="pm-fab__item" role="menuitem" href="' + base + 'assistant-help.html">'
    +       '<span class="pm-fab__item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>'
    +       '<span class="pm-fab__item-text"><span class="pm-fab__item-title">For Assistants</span><span class="pm-fab__item-sub">Logged-in roster only</span></span>'
    +     '</a>'
    +     '<a class="pm-fab__item" role="menuitem" href="mailto:hello@privatementorship.ca">'
    +       '<span class="pm-fab__item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg></span>'
    +       '<span class="pm-fab__item-text"><span class="pm-fab__item-title">Email Us</span><span class="pm-fab__item-sub">hello@privatementorship.ca</span></span>'
    +     '</a>'
    +     '<a class="pm-fab__item pm-fab__item--danger" role="menuitem" href="tel:911">'
    +       '<span class="pm-fab__item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg></span>'
    +       '<span class="pm-fab__item-text"><span class="pm-fab__item-title">Emergency</span><span class="pm-fab__item-sub">Call 911 first</span></span>'
    +     '</a>'
    +   '</div>'
    +   '<div class="pm-fab__foot">Replies within 1 business day</div>'
    + '</div>';

  var wrap = document.createElement('div');
  wrap.className = 'pm-fab';
  wrap.id = 'pmFab';
  wrap.innerHTML = html;
  document.body.appendChild(wrap);

  // ─── BEHAVIOR ─────────────────────────────
  var btn = document.getElementById('pmFabBtn');
  var menu = document.getElementById('pmFabMenu');

  function setOpen(open){
    wrap.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  btn.addEventListener('click', function(e){
    e.stopPropagation();
    setOpen(!wrap.classList.contains('is-open'));
  });

  // Close on outside click
  document.addEventListener('click', function(e){
    if (!wrap.contains(e.target)) setOpen(false);
  });

  // Close on Escape
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && wrap.classList.contains('is-open')) {
      setOpen(false);
      btn.focus();
    }
  });
})();
