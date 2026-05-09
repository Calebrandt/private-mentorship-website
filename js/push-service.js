// Web Push registration helper for the Private Mentorship website.
//
// Registers /sw.js, requests notification permission, subscribes to
// push using the VAPID public key, and upserts the resulting endpoint
// into device_push_tokens with device_type='web_push'.
//
// Real delivery happens via the send-web-push edge function. This file
// only handles the browser side.
//
// Depends on:
//   - window.pmSupabase (supabase-client.js)
//   - window.PM_VAPID_PUBLIC_KEY (set in supabase-client.js once VAPID
//     keys are generated and stored as Supabase secrets)
//
// Exposes window.pmPush.

(function () {
  const sb = window.pmSupabase;
  if (!sb) {
    console.warn('[push] pmSupabase not loaded — load supabase-client.js first');
    return;
  }

  const VAPID_PUBLIC_KEY = window.PM_VAPID_PUBLIC_KEY || '';

  function canUse() {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window &&
      window.isSecureContext // localhost or https://
    );
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  async function registerServiceWorker() {
    if (!canUse()) return null;
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    return reg;
  }

  async function getCurrentPermission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission; // 'granted' | 'denied' | 'default'
  }

  async function subscribeAndStore({ userId }) {
    if (!canUse()) throw new Error('Push not supported on this browser');
    if (!VAPID_PUBLIC_KEY) {
      throw new Error('VAPID public key missing — set window.PM_VAPID_PUBLIC_KEY in supabase-client.js');
    }
    if (!userId) throw new Error('userId required');

    const reg = await registerServiceWorker();
    if (!reg) throw new Error('Service worker registration failed');

    // Re-use an existing subscription if present
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const subJson = sub.toJSON();
    // Normalize to a stable shape regardless of browser
    const subscription = {
      endpoint: subJson.endpoint,
      keys: {
        p256dh: subJson.keys?.p256dh || arrayBufferToBase64(sub.getKey('p256dh') || new ArrayBuffer(0)),
        auth: subJson.keys?.auth || arrayBufferToBase64(sub.getKey('auth') || new ArrayBuffer(0)),
      },
    };

    // Upsert into device_push_tokens. We key by (user_id, push_token)
    // using the endpoint as a stable identifier so re-registrations
    // don't create duplicates.
    const tokenStr = JSON.stringify(subscription);
    // Try upsert by endpoint — if a row already exists for this user
    // with the same endpoint, just touch updated_at; otherwise insert.
    try {
      const { data: existing } = await sb
        .from('device_push_tokens')
        .select('id, push_token')
        .eq('user_id', userId)
        .eq('device_type', 'web_push');
      const match = (existing || []).find((row) => {
        try { return JSON.parse(row.push_token)?.endpoint === subscription.endpoint; }
        catch (_) { return false; }
      });
      if (match) {
        await sb.from('device_push_tokens').update({ push_token: tokenStr }).eq('id', match.id);
      } else {
        await sb.from('device_push_tokens').insert({
          user_id: userId,
          push_token: tokenStr,
          device_type: 'web_push',
        });
      }
    } catch (e) {
      console.warn('[push] device_push_tokens upsert failed', e);
    }

    return subscription;
  }

  async function unsubscribe({ userId }) {
    if (!canUse()) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        if (userId && endpoint) {
          // Remove the matching device_push_tokens row (by endpoint match)
          const { data: rows } = await sb
            .from('device_push_tokens')
            .select('id, push_token')
            .eq('user_id', userId)
            .eq('device_type', 'web_push');
          for (const r of rows || []) {
            try {
              if (JSON.parse(r.push_token)?.endpoint === endpoint) {
                await sb.from('device_push_tokens').delete().eq('id', r.id);
              }
            } catch (_) {}
          }
        }
      }
    } catch (e) {
      console.warn('[push] unsubscribe failed', e);
    }
  }

  // Best-effort init: register SW + subscribe if permission already granted,
  // skip prompting (caller decides when to prompt).
  async function init({ userId }) {
    if (!canUse()) return { ok: false, reason: 'unsupported' };
    if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'no-vapid-key' };
    try {
      await registerServiceWorker();
    } catch (e) {
      return { ok: false, reason: 'sw-failed', error: e?.message || String(e) };
    }
    const perm = await getCurrentPermission();
    if (perm === 'granted') {
      try {
        await subscribeAndStore({ userId });
        return { ok: true, perm: 'granted' };
      } catch (e) {
        return { ok: false, reason: 'subscribe-failed', error: e?.message || String(e) };
      }
    }
    return { ok: false, reason: perm }; // 'default' or 'denied'
  }

  // Prompt user, then subscribe if granted. Call this from an explicit UI
  // gesture (button click) — browsers will silently reject otherwise.
  async function requestPermissionAndSubscribe({ userId }) {
    if (!canUse()) throw new Error('Push not supported on this browser');
    const result = await Notification.requestPermission();
    if (result !== 'granted') return { ok: false, perm: result };
    const sub = await subscribeAndStore({ userId });
    return { ok: true, perm: 'granted', subscription: sub };
  }

  // Listen to messages from the SW (e.g. PM_OPEN_CONVERSATION on click)
  function onServiceWorkerMessage(handler) {
    if (!('serviceWorker' in navigator)) return () => {};
    const fn = (ev) => { try { handler?.(ev.data); } catch (e) { console.warn(e); } };
    navigator.serviceWorker.addEventListener('message', fn);
    return () => navigator.serviceWorker.removeEventListener('message', fn);
  }

  // Fan-out: tells the edge function to deliver a push to other
  // participants in a conversation. Safe no-op if the edge function
  // isn't deployed yet (or the user doesn't have web_push tokens).
  async function fanOutForMessage({ conversationId, senderUserId, body, subject }) {
    if (!conversationId || !senderUserId) return;
    try {
      await sb.functions.invoke('send-web-push', {
        body: {
          source: 'message',
          conversationId,
          senderUserId,
          title: subject || 'New message',
          body: (body || '').slice(0, 220),
          type: 'message',
        },
      });
    } catch (e) {
      // Don't let a missing/failing push function break message send.
      console.warn('[push] fan-out failed (non-fatal)', e?.message || e);
    }
  }

  window.pmPush = {
    canUse,
    init,
    requestPermissionAndSubscribe,
    unsubscribe,
    getCurrentPermission,
    onServiceWorkerMessage,
    fanOutForMessage,
  };
})();
