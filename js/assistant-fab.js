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
    }
    .pm-assist-msg--preview iframe {
      width: 100%; height: 480px; border: 0; display: block;
      background: #fff;
    }
    .pm-assist-msg--actions {
      align-self: flex-start; display: flex; flex-wrap: wrap; gap: 6px;
      background: transparent; padding: 0;
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
    }
    .pm-assist-toast.is-shown { opacity: 1; transform: translateX(-50%) translateY(0); }

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
    fab.title = 'PM Assistant';
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
    panel.setAttribute('aria-label', 'PM Assistant chat panel');
    panel.innerHTML = `
      <header class="pm-assist-head">
        <div class="pm-assist-head__title">
          <span class="pm-assist-head__title-dot"></span>
          PM Assistant
        </div>
        <div class="pm-assist-head__actions">
          <button class="pm-assist-head__btn" id="pmAssistScan" title="Scan for new work now">Scan</button>
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

    function $(id) { return document.getElementById(id); }
    function toastMsg(msg) {
      const t = $('pmAssistToast');
      t.textContent = msg;
      t.classList.add('is-shown');
      setTimeout(() => t.classList.remove('is-shown'), 2400);
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
    $('pmAssistScan').addEventListener('click', async () => {
      const btn = $('pmAssistScan');
      btn.disabled = true; btn.textContent = 'Scanning…';
      try {
        const result = await window.pmHiring.assistantScanNow();
        const created = result?.total_threads_created || 0;
        toastMsg(created > 0 ? `${created} new thread${created === 1 ? '' : 's'}` : 'No new work');
        await loadThreads();
      } catch (e) {
        toastMsg('Scan failed: ' + e.message);
      } finally {
        btn.disabled = false; btn.textContent = 'Scan';
      }
    });

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
        threads = await window.pmHiring.assistantListThreads();
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
      if (!threads.length) {
        body.innerHTML = `<div class="pm-assist-empty">
          <strong>All clear.</strong>
          No threads need your attention right now.
          <div class="pm-assist-empty__sub">Click <em>Scan</em> above to check for new work.</div>
        </div>`;
        return;
      }
      body.innerHTML = threads.map(t => `
        <div class="pm-assist-thread" data-tid="${esc(t.id)}">
          <div class="pm-assist-thread__top">
            <span class="pm-assist-thread__icon">${esc(t.scenario_icon || '💬')}</span>
            <span class="pm-assist-thread__title">${esc(t.title)}</span>
            <span class="pm-assist-thread__pip ${t.unread ? '' : 'is-hidden'}"></span>
          </div>
          ${t.subtitle ? `<div class="pm-assist-thread__sub">${esc(t.subtitle)}</div>` : ''}
          <div class="pm-assist-thread__time">${esc(timeAgo(t.last_message_at || t.updated_at))}</div>
        </div>
      `).join('');
      body.querySelectorAll('[data-tid]').forEach(el => {
        el.addEventListener('click', () => openThread(el.dataset.tid));
      });
    }

    // ─── Conversation view ─────────────────────────────────────
    async function openThread(threadId) {
      currentThreadId = threadId;
      const thread = threads.find(t => t.id === threadId);
      const body = $('pmAssistBody');
      body.innerHTML = `
        <div class="pm-assist-convo-head">
          <button class="pm-assist-convo-back" title="Back">←</button>
          <div class="pm-assist-convo-title">${esc((thread?.scenario_icon || '💬') + '  ' + (thread?.title || ''))}</div>
        </div>
        <div class="pm-assist-messages" id="pmAssistMsgs"><div class="pm-assist-empty" style="padding:40px 20px;">Loading…</div></div>
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
      msgsEl.innerHTML = msgs.map(m => renderOneMessage(m)).join('');

      // Wire action buttons
      msgsEl.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => handleAction(threadId, btn.dataset.action));
      });

      // Scroll to bottom
      msgsEl.scrollIntoView({ block: 'end', behavior: 'instant' });
      const body = $('pmAssistBody');
      body.scrollTop = body.scrollHeight;
    }

    function renderOneMessage(m) {
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

      // ─── send_now: client-side PDF render + email send via existing pipeline
      if (actionKey === 'send_now' || actionKey === 'preview_pdf') {
        if (!thread.invoice_id) {
          toastMsg('No invoice linked');
          return;
        }
        try {
          // Lazy-load the PDF + email machinery only when needed
          await ensureFinancialPipelineLoaded();
          const out = await window.pmPDF.buildDoc({ docType: 'invoice', docId: thread.invoice_id });

          if (actionKey === 'preview_pdf') {
            // Render an inline preview message in the chat
            const blobUrl = URL.createObjectURL(out.blob);
            const msgsEl = $('pmAssistMsgs');
            msgsEl.insertAdjacentHTML('beforeend', `
              <div class="pm-assist-msg pm-assist-msg--preview">
                <iframe src="${blobUrl}#toolbar=0&navpanes=0" title="Invoice preview"></iframe>
              </div>
            `);
            $('pmAssistBody').scrollTop = $('pmAssistBody').scrollHeight;
            return;
          }

          // send_now → email it
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
          const subject = `Invoice ${docNumber} from Private Mentorship`;
          const body = 'Please find your invoice attached as a PDF for your records.';
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
          await window.pmHiring.assistantAction(threadId, 'mark_email_sent',
            { event_text: 'Email sent to ' + to + ' ✓', to_emails: to });
          toastMsg('Sent ✓');
          await loadThreads();
        } catch (e) {
          console.error(e);
          toastMsg('Send failed: ' + (e.message || 'unknown'));
        }
        return;
      }

      // Server-side actions: snooze, resolve, dismiss, reopen
      try {
        await window.pmHiring.assistantAction(threadId, actionKey);
        toastMsg(actionKey === 'resolve' ? 'Marked handled ✓' :
                 actionKey.startsWith('snooze') ? 'Snoozed' :
                 'Done');
        if (actionKey === 'resolve' || actionKey === 'dismiss' || actionKey.startsWith('snooze')) {
          await loadThreads();  // bounce back to list
        } else {
          await renderMessages(threadId);
        }
      } catch (e) {
        toastMsg('Action failed: ' + e.message);
      }
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
        loadScript('js/financial-pdf-templates.js?v=20260517b')
          .then(() => loadScript('js/financial-pdf.js?v=20260517a'))
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
