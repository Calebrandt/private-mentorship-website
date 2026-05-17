// Supabase Edge Function: email-financial-document
// ─────────────────────────────────────────────────────────────────────
// Phase 19c.4c — emails a freshly-rendered financial PDF (invoice,
// receipt, or paycheque) to a customer or assistant via Resend, then
// stamps an audit_logs row so every send is on the record.
//
// Triggered from admin-financials.html via:
//   supabase.functions.invoke('email-financial-document', { body: {...} })
//
// REQUEST BODY
//   docType:     'invoice' | 'receipt' | 'paycheque'
//   docId:       uuid of the document
//   docNumber:   optional display number (INV-000001) — used in audit + subject
//   to:          recipient email
//   subject:     email subject line
//   body:        plaintext email body (also rendered as HTML below)
//   filename:    attachment filename, e.g. INV-000001.pdf
//   pdfBase64:   base64-encoded PDF (no data:... prefix)
//   meta?:       optional { totalCents, balanceCents, docDate, dueDate,
//                           clientName } — drives the branded amount block
//                in the email body. All fields optional.
//
// RESPONSE
//   { ok: true,  messageId, ref }      on success
//   { ok: false, error }               on failure
//
// REQUIRED ENV VARS (set via the Supabase dashboard → Functions → email-financial-document → "Secrets"):
//   RESEND_API_KEY        — same Resend key the rest of the site uses
//   NOTIFY_FROM_EMAIL     — verified From: header, e.g. "Private Mentorship <billing@private-mentorship.com>"
//   REPLY_TO_EMAIL        — (optional) Reply-To address (defaults to billing@private-mentorship.com)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided by the runtime.
// ─────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB — Resend tops out around 40 MB but this keeps us safe

type DocType = "invoice" | "receipt" | "paycheque";

interface ReqLine {
  description?: string | null;
  quantity?: number | null;
  unit_price_cents?: number | null;   // invoices
  line_total_cents?: number | null;   // invoices + paycheques
  unit_price?: number | null;         // receipts (dollars)
  line_total?: number | null;         // receipts (dollars)
  hours?: number | null;              // paycheques
  hourly_rate_cents?: number | null;  // paycheques
}
interface ReqMeta {
  totalCents?: number | null;
  paidCents?: number | null;
  balanceCents?: number | null;
  docDate?: string | null;
  dueDate?: string | null;
  clientName?: string | null;
  // Rich BILLED TO block
  guardianName?: string | null;
  studentName?: string | null;
  billingAddress?: string | null;
  billingPhone?: string | null;
  billingEmail?: string | null;
  billingEmailSecondary?: string | null;
  // Document context
  subject?: string | null;
  terms?: string | null;
  customerNotes?: string | null;
  currency?: string | null;
  // Inline line items table
  lines?: ReqLine[] | null;
}
interface ReqBody {
  docType: DocType;
  docId: string;
  docNumber?: string | null;
  to: string | string[];           // primary recipient(s) — string OR array OR comma-separated
  cc?: string | string[] | null;   // optional carbon-copy recipients
  bcc?: string | string[] | null;  // optional blind-carbon-copy recipients
  subject: string;
  body: string;
  filename: string;
  pdfBase64: string;
  meta?: ReqMeta | null;
}

// Accepts string | string[] | comma-separated string, returns deduped
// trimmed array of valid email addresses. Empty input → empty array.
function parseRecipients(input: string | string[] | null | undefined): string[] {
  if (!input) return [];
  const raw = Array.isArray(input) ? input : String(input).split(/[,;]/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const s = String(r || "").trim();
    if (!s) continue;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) continue;  // skip invalid silently
    const lower = s.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(s);
  }
  return out;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return (s || "").toString().replace(/[&<>"']/g, (c) => {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c] || c;
  });
}

