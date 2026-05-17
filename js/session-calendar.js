// =============================================================
// Phase 17 — Session calendar widget
// =============================================================
// Premium month-grid calendar for showing sessions. Designed to be
// dropped onto multiple pages with one mount call. Two scopes:
//
//   • Single family  — pass `clientId: '<uuid>'`, used on
//     assistant-client.html. Shows that family's sessions only.
//
//   • All families   — omit clientId + set `colorByClient: true`,
//     used on assistant-dashboard.html. Shows every assigned
//     family's sessions with stable per-family color blocks.
//
// Data: pulls from window.pmHiring.fetchAssistantAppointmentsRange
// (already RLS-scoped to "appointments on contracts this assistant
// owns"). Pads the window slightly past the visible month so the
// grid edges (last days of prior month / first days of next month
// shown faded) also light up if there's a session there.
//
// Usage:
//   window.pmCalendar.mount('myContainerId', {
//     clientId: '<uuid>'      // optional — single-family scope
//     colorByClient: true,    // optional — color-code per family
//     onDayClick: fn(date, sessions)  // optional — click handler
//   });
// =============================================================

(function () {
  'use strict';

  // ─── Helpers ────────────────────────────────────────────────

  function parseLocalDate(s) {
    if (!s) return null;
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  function dateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    }[ch]));
  }

  // Stable palette per family — derived from client_id hash so the
  // same family always gets the same color across sessions/pages.
  const PALETTE = [
    ['#0071e3', '#60A5FA'], // blue
    ['#10B981', '#34D399'], // green
    ['#8B5CF6', '#A78BFA'], // purple
    ['#F59E0B', '#FBBF24'], // amber
    ['#EF4444', '#F87171'], // red
    ['#06B6D4', '#22D3EE'], // cyan
    ['#EC4899', '#F472B6'], // pink
    ['#14B8A6', '#2DD4BF'], // teal
  ];
  function clientColor(id) {
    if (!id) return PALETTE[0];
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  // ─── Data ───────────────────────────────────────────────────

  async function fetchSessions({ clientId, fromIso, toIso }) {
    if (!window.pmHiring?.fetchAssistantAppointmentsRange) return [];
    const all = await window.pmHiring.fetchAssistantAppointmentsRange({
      fromDate: fromIso,
      toDate: toIso,
      limit: 1000,
    });
    if (!clientId) return all || [];
    return (all || []).filter(a => a.client_id === clientId);
  }

  async function fetchClientNames(clientIds) {
    if (!clientIds.length || !window.pmSupabase) return {};
    try {
      const { data } = await window.pmSupabase
        .from('clients').select('id, full_name').in('id', clientIds);
      const map = {};
      (data || []).forEach(c => { map[c.id] = c.full_name; });
      return map;
    } catch (_) { return {}; }
  }

  // ─── Render ─────────────────────────────────────────────────

  async function render(container, state, opts) {
    const today = new Date();
    const firstOfMonth = new Date(state.year, state.month, 1);
    const lastOfMonth  = new Date(state.year, state.month + 1, 0);
    const monthLabel   = firstOfMonth.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' });

    // Grid always starts on Sunday. Pad with prior-month days, fill to
    // complete weeks at the end so the grid is rectangular (5 or 6 rows).
    const firstDayOfWeek = firstOfMonth.getDay(); // 0 = Sun
    const totalCells = Math.ceil((firstDayOfWeek + lastOfMonth.getDate()) / 7) * 7;
    const gridStart = new Date(state.year, state.month, 1 - firstDayOfWeek);
    const gridEnd   = new Date(gridStart);
    gridEnd.setDate(gridEnd.getDate() + totalCells - 1);

    // Loading state while fetching
    container.querySelectorAll('.pmcal-grid').forEach(g => g.classList.add('is-loading'));

    const fromIso = gridStart.toISOString();
    const toIso   = new Date(gridEnd.getTime() + 86400000 - 1).toISOString();

    // Phase 19c.10 — fetch sessions + contract renewals in parallel so
    // each day cell can render both session pills AND a "Renewal" marker
    // on contract.end_at days.
    const [sessions, renewals] = await Promise.all([
      fetchSessions({ clientId: opts.clientId || null, fromIso, toIso }),
      (window.pmHiring?.fetchContractRenewalsRange
        ? window.pmHiring.fetchContractRenewalsRange({ clientId: opts.clientId || null, fromIso, toIso })
        : Promise.resolve([])),
    ]);

    // Bucket sessions by local date key
    const byDate = {};
    const clientIds = new Set();
    (sessions || []).forEach(s => {
      const d = new Date(s.starts_at);
      const key = dateKey(d);
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(s);
      if (s.client_id) clientIds.add(s.client_id);
    });

    // Bucket renewals by local date key (contract.end_at → that day)
    const renewByDate = {};
    (renewals || []).forEach(r => {
      const d = new Date(r.end_at);
      const key = dateKey(d);
      if (!renewByDate[key]) renewByDate[key] = [];
      renewByDate[key].push(r);
      if (r.client_id) clientIds.add(r.client_id);
    });
    // Sort each bucket by start time
    Object.values(byDate).forEach(arr =>
      arr.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at))
    );

    const clientNames = opts.colorByClient
      ? await fetchClientNames([...clientIds])
      : {};

    // Build cells
    const todayKey = dateKey(today);
    const cells = [];
    for (let i = 0; i < totalCells; i++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(gridStart.getDate() + i);
      const inMonth = cellDate.getMonth() === state.month;
      const isToday = dateKey(cellDate) === todayKey;
      const daySessions = byDate[dateKey(cellDate)] || [];

      const dayRenewals = renewByDate[dateKey(cellDate)] || [];
      const hasRenewal = dayRenewals.length > 0;

      let html = `<div class="pmcal-cell${inMonth ? '' : ' is-out'}${isToday ? ' is-today' : ''}${hasRenewal ? ' has-renewal' : ''}" data-date="${dateKey(cellDate)}">`;
      html += `<span class="pmcal-day">${cellDate.getDate()}</span>`;

      // Renewal banner sits at the top of the cell, above session pills.
      if (hasRenewal) {
        const r = dayRenewals[0];
        const fam = r.clients?.billing_contact_name || r.clients?.full_name || 'Client';
        const label = dayRenewals.length === 1
          ? `${fam.split(' ')[0]} · Renewal`
          : `${dayRenewals.length} renewals`;
        const tip = dayRenewals.map(x => {
          const n = x.clients?.billing_contact_name || x.clients?.full_name || 'Client';
          return `${n} — contract ends ${new Date(x.end_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}`;
        }).join('\n');
        html += `<div class="pmcal-renewal" title="${escapeHtml(tip)}"><span class="pmcal-renewal__dot"></span>${escapeHtml(label)}</div>`;
      }

      if (daySessions.length) {
        html += '<div class="pmcal-events">';
        const shown = daySessions.slice(0, 3);
        shown.forEach(s => {
          const colors = opts.colorByClient ? clientColor(s.client_id) : ['#0071e3', '#60A5FA'];
          const start = new Date(s.starts_at);
          const time = start.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
          const cName = clientNames[s.client_id] || '';
          const firstName = cName.split(' ')[0];
          const cancelled = ['cancelled', 'late_cancelled', 'no_show'].includes(s.status);
          const tooltipParts = [time];
          if (firstName) tooltipParts.push(firstName);
          if (s.title) tooltipParts.push(s.title);
          if (cancelled) tooltipParts.push(`(${s.status.replace('_', ' ')})`);
          if (!cancelled) tooltipParts.push('Click to preview');
          const tooltip = tooltipParts.join(' · ');
          const labelParts = [time];
          if (opts.colorByClient && firstName) labelParts.push(firstName);
          // Build a deep-link URL via the host page's eventUrl callback.
          // Returns null when the host doesn't want the event clickable.
          const url = typeof opts.eventUrl === 'function' ? opts.eventUrl(s) : null;
          const clickable = !!url && !cancelled;
          const cls = `pmcal-event${cancelled ? ' is-cancelled' : ''}${clickable ? ' is-link' : ''}`;
          // Note: NOT an <a> anymore — we now open a confirmation/preview
          // modal first instead of navigating directly. The URL is stashed
          // as data-url and consumed by the modal's "Open" button.
          html += `<button type="button" class="${cls}" style="background:${colors[0]};" title="${escapeHtml(tooltip)}" data-appt-id="${escapeHtml(s.id)}"${url ? ` data-url="${escapeHtml(url)}"` : ''}${cancelled ? ' disabled' : ''}>${escapeHtml(labelParts.join(' '))}</button>`;
        });
        if (daySessions.length > 3) {
          html += `<div class="pmcal-event-more">+${daySessions.length - 3} more</div>`;
        }
        html += '</div>';
      }

      html += '</div>';
      cells.push(html);
    }

    container.innerHTML = `
      <div class="pmcal">
        <header class="pmcal-header">
          <div>
            <h3 class="pmcal-title">${escapeHtml(monthLabel)}</h3>
            <p class="pmcal-sub">${opts.subtitle || (opts.clientId ? "This family's sessions" : 'All your sessions, color-coded by family')}</p>
          </div>
          <div class="pmcal-nav">
            <button type="button" data-pmcal-nav="prev" aria-label="Previous month">‹</button>
            <button type="button" data-pmcal-nav="today">Today</button>
            <button type="button" data-pmcal-nav="next" aria-label="Next month">›</button>
          </div>
        </header>
        <div class="pmcal-weekdays">
          ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div>${d}</div>`).join('')}
        </div>
        <div class="pmcal-grid">${cells.join('')}</div>
      </div>
    `;

    // Wire nav
    container.querySelectorAll('[data-pmcal-nav]').forEach(btn => {
      btn.addEventListener('click', () => {
        const nav = btn.getAttribute('data-pmcal-nav');
        if (nav === 'prev') {
          state.month--;
          if (state.month < 0) { state.month = 11; state.year--; }
        } else if (nav === 'next') {
          state.month++;
          if (state.month > 11) { state.month = 0; state.year++; }
        } else if (nav === 'today') {
          state.year = today.getFullYear();
          state.month = today.getMonth();
        }
        render(container, state, opts);
      });
    });

    // Optional day-click handler — fires only when the click landed on
    // the day cell itself, not on an event button inside it.
    if (typeof opts.onDayClick === 'function') {
      container.querySelectorAll('.pmcal-cell').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', (e) => {
          if (e.target.closest('.pmcal-event')) return;   // event button handles itself
          const key = cell.getAttribute('data-date');
          opts.onDayClick(key, byDate[key] || []);
        });
      });
    }

    // Wire session-pill clicks → open confirmation/preview modal
    // (replaces the previous auto-navigation behavior). The modal
    // shows the lesson preview inline + a "Open in lesson tracker"
    // button that does the actual navigation when the user confirms.
    container.querySelectorAll('.pmcal-event.is-link').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const apptId = btn.getAttribute('data-appt-id');
        const url    = btn.getAttribute('data-url');
        const sess   = (sessions || []).find(x => x.id === apptId);
        if (!sess) return;
        openSessionModal({
          session: sess,
          url,
          clientName: clientNames[sess.client_id] || '',
        });
      });
    });
  }

  // ─── Confirmation / preview modal ───────────────────────────

  function ensureModal() {
    if (document.getElementById('pmcalModal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'pmcalModal';
    wrap.className = 'pmcal-modal';
    wrap.hidden = true;
    wrap.innerHTML = `
      <div class="pmcal-modal__backdrop" data-close="1"></div>
      <div class="pmcal-modal__card" role="dialog" aria-labelledby="pmcalModalTitle">
        <div class="pmcal-modal__head">
          <div class="pmcal-modal__kind">Session</div>
          <h3 class="pmcal-modal__title" id="pmcalModalTitle">—</h3>
          <p class="pmcal-modal__sub" id="pmcalModalSub">—</p>
        </div>
        <div class="pmcal-modal__body" id="pmcalModalBody">
          <div class="pmcal-modal__loading">Loading lesson notes…</div>
        </div>
        <div class="pmcal-modal__foot">
          <button type="button" class="pmcal-modal__btn pmcal-modal__btn--ghost" data-close="1">Cancel</button>
          <a class="pmcal-modal__btn pmcal-modal__btn--primary" id="pmcalModalOpen" href="#">
            Open in lesson tracker
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
          </a>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
    wrap.querySelectorAll('[data-close]').forEach(el => {
      el.addEventListener('click', () => closeSessionModal());
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !wrap.hidden) closeSessionModal();
    });
  }

  function openSessionModal({ session, url, clientName }) {
    ensureModal();
    const modal = document.getElementById('pmcalModal');
    if (!modal) return;
    const startDate = new Date(session.starts_at);
    const longDate = startDate.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const timeStr  = startDate.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
    const dur = session.duration_minutes ? `${session.duration_minutes / 60}h` : '';
    const statusPretty = (session.status || 'scheduled').replace(/_/g, ' ');

    document.getElementById('pmcalModalTitle').textContent = `${longDate} · ${timeStr}`;
    const subParts = [];
    if (clientName) subParts.push(clientName);
    if (session.title) subParts.push(session.title);
    if (dur) subParts.push(dur);
    subParts.push(statusPretty);
    document.getElementById('pmcalModalSub').textContent = subParts.join(' · ');

    const bodyEl = document.getElementById('pmcalModalBody');
    bodyEl.innerHTML = `<div class="pmcal-modal__loading">Loading lesson notes…</div>`;

    const openBtn = document.getElementById('pmcalModalOpen');
    openBtn.setAttribute('href', url || '#');

    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('is-shown'));

    // Inline lesson-log preview. Never blocks the user — the Open
    // button is always usable even while the fetch is in flight.
    (async () => {
      if (!window.pmHiring?.fetchLessonLog) {
        bodyEl.innerHTML = `<div class="pmcal-modal__empty">No lesson preview available.</div>`;
        return;
      }
      try {
        const log = await window.pmHiring.fetchLessonLog(session.id);
        if (!log) {
          bodyEl.innerHTML = `<div class="pmcal-modal__empty">
            <strong>No lesson notes yet for this session.</strong>
            <p>The assistant logs lesson notes after each completed session.${session.status === 'scheduled' ? ' This session is still upcoming.' : ''}</p>
          </div>`;
          return;
        }
        const esc = escapeHtml;
        const block = (label, value) => value
          ? `<div class="pmcal-modal__field"><div class="pmcal-modal__label">${esc(label)}</div><div class="pmcal-modal__value">${esc(value)}</div></div>`
          : '';
        const rating = log.rating
          ? `<div class="pmcal-modal__rating">${'★'.repeat(Math.round(log.rating))}<span class="pmcal-modal__rating-mute">${'★'.repeat(Math.max(0, 5 - Math.round(log.rating)))}</span> <span class="pmcal-modal__rating-text">${log.rating} of 5</span></div>`
          : '';
        bodyEl.innerHTML = `
          ${rating}
          ${block('Focus area', log.focus_area)}
          ${block('Key concepts', log.key_concepts)}
          ${block('Feedback', log.feedback)}
          ${block('Next session notes', log.next_session_notes)}
          ${(log.files || []).length ? `<div class="pmcal-modal__field"><div class="pmcal-modal__label">Attached files</div><div class="pmcal-modal__value">${log.files.length} file${log.files.length === 1 ? '' : 's'} attached</div></div>` : ''}
        `;
        if (!bodyEl.textContent.trim()) {
          bodyEl.innerHTML = `<div class="pmcal-modal__empty"><strong>Lesson logged with no notes.</strong><p>Open the lesson tracker to view full details.</p></div>`;
        }
      } catch (err) {
        console.warn('pmCalendar: lesson preview fetch failed', err);
        bodyEl.innerHTML = `<div class="pmcal-modal__empty">Couldn't load lesson preview. Open the tracker to view.</div>`;
      }
    })();
  }

  function closeSessionModal() {
    const modal = document.getElementById('pmcalModal');
    if (!modal) return;
    modal.classList.remove('is-shown');
    setTimeout(() => { modal.hidden = true; }, 180);
  }

  // ─── Styles ─────────────────────────────────────────────────

  function injectStyles() {
    if (document.getElementById('pmcal-styles')) return;
    const css = `
      .pmcal{background:#fff;border:1px solid #E2E8F0;border-radius:14px;padding:20px 22px;font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;}
      .pmcal-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px;flex-wrap:wrap;}
      .pmcal-title{font-family:Archivo,Inter,sans-serif;font-size:20px;font-weight:800;letter-spacing:-.018em;color:#0F172A;margin:0 0 2px;}
      .pmcal-sub{font-size:12.5px;color:#64748B;margin:0;}
      .pmcal-nav{display:flex;gap:6px;flex-shrink:0;}
      .pmcal-nav button{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:6px 11px;font:600 13px Inter,sans-serif;color:#475569;cursor:pointer;transition:background .15s,color .15s,border-color .15s;line-height:1;}
      .pmcal-nav button:hover{background:#F1F5F9;color:#0F172A;border-color:#CBD5E1;}
      .pmcal-weekdays{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px;}
      .pmcal-weekdays>div{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#94A3B8;text-align:center;padding:6px 0;}
      .pmcal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;}
      .pmcal-grid.is-loading{opacity:0.6;pointer-events:none;}
      .pmcal-cell{min-height:84px;background:#FAFBFC;border:1px solid #F1F5F9;border-radius:8px;padding:6px 7px;display:flex;flex-direction:column;gap:4px;transition:background .12s;}
      .pmcal-cell:hover{background:#F1F5F9;}
      .pmcal-cell.is-out{opacity:0.4;background:transparent;}
      .pmcal-cell.is-today{background:#EFF6FF;border-color:#BFDBFE;}
      .pmcal-cell.is-today:hover{background:#DBEAFE;}
      .pmcal-cell.is-today .pmcal-day{color:#1E40AF;font-weight:800;}
      .pmcal-day{font-family:Archivo,Inter,sans-serif;font-size:13.5px;font-weight:700;color:#475569;line-height:1;}
      .pmcal-events{display:flex;flex-direction:column;gap:2px;overflow:hidden;}
      .pmcal-event{color:#fff;font-size:10.5px;font-weight:600;padding:2px 6px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.005em;line-height:1.35;display:block;}
      a.pmcal-event{text-decoration:none;}
      .pmcal-event.is-link{cursor:pointer;transition:transform .12s ease, box-shadow .12s ease, filter .12s ease;}
      .pmcal-event.is-link:hover{transform:translateY(-1px);filter:brightness(1.08) saturate(1.1);box-shadow:0 4px 10px -3px rgba(15,23,42,0.25);}
      .pmcal-event.is-cancelled{opacity:0.45;text-decoration:line-through;}
      .pmcal-event.is-cancelled.is-link:hover{filter:none;transform:none;box-shadow:none;cursor:default;}
      .pmcal-event-more{font-size:10px;color:#64748B;font-weight:700;padding:1px 4px;}

      /* Phase 19c.10 — Renewal banner on contract.end_at days */
      .pmcal-cell.has-renewal{
        background:#fff7ed;border-color:#fed7aa;
      }
      .pmcal-cell.has-renewal:hover{background:#ffedd5;}
      .pmcal-cell.is-today.has-renewal{
        background:linear-gradient(135deg,#eff6ff 0%,#fff7ed 100%);
        border-color:#fdba74;
      }
      .pmcal-renewal{
        display:inline-flex;align-items:center;gap:5px;
        background:#f97316;color:#fff;
        font-size:9.5px;font-weight:700;letter-spacing:0.04em;
        padding:2px 7px;border-radius:9999px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
        max-width:100%;
        text-transform:uppercase;
        box-shadow:0 1px 2px rgba(249,115,22,0.30);
      }
      .pmcal-renewal__dot{
        width:5px;height:5px;border-radius:50%;
        background:#fff;flex-shrink:0;
        animation:pmcal-pulse 1.8s ease-in-out infinite;
      }
      @keyframes pmcal-pulse{
        0%,100%{opacity:1;}
        50%{opacity:0.35;}
      }

      @media(max-width:680px){
        .pmcal{padding:14px;}
        .pmcal-cell{min-height:58px;padding:4px 5px;}
        .pmcal-event{font-size:9px;padding:1px 4px;}
        .pmcal-day{font-size:11.5px;}
        .pmcal-weekdays>div{font-size:9.5px;letter-spacing:.06em;}
        .pmcal-nav button{padding:5px 9px;font-size:12px;}
        .pmcal-renewal{font-size:8.5px;padding:1px 5px;}
      }
      /* ── Session-preview modal ───────────────────────────── */
      .pmcal-modal{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:24px;opacity:0;transition:opacity .18s ease;}
      .pmcal-modal.is-shown{opacity:1;}
      .pmcal-modal[hidden]{display:none !important;}
      .pmcal-modal__backdrop{position:absolute;inset:0;background:rgba(15,23,42,0.55);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);}
      .pmcal-modal__card{
        position:relative;background:#ffffff;border-radius:16px;
        width:100%;max-width:520px;max-height:85vh;display:flex;flex-direction:column;
        box-shadow:0 0 0 1px rgba(15,23,42,0.08),0 1px 3px rgba(15,23,42,0.10),0 24px 56px -12px rgba(15,23,42,0.40);
        transform:scale(.97);transition:transform .18s cubic-bezier(.22,1,.36,1);
        font-family:Inter,-apple-system,BlinkMacSystemFont,sans-serif;
      }
      .pmcal-modal.is-shown .pmcal-modal__card{transform:scale(1);}
      /* Dark mode card */
      html[data-dash-theme="dark"] .pmcal-modal__card,
      html[data-pm-theme="dark"] .pmcal-modal__card{
        background:#16171c;
        box-shadow:0 0 0 1px rgba(255,255,255,0.08),0 1px 3px rgba(0,0,0,0.40),0 24px 56px -12px rgba(0,0,0,0.70);
      }
      .pmcal-modal__head{padding:22px 26px 16px;border-bottom:1px solid #EEF1F6;}
      html[data-dash-theme="dark"] .pmcal-modal__head,
      html[data-pm-theme="dark"] .pmcal-modal__head{border-bottom-color:rgba(255,255,255,0.08);}
      .pmcal-modal__kind{
        display:inline-block;font:700 9.5px Inter,sans-serif;letter-spacing:.18em;text-transform:uppercase;
        color:#64748B;background:#F1F5F9;border:1px solid #E2E8F0;padding:4px 10px;border-radius:5px;margin-bottom:10px;
      }
      html[data-dash-theme="dark"] .pmcal-modal__kind,
      html[data-pm-theme="dark"] .pmcal-modal__kind{
        background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.08);color:#94A3B8;
      }
      .pmcal-modal__title{
        font:700 19px Inter,sans-serif;color:#0F172A;letter-spacing:-.018em;line-height:1.25;margin:0 0 6px;
      }
      .pmcal-modal__sub{
        font:500 13px Inter,sans-serif;color:#64748B;letter-spacing:-.005em;margin:0;line-height:1.5;
      }
      html[data-dash-theme="dark"] .pmcal-modal__title,
      html[data-pm-theme="dark"] .pmcal-modal__title{color:#FFFFFF;}
      html[data-dash-theme="dark"] .pmcal-modal__sub,
      html[data-pm-theme="dark"] .pmcal-modal__sub{color:#94A3B8;}
      .pmcal-modal__body{
        padding:20px 26px;overflow-y:auto;flex:1;
      }
      .pmcal-modal__loading,.pmcal-modal__empty{
        font:500 13.5px Inter,sans-serif;color:#64748B;text-align:center;padding:24px 8px;line-height:1.6;
      }
      .pmcal-modal__empty strong{display:block;color:#0F172A;font-weight:700;margin-bottom:6px;}
      .pmcal-modal__empty p{margin:0;}
      html[data-dash-theme="dark"] .pmcal-modal__loading,
      html[data-pm-theme="dark"] .pmcal-modal__loading,
      html[data-dash-theme="dark"] .pmcal-modal__empty,
      html[data-pm-theme="dark"] .pmcal-modal__empty{color:#94A3B8;}
      html[data-dash-theme="dark"] .pmcal-modal__empty strong,
      html[data-pm-theme="dark"] .pmcal-modal__empty strong{color:#FFFFFF;}
      .pmcal-modal__field{margin-bottom:14px;}
      .pmcal-modal__field:last-child{margin-bottom:0;}
      .pmcal-modal__label{
        font:700 10px Inter,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#94A3B8;margin-bottom:6px;
      }
      .pmcal-modal__value{
        font:500 13.5px Inter,sans-serif;color:#1F2937;letter-spacing:-.005em;line-height:1.55;
        white-space:pre-wrap;word-break:break-word;
      }
      html[data-dash-theme="dark"] .pmcal-modal__value,
      html[data-pm-theme="dark"] .pmcal-modal__value{color:#F1F5F9;}
      .pmcal-modal__rating{
        font:700 17px Inter,sans-serif;color:#D97706;margin-bottom:14px;letter-spacing:.05em;
      }
      .pmcal-modal__rating-mute{color:#E2E8F0;}
      .pmcal-modal__rating-text{
        font:500 12px Inter,sans-serif;color:#94A3B8;margin-left:8px;letter-spacing:0;
      }
      html[data-dash-theme="dark"] .pmcal-modal__rating,
      html[data-pm-theme="dark"] .pmcal-modal__rating{color:#FBBF24;}
      html[data-dash-theme="dark"] .pmcal-modal__rating-mute,
      html[data-pm-theme="dark"] .pmcal-modal__rating-mute{color:rgba(255,255,255,0.10);}
      .pmcal-modal__foot{
        padding:14px 18px;border-top:1px solid #EEF1F6;
        display:flex;justify-content:flex-end;gap:8px;
      }
      html[data-dash-theme="dark"] .pmcal-modal__foot,
      html[data-pm-theme="dark"] .pmcal-modal__foot{border-top-color:rgba(255,255,255,0.08);}
      .pmcal-modal__btn{
        display:inline-flex;align-items:center;gap:6px;
        padding:10px 16px;border-radius:9px;
        font:600 13px Inter,sans-serif;letter-spacing:-.005em;
        text-decoration:none;cursor:pointer;border:1px solid transparent;
        transition:background .14s ease,color .14s ease,border-color .14s ease,box-shadow .14s ease,transform .12s ease;
      }
      .pmcal-modal__btn--ghost{background:transparent;color:#475569;border-color:#E2E8F0;}
      .pmcal-modal__btn--ghost:hover{background:#F8FAFC;color:#0F172A;border-color:#CBD5E1;}
      html[data-dash-theme="dark"] .pmcal-modal__btn--ghost,
      html[data-pm-theme="dark"] .pmcal-modal__btn--ghost{
        color:#CBD5E1;border-color:rgba(255,255,255,0.10);
      }
      html[data-dash-theme="dark"] .pmcal-modal__btn--ghost:hover,
      html[data-pm-theme="dark"] .pmcal-modal__btn--ghost:hover{
        background:rgba(255,255,255,0.04);color:#FFFFFF;border-color:rgba(255,255,255,0.20);
      }
      .pmcal-modal__btn--primary{
        background:linear-gradient(180deg,#2563EB 0%,#1D4ED8 100%);color:#fff;
        box-shadow:0 1px 2px rgba(15,23,42,0.10),0 6px 14px -3px rgba(37,99,235,0.45),inset 0 1px 0 rgba(255,255,255,0.18);
      }
      .pmcal-modal__btn--primary:hover{
        transform:translateY(-1px);
        box-shadow:0 1px 2px rgba(15,23,42,0.14),0 10px 22px -4px rgba(37,99,235,0.55),inset 0 1px 0 rgba(255,255,255,0.20);
      }
      .pmcal-modal__btn--primary svg{width:13px;height:13px;}
    `;
    const style = document.createElement('style');
    style.id = 'pmcal-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─── Public API ─────────────────────────────────────────────

  window.pmCalendar = {
    mount: async function (containerId, opts = {}) {
      const container = typeof containerId === 'string'
        ? document.getElementById(containerId)
        : containerId;
      if (!container) {
        console.warn('pmCalendar: container not found:', containerId);
        return;
      }
      injectStyles();
      const today = new Date();
      const state = {
        year:  opts.startYear  ?? today.getFullYear(),
        month: opts.startMonth ?? today.getMonth(),
      };
      await render(container, state, opts);
    }
  };
})();
