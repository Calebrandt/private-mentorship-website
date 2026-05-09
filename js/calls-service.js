// Calls service — wraps Stream.io vanilla JS SDK so the website can place
// audio/video calls that bridge to the React Native app.
//
// Bridges via:
//   - the existing `stream-video-token` Supabase edge function (issues the JWT)
//   - the existing `call_logs` table (status: ringing → answered/declined → ended)
//   - the same Stream.io project the app uses, so a web caller and an app
//     callee end up in the same call.
//
// Depends on:
//   - window.pmSupabase  (from supabase-client.js)
//   - dynamic import of @stream-io/video-client from esm.sh on first use
//
// Exposes window.pmCalls.

(function () {
  const sb = window.pmSupabase;
  if (!sb) {
    console.warn('[calls] pmSupabase not loaded — load supabase-client.js first');
    return;
  }

  // ─── Stream SDK loader ─────────────────────────────────────────────────
  // Dynamically loads @stream-io/video-client only when the user actually
  // tries to start/accept a call — keeps the SDK off the critical path.
  let _sdkPromise = null;
  function loadSdk() {
    if (_sdkPromise) return _sdkPromise;
    _sdkPromise = import('https://esm.sh/@stream-io/video-client@1').catch((e) => {
      _sdkPromise = null;
      throw new Error('Failed to load Stream.io SDK: ' + (e?.message || e));
    });
    return _sdkPromise;
  }

  // ─── Token (mirrors app's videoTokenService) ───────────────────────────
  async function fetchVideoToken() {
    const { data: { session }, error: sessErr } = await sb.auth.getSession();
    if (sessErr) throw sessErr;
    const accessToken = session?.access_token;
    if (!accessToken) throw new Error('Not signed in');

    const projectUrl = sb.supabaseUrl || (window.pmSupabaseUrl || '');
    if (!projectUrl) throw new Error('Missing Supabase URL');

    const res = await fetch(`${projectUrl}/functions/v1/stream-video-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload?.error || 'Failed to fetch Stream token');
    if (!payload.apiKey || !payload.token || !payload.userId) {
      throw new Error('Invalid Stream token response');
    }
    return payload;
  }

  // ─── Client lifecycle ──────────────────────────────────────────────────
  let _client = null;
  let _clientUserId = null;

  async function getClient(userId) {
    if (_client && _clientUserId === userId) return _client;
    if (_client && _clientUserId !== userId) {
      try { await _client.disconnectUser(); } catch (_) {}
      _client = null; _clientUserId = null;
    }
    const { StreamVideoClient } = await loadSdk();
    const { apiKey, token, userId: tokenUserId } = await fetchVideoToken();
    _client = new StreamVideoClient({ apiKey });
    await _client.connectUser({ id: tokenUserId }, token);
    _clientUserId = tokenUserId;
    return _client;
  }

  async function disconnect() {
    if (!_client) return;
    try { await _client.disconnectUser(); } catch (_) {}
    _client = null; _clientUserId = null;
  }

  // ─── Active call state ─────────────────────────────────────────────────
  let _activeCall = null;       // Stream Call instance
  let _activeCallId = null;     // string callId we wrote to call_logs
  let _activeCallType = null;   // 'audio' | 'video'
  let _participantsSub = null;  // RxJS subscription
  let _callEndedSub = null;
  const _callbacks = {
    onParticipants: null,
    onLocalState: null,
    onEnded: null,
    onIncoming: null,
  };

  function on(eventName, fn) {
    if (eventName in _callbacks) _callbacks[eventName] = fn;
  }

  // ─── Outgoing ──────────────────────────────────────────────────────────
  async function startCall({ conversationId, callType, callerUserId, recipientUserIds = [] }) {
    if (!conversationId || !callType || !callerUserId) {
      throw new Error('startCall: missing required fields');
    }
    if (_activeCall) throw new Error('A call is already in progress');

    const callId = `call-${conversationId}-${Date.now()}`;

    // Insert call_log first (status: ringing) — RLS will let participants read it
    await sb.from('call_logs').insert({
      conversation_id: conversationId,
      call_id: callId,
      caller_user_id: callerUserId,
      recipient_user_id: recipientUserIds[0] || null,
      call_type: callType,
      status: 'ringing',
    });

    const client = await getClient(callerUserId);
    const call = client.call('default', callId);

    // Members = caller + recipients so Stream rings the right people
    const memberRecords = [
      { user_id: callerUserId },
      ...recipientUserIds.map((id) => ({ user_id: id })),
    ];

    await call.getOrCreate({
      ring: true,
      data: { members: memberRecords, custom: { callType, conversationId } },
    });

    // Enable mic; enable camera only for video
    try {
      if (callType === 'video') await call.camera.enable(); else await call.camera.disable();
      await call.microphone.enable();
    } catch (e) { console.warn('[calls] track enable warning', e?.message); }

    await call.join({ create: true });

    _bindCall(call, callId, callType);
    return { callId, call };
  }

  async function acceptIncoming({ callId, callType, userId }) {
    if (!callId || !userId) throw new Error('acceptIncoming: missing fields');
    const client = await getClient(userId);
    const call = client.call('default', callId);
    try { await call.accept(); } catch (e) { /* may not be a ringing call yet */ }
    try {
      if (callType === 'video') await call.camera.enable(); else await call.camera.disable();
      await call.microphone.enable();
    } catch (e) { console.warn('[calls] track enable warning', e?.message); }
    await call.join();
    _bindCall(call, callId, callType || 'audio');
    await sb.from('call_logs')
      .update({ status: 'answered', updated_at: new Date().toISOString() })
      .eq('call_id', callId);
    return { callId, call };
  }

  async function declineIncoming({ callId, userId }) {
    if (!callId || !userId) return;
    const client = await getClient(userId);
    try { await client.call('default', callId).reject(); } catch (e) {}
    await sb.from('call_logs')
      .update({ status: 'declined', updated_at: new Date().toISOString() })
      .eq('call_id', callId);
  }

  async function endActiveCall() {
    if (!_activeCall) return;
    try { await _activeCall.leave(); } catch (e) {}
    if (_activeCallId) {
      await sb.from('call_logs')
        .update({ status: 'ended', updated_at: new Date().toISOString() })
        .eq('call_id', _activeCallId);
    }
    _unbindCall();
  }

  function _bindCall(call, callId, callType) {
    _activeCall = call;
    _activeCallId = callId;
    _activeCallType = callType;

    // Live participants — array of { userId, sessionId, isLocalParticipant, audioStream, videoStream, ... }
    if (call.state?.participants$?.subscribe) {
      _participantsSub = call.state.participants$.subscribe((parts) => {
        try { _callbacks.onParticipants?.(parts || []); } catch (e) { console.warn(e); }
      });
    }
    // Local mic/cam state — composite of two observables
    const camera$ = call.camera?.state?.status$;
    const mic$ = call.microphone?.state?.status$;
    const emitLocal = () => {
      try {
        _callbacks.onLocalState?.({
          micEnabled: call.microphone?.state?.status === 'enabled',
          cameraEnabled: call.camera?.state?.status === 'enabled',
          callType: _activeCallType,
        });
      } catch (e) { console.warn(e); }
    };
    camera$?.subscribe?.(emitLocal);
    mic$?.subscribe?.(emitLocal);
    emitLocal();

    // Stream's call_ended event
    _callEndedSub = call.on?.('call.ended', () => {
      _callbacks.onEnded?.();
      _unbindCall();
    });
  }

  function _unbindCall() {
    try { _participantsSub?.unsubscribe?.(); } catch (_) {}
    try { typeof _callEndedSub === 'function' ? _callEndedSub() : _callEndedSub?.unsubscribe?.(); } catch (_) {}
    _participantsSub = null; _callEndedSub = null;
    _activeCall = null; _activeCallId = null; _activeCallType = null;
  }

  // ─── Local controls ────────────────────────────────────────────────────
  async function toggleMic() {
    if (!_activeCall) return;
    const enabled = _activeCall.microphone?.state?.status === 'enabled';
    if (enabled) await _activeCall.microphone.disable();
    else await _activeCall.microphone.enable();
  }
  async function toggleCamera() {
    if (!_activeCall) return;
    const enabled = _activeCall.camera?.state?.status === 'enabled';
    if (enabled) await _activeCall.camera.disable();
    else await _activeCall.camera.enable();
  }

  // Bind a participant's video to a <video> element. Returns a cleanup fn.
  function bindVideo(videoEl, participant) {
    if (!videoEl || !participant) return () => {};
    const track = participant.videoStream || participant.publishedTracks?.find?.(t => t.kind === 'video') || null;
    if (track instanceof MediaStream) {
      videoEl.srcObject = track;
    } else if (track && track.track) {
      const ms = new MediaStream([track.track]);
      videoEl.srcObject = ms;
    } else if (participant.videoStream) {
      videoEl.srcObject = participant.videoStream;
    }
    videoEl.muted = !!participant.isLocalParticipant; // avoid local echo
    videoEl.autoplay = true; videoEl.playsInline = true;
    videoEl.play?.().catch(() => {});
    return () => { try { videoEl.srcObject = null; } catch (_) {} };
  }

  function bindAudio(audioEl, participant) {
    if (!audioEl || !participant) return () => {};
    if (participant.isLocalParticipant) return () => {}; // never play own mic
    const track = participant.audioStream || null;
    if (track instanceof MediaStream) audioEl.srcObject = track;
    audioEl.autoplay = true;
    audioEl.play?.().catch(() => {});
    return () => { try { audioEl.srcObject = null; } catch (_) {} };
  }

  // ─── Incoming ring listener ────────────────────────────────────────────
  // Subscribes to INSERTs on call_logs for the current user. When a new
  // ringing row appears with recipient_user_id = me (or me is in the
  // conversation members), fires onIncoming(payload).
  let _incomingChannel = null;
  function subscribeToIncoming(userId) {
    if (!userId) return;
    if (_incomingChannel) sb.removeChannel(_incomingChannel);
    _incomingChannel = sb.channel(`call-incoming-${userId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'call_logs',
          filter: `recipient_user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new;
          if (!row || row.status !== 'ringing') return;
          if (row.caller_user_id === userId) return; // ignore self
          try { _callbacks.onIncoming?.(row); } catch (e) { console.warn(e); }
        })
      .subscribe();
  }
  function unsubscribeFromIncoming() {
    if (_incomingChannel) { sb.removeChannel(_incomingChannel); _incomingChannel = null; }
  }

  // ─── Recents (mirror messages-service.loadCallLogs but global per user) ─
  async function loadRecentsForConversation(conversationId, limit = 50) {
    if (!conversationId) return [];
    const { data, error } = await sb.from('call_logs')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  // ─── Public API ────────────────────────────────────────────────────────
  window.pmCalls = {
    startCall,
    acceptIncoming,
    declineIncoming,
    endActiveCall,
    toggleMic,
    toggleCamera,
    bindVideo,
    bindAudio,
    subscribeToIncoming,
    unsubscribeFromIncoming,
    loadRecentsForConversation,
    disconnect,
    on,
    isInCall: () => !!_activeCall,
    activeCallId: () => _activeCallId,
    activeCallType: () => _activeCallType,
  };
})();