function bodyToHtml(text: string): string {
  // Convert plaintext body to lightly-styled HTML — preserves paragraphs &
  // single-line breaks while keeping the look e-mail-client safe.
  const escaped = escapeHtml(text || "");
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6;color:#475569;font-size:14px;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function fmtMoneyCents(cents: number | null | undefined): string {
  const n = (Number(cents) || 0) / 100;
  return n.toLocaleString("en-CA", { style: "currency", currency: "CAD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateShort(v: string | null | undefined): string {
  if (!v) return "";
  const s = String(v).slice(0, 10);
  // ISO YYYY-MM-DD → Mon DD, YYYY
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

// ─── Branded HTML email shell — 1:1 port of the React Native app design ──
// Matches the screenshot Caleb shared (IMG_3756.PNG) showing the receipt
// email from the app. Clean Stripe-style transactional email — dark slate
// header card + greeting + intro + big dashed amount block + optional
// notes + thank-you footer. No line items table, no multi-row totals
// breakdown, no payment-instructions card — the PDF attachment carries
// the detail; the email body conveys the headline at a glance.
function buildBrandedEmailHtml(opts: {
  docType: DocType;
  docNumber: string | null | undefined;
  body: string;
  filename: string;
  meta?: ReqMeta | null;
}): string {
  const BRAND_PRIMARY = "#0f172a";  // dark slate — header card
  const BRAND_ACCENT  = "#2563eb";  // blue accent — doc number
  const BG            = "#f1f5f9";  // light slate page background
  const CARD_BG       = "#ffffff";

  const COMPANY_NAME = "Private Mentorship";

  const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif`;

  const docLabel = String(opts.docType).toUpperCase();
  const num      = opts.docNumber ? `#${escapeHtml(opts.docNumber)}` : "";
  const m        = opts.meta || {};

  // ─── Greeting — use FULL client/student name (matches IMG_3756) ────
  const fullName  = (m.studentName || m.clientName || m.guardianName || "").trim();
  const greeting  = fullName ? `Hello <strong>${escapeHtml(fullName)}</strong>,` : `Hello,`;

  // ─── Intro line ────────────────────────────────────────────────────
  const defaultIntro =
    opts.docType === "receipt"
      ? "This email confirms that we have received your payment. A detailed PDF copy is attached to this email for your records."
      : opts.docType === "paycheque"
        ? "Your paycheque is attached as a PDF for your records."
        : "Please find your invoice attached as a PDF for your records.";
  const intro = (opts.body || "").trim() || defaultIntro;

  // ─── Big amount block — label + figure + sub-info ──────────────────
  const amountLabel =
    opts.docType === "receipt"   ? "Amount Paid"  :
    opts.docType === "paycheque" ? "Net Pay"      :
                                   "Total Amount";

  const headlineCents = Number(m.totalCents ?? 0);
  const headlineAmount = fmtMoneyCents(headlineCents);

  const balanceLine = (opts.docType === "invoice" && m.balanceCents != null)
    ? `<div><strong>Balance Due:</strong> ${escapeHtml(fmtMoneyCents(Number(m.balanceCents)))}</div>`
    : "";
  const dateLine = (() => {
    if (opts.docType === "receipt"  && m.docDate) return `<div>Paid on ${escapeHtml(fmtDateShort(m.docDate))}</div>`;
    if (opts.docType === "paycheque" && m.docDate) return `<div>Pay date · ${escapeHtml(fmtDateShort(m.docDate))}</div>`;
    if (opts.docType === "invoice"  && m.docDate) return `<div>Issued on ${escapeHtml(fmtDateShort(m.docDate))}</div>`;
    return "";
  })();
  const dueLine = (opts.docType === "invoice" && m.dueDate)
    ? `<div>Due by ${escapeHtml(fmtDateShort(m.dueDate))}</div>`
    : "";

  // Bigger figure for receipts (single headline) to mirror the app
  const figureSize = opts.docType === "receipt" ? 36 : 32;

  const amountBlock = `
        <div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:25px;text-align:center;margin:24px 0 0 0;">
          <div style="font-size:11px;text-transform:uppercase;color:#94a3b8;letter-spacing:0.1em;font-weight:700;">${escapeHtml(amountLabel)}</div>
          <div style="font-size:${figureSize}px;color:${BRAND_PRIMARY};font-weight:700;margin:10px 0;">${escapeHtml(headlineAmount)}</div>
          <div style="font-size:12px;color:#64748b;line-height:1.6;">
            ${balanceLine}
            ${dateLine}
            ${dueLine}
          </div>
        </div>`;

  // ─── Description block (customer notes) — matches IMG_3756 ─────────
  const notesBlock = m.customerNotes
    ? `
        <div style="margin-top:30px;">
          <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#334155;margin-bottom:6px;letter-spacing:0.04em;">Description</div>
          <div style="font-size:14px;color:#64748b;line-height:1.5;">${escapeHtml(m.customerNotes)}</div>
        </div>`
    : "";

  // ─── Final assembled email — 1:1 with the app's clean design ───────
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;">
  <div style="background-color:${BG};padding:40px 10px;font-family:${FONT};color:#334155;">
    <div style="max-width:600px;margin:0 auto;background:${CARD_BG};border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">

      <div style="background:${BRAND_PRIMARY};padding:30px 40px;text-align:center;">
        <h1 style="color:#ffffff;margin:0;font-size:24px;letter-spacing:0.05em;text-transform:uppercase;">${escapeHtml(docLabel)}</h1>
        ${num ? `<p style="color:${BRAND_ACCENT};margin:5px 0 0 0;font-size:14px;font-weight:600;">${num}</p>` : ""}
      </div>

      <div style="padding:40px;">
        <p style="font-size:16px;margin:0 0 20px 0;color:#334155;">${greeting}</p>
        <p style="font-size:14px;line-height:1.6;color:#64748b;margin:0 0 24px 0;">${escapeHtml(intro)}</p>

        ${amountBlock}

        ${notesBlock}

        <div style="margin-top:40px;border-top:1px solid #e2e8f0;padding-top:20px;text-align:center;font-size:12px;color:#94a3b8;">
          Thank you for choosing ${escapeHtml(COMPANY_NAME)}.
        </div>
      </div>

    </div>
  </div>
</body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  // ─── Env ──────────────────────────────────────────────────────────
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
  const NOTIFY_FROM    = Deno.env.get("NOTIFY_FROM_EMAIL") || "Private Mentorship <billing@private-mentorship.com>";
  const REPLY_TO       = Deno.env.get("REPLY_TO_EMAIL") || "billing@private-mentorship.com";

  if (!RESEND_API_KEY) {
    return jsonResponse(500, { ok: false, error: "RESEND_API_KEY not configured." });
  }

  // ─── Body + validation ────────────────────────────────────────────
  let body: ReqBody;
  try {
    body = await req.json();
  } catch (_) {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body." });
  }

  const { docType, docId, docNumber, to, cc, bcc, subject, body: emailBody, filename, pdfBase64 } = body || ({} as ReqBody);

  if (!docType || !["invoice", "receipt", "paycheque"].includes(docType)) {
    return jsonResponse(400, { ok: false, error: "docType must be invoice|receipt|paycheque" });
  }
  if (!docId || !/^[0-9a-f-]{8,}$/i.test(docId)) {
    return jsonResponse(400, { ok: false, error: "Valid docId required" });
  }
  // Parse + validate all three recipient buckets (each accepts string, array,
  // or comma/semicolon-separated string). Invalid addresses are silently
  // dropped so partial typos in CC don't kill the whole send.
  const toList  = parseRecipients(to);
  const ccList  = parseRecipients(cc);
  const bccList = parseRecipients(bcc);
  if (toList.length === 0) {
    return jsonResponse(400, { ok: false, error: "At least one valid recipient (To) is required" });
  }
  if (!subject) return jsonResponse(400, { ok: false, error: "subject required" });
  if (!filename) return jsonResponse(400, { ok: false, error: "filename required" });
  if (!pdfBase64) return jsonResponse(400, { ok: false, error: "pdfBase64 required" });

  // Size guard
  const approxBytes = Math.floor((pdfBase64.length * 3) / 4);
  if (approxBytes > MAX_PDF_BYTES) {
    return jsonResponse(413, { ok: false, error: `PDF too large (${(approxBytes / 1024 / 1024).toFixed(1)} MB)` });
  }

  // ─── Verify caller is admin/owner using their JWT ─────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return jsonResponse(401, { ok: false, error: "Missing Authorization header" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Caller's identity (verified by the user's JWT)
  const sbUser = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userErr } = await sbUser.auth.getUser(token);
  if (userErr || !userData?.user) {
    return jsonResponse(401, { ok: false, error: "Invalid session" });
  }
  const callerId = userData.user.id;

  // Service-role client for audit-log inserts (bypasses RLS)
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Admin check MUST use the user's JWT so `is_admin()` can read auth.uid()
  const { data: isAdminData, error: isAdminErr } = await sbUser.rpc("is_admin");
  if (isAdminErr || !isAdminData) {
    return jsonResponse(403, { ok: false, error: "Admin/owner role required" });
  }

  // ─── Send via Resend — branded HTML shell (matches the app design) ───
  const html = buildBrandedEmailHtml({
    docType,
    docNumber,
    body: emailBody || "",
    filename,
    meta: body?.meta || null,
  });

  const resendPayload: Record<string, unknown> = {
    from: NOTIFY_FROM,
    to: toList,
    reply_to: REPLY_TO,
    subject,
    html,
    text: emailBody || "",
    attachments: [
      { filename: filename, content: pdfBase64 },
    ],
  };
  if (ccList.length)  resendPayload.cc  = ccList;
  if (bccList.length) resendPayload.bcc = bccList;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(resendPayload),
  });

  const resendBodyText = await resendRes.text();
  let resendParsed: any = null;
  try { resendParsed = JSON.parse(resendBodyText); } catch (_) { resendParsed = { raw: resendBodyText }; }

  if (!resendRes.ok) {
    // Try to log the failed attempt too, then bubble up the error
    try {
      await sb.from("audit_logs").insert({
        user_id: callerId,
        action: "EMAIL_FINANCIAL_DOC_FAILED",
        entity_type: docType,
        entity_id: docId,
        details: {
          to: toList,
          cc: ccList,
          bcc: bccList,
          subject,
          filename,
          doc_number: docNumber,
          resend_status: resendRes.status,
          resend_error: resendParsed?.message || resendParsed?.raw || "unknown",
        },
      });
    } catch (_) { /* swallow */ }
    return jsonResponse(502, { ok: false, error: `Resend error: ${resendParsed?.message || resendBodyText}` });
  }

  const messageId: string | null = resendParsed?.id || null;

  // ─── Audit log (success) ─────────────────────────────────────────
  // Best-effort — we don't fail the request if the audit insert breaks.
  try {
    await sb.from("audit_logs").insert({
      user_id: callerId,
      action: "EMAIL_FINANCIAL_DOC_SENT",
      entity_type: docType,
      entity_id: docId,
      details: {
        to: toList,
        cc: ccList,
        bcc: bccList,
        subject,
        filename,
        doc_number: docNumber,
        bytes: approxBytes,
        resend_message_id: messageId,
      },
    });
  } catch (e) {
    console.warn("[email-financial-document] audit_logs insert failed:", e);
  }

  return jsonResponse(200, {
    ok: true,
    messageId,
    ref: docNumber || docId,
  });
});
