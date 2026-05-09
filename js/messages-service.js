// Messages service for the Private Mentorship website.
// Mirrors the React Native app's src/services/messages.js so a message sent
// from the website appears live in the app and vice versa via Supabase Realtime.
//
// Depends on window.pmSupabase (from supabase-client.js) being loaded first.
// Exposes window.pmMessages.

(function () {
  const sb = window.pmSupabase;
  if (!sb) {
    console.warn('[messages] pmSupabase not loaded — load supabase-client.js first');
    return;
  }

  // ─── Conversations ───────────────────────────────────────────────────────
  async function loadConversations(userId) {
    if (!userId) return [];
    // 1. Find conversation IDs the user participates in
    const { data: parts, error: partsErr } = await sb
      .from('conversation_participants')
      .select('conversation_id')
      .eq('profile_id', userId);
    if (partsErr) throw partsErr;
    const ids = (parts || []).map(p => p.conversation_id);
    if (ids.length === 0) return [];

    // 2. Fetch the conversations
    const { data: convos, error: convosErr } = await sb
      .from('conversations')
      .select('id, title, scope, type, client_id, created_by, created_at')
      .in('id', ids);
    if (convosErr) throw convosErr;

    // 3. Fetch latest message per conversation (one batched query, then map)
    const { data: msgs } = await sb
      .from('conversation_messages')
      .select('id, conversation_id, body, subject, message_type, created_at')
      .in('conversation_id', ids)
      .order('created_at', { ascending: false })
      .limit(500);
    const lastByConvo = new Map();
    (msgs || []).forEach(m => {
      if (!lastByConvo.has(m.conversation_id)) lastByConvo.set(m.conversation_id, m);
    });

    return (convos || [])
      .map(c => {
        const last = lastByConvo.get(c.id);
        return {
          ...c,
          last_message_body: last?.body || '',
          last_message_subject: last?.subject || '',
          last_message_type: last?.message_type || null,
          last_message_at: last?.created_at || c.created_at,
        };
      })
      .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at));
  }

  async function loadMessages(conversationId) {
    if (!conversationId) return [];
    const { data, error } = await sb
      .from('conversation_messages')
      .select('id, conversation_id, profile_id, body, subject, message_type, event_type, reaction, created_at, read_by')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (error) throw error;

    // Enrich with sender names/avatars in one batched profiles query
    const senderIds = Array.from(new Set((data || []).map(m => m.profile_id).filter(Boolean)));
    let profileMap = new Map();
    if (senderIds.length) {
      const { data: profs } = await sb
        .from('profiles')
        .select('user_id, full_name, avatar_url')
        .in('user_id', senderIds);
      (profs || []).forEach(p => profileMap.set(p.user_id, p));
    }
    return (data || []).map(m => ({
      ...m,
      sender_name: profileMap.get(m.profile_id)?.full_name || '',
      sender_avatar_url: profileMap.get(m.profile_id)?.avatar_url || '',
    }));
  }

  async function sendMessage({ conversationId, userId, body, subject = null }) {
    if (!conversationId || !userId || !body) throw new Error('sendMessage: missing required fields');
    const trimmed = String(body).trim();
    if (!trimmed) throw new Error('sendMessage: empty body');
    const payload = {
      conversation_id: conversationId,
      profile_id: userId,
      body: trimmed,
    };
    if (subject) payload.subject = subject;
    const { data, error } = await sb
      .from('conversation_messages')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    // Fire-and-forget notifications insert for participants not actively viewing
    queueNotificationInserts({ conversationId, senderUserId: userId, body: trimmed }).catch(() => {});
    return data;
  }

  async function setReaction({ messageId, reaction }) {
    if (!messageId) throw new Error('setReaction: missing messageId');
    const { data, error } = await sb
      .from('conversation_messages')
      .update({ reaction: reaction || null })
      .eq('id', messageId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ─── Realtime ────────────────────────────────────────────────────────────
  function subscribeToConversation({ conversationId, onInsert, onUpdate }) {
    if (!conversationId) return null;
    const ch = sb.channel(`conversation-${conversationId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'conversation_messages',
          filter: `conversation_id=eq.${conversationId}` },
        (payload) => { try { onInsert?.(payload.new); } catch (e) { console.warn(e); } })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversation_messages',
          filter: `conversation_id=eq.${conversationId}` },
        (payload) => { try { onUpdate?.(payload.new); } catch (e) { console.warn(e); } })
      .subscribe();
    return ch;
  }

  function unsubscribe(channel) {
    if (channel) sb.removeChannel(channel);
  }

  // ─── Presence (heartbeat so push notifications skip you while you're viewing) ──
  let presenceTimer = null;
  function startPresenceHeartbeat({ userId, conversationId }) {
    stopPresenceHeartbeat();
    const tick = async () => {
      try {
        await sb.from('user_presence').upsert({
          user_id: userId,
          active_screen: 'CONVERSATION',
          active_conversation_id: conversationId || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
      } catch (e) { /* swallow */ }
    };
    tick();
    presenceTimer = setInterval(tick, 4000);
  }
  function stopPresenceHeartbeat() {
    if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
  }
  async function clearPresence(userId) {
    if (!userId) return;
    try {
      await sb.from('user_presence').upsert({
        user_id: userId, active_screen: null, active_conversation_id: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
    } catch (e) { /* swallow */ }
  }

  // ─── Notifications row inserts (text alerts; web push wires later) ──────
  async function queueNotificationInserts({ conversationId, senderUserId, body }) {
    // Find participants other than sender
    const { data: parts } = await sb
      .from('conversation_participants')
      .select('profile_id')
      .eq('conversation_id', conversationId)
      .neq('profile_id', senderUserId);
    const recipientIds = (parts || []).map(p => p.profile_id);
    if (!recipientIds.length) return;

    // Skip recipients currently viewing this conversation
    const { data: presences } = await sb
      .from('user_presence')
      .select('user_id, active_conversation_id, updated_at')
      .in('user_id', recipientIds);
    const fresh = new Set();
    (presences || []).forEach(p => {
      const ageMs = Date.now() - new Date(p.updated_at).getTime();
      if (p.active_conversation_id === conversationId && ageMs < 15_000) fresh.add(p.user_id);
    });
    const toNotify = recipientIds.filter(id => !fresh.has(id));
    if (!toNotify.length) return;

    const preview = String(body).slice(0, 140);
    const rows = toNotify.map(uid => ({
      user_id: uid,
      type: 'message',
      title: 'New Message',
      body: preview,
      is_read: false,
      route_name: 'CONVERSATION',
      route_params: { conversationId },
    }));
    await sb.from('notifications').insert(rows);
  }

  // ─── Family-routed conversation creation (mirrors app services) ─────────
  async function createOrGetClientConversation({ clientId, creatorUserId }) {
    if (!clientId) throw new Error('clientId required');

    // Resolve family members
    const { data: members, error: memErr } = await sb
      .from('family_assignments')
      .select('user_id, role, display_name')
      .eq('client_id', clientId);
    if (memErr) throw memErr;

    // Resolve client name for the title
    const { data: clientRow } = await sb
      .from('clients')
      .select('name, profile_id')
      .eq('id', clientId)
      .maybeSingle();
    const title = (clientRow?.name ? `${clientRow.name} Family` : 'Client Family');

    // Look for existing CLIENT_SHARED convo for this client
    const { data: existing } = await sb
      .from('conversations')
      .select('id')
      .eq('type', 'CLIENT_SHARED')
      .eq('client_id', clientId)
      .limit(1)
      .maybeSingle();

    let convoId = existing?.id;
    if (!convoId) {
      const createdBy = creatorUserId
        || (members || []).find(m => ['ASSISTANT','ADMIN','OWNER'].includes(String(m.role).toUpperCase()))?.user_id
        || (members || [])[0]?.user_id;
      if (!createdBy) throw new Error('No suitable creator for new conversation');
      const { data: created, error: cErr } = await sb
        .from('conversations')
        .insert({
          title, scope: 'FAMILY', type: 'CLIENT_SHARED',
          client_id: clientId, created_by: createdBy,
        })
        .select('id')
        .single();
      if (cErr) throw cErr;
      convoId = created.id;
    }

    // Sync participants — insert any missing
    if ((members || []).length) {
      const { data: existingParts } = await sb
        .from('conversation_participants')
        .select('profile_id')
        .eq('conversation_id', convoId);
      const have = new Set((existingParts || []).map(p => p.profile_id));
      const missing = (members || [])
        .filter(m => m.user_id && !have.has(m.user_id))
        .map(m => ({
          conversation_id: convoId,
          profile_id: m.user_id,
          role: ['ASSISTANT','ADMIN','OWNER'].includes(String(m.role).toUpperCase()) ? 'ADMIN' : 'CLIENT',
        }));
      if (missing.length) {
        await sb.from('conversation_participants').insert(missing);
      }
    }
    return convoId;
  }

  // ─── Call logs ──────────────────────────────────────────────────────────
  async function loadCallLogs({ conversationId, limit = 100 }) {
    if (!conversationId) return [];
    const { data, error } = await sb
      .from('call_logs')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  }

  async function createCallLog({ conversationId, callId, callerUserId, recipientUserId, callType, status }) {
    const { data, error } = await sb
      .from('call_logs')
      .insert({
        conversation_id: conversationId,
        call_id: callId,
        caller_user_id: callerUserId,
        recipient_user_id: recipientUserId || null,
        call_type: callType,
        status: status || 'initiated',
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function updateCallLogStatus({ callId, status }) {
    const { data, error } = await sb
      .from('call_logs')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('call_id', callId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ─── Notifications inbox (for the bell icon + admin) ────────────────────
  async function loadMyNotifications(userId, { unreadOnly = false, limit = 50 } = {}) {
    let q = sb.from('notifications').select('*').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(limit);
    if (unreadOnly) q = q.eq('is_read', false);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  }
  async function markNotificationRead(id) {
    if (!id) return;
    const { error } = await sb.from('notifications').update({ is_read: true }).eq('id', id);
    if (error) throw error;
  }
  async function markAllNotificationsRead(userId) {
    const { error } = await sb.from('notifications').update({ is_read: true })
      .eq('user_id', userId).eq('is_read', false);
    if (error) throw error;
  }

  // ─── Public API ─────────────────────────────────────────────────────────
  window.pmMessages = {
    loadConversations,
    loadMessages,
    sendMessage,
    setReaction,
    subscribeToConversation,
    unsubscribe,
    startPresenceHeartbeat,
    stopPresenceHeartbeat,
    clearPresence,
    createOrGetClientConversation,
    loadCallLogs,
    createCallLog,
    updateCallLogStatus,
    loadMyNotifications,
    markNotificationRead,
    markAllNotificationsRead,
  };
})();
