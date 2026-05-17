/* =====================================================================
   js/assistant-fab.js  —  Phase 19c.8a
   ---------------------------------------------------------------------
   The PM Assistant floating action button (FAB) + slide-out chat panel.
   Self-injects into every page that loads this script. Only renders for
   admin/owner roles.

   What it does
     • Bottom-right FAB shows a chat-bubble icon + red badge with unread count
     • Click FAB → slide-out drawer from the right (mobile: full-screen)
     • Drawer shows thread list (recent conversations with the bot)
     • Click thread → conversation view with messages, action buttons,
       preview cards, free-text input
     • Auto-refreshes every 60s for new threads
     • "Scan now" button lets you fire the daily scan on demand

   This file is the entire UI — markup is injected, styles are scoped
   under .pm-assist-* prefixes to avoid colliding with anything.
   ===================================================================== */
(function () {
  'use strict';

  // ─── Wait for pmHiring to be loaded ───────────────────────────────
  function whenHiringReady(cb, attempts = 0) {
    if (window.pmHiring?.isCurrentUserAdminOrOwner) return cb();
    if (attempts > 40) return; // give up after 4s
    setTimeout(() => whenHiringReady(cb, attempts + 1), 100);
  }

  whenHiringReady(async () => {
    try {
      const isAdmin = await window.pmHiring.isCurrentUserAdminOrOwner();
      if (!isAdmin) return; // FAB is admin-only
    } catch (_) { return; }
    inject();
  });

  // ─── Markup + CSS injection ──────────────────────────────────────
  function inject() {
    const css = `
    .pm-assist-fab {
      position: fixed; bottom: 24px; right: 24px; z-index: 9998;
      width: 60px; height: 60px; border-radius: 30px;
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      box-shadow: 0 6px 24px -6px rgba(37,99,235,0.55), 0 2px 6px rgba(15,23,42,0.18);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; border: none;
      transition: transform .15s ease, box-shadow .15s ease;
    }
    .pm-assist-fab:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 10px 32px -6px rgba(37,99,235,0.65), 0 4px 10px rgba(15,23,42,0.22); }
    .pm-assist-fab:active { transform: translateY(0) scale(0.98); }
    .pm-assist-fab svg { width: 26px; height: 26px; color: #fff; }
    .pm-assist-fab__badge {
      position: absolute; top: -4px; right: -4px;
      min-width: 22px; height: 22px; border-radius: 11px;
      background: #ef4444; color: #fff;
      font: 700 11px Inter, -apple-system, sans-serif;
      display: none; align-items: center; justify-content: center;
      padding: 0 6px; border: 2px solid #fff;
    }
    .pm-assist-fab__badge.is-shown { display: inline-flex; }

    .pm-assist-backdrop {
      position: fixed; inset: 0; z-index: 9997;
      background: rgba(15,23,42,0.45);
      backdrop-filter: blur(2px);
      opacity: 0; pointer-events: none;
      transition: opacity .2s ease;
    }
    .pm-assist-backdrop.is-shown { opacity: 1; pointer-events: auto; }

    .pm-assist-panel {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 9999;
      width: 420px; max-width: 100vw;
      background: #f7f8fa;
      box-shadow: -10px 0 40px -10px rgba(15,23,42,0.25);
      display: flex; flex-direction: column;
      transform: translateX(100%);
      transition: transform .25s cubic-bezier(.4,0,.2,1);
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      color: #1f2937;
    }
    .pm-assist-panel.is-shown { transform: translateX(0); }

    .pm-assist-head {
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 20px; background: #ffffff; border-bottom: 1px solid #e5e7eb;
    }
    .pm-assist-head__title {
      display: flex; align-items: center; gap: 10px;
      font-weight: 700; font-size: 15px; color: #111827; letter-spacing: -0.01em;
    }
    .pm-assist-head__title-dot {
      width: 8px; height: 8px; border-radius: 4px; background: #10b981;
    }
    .pm-assist-head__actions { display: flex; gap: 4px; }
    .pm-assist-head__btn {
      background: transparent; border: 1px solid #e5e7eb;
      border-radius: 8px; padding: 6px 10px; cursor: pointer;
      font: 600 11px Inter, sans-serif; color: #4b5563;
      transition: background .12s ease, color .12s ease;
    }
    .pm-assist-head__btn:hover { background: #f3f4f6; color: #111827; }
    .pm-assist-head__btn.is-icon { padding: 6px 8px; line-height: 0; }
    .pm-assist-head__btn svg { width: 14px; height: 14px; }
    .pm-assist-head__btn.is-active {
      background: #111827; color: #fff; border-color: #111827;
    }
    .pm-assist-head__btn.is-active:hover { background: #1f2937; color: #fff; }
    /* Overflow menu — Email me / Show resolved tucked away */
    .pm-assist-head__menu-wrap { position: relative; }
    .pm-assist-head__menu {
      position: absolute; top: calc(100% + 6px); right: 0; z-index: 1000;
      min-width: 200px;
      background: #fff; border: 1px solid #e5e7eb;
      border-radius: 9px;
      box-shadow: 0 6px 20px -4px rgba(15,23,42,0.18);
      padding: 4px;
      display: flex; flex-direction: column;
    }
    .pm-assist-head__menu-item {
      text-align: left; padding: 9px 12px;
      background: transparent; border: none; border-radius: 7px;
      font: 500 12.5px Inter, sans-serif; color: #374151;
      cursor: pointer;
      transition: background .12s ease, color .12s ease;
    }
    .pm-assist-head__menu-item:hover { background: #f3f4f6; color: #0f172a; }
    .pm-assist-head__menu-item:disabled { opacity: 0.5; cursor: wait; }

    .pm-assist-body {
      flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
      background: #f7f8fa;
    }
    .pm-assist-empty {
      padding: 60px 30px; text-align: center; color: #9ca3af;
      font: 500 13px Inter, sans-serif; line-height: 1.55;
    }
    .pm-assist-empty strong { color: #374151; display: block; margin-bottom: 6px; font-weight: 700; }
    .pm-assist-empty .pm-assist-empty__sub { margin-top: 14px; font-size: 12px; }

    /* Thread list */
    .pm-assist-thread {
      display: block; padding: 14px 20px; cursor: pointer;
      border-bottom: 1px solid #ececec;
      background: #fff; transition: background .1s ease;
    }
    .pm-assist-thread:hover { background: #f3f4f6; }
    .pm-assist-thread__top {
      display: flex; align-items: center; gap: 10px;
    }
    .pm-assist-thread__icon { font-size: 16px; }
    .pm-assist-thread__title {
      flex: 1; font-weight: 600; font-size: 13.5px;
      color: #111827; letter-spacing: -0.005em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pm-assist-thread__pip {
      width: 8px; height: 8px; border-radius: 4px; background: #ef4444;
    }
    .pm-assist-thread__pip.is-hidden { display: none; }
    .pm-assist-thread__sub {
      font-size: 11.5px; color: #6b7280; margin-top: 4px; padding-left: 26px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pm-assist-thread__time {
      font-size: 10.5px; color: #9ca3af; margin-top: 4px; padding-left: 26px;
    }
    /* History section divider — separates active work from resolved/dismissed history */
    .pm-assist-section-divider {
      display: flex; align-items: center; gap: 10px;
      padding: 18px 20px 8px;
      font: 600 10px Inter, sans-serif;
      text-transform: uppercase; letter-spacing: 0.14em;
      color: #94a3b8;
    }
    .pm-assist-section-divider span { display: inline-block; padding: 0; }
    .pm-assist-section-divider::before,
    .pm-assist-section-divider::after {
      content: ''; flex: 1; height: 1px; background: #e5e7eb;
    }
    /* Closed (resolved/dismissed) threads — muted so open work pops */
    .pm-assist-thread.is-closed { background: #fafbfc; }
    .pm-assist-thread.is-closed .pm-assist-thread__title { color: #9ca3af; font-weight: 500; }
    .pm-assist-thread.is-closed .pm-assist-thread__sub { color: #b6bcc6; }
    .pm-assist-thread__badge {
      font: 600 9px Inter, sans-serif; letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 2px 7px; border-radius: 9999px;
      background: #e5e7eb; color: #6b7280;
    }

    /* Conversation view */
    .pm-assist-convo-head {
      display: flex; align-items: center; gap: 10px;
      padding: 14px 20px; background: #fff; border-bottom: 1px solid #e5e7eb;
    }
    .pm-assist-convo-back {
      background: transparent; border: none; cursor: pointer;
      color: #6b7280; font-size: 18px; line-height: 1;
      padding: 4px 8px; border-radius: 6px;
    }
    .pm-assist-convo-back:hover { background: #f3f4f6; color: #111827; }
    .pm-assist-convo-title {
      flex: 1; font-weight: 700; font-size: 13.5px; color: #111827;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    .pm-assist-messages {
      padding: 16px 20px; display: flex; flex-direction: column; gap: 12px;
    }
    .pm-assist-msg {
      max-width: 88%; padding: 11px 14px; border-radius: 14px;
      font-size: 13.5px; line-height: 1.5; letter-spacing: -0.003em;
      word-wrap: break-word; overflow-wrap: break-word;
    }
    .pm-assist-msg--bot {
      align-self: flex-start; background: #fff; color: #1f2937;
      border: 1px solid #e5e7eb;
      border-bottom-left-radius: 4px;
    }
    .pm-assist-msg--user {
      align-self: flex-end; background: #2563eb; color: #fff;
      border-bottom-right-radius: 4px;
    }
    .pm-assist-msg--system {
      align-self: center; background: #ecfdf5; color: #047857;
      border: 1px solid #d1fae5;
      font-size: 11.5px; padding: 6px 12px; border-radius: 9999px;
    }
    .pm-assist-msg--preview {
      align-self: flex-start; background: #fff; border: 1px solid #e5e7eb;
      border-radius: 12px; padding: 0; width: 100%; max-width: 100%;
      overflow: hidden;
      position: relative;
    }
    .pm-assist-msg--preview iframe {
      width: 100%; height: 480px; border: 0; display: block;
      background: #fff;
    }
    .pm-assist-msg__expand {
      position: absolute; bottom: 10px; right: 10px;
      background: rgba(15,23,42,0.85); color: #fff;
      padding: 6px 12px; border-radius: 8px; border: none;
      font: 600 11px Inter, sans-serif; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px;
      backdrop-filter: blur(6px);
      box-shadow: 0 4px 12px -2px rgba(15,23,42,0.45);
      transition: background .12s ease, transform .12s ease;
    }
    .pm-assist-msg__expand:hover { background: rgba(15,23,42,0.95); transform: translateY(-1px); }
    .pm-assist-msg__expand svg { width: 12px; height: 12px; }
    .pm-assist-msg--actions {
      align-self: flex-start; display: flex; flex-wrap: wrap; gap: 6px;
      background: transparent; padding: 0;
    }
    /* Phase 19c.12 polish — bot message with paired action buttons.
       Text on top, divider, buttons grouped below — all in one bubble
       so the user reads it as one Oracle question + options unit. */
    .pm-assist-msg--with-actions {
      padding: 0;
      overflow: hidden;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 2px rgba(15,23,42,0.04);
    }
    .pm-assist-msg--with-actions .pm-assist-msg__text {
      padding: 14px 16px 12px;
      color: #1f2937;
      line-height: 1.55;
    }
    .pm-assist-msg--with-actions .pm-assist-msg__actions-inline {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 10px 14px 14px;
      background: transparent;
      border-top: none;
    }
    /* Tighter, more refined button look inside the bubble */
    .pm-assist-msg--with-actions .pm-assist-action-btn {
      padding: 7px 13px;
      font: 600 12px Inter, sans-serif;
      letter-spacing: 0.005em;
      border-radius: 8px;
    }
    .pm-assist-msg--with-actions .pm-assist-action-btn--primary {
      background: #0f172a; border-color: #0f172a; color: #fff;
    }
    .pm-assist-msg--with-actions .pm-assist-action-btn--primary:hover {
      background: #1f2937; border-color: #1f2937;
    }
    .pm-assist-msg--with-actions .pm-assist-action-btn--ghost {
      background: #fff; border: 1px solid #cbd5e1; color: #475569;
    }
    .pm-assist-msg--with-actions .pm-assist-action-btn--ghost:hover {
      background: #f1f5f9; color: #0f172a; border-color: #94a3b8;
    }
    .pm-assist-action-btn {
      padding: 9px 14px; border-radius: 9px; border: 1px solid;
      font: 600 12px Inter, sans-serif; cursor: pointer; letter-spacing: -0.003em;
      transition: transform .1s ease, box-shadow .12s ease;
    }
    .pm-assist-action-btn:hover { transform: translateY(-1px); }
    .pm-assist-action-btn--primary {
      background: linear-gradient(180deg, #2563eb, #1d4ed8); color: #fff;
      border-color: transparent;
      box-shadow: 0 2px 6px -2px rgba(37,99,235,0.45);
    }
    .pm-assist-action-btn--ghost {
      background: #fff; color: #1f2937; border-color: #d1d5db;
    }
    .pm-assist-action-btn--ghost:hover { background: #f9fafb; }
    .pm-assist-action-btn:disabled { opacity: 0.5; cursor: wait; }
    /* Archived state — in-chat action buttons on closed threads.
       Visually neutralised so the user knows they're history, not action. */
    .pm-assist-action-btn.is-archived {
      opacity: 0.4;
      background: #f1f5f9 !important;
      color: #94a3b8 !important;
      border: 1px solid #e2e8f0 !important;
      cursor: default !important;
      text-decoration: line-through;
    }
    .pm-assist-action-btn.is-archived:hover { transform: none; background: #f1f5f9 !important; }

    /* Quick-action chips above the input — context-aware shortcuts */
    .pm-assist-quickchips {
      flex-shrink: 0;
      padding: 10px 20px 0 20px;
      background: #fff;
      display: flex; flex-wrap: wrap; gap: 6px;
      border-top: 1px solid #f1f5f9;
    }
    .pm-assist-quickchip {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 10px 18px;
      background: #16a34a; color: #fff;
      border: 1px solid #15803d;
      border-radius: 9999px;
      font: 700 13px Inter, sans-serif;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(22,163,74,0.25);
      transition: background .12s ease, transform .08s ease, box-shadow .12s ease;
    }
    .pm-assist-quickchip:hover {
      background: #15803d;
      box-shadow: 0 4px 12px rgba(22,163,74,0.35);
      transform: translateY(-1px);
    }
    .pm-assist-quickchip:active { transform: translateY(1px); box-shadow: 0 1px 3px rgba(22,163,74,0.25); }

    /* Input bar */
    .pm-assist-input {
      flex-shrink: 0; padding: 14px 20px;
      background: #fff; border-top: 1px solid #e5e7eb;
      display: flex; gap: 8px;
    }
    .pm-assist-input textarea {
      flex: 1; padding: 9px 14px; border: 1px solid #d1d5db;
      border-radius: 9px; font: 400 13px Inter, sans-serif; color: #1f2937;
      resize: none; min-height: 40px; max-height: 120px;
      transition: border-color .12s ease;
    }
    .pm-assist-input textarea:focus { outline: none; border-color: #2563eb; }
    .pm-assist-input button {
      padding: 0 16px; background: #2563eb; color: #fff;
      border: none; border-radius: 9px; font: 700 12px Inter, sans-serif;
      cursor: pointer; transition: background .12s ease;
    }
    .pm-assist-input button:hover { background: #1d4ed8; }
    .pm-assist-input button:disabled { background: #93c5fd; cursor: wait; }

    .pm-assist-toast {
      position: fixed; bottom: 96px; left: 50%; z-index: 10000;
      transform: translateX(-50%) translateY(20px); opacity: 0;
      background: #111827; color: #fff;
      padding: 10px 18px; border-radius: 9999px;
      font: 600 12px Inter, sans-serif;
      box-shadow: 0 8px 24px -6px rgba(15,23,42,0.45);
      pointer-events: none;
      transition: opacity .2s ease, transform .2s ease;
      user-select: text; -webkit-user-select: text;
    }
    .pm-assist-toast.is-shown { opacity: 1; transform: translateX(-50%) translateY(0); pointer-events: auto; }

    /* Error variant — copyable, stays much longer */
    .pm-assist-error-card {
      align-self: stretch; max-width: 100%;
      background: #fef2f2; border: 1px solid #fecaca;
      border-radius: 12px; padding: 14px 16px;
      color: #991b1b;
    }
    .pm-assist-error-card__title {
      font: 700 11px Inter, sans-serif; letter-spacing: 0.05em;
      text-transform: uppercase; margin-bottom: 6px;
    }
    .pm-assist-error-card__body {
      font: 500 12.5px ui-monospace, SFMono-Regular, Menlo, monospace;
      line-height: 1.5; user-select: text; -webkit-user-select: text;
      cursor: text; word-break: break-word; white-space: pre-wrap;
      background: rgba(255,255,255,0.6); padding: 8px 10px;
      border-radius: 6px; margin-bottom: 8px;
    }
    .pm-assist-error-card__copy {
      background: #fff; border: 1px solid #fca5a5; color: #991b1b;
      font: 600 11px Inter, sans-serif; padding: 5px 10px;
      border-radius: 6px; cursor: pointer;
      transition: background .1s ease;
    }
    .pm-assist-error-card__copy:hover { background: #fef2f2; }
    .pm-assist-error-card__copy.is-copied { background: #d1fae5; border-color: #6ee7b7; color: #065f46; }

    @media (max-width: 540px) {
      .pm-assist-panel { width: 100vw; }
      .pm-assist-fab { bottom: 18px; right: 18px; }
    }
    `;
    const styleEl = document.createElement('style');
    styleEl.id = 'pm-assist-style';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    const fab = document.createElement('button');
    fab.className = 'pm-assist-fab';
    fab.id = 'pmAssistFab';
    fab.title = 'Oracle — your bookkeeper';
    fab.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
      <span class="pm-assist-fab__badge" id="pmAssistBadge">0</span>
    `;
    document.body.appendChild(fab);

    const backdrop = document.createElement('div');
    backdrop.className = 'pm-assist-backdrop';
    backdrop.id = 'pmAssistBackdrop';
    document.body.appendChild(backdrop);

    const panel = document.createElement('aside');
    panel.className = 'pm-assist-panel';
    panel.id = 'pmAssistPanel';
    panel.setAttribute('aria-label', 'Oracle chat panel');
    panel.innerHTML = `
      <header class="pm-assist-head">
        <div class="pm-assist-head__title">
          <span class="pm-assist-head__title-dot"></span>
          Oracle
          <span style="font-weight:400;color:#9ca3af;font-size:11.5px;font-style:italic;margin-left:6px;">your bookkeeper</span>
        </div>
        <div class="pm-assist-head__actions">
          <button class="pm-assist-head__btn" id="pmAssistScan" title="Scan for new work now">Scan</button>
          <div class="pm-assist-head__menu-wrap">
            <button class="pm-assist-head__btn is-icon" id="pmAssistMoreBtn" aria-label="More" title="More">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
            </button>
            <div class="pm-assist-head__menu" id="pmAssistMore" hidden>
              <button class="pm-assist-head__menu-item" id="pmAssistResolvedToggle">Show resolved threads</button>
              <button class="pm-assist-head__menu-item" id="pmAssistEmail">Email me a digest now</button>
            </div>
          </div>
          <button class="pm-assist-head__btn is-icon" id="pmAssistClose" aria-label="Close" title="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </header>
      <div class="pm-assist-body" id="pmAssistBody"></div>
    `;
    document.body.appendChild(panel);

    const toast = document.createElement('div');
    toast.className = 'pm-assist-toast';
    toast.id = 'pmAssistToast';
    document.body.appendChild(toast);

    // ─── State + helpers ────────────────────────────────────────
    let currentThreadId = null;
    let threads = [];
    let pollHandle = null;
    let showResolved = false;  // Phase 19c.10a — toggle resolved threads in list

    function $(id) { return document.getElementById(id); }
    function toastMsg(msg) {
      const t = $('pmAssistToast');
      t.textContent = msg;
      t.classList.add('is-shown');
      setTimeout(() => t.classList.remove('is-shown'), 2400);
    }
    // Renders an error directly into the conversation as a copyable card.
    // Used for action failures so the user can copy the full message back.
    function showErrorInChat(title, errMsg) {
      const msgsEl = $('pmAssistMsgs');
      if (!msgsEl) { toastMsg(title + ': ' + errMsg); return; }
      const safe = esc(errMsg || 'unknown error');
      msgsEl.insertAdjacentHTML('beforeend', `
        <div class="pm-assist-error-card">
          <div class="pm-assist-error-card__title">⚠ ${esc(title)}</div>
          <div class="pm-assist-error-card__body" data-err-body>${safe}</div>
          <button class="pm-assist-error-card__copy" data-err-copy>Copy error</button>
        </div>
      `);
      const card = msgsEl.lastElementChild;
      const btn = card.querySelector('[data-err-copy]');
      const body = card.querySelector('[data-err-body]');
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(body.innerText);
          btn.textContent = 'Copied ✓';
          btn.classList.add('is-copied');
          setTimeout(() => { btn.textContent = 'Copy error'; btn.classList.remove('is-copied'); }, 2000);
        } catch (_) {
          // Fallback: select the text so the user can Cmd-C manually
          const range = document.createRange();
          range.selectNodeContents(body);
          const sel = window.getSelection();
          sel.removeAllRanges(); sel.addRange(range);
        }
      });
      $('pmAssistBody').scrollTop = $('pmAssistBody').scrollHeight;
    }
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    }
    function timeAgo(iso) {
      if (!iso) return '';
      const ms = Date.now() - new Date(iso).getTime();
      const s = Math.round(ms / 1000);
      if (s < 60) return 'just now';
      const m = Math.round(s / 60); if (m < 60) return m + 'm ago';
      const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
      const d = Math.round(h / 24); return d + 'd ago';
    }

    // ─── Panel open/close ───────────────────────────────────────
    function openPanel() {
      panel.classList.add('is-shown');
      backdrop.classList.add('is-shown');
      loadThreads();
      if (!pollHandle) pollHandle = setInterval(loadThreads, 60_000);
    }
    function closePanel() {
      panel.classList.remove('is-shown');
      backdrop.classList.remove('is-shown');
      if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
      currentThreadId = null;
    }
    fab.addEventListener('click', () => panel.classList.contains('is-shown') ? closePanel() : openPanel());
    backdrop.addEventListener('click', closePanel);
    $('pmAssistClose').addEventListener('click', closePanel);
    $('pmAssistEmail').addEventListener('click', async () => {
      const btn = $('pmAssistEmail');
      const originalLabel = btn.textContent;
      $('pmAssistMore').hidden = true;  // close menu immediately
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const r = await window.pmHiring.oracleNotifyNow();
        if (r?.skipped) {
          toastMsg('No open threads to send');
        } else if (r?.ok) {
          toastMsg(`📧 Sent to ${r.sent_to || 'your inbox'}`);
        } else {
          toastMsg('Send failed: ' + (r?.error || 'unknown'));
        }
      } catch (e) {
        toastMsg('Send failed: ' + e.message);
      } finally {
        btn.disabled = false; btn.textContent = originalLabel;
      }
    });

    // Phase 19c.12 polish — overflow menu wire-up. Closes on outside click.
    $('pmAssistMoreBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const menu = $('pmAssistMore');
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', (e) => {
      const menu = $('pmAssistMore');
      const btn  = $('pmAssistMoreBtn');
      if (menu && !menu.hidden && !menu.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
        menu.hidden = true;
      }
    });

    // Phase 19c.10a — toggle resolved threads in the list view.
    $('pmAssistResolvedToggle').addEventListener('click', async () => {
      const btn = $('pmAssistResolvedToggle');
      showResolved = !showResolved;
      btn.textContent = showResolved ? 'Hide resolved threads' : 'Show resolved threads';
      $('pmAssistMore').hidden = true;
      await loadThreads();
    });

    $('pmAssistScan').addEventListener('click', async () => {
      const btn = $('pmAssistScan');
      btn.disabled = true; btn.textContent = 'Scanning…';
      try {
        const result = await window.pmHiring.assistantScanNow();
        const created = result?.total_threads_created || 0;
        toastMsg(created > 0 ? `${created} new thread${created === 1 ? '' : 's'}` : 'No new work');
        await loadThreads();

        // Phase 19c.8c — fire an Oracle digest email so Caleb gets an
        // inbox notification with deep-links into each thread.
        // Best-effort: never let an email failure break the Scan flow.
        if (created > 0) {
          try {
            const result2 = await window.pmHiring.oracleNotifyNow();
            if (result2?.ok) toastMsg('📧 Digest sent to your inbox');
          } catch (_) { /* silent — email is a bonus, not required */ }
        }
      } catch (e) {
        toastMsg('Scan failed: ' + e.message);
      } finally {
        btn.disabled = false; btn.textContent = 'Scan';
      }
    });

    // ─── Phase 19c.8c — deep-link handler ────────────────────────
    // Open the drawer + jump straight into a specific thread when the
    // page URL has ?oracle_thread=<id> (used by Oracle's digest email's
    // "Open in chat →" buttons).
    (function handleDeepLink() {
      try {
        const params = new URLSearchParams(window.location.search);
        const threadId = params.get('oracle_thread');
        if (!threadId) return;

        // Wait briefly so the rest of the page (sidebar, auth) settles
        setTimeout(async () => {
          openPanel();
          // Make sure the thread list is fresh, then open this one
          try {
            await loadThreads();
            await openThread(threadId);
            // Clean the URL so reloads don't keep re-opening the same thread
            const url = new URL(window.location.href);
            url.searchParams.delete('oracle_thread');
            window.history.replaceState({}, '', url.toString());
          } catch (e) {
            console.warn('[oracle deep-link]', e);
          }
        }, 400);
      } catch (_) {}
    })();

    // ─── Badge updater (runs in background) ─────────────────────
    async function refreshBadge() {
      try {
        const list = await window.pmHiring.assistantListThreads();
        const unread = list.filter(t => t.unread).length;
        const badge = $('pmAssistBadge');
        if (unread > 0) {
          badge.textContent = unread > 99 ? '99+' : unread;
          badge.classList.add('is-shown');
        } else {
          badge.classList.remove('is-shown');
        }
      } catch (_) {}
    }
    refreshBadge();
    setInterval(refreshBadge, 60_000);

    // ─── Thread list view ──────────────────────────────────────
    async function loadThreads() {
      try {
        threads = await window.pmHiring.assistantListThreads({ includeResolved: showResolved });
      } catch (e) {
        $('pmAssistBody').innerHTML = `<div class="pm-assist-empty">Couldn't load threads.<br/><small>${esc(e.message)}</small></div>`;
        return;
      }
      renderThreadList();
      refreshBadge();
    }
    function renderThreadList() {
      currentThreadId = null;
      const body = $('pmAssistBody');
      // Split into active + history so resolved threads sit BELOW a clear
      // divider, never interleaved with the work-to-do list.
      const isClosedThread = (t) => ['resolved', 'dismissed'].includes(t.status);
      const activeThreads  = threads.filter(t => !isClosedThread(t));
      const historyThreads = threads.filter(t =>  isClosedThread(t));

      if (!activeThreads.length && !historyThreads.length) {
        body.innerHTML = `<div class="pm-assist-empty">
          <strong>All clear.</strong>
          No threads need your attention right now.
          <div class="pm-assist-empty__sub">Click <em>Scan</em> above to check for new work.</div>
        </div>`;
        return;
      }

      const renderRow = (t) => {
        const isClosed = isClosedThread(t);
        const statusBadge = isClosed
          ? `<span class="pm-assist-thread__badge">${t.status === 'dismissed' ? 'Dismissed' : 'Resolved'}</span>`
          : '';
        return `
        <div class="pm-assist-thread ${isClosed ? 'is-closed' : ''}" data-tid="${esc(t.id)}">
          <div class="pm-assist-thread__top">
            <span class="pm-assist-thread__icon">${esc(t.scenario_icon || '💬')}</span>
            <span class="pm-assist-thread__title">${esc(t.title)}</span>
            ${statusBadge}
            <span class="pm-assist-thread__pip ${t.unread ? '' : 'is-hidden'}"></span>
          </div>
          ${t.subtitle ? `<div class="pm-assist-thread__sub">${esc(t.subtitle)}</div>` : ''}
          <div class="pm-assist-thread__time">${esc(timeAgo(t.last_message_at || t.updated_at))}</div>
        </div>`;
      };

      let html = '';
      if (activeThreads.length) {
        html += activeThreads.map(renderRow).join('');
      } else if (showResolved && historyThreads.length) {
        html += `<div class="pm-assist-empty" style="padding:30px 20px;">
          <strong>All caught up.</strong>
          <div class="pm-assist-empty__sub">No active threads. History below.</div>
        </div>`;
      }
      if (historyThreads.length) {
        html += `<div class="pm-assist-section-divider">
          <span>History · ${historyThreads.length}</span>
        </div>`;
        html += historyThreads.map(renderRow).join('');
      }
      body.innerHTML = html;
      body.querySelectorAll('[data-tid]').forEach(el => {
        el.addEventListener('click', () => openThread(el.dataset.tid));
      });
    }

    // ─── Conversation view ─────────────────────────────────────
    async function openThread(threadId) {
      currentThreadId = threadId;
      const thread = threads.find(t => t.id === threadId);

      // Build the "mark paid" quick-chip if the thread is invoice-scoped.
      // Parses the dollar amount from subtitle ("$1,200.00 from …") so we
      // can show the user exactly how much they'd be marking paid. The
      // server-side action uses the LIVE balance from invoices, so this
      // display is for visual confirmation only — accurate to detect-time.
      // Extract just the INV-XXX number from the title for the confirm
      // dialog so it reads "Mark INV-YAN-019 paid…" instead of the awkward
      // "Mark Send INV-YAN-019 to Daniel Yang paid…"
      let quickChips = '';
      if (thread?.invoice_id) {
        const m = (thread.subtitle || '').match(/\$[\d,]+\.\d{2}/);
        const amt = m ? m[0] : '';
        const invMatch = (thread.title || '').match(/INV-[A-Z]{1,8}-\d{1,5}/i);
        const invLabel = invMatch ? invMatch[0] : 'this invoice';
        quickChips = `
          <div class="pm-assist-quickchips" id="pmAssistQuickChips">
            <button class="pm-assist-quickchip" data-quickaction="mark_paid_full"
                    data-confirm-amt="${esc(amt)}"
                    data-confirm-inv="${esc(invLabel)}">
              💵 Mark paid in full${amt ? ' (' + amt + ')' : ''}
            </button>
          </div>`;
      }

      const body = $('pmAssistBody');
      body.innerHTML = `
        <div class="pm-assist-convo-head">
          <button class="pm-assist-convo-back" title="Back">←</button>
          <div class="pm-assist-convo-title">${esc((thread?.scenario_icon || '💬') + '  ' + (thread?.title || ''))}</div>
        </div>
        <div class="pm-assist-messages" id="pmAssistMsgs"><div class="pm-assist-empty" style="padding:40px 20px;">Loading…</div></div>
        ${quickChips}
        <div class="pm-assist-input">
          <textarea id="pmAssistInputText" rows="1" placeholder="Reply to assistant…"></textarea>
          <button id="pmAssistInputSend">Send</button>
        </div>
      `;
      body.querySelector('.pm-assist-convo-back').addEventListener('click', () => { loadThreads(); });
      $('pmAssistInputSend').addEventListener('click', sendUserMessage);
      $('pmAssistInputText').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUserMessage(); }
      });

      // Wire quick-chips with a confirm dialog so a stray tap doesn't
      // accidentally mark something paid.
      body.querySelectorAll('[data-quickaction]').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.quickaction;
          const amt = btn.dataset.confirmAmt || '';
          const inv = btn.dataset.confirmInv || 'this invoice';
          if (action === 'mark_paid_full') {
            const msg = amt
              ? `Mark ${inv} paid in full for ${amt}?`
              : `Mark ${inv} paid in full?`;
            if (!confirm(msg)) return;
          }
          handleAction(threadId, action);
        });
      });

      await renderMessages(threadId);
    }

    async function renderMessages(threadId) {
      const msgsEl = $('pmAssistMsgs');
      let msgs = [];
      try {
        msgs = await window.pmHiring.assistantThreadMessages(threadId);
      } catch (e) {
        msgsEl.innerHTML = `<div class="pm-assist-empty" style="padding:40px 20px;color:#dc2626;">${esc(e.message)}</div>`;
        return;
      }
      // Phase 19c.12 polish — pair each bot text message with the
      // immediately-following actions message into a single visual bubble.
      // The actions ARE part of Oracle's question; they shouldn't float
      // separately from the message that asks them.
      const grouped = [];
      msgs.forEach(m => {
        if (m.content_type === 'actions' && grouped.length > 0) {
          const prev = grouped[grouped.length - 1];
          if (prev.role === 'bot' && prev.content_type === 'text' && !prev._actions) {
            prev._actions = m.metadata?.actions || [];
            return;
          }
        }
        grouped.push({ ...m });
      });
      msgsEl.innerHTML = grouped.map(m => renderOneMessage(m)).join('');

      // Phase 19c.12 polish — if the thread is closed (resolved/dismissed),
      // disable all in-chat action buttons. They served their purpose
      // when the thread was live; now they're history. The persistent
      // chip above the input is the only path for further action (e.g.
      // mark-paid on a resolved 'send invoice' thread).
      const thread = threads.find(t => t.id === threadId);
      const isClosed = thread && ['resolved', 'dismissed'].includes(thread.status);
      if (isClosed) {
        msgsEl.querySelectorAll('[data-action]').forEach(btn => {
          btn.disabled = true;
          btn.classList.add('is-archived');
          btn.title = 'Past action — thread is ' + thread.status;
        });
      } else {
        // Live thread — wire action buttons as normal
        msgsEl.querySelectorAll('[data-action]').forEach(btn => {
          btn.addEventListener('click', () => handleAction(threadId, btn.dataset.action));
        });
      }

      // Scroll to bottom
      msgsEl.scrollIntoView({ block: 'end', behavior: 'instant' });
      const body = $('pmAssistBody');
      body.scrollTop = body.scrollHeight;
    }

    function renderOneMessage(m) {
      // Standalone actions message — only happens if it WASN'T paired with
      // a preceding bot text in the grouping step. Rare but keep handler
      // for backward compatibility.
      if (m.content_type === 'actions') {
        const actions = m.metadata?.actions || [];
        return `<div class="pm-assist-msg pm-assist-msg--actions">${
          actions.map(a => `<button class="pm-assist-action-btn pm-assist-action-btn--${esc(a.style || 'ghost')}" data-action="${esc(a.key)}">${esc(a.label)}</button>`).join('')
        }</div>`;
      }
      if (m.content_type === 'event') {
        return `<div class="pm-assist-msg pm-assist-msg--system">${esc(m.content || '')}</div>`;
      }
      if (m.content_type === 'preview' && m.metadata?.preview_url) {
        return `<div class="pm-assist-msg pm-assist-msg--preview">
          <iframe src="${esc(m.metadata.preview_url)}#toolbar=0&navpanes=0" title="Preview"></iframe>
        </div>`;
      }
      const cls = m.role === 'user' ? 'pm-assist-msg--user' : 'pm-assist-msg--bot';
      // Phase 19c.12 polish — bot text + paired actions render as one
      // bubble (text on top, divider, buttons grouped at the bottom).
      // Reads as a single Oracle "question + options" unit.
      if (m._actions && m._actions.length) {
        const actionsHtml = m._actions.map(a =>
          `<button class="pm-assist-action-btn pm-assist-action-btn--${esc(a.style || 'ghost')}" data-action="${esc(a.key)}">${esc(a.label)}</button>`
        ).join('');
        return `<div class="pm-assist-msg ${cls} pm-assist-msg--with-actions">
          <div class="pm-assist-msg__text">${esc(m.content || '')}</div>
          <div class="pm-assist-msg__actions-inline">${actionsHtml}</div>
        </div>`;
      }
      return `<div class="pm-assist-msg ${cls}">${esc(m.content || '')}</div>`;
    }

    async function sendUserMessage() {
      const input = $('pmAssistInputText');
      const text = (input.value || '').trim();
      if (!text || !currentThreadId) return;
      input.value = '';
      try {
        await window.pmHiring.assistantPostMessage(currentThreadId, text);
        await renderMessages(currentThreadId);
      } catch (e) {
        toastMsg('Send failed: ' + e.message);
      }
    }

    // ─── Action handler (Send, Preview, Snooze, Resolve, etc.) ──
    async function handleAction(threadId, actionKey) {
      const thread = threads.find(t => t.id === threadId);
      if (!thread) return;

      // ─── send_now / send_reminder / send_followup / preview_pdf:
      //     client-side PDF render + email send via existing pipeline.
      //     Subject prefix and post-send action key vary by intent.
      const EMAIL_ACTIONS = ['send_now', 'send_reminder', 'send_followup'];
      const isEmailAction = EMAIL_ACTIONS.includes(actionKey);

      if (isEmailAction || actionKey === 'preview_pdf') {
        if (!thread.invoice_id) {
          toastMsg('No invoice linked');
          return;
        }
        try {
          // Lazy-load the PDF + email machinery only when needed
          await ensureFinancialPipelineLoaded();
          const out = await window.pmPDF.buildDoc({ docType: 'invoice', docId: thread.invoice_id });

          if (actionKey === 'preview_pdf') {
            // Render an inline preview message in the chat + an Expand button
            // that opens the PDF in a new browser tab (full size, zoomable).
            const blobUrl = URL.createObjectURL(out.blob);
            const msgsEl = $('pmAssistMsgs');
            msgsEl.insertAdjacentHTML('beforeend', `
              <div class="pm-assist-msg pm-assist-msg--preview">
                <iframe src="${blobUrl}#toolbar=0&navpanes=0" title="Invoice preview"></iframe>
                <button class="pm-assist-msg__expand" data-expand-url="${blobUrl}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                  Expand
                </button>
              </div>
            `);
            // Wire the expand button
            msgsEl.querySelectorAll('[data-expand-url]').forEach(b => {
              if (b.dataset.wired) return;
              b.dataset.wired = '1';
              b.addEventListener('click', () => window.open(b.dataset.expandUrl, '_blank', 'noopener'));
            });
            $('pmAssistBody').scrollTop = $('pmAssistBody').scrollHeight;
            return;
          }

          // Email it. Subject + body vary by action key — same PDF pipeline.
          const pdfBase64 = await blobToBase64(out.blob);
          const p = out.payload || {};
          const client = p.clients || {};
          const primary = client.email || '';
          const secondary = client.billing_email_secondary || '';
          const to = [primary, secondary].filter(Boolean).join(', ');
          if (!to) {
            toastMsg('No email on file for this client');
            return;
          }
          const docNumber = p.invoice_number;
          let subject, body;
          if (actionKey === 'send_reminder') {
            subject = `Past due: Invoice ${docNumber}`;
            body = 'A quick reminder that the attached invoice is past due. Please let us know if there\'s anything we can help clarify.';
          } else if (actionKey === 'send_followup') {
            subject = `Following up: Invoice ${docNumber}`;
            body = 'Just following up on the attached invoice. Let us know if you have any questions.';
          } else {
            subject = `Invoice ${docNumber} from Private Mentorship`;
            body = 'Please find your invoice attached as a PDF for your records.';
          }
          const meta = {
            totalCents:   Number(p.total_cents) || 0,
            paidCents:    Number(p.amount_paid_cents) || 0,
            balanceCents: Number(p.balance_due_cents) || 0,
            docDate:      p.invoice_date || null,
            dueDate:      p.due_date || null,
            clientName:   client.full_name || null,
            guardianName: client.billing_contact_name || null,
            studentName:  client.full_name || null,
            billingAddress:        client.billing_address || null,
            billingPhone:          client.phone || null,
            billingEmail:          client.email || null,
            billingEmailSecondary: client.billing_email_secondary || null,
            customerNotes: p.customer_notes || null,
            currency:     (p.currency || 'CAD').toUpperCase(),
          };
          await window.pmHiring.sendFinancialEmail({
            docType: 'invoice', docId: thread.invoice_id, docNumber,
            to, subject, body, filename: out.filename,
            pdfBase64, meta,
          });
          // Server action key matches the intent → resolves with the right
          // event message ("Reminder email sent ✓" etc.)
          const serverActionKey = isEmailAction ? actionKey : 'mark_email_sent';
          await window.pmHiring.assistantAction(threadId, serverActionKey,
            { event_text: 'Email sent to ' + to + ' ✓', to_emails: to });
          toastMsg(actionKey === 'send_reminder' ? 'Reminder sent ✓'
                 : actionKey === 'send_followup' ? 'Follow-up sent ✓'
                 : 'Sent ✓');
          await loadThreads();
        } catch (e) {
          console.error('[oracle send]', e);
          showErrorInChat('Send failed', (e?.message || String(e)) + (e?.details ? '\n\n' + e.details : ''));
        }
        return;
      }

      // Server-side actions: snooze, resolve, dismiss, reopen,
      // activate_contract, mark_paid_full, create_renewal_invoice
      try {
        const actionResult = await window.pmHiring.assistantAction(threadId, actionKey);
        toastMsg(actionKey === 'resolve' ? 'Marked handled ✓' :
                 actionKey.startsWith('snooze') ? 'Snoozed' :
                 actionKey === 'activate_contract' ? 'Contract activated ✓' :
                 actionKey === 'mark_paid_full' ? 'Marked paid ✓' :
                 actionKey === 'create_renewal_invoice' ? 'Renewal invoice created ✓' :
                 'Done');

        // Phase 19c.10a + preview — after mark_paid_full succeeds, build the
        // receipt PDF and show a preview in the chat with Send / Skip buttons.
        // Caleb wanted to confirm exactly what the family receives before
        // it goes out. Payment itself is already recorded server-side, so
        // skipping the receipt is a safe escape hatch.
        if (actionKey === 'mark_paid_full' && actionResult?.receipt_id) {
          previewReceiptThenSend(actionResult.receipt_id, threadId).catch(err => {
            console.warn('[oracle receipt preview]', err);
            showErrorInChat('Receipt preview failed (payment still recorded)',
              (err?.message || String(err)));
          });
        }

        // Phase 19c.12 #7 — broadcast a payment event so any open page
        // (admin-financials KPI counts, per-client payment history widget,
        // etc.) can refresh itself without a page reload. Pages listen via
        //   window.addEventListener('pm-payment-recorded', handler)
        if (actionKey === 'mark_paid_full' && actionResult?.invoice_id) {
          try {
            window.dispatchEvent(new CustomEvent('pm-payment-recorded', {
              detail: {
                invoice_id: actionResult.invoice_id,
                receipt_id: actionResult.receipt_id,
                client_id:  actionResult.client_id,
              },
            }));
          } catch (_) { /* CustomEvent missing somehow — harmless */ }
        }

        // These actions close the thread → bounce back to list
        if (['resolve', 'dismiss', 'activate_contract', 'mark_paid_full',
             'create_renewal_invoice'].includes(actionKey)
            || actionKey.startsWith('snooze')) {
          await loadThreads();
        } else {
          await renderMessages(threadId);
        }
      } catch (e) {
        console.error('[oracle action]', actionKey, e);
        // Show as copyable card in the chat so user can paste the
        // exact SQL error back for debugging
        showErrorInChat(
          'Action "' + actionKey + '" failed',
          (e?.message || String(e)) + (e?.details ? '\n\n' + e.details : '')
        );
      }
    }

    // ─── Receipt preview-and-confirm flow ───────────────────────
    // After mark_paid_full succeeds, build the receipt PDF and inject an
    // inline preview card in the chat with [Send] / [Skip] buttons. Send
    // fires fireReceiptEmail. Skip leaves the payment recorded but doesn't
    // email (Caleb can re-send later from admin-financials → Receipts).
    async function previewReceiptThenSend(receiptId, threadId) {
      if (!receiptId) return;
      await ensureFinancialPipelineLoaded();
      const out = await window.pmPDF.buildDoc({ docType: 'receipt', docId: receiptId });
      const p = out.payload || {};
      const client = p.clients || {};
      const primary = client.email || '';
      const secondary = client.billing_email_secondary || '';
      const to = [primary, secondary].filter(Boolean).join(', ');
      if (!to) {
        showErrorInChat('Receipt built but no email on file',
          'Payment was recorded. To email the receipt later, add an email to the client and re-send from admin-financials → Receipts.');
        return;
      }

      // Inject preview card into the open thread (if still open) or
      // somewhere visible on the page.
      const blobUrl = URL.createObjectURL(out.blob);
      const previewId = 'pmReceiptPreview-' + Date.now();
      const recipientHtml = to.split(', ').map(e => `<code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:11px;">${e}</code>`).join(' ');
      const msgsEl = document.getElementById('pmAssistMsgs');
      const previewHtml = `
        <div class="pm-assist-msg pm-assist-msg--preview" id="${previewId}" style="background:#fffbeb;border:1px solid #fde68a;padding:12px;border-radius:10px;">
          <div style="font:600 12px Inter,sans-serif;color:#92400e;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;">
            📄 Receipt preview — confirm before sending
          </div>
          <div style="font:400 12.5px Inter,sans-serif;color:#475569;margin-bottom:10px;">
            Will send to: ${recipientHtml}
          </div>
          <iframe src="${blobUrl}#toolbar=0&navpanes=0" title="Receipt preview" style="width:100%;height:300px;border:1px solid #e5e7eb;border-radius:6px;background:#fff;"></iframe>
          <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end;">
            <button class="pm-assist-action-btn pm-assist-action-btn--ghost" data-receipt-action="skip" data-preview-id="${previewId}">Skip — don't email</button>
            <button class="pm-assist-action-btn pm-assist-action-btn--ghost" data-receipt-action="open" data-preview-url="${blobUrl}">Open in tab</button>
            <button class="pm-assist-action-btn pm-assist-action-btn--primary" data-receipt-action="send" data-preview-id="${previewId}" data-receipt-id="${receiptId}">Send receipt</button>
          </div>
        </div>`;
      if (msgsEl) {
        msgsEl.insertAdjacentHTML('beforeend', previewHtml);
        const bodyEl = document.getElementById('pmAssistBody');
        if (bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
      } else {
        // Drawer's closed — pop the preview in a new tab as a fallback
        window.open(blobUrl, '_blank', 'noopener');
        toastMsg('Open Oracle drawer to confirm + send receipt');
        return;
      }

      // Wire the buttons
      const previewCard = document.getElementById(previewId);
      previewCard?.querySelector('[data-receipt-action="open"]')?.addEventListener('click', (e) => {
        const url = e.currentTarget.dataset.previewUrl;
        if (url) window.open(url, '_blank', 'noopener');
      });
      previewCard?.querySelector('[data-receipt-action="skip"]')?.addEventListener('click', () => {
        previewCard.innerHTML = `<div style="font:400 12px Inter,sans-serif;color:#64748b;">
          Receipt not emailed. Payment is still recorded. To send later, go to admin-financials → Receipts.
        </div>`;
        previewCard.style.background = '#f8fafc';
        previewCard.style.borderColor = '#e2e8f0';
      });
      previewCard?.querySelector('[data-receipt-action="send"]')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = 'Sending…';
        try {
          await fireReceiptEmail(receiptId);
          previewCard.innerHTML = `<div style="font:600 12.5px Inter,sans-serif;color:#166534;">
            ✓ Receipt emailed to ${recipientHtml}
          </div>`;
          previewCard.style.background = '#f0fdf4';
          previewCard.style.borderColor = '#bbf7d0';
        } catch (err) {
          btn.disabled = false; btn.textContent = 'Send receipt';
          showErrorInChat('Receipt email failed', err?.message || String(err));
        }
      });
    }

    // ─── Auto-receipt email (Phase 19c.10a) ─────────────────────
    // Now called by previewReceiptThenSend after user confirms in the preview.
    // Builds the receipt PDF and emails it via the existing send-financial-email
    // pipeline. Same body + meta shape as a manually-sent receipt.
    async function fireReceiptEmail(receiptId) {
      if (!receiptId) return;
      await ensureFinancialPipelineLoaded();
      const out = await window.pmPDF.buildDoc({ docType: 'receipt', docId: receiptId });
      const p = out.payload || {};
      const client = p.clients || {};
      const primary = client.email || '';
      const secondary = client.billing_email_secondary || '';
      const to = [primary, secondary].filter(Boolean).join(', ');
      if (!to) {
        showErrorInChat('Receipt not sent', 'No email on file for this client');
        return;
      }
      const recNumber = p.receipt_number || 'receipt';
      const invNumber = p.invoices?.invoice_number || '';
      const subject = `Payment received — ${recNumber}${invNumber ? ' (' + invNumber + ')' : ''}`;
      const body = 'Thank you — payment received. Your official receipt is attached as a PDF for your records.';
      const meta = {
        totalCents:   Math.round((Number(p.total_amount) || 0) * 100),
        clientName:   client.full_name || null,
        guardianName: client.billing_contact_name || null,
        studentName:  client.full_name || null,
        billingAddress:        client.billing_address || null,
        billingPhone:          client.phone || null,
        billingEmail:          client.email || null,
        billingEmailSecondary: client.billing_email_secondary || null,
        currency:     'CAD',
      };
      const pdfBase64 = await blobToBase64(out.blob);
      await window.pmHiring.sendFinancialEmail({
        docType: 'receipt', docId: receiptId, docNumber: recNumber,
        to, subject, body, filename: out.filename,
        pdfBase64, meta,
      });
      // Toast removed — previewReceiptThenSend renders the green success
      // card inline. Showing both would be redundant noise.
    }

    // ─── Helpers: lazy-load PDF machinery + blob→base64 ─────────
    function ensureFinancialPipelineLoaded() {
      // financial-pdf.js + financial-pdf-templates.js are already loaded on
      // admin-financials.html. On other admin pages we need to load them.
      if (window.pmPDF && window.pmPDFTemplates) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const loadScript = (src) => new Promise((res, rej) => {
          if (document.querySelector(`script[src="${src}"]`)) return res();
          const s = document.createElement('script');
          s.src = src; s.async = false;
          s.onload = res; s.onerror = () => rej(new Error('Failed to load ' + src));
          document.head.appendChild(s);
        });
        loadScript('js/financial-pdf-templates.js?v=20260517k')
          .then(() => loadScript('js/financial-pdf.js?v=20260517j'))
          .then(resolve).catch(reject);
      });
    }
    function blobToBase64(blob) {
      return new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result).split(',')[1] || '');
        fr.onerror = () => rej(fr.error);
        fr.readAsDataURL(blob);
      });
    }
  }
})();
