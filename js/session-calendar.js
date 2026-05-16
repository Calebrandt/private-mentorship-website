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

    const sessions = await fetchSessions({
      clientId: opts.clientId || null,
      fromIso: gridStart.toISOString(),
      toIso: new Date(gridEnd.getTime() + 86400000 - 1).toISOString(),
    });

    // Bucket by local date key
    const byDate = {};
    const clientIds = new Set();
    (sessions || []).forEach(s => {
      const d = new Date(s.starts_at);
      const key = dateKey(d);
      if (!byDate[key]) byDate[key] = [];
      byDate[key].push(s);
      if (s.client_id) clientIds.add(s.client_id);
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

      let html = `<div class="pmcal-cell${inMonth ? '' : ' is-out'}${isToday ? ' is-today' : ''}" data-date="${dateKey(cellDate)}">`;
      html += `<span class="pmcal-day">${cellDate.getDate()}</span>`;

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
          const tooltip = tooltipParts.join(' · ');
          const labelParts = [time];
          if (opts.colorByClient && firstName) labelParts.push(firstName);
          html += `<div class="pmcal-event${cancelled ? ' is-cancelled' : ''}" style="background:${colors[0]};" title="${escapeHtml(tooltip)}">${escapeHtml(labelParts.join(' '))}</div>`;
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

    // Optional day-click handler
    if (typeof opts.onDayClick === 'function') {
      container.querySelectorAll('.pmcal-cell').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => {
          const key = cell.getAttribute('data-date');
          opts.onDayClick(key, byDate[key] || []);
        });
      });
    }
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
      .pmcal-event{color:#fff;font-size:10.5px;font-weight:600;padding:2px 6px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.005em;line-height:1.35;}
      .pmcal-event.is-cancelled{opacity:0.45;text-decoration:line-through;}
      .pmcal-event-more{font-size:10px;color:#64748B;font-weight:700;padding:1px 4px;}
      @media(max-width:680px){
        .pmcal{padding:14px;}
        .pmcal-cell{min-height:58px;padding:4px 5px;}
        .pmcal-event{font-size:9px;padding:1px 4px;}
        .pmcal-day{font-size:11.5px;}
        .pmcal-weekdays>div{font-size:9.5px;letter-spacing:.06em;}
        .pmcal-nav button{padding:5px 9px;font-size:12px;}
      }
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
