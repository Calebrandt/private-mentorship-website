# Web Push setup

One-time setup the owner needs to do for browser push notifications to actually deliver. The website code is already in place — it just needs VAPID keys + the edge function deployed.

## 1. Generate VAPID keys

Run this once on your local machine (anywhere with `npx`):

```bash
npx web-push generate-vapid-keys
```

You'll get something like:

```
=======================================
Public Key:
BKxxx...long-base64-url-string...

Private Key:
xxxx...shorter-base64-url-string...
=======================================
```

Keep the private key secret. The public key is fine to expose in browser code.

## 2. Add the public key to the website

Edit `js/supabase-client.js` and add at the bottom (before `window.pmSupabase = sb;`):

```js
window.PM_VAPID_PUBLIC_KEY = 'BKxxx...your public key here...';
```

Commit and push — Netlify will auto-deploy.

## 3. Deploy the edge function

```bash
cd "/Users/calebbrandt/Private Mentorship Website/website"
supabase functions deploy send-web-push
```

(or upload via the Supabase dashboard → Functions → New Function)

## 4. Set the edge function secrets

Supabase dashboard → Functions → `send-web-push` → Secrets, add:

- `VAPID_PUBLIC_KEY` — the same public key from step 1
- `VAPID_PRIVATE_KEY` — the private key from step 1
- `VAPID_SUBJECT` — `mailto:owner@privatementorship.ca` (or whatever real email)

Save.

## 5. Test from the browser

1. Open `https://privatementorship.ca/messages.html` (signed in as a real user)
2. Open DevTools → Console
3. Run:
   ```js
   await window.pmPush.requestPermissionAndSubscribe({ userId: (await window.pmSupabase.auth.getUser()).data.user.id })
   ```
4. Browser will prompt — click Allow.
5. Check `device_push_tokens` in Supabase: a new row with `device_type='web_push'` should appear.

## 6. Test delivery

From a different browser / device signed in as someone else, send a message in a shared conversation. The first browser (with the tab CLOSED) should get a native notification.

## What's wired

- `sw.js` — service worker, listens for `push`, shows notification, click → focus/open `messages.html?c=<conversationId>`
- `js/push-service.js` — `pmPush.init()` (called automatically on `messages.html` load if user already granted permission), `pmPush.requestPermissionAndSubscribe()` (call this from a UI button), `pmPush.unsubscribe()`
- `messages.html` — calls `pmPush.init()` after auth resolves; calls `pmPush.fanOutForMessage()` after every send so other participants get pushed
- `device_push_tokens` table — reused with `device_type='web_push'`. The `push_token` column stores the JSON-stringified PushSubscription `{endpoint, keys: {p256dh, auth}}`

## Things to know

- Push only works on **HTTPS or localhost**. `127.0.0.1:5500` (Live Server) works.
- iOS Safari supports Web Push **only when the site is added to the Home Screen** (PWA). Not from the regular tab.
- Service Worker is at the root path (`/sw.js`) so its scope covers the whole site.
- Dead subscriptions (404 / 410 from the push endpoint) are auto-cleaned from `device_push_tokens` by the edge function.
- The edge function skips users who have a `user_presence` row showing `active_conversation_id = <this convo>` updated within the last 15s — same suppression rule the in-app notification table uses.
