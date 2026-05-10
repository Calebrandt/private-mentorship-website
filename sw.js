// Private Mentorship — Web Push service worker
// Receives push events when the tab is closed/backgrounded and shows
// a native browser notification. Click → focus or open messages.html
// at the right conversation.

const NOTIFICATION_TAG_PREFIX = 'pm-msg-';

self.addEventListener('install', (event) => {
  // Activate immediately so the first registration starts handling pushes.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    try { payload = { title: 'Private Mentorship', body: event.data?.text?.() || 'New message' }; }
    catch (__) { payload = { title: 'Private Mentorship', body: 'New message' }; }
  }

  const title = payload.title || 'Private Mentorship';
  const body = payload.body || '';
  const tag = payload.tag || `${NOTIFICATION_TAG_PREFIX}${payload.conversationId || 'general'}`;
  const data = {
    conversationId: payload.conversationId || null,
    notificationId: payload.notificationId || null,
    type: payload.type || 'message',
    url: payload.url || `/messages.html${payload.conversationId ? `?c=${encodeURIComponent(payload.conversationId)}` : ''}`,
  };

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/assets/logos/pm-logo.png',
      badge: '/assets/logos/pm-logo.png',
      renotify: true,
      data,
      actions: payload.type === 'call'
        ? [{ action: 'accept', title: 'Accept' }, { action: 'decline', title: 'Decline' }]
        : [],
      requireInteraction: payload.type === 'call',
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  // Decline action just dismisses — the caller's call_log will time
  // out on its own. (No DB call from the SW; it doesn't have an auth
  // session.)
  if (event.action === 'decline') return;

  const isCall = data.type === 'call' && data.callId;
  // For accept (or main click on a call notification): always go to
  // messages.html with the auto-accept params so the call joins
  // immediately on landing.
  let target;
  if (isCall) {
    const params = new URLSearchParams({
      incomingCall: data.callId,
      callType: data.callType || 'audio',
      conversationId: data.conversationId || '',
    });
    target = new URL(`/messages.html?${params.toString()}`, self.location.origin).href;
  } else {
    target = new URL(data.url || '/messages.html', self.location.origin).href;
  }

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // For call accepts, navigate any existing client to the auto-accept
    // URL so it joins. For messages, focus an existing tab if found.
    for (const client of allClients) {
      try {
        const cu = new URL(client.url);
        if (cu.pathname === '/messages.html' || cu.pathname.endsWith('/messages.html')) {
          if (isCall) {
            // Force navigation so URL params trigger auto-join
            await client.focus();
            await client.navigate(target);
            return;
          }
          client.focus();
          if (data.conversationId) {
            client.postMessage({
              type: 'PM_OPEN_CONVERSATION',
              conversationId: data.conversationId,
            });
          }
          return;
        }
      } catch (_) { /* skip */ }
    }
    // No existing PM tab — open a fresh one.
    if (self.clients.openWindow) {
      await self.clients.openWindow(target);
    }
  })());
});
