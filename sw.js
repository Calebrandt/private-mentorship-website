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

  const url = event.notification.data?.url || '/messages.html';
  const target = new URL(url, self.location.origin).href;

  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // If a tab is already open on messages.html, focus it
    for (const client of allClients) {
      try {
        const cu = new URL(client.url);
        if (cu.pathname === '/messages.html' || cu.pathname.endsWith('/messages.html')) {
          client.focus();
          // Let the page know which conversation to open
          if (event.notification.data?.conversationId) {
            client.postMessage({
              type: 'PM_OPEN_CONVERSATION',
              conversationId: event.notification.data.conversationId,
            });
          }
          return;
        }
      } catch (_) { /* skip */ }
    }
    // Otherwise open a fresh tab
    if (self.clients.openWindow) {
      await self.clients.openWindow(target);
    }
  })());
});
