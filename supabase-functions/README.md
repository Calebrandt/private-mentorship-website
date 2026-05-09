# Supabase Edge Functions for the Private Mentorship website

These are server-side helpers that the website needs. Right now there's one:

## `notify-submission`

Emails the owner whenever an applicant submits or resubmits a hiring application via the website wizard.

### Step 1 — Make a Resend account (free, 1 minute)

1. Go to https://resend.com/signup and sign up.
2. Once in, go to **API Keys** → **Create API Key** → name it "Private Mentorship" → click **Create**.
3. Copy the API key (starts with `re_`). You won't see it again, so paste it somewhere safe.
4. (Optional but recommended) Add and verify your domain at https://resend.com/domains so emails come from `you@privatementorship.com` instead of Resend's sandbox sender.

### Step 2 — Deploy the function in your Supabase dashboard

1. Open https://supabase.com/dashboard/project/llkicgphkvciumfzhbkk/functions
2. Click **Deploy a new function** → name it exactly `notify-submission`.
3. **Disable** the "Verify JWT" toggle for now (the wizard sends an authenticated request, but if it gives you trouble during setup, you can re-enable later).
4. Open `supabase-functions/notify-submission/index.ts` from this repo, copy the entire file, paste it into the Supabase dashboard's code editor.
5. Click **Deploy**.

### Step 3 — Set the secrets (env vars)

In the same function's settings page, under **Secrets**, add:

| Name | Value |
|---|---|
| `RESEND_API_KEY` | Your Resend API key from step 1 |
| `NOTIFY_TO_EMAIL` | The email you want notifications sent to (your inbox) |
| `NOTIFY_FROM_EMAIL` | `Private Mentorship <onboarding@resend.dev>` (for sandbox) **or** `Private Mentorship <hiring@yourdomain.com>` (after verifying a domain) |
| `ADMIN_REVIEW_BASE_URL` | The URL where the admin dashboard lives. Local: `http://127.0.0.1:5500`. Production: `https://yourdomain.com` |

Click **Save**.

### Step 4 — Test it

1. Sign up via `hiring-entry.html` with a real email you can read.
2. Fill out and submit the wizard.
3. Within ~5 seconds the address you set as `NOTIFY_TO_EMAIL` should receive an email titled "New assistant application — …".
4. The "Review application" button in the email opens the admin dossier directly.

### What this does NOT cover (yet)

- Notifying the **applicant** when their application is accepted, rejected, or has a correction request. The schema queues those in `email_outbox` but no worker processes that queue yet — separate task.
- SMS notifications.
- Bulk reminder emails.
