// Site-wide incoming-call ring listener.
//
// Loaded on every authenticated page. While the user is signed in
// anywhere on privatementorship.ca, this opens a floating ring modal
// the moment someone calls them — even if they're on the dashboard,
// hours page, etc. Clicking Accept navigates to /messages.html with
// the call info, which auto-joins the Stream call.
//
// Depends on window.pmSupabase (supabase-client.js) being loaded.
// Skips itself entirely on /messages.html — that page has its own
// in-call ring + accept modal so we don't want a duplicate.

(function () {
  // Don't double-register on the messages page.
  if (/\/messages\.html(\?|$|#)/.test(location.pathname + location.search)) return;

  const sb = window.pmSupabase;
  if (!sb) return;

  // ── CSS ──────────────────────────────────────────────────────────
  const css = `
    .pm-call-ring-overlay{
      position:fixed;left:50%;bottom:24px;transform:translateX(-50%);
      z-index:99000;display:none;
      pointer-events:none;
    }
    .pm-call-ring-overlay.is-open{display:block;}
    .pm-call-ring-card{
      pointer-events:auto;
      display:flex;align-items:center;gap:14px;
      padding:14px 16px;border-radius:18px;
      min-width:380px;max-width:520px;
      background:rgba(15,15,22,0.92);
      border:1px solid rgba(255,255,255,0.10);
      box-shadow:0 24px 60px -20px rgba(0,0,0,0.7);
      color:#fff;
      font-family:"Inter",ui-sans-serif,system-ui,-apple-system,sans-serif;
      animation:pmRingSlideIn .35s cubic-bezier(0.4,0,0.2,1);
    }
    body.theme-light .pm-call-ring-card,
    .pm-light-host .pm-call-ring-card{
      background:rgba(255,255,255,0.95);
      color:#0F172A;
      border-color:rgba(15,23,42,0.10);
      box-shadow:0 24px 60px -18px rgba(15,23,42,0.18);
    }
    @keyframes pmRingSlideIn{from{transform:translate(-50%,40px);opacity:0;}to{transform:translate(-50%,0);opacity:1;}}
    .pm-call-ring-card__avatar{
      width:42px;height:42px;border-radius:50%;
      background:linear-gradient(135deg,#5750F1,#9F75FF);
      display:flex;align-items:center;justify-content:center;
      font:800 16px Inter,sans-serif;color:#fff;flex:0 0 auto;
      animation:pmRingPulseSW 1.6s ease-in-out infinite;
    }
    @keyframes pmRingPulseSW{
      0%,100%{box-shadow:0 0 0 0 rgba(87,80,241,0.45);}
      50%{box-shadow:0 0 0 10px rgba(87,80,241,0);}
    }
    .pm-call-ring-card__text{flex:1;min-width:0;}
    .pm-call-ring-card__title{font:700 14px Inter,sans-serif;margin:0;}
    .pm-call-ring-card__sub{font:500 12.5px Inter,sans-serif;color:rgba(255,255,255,0.62);margin-top:2px;}
    body.theme-light .pm-call-ring-card__sub,
    .pm-light-host .pm-call-ring-card__sub{color:#64748B;}
    .pm-call-ring-card__actions{display:flex;gap:8px;flex:0 0 auto;}
    .pm-call-ring-card__btn{
      width:42px;height:42px;border-radius:50%;border:none;cursor:pointer;
      display:flex;align-items:center;justify-content:center;color:#fff;
      transition:transform .12s ease, background .15s ease;
    }
    .pm-call-ring-card__btn:hover{transform:translateY(-1px);}
    .pm-call-ring-card__btn svg{width:18px;height:18px;}
    .pm-call-ring-card__btn.is-accept{background:#22c55e;}
    .pm-call-ring-card__btn.is-accept:hover{background:#16a34a;}
    .pm-call-ring-card__btn.is-decline{background:#dc2626;}
    .pm-call-ring-card__btn.is-decline:hover{background:#b91c1c;}
  `;
  const style = document.createElement('style');
  style.id = 'pm-call-ring-styles';
  style.textContent = css;
  document.head.appendChild(style);

  // ── Markup ────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.className = 'pm-call-ring-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'Incoming call');
  overlay.innerHTML = `
    <div class="pm-call-ring-card">
      <div class="pm-call-ring-card__avatar" id="pmRingAvatar">·</div>
      <div class="pm-call-ring-card__text">
        <p class="pm-call-ring-card__title" id="pmRingTitle">Incoming call</p>
        <p class="pm-call-ring-card__sub" id="pmRingSub">…</p>
      </div>
      <div class="pm-call-ring-card__actions">
        <button class="pm-call-ring-card__btn is-decline" id="pmRingDecline" type="button" aria-label="Decline">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="23" y1="1" x2="1" y2="23"/></svg>
        </button>
        <button class="pm-call-ring-card__btn is-accept" id="pmRingAccept" type="button" aria-label="Accept">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
        </button>
      </div>
    </div>
  `;
  // Attach light-mode flag based on saved theme so the popup matches
  // the messenger theme even on pages that don't render the messenger.
  try {
    const savedTheme = localStorage.getItem('pm-msg-theme');
    if (savedTheme === 'light') overlay.classList.add('pm-light-host');
  } catch (_) {}
  document.body.appendChild(overlay);

  // ── State ─────────────────────────────────────────────────────────
  let _myUserId = null;
  let _channel = null;
  let _currentCall = null; // { call_id, conversation_id, call_type, caller_user_id }
  const seenIds = new Set();

  function showRing(row, callerName) {
    _currentCall = row;
    const initial = (callerName || 'Caller').trim().charAt(0).toUpperCase() || '?';
    document.getElementById('pmRingAvatar').textContent = initial;
    document.getElementById('pmRingTitle').textContent =
      `Incoming ${row.call_type === 'video' ? 'video' : 'voice'} call`;
    document.getElementById('pmRingSub').textContent =
      callerName ? `from ${callerName}` : 'Tap accept to join';
    overlay.classList.add('is-open');
  }
  function hideRing() {
    overlay.classList.remove('is-open');
    _currentCall = null;
  }

  // ── Subscription ──────────────────────────────────────────────────
  async function start() {
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return; // Not signed in — no ring needed
      _myUserId = user.id;
    } catch (_) { return; }

    if (_channel) sb.removeChannel(_channel);
    _channel = sb.channel(`call-incoming-site-${_myUserId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'call_logs' },
        async (payload) => {
          try {
            const row = payload?.new;
            if (!row?.id) return;
            if (row.status !== 'ringing') return;
            if (row.caller_user_id === _myUserId) return; // ignore own calls
            if (seenIds.has(row.call_id || row.id)) return;
            seenIds.add(row.call_id || row.id);

            // Confirm I'm a participant of this conversation.
            const { data: parts, error } = await sb.from('conversation_participants')
              .select('profile_id')
              .eq('conversation_id', row.conversation_id)
              .eq('profile_id', _myUserId)
              .limit(1);
            if (error || !parts?.length) return;

            // Best-effort caller name lookup
            let callerName = '';
            try {
              const { data: prof } = await sb.from('profiles')
                .select('full_name')
                .eq('user_id', row.caller_user_id)
                .maybeSingle();
              callerName = prof?.full_name || '';
            } catch (_) {}

            showRing(row, callerName);
          } catch (e) { console.warn('[ring]', e); }
        })
      .subscribe();
  }

  // Accept → navigate to messages.html and let it auto-join via URL params.
  document.getElementById('pmRingAccept').addEventListener('click', () => {
    if (!_currentCall) return;
    const params = new URLSearchParams({
      incomingCall: _currentCall.call_id,
      callType: _currentCall.call_type || 'audio',
      conversationId: _currentCall.conversation_id || '',
    });
    location.href = `messages.html?${params.toString()}`;
  });

  // Decline → mark the row as declined so the caller's UI updates.
  document.getElementById('pmRingDecline').addEventListener('click', async () => {
    if (!_currentCall) return;
    try {
      await sb.from('call_logs')
        .update({ status: 'declined', updated_at: new Date().toISOString() })
        .eq('call_id', _currentCall.call_id);
    } catch (_) {}
    hideRing();
  });

  start();

  // Re-evaluate on auth changes (sign in / sign out)
  try {
    sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') start();
      if (event === 'SIGNED_OUT') {
        if (_channel) { sb.removeChannel(_channel); _channel = null; }
        hideRing();
      }
    });
  } catch (_) {}
})();
