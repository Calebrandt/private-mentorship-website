# `email-financial-document` — deployment notes

Phase 19c.4c. Emails a freshly-rendered financial PDF (invoice / receipt / paycheque) to a customer or assistant via Resend, and stamps an `audit_logs` row so every send is on the record.

Called from `admin-financials.html` via the `pmHiring.sendFinancialEmail()` wrapper in `js/hiring-service.js`.

---

## 1. Deploy the function

```bash
# From the website/ directory
supabase functions deploy email-financial-document --project-ref llkicgphkvciumfzhbkk
```

(If you prefer to deploy from the dashboard, just paste `index.ts` into the editor and click Deploy.)

---

## 2. Set the secrets

Supabase dashboard → **Edge Functions** → **email-financial-document** → **Secrets** tab. Add:

| Key                | Value                                                              | Notes |
|--------------------|--------------------------------------------------------------------|-------|
| `RESEND_API_KEY`   | (same key you use for `notify-submission`)                         | Reuse the existing Resend key. |
| `NOTIFY_FROM_EMAIL`| `Private Mentorship <billing@privatementorship.com>`               | Must be a verified Resend sender or verified domain. |
| `REPLY_TO_EMAIL`   | `caleb@privatementorship.com`                                       | Optional — defaults to caleb@privatementorship.com if omitted. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-provided by the runtime — no action needed.

---

## 3. Verify

In `admin-financials.html`:

1. Click **PDF** on any invoice row → preview should render.
2. Click **Email** → composer opens with the recipient + subject + body pre-filled.
3. Click **Send email** → toast shows `Email sent ✓`.
4. Check the recipient inbox.
5. In the Supabase SQL editor:

```sql
select created_at, user_id, action, entity_type, entity_id, details
from audit_logs
where action in ('EMAIL_FINANCIAL_DOC_SENT','EMAIL_FINANCIAL_DOC_FAILED')
order by created_at desc
limit 10;
```

Every send (success or failure) shows up here with the Resend message-ID, recipient, file name, and document number. This is the audit trail.

---

## 4. Behaviour notes

- **Admin-gated.** Function calls `is_admin()` (the same Postgres helper the bookkeeping RPCs use) with the caller's JWT. Non-admins get HTTP 403.
- **10 MB hard cap** on the PDF attachment — anything bigger is rejected before it leaves the browser. (Resend itself allows ~40 MB, but our PDFs are small.)
- **Failures are logged too.** If Resend errors out, the function writes an `EMAIL_FINANCIAL_DOC_FAILED` audit row including Resend's error message, then returns HTTP 502 so the UI can surface the failure as a toast.
- **Reply-to** is set so the customer can hit Reply on the e-mail and reach Caleb directly.
- **Idempotency** is *not* enforced server-side — clicking "Send" twice will send twice. Re-deploys are safe to do at any time.
