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
  to: string;
  subject: string;
  body: string;
  filename: string;
  pdfBase64: string;
  meta?: ReqMeta | null;
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

// ─── Branded HTML email shell — Stripe/Square-style inline receipt ───────
// The email body IS the document. Same visual language as the PDF, rendered
// in HTML so the recipient sees the full invoice/receipt without having to
// open the PDF attachment. The PDF is still attached for their records.
//
// Email-client compatibility notes:
//   • All styles inline (most clients strip <style> blocks)
//   • Table-based layout where it matters (Outlook desktop)
//   • Single 600px-wide card centered on a soft background
//   • Web-safe fonts only (Outfit/Inter ignored by most clients,
//     fallback chain hits Helvetica → system sans)
//   • Logos hosted on Supabase storage (public bucket, served with CORS)
function buildBrandedEmailHtml(opts: {
  docType: DocType;
  docNumber: string | null | undefined;
  body: string;
  filename: string;
  meta?: ReqMeta | null;
}): string {
  // ─── Palette — matches the PDF's airy luxury-minimal feel ──────────
  const INK        = "#1f1f1f";
  const INK_SOFT   = "#4a4a4a";
  const INK_MUTE   = "#6a6a6a";
  const INK_TERT   = "#8a8a8a";
  const HAIRLINE   = "#e2e2e2";
  const ROW_LINE   = "#ededed";
  const HIGHLIGHT  = "#e5e5e5";
  const SIDEBAR_BG = "#efefef";
  const BG         = "#f4f4f4";
  const CARD_BG    = "#ffffff";

  const LOGO_URL = "https://llkicgphkvciumfzhbkk.supabase.co/storage/v1/object/public/branding/RecLogo.png";

  const COMPANY_NAME  = "Private Mentorship";
  const COMPANY_EMAIL = "billing@private-mentorship.com";
  const COMPANY_WEB   = "privatementorship.ca";

  const FONT = `'Outfit','Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif`;

  const docLabel = String(opts.docType).toUpperCase();
  const num      = opts.docNumber ? `#${escapeHtml(opts.docNumber)}` : "";
  const m        = opts.meta || {};
  const ccy      = (m.currency || "CAD").toUpperCase();

  // ─── Greeting ──────────────────────────────────────────────────────
  const greetName = (m.guardianName || m.clientName || "").trim();
  const firstName = greetName ? greetName.split(/\s+/)[0] : "";
  const greeting  = firstName ? `Hello ${escapeHtml(firstName)},` : `Hello,`;

  // ─── Intro line ────────────────────────────────────────────────────
  const defaultIntro =
    opts.docType === "receipt"
      ? "This email confirms your payment. The full receipt is below — a PDF copy is also attached for your records."
      : opts.docType === "paycheque"
        ? "Your paycheque is below — a PDF copy is also attached for your records."
        : "Your invoice is below — a PDF copy is also attached for your records.";
  const intro = (opts.body || "").trim() || defaultIntro;

  // ─── BILLED TO / RECEIVED FROM / PAID TO block ─────────────────────
  const partyLabel =
    opts.docType === "invoice"   ? "Billed To" :
    opts.docType === "receipt"   ? "Received From" :
                                   "Paid To";
  const partyHeadline = m.guardianName
    ? `Guardian: ${escapeHtml(m.guardianName)}`
    : escapeHtml(m.clientName || "—");
  const partyForLine = (m.guardianName && m.clientName)
    ? `<div style="margin-top:2px;color:${INK_TERT};font-style:italic;">For: ${escapeHtml(m.clientName)}</div>`
    : "";
  const partyAddress = m.billingAddress ? `<div>${escapeHtml(m.billingAddress)}</div>` : "";
  const partyPhone   = m.billingPhone   ? `<div>${escapeHtml(m.billingPhone)}</div>` : "";
  const partyEmail   = m.billingEmail   ? `<div>${escapeHtml(m.billingEmail)}</div>` : "";
  const partyEmail2  = m.billingEmailSecondary ? `<div>${escapeHtml(m.billingEmailSecondary)}</div>` : "";

  // ─── Document details (right-side mini-table) ──────────────────────
  const dateLabelLeft  = opts.docType === "receipt" ? "Received" : opts.docType === "paycheque" ? "Pay Date" : "Issued";
  const dateValueLeft  = m.docDate ? fmtDateShort(m.docDate) : "";
  const dueRow = (opts.docType === "invoice" && m.dueDate)
    ? `<tr><td style="padding:4px 0;color:${INK_TERT};font-style:italic;">Due</td><td style="padding:4px 0;text-align:right;color:${INK};font-weight:500;">${escapeHtml(fmtDateShort(m.dueDate))}</td></tr>`
    : "";
  const subjectRow = (opts.docType === "invoice" && m.subject)
    ? `<tr><td style="padding:4px 0;color:${INK_TERT};font-style:italic;">Subject</td><td style="padding:4px 0;text-align:right;color:${INK};font-weight:500;">${escapeHtml(m.subject)}</td></tr>`
    : "";

  // ─── Line items table ──────────────────────────────────────────────
  const lines = Array.isArray(m.lines) ? m.lines : [];
  const isPaycheque = opts.docType === "paycheque";
  const isReceipt   = opts.docType === "receipt";

  // Normalize each line into cents
  const itemRows = lines.map((l, idx) => {
    let qty = Number(l.quantity ?? l.hours ?? 0) || 0;
    let unitCents = 0;
    let totalCents = 0;
    if (isPaycheque) {
      qty = Number(l.hours ?? 0) || 0;
      unitCents = Number(l.hourly_rate_cents ?? 0) || 0;
      totalCents = Number(l.line_total_cents ?? Math.round(qty * unitCents)) || 0;
    } else if (isReceipt) {
      // sales_receipt_lines stores dollars
      const qDollars = Number(l.quantity ?? 1) || 1;
      const unitDollars = Number(l.unit_price ?? 0) || 0;
      const totalDollars = Number(l.line_total ?? qDollars * unitDollars) || 0;
      qty = qDollars;
      unitCents = Math.round(unitDollars * 100);
      totalCents = Math.round(totalDollars * 100);
    } else {
      qty = Number(l.quantity ?? 0) || 0;
      unitCents = Number(l.unit_price_cents ?? 0) || 0;
      totalCents = Number(l.line_total_cents ?? Math.round(qty * unitCents)) || 0;
    }
    const qtyDisplay = isPaycheque ? qty.toFixed(2) : String(qty);
    return `
      <tr>
        <td style="padding:14px 8px 14px 0;border-bottom:1px solid ${ROW_LINE};color:${INK};font-weight:400;font-size:13px;vertical-align:top;">
          ${escapeHtml(l.description || "—")}
        </td>
        <td style="padding:14px 8px;border-bottom:1px solid ${ROW_LINE};color:${INK_MUTE};font-size:13px;text-align:center;vertical-align:top;">
          ${escapeHtml(qtyDisplay)}
        </td>
        <td style="padding:14px 8px;border-bottom:1px solid ${ROW_LINE};color:${INK_MUTE};font-size:13px;text-align:right;vertical-align:top;font-variant-numeric:tabular-nums;">
          ${escapeHtml(fmtMoneyCents(unitCents))}
        </td>
        <td style="padding:14px 0 14px 8px;border-bottom:1px solid ${ROW_LINE};color:${INK};font-weight:500;font-size:13px;text-align:right;vertical-align:top;font-variant-numeric:tabular-nums;">
          ${escapeHtml(fmtMoneyCents(totalCents))}
        </td>
      </tr>`;
  }).join("");

  const qtyHeader  = isPaycheque ? "Hours" : "Qty";
  const rateHeader = isPaycheque ? "Rate"  : "Unit Price";
  const itemsTable = lines.length ? `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:24px 0 18px 0;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="text-align:left;padding:10px 8px 10px 0;border-bottom:1px solid ${HAIRLINE};color:${INK_SOFT};font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;">Description</th>
          <th style="text-align:center;padding:10px 8px;border-bottom:1px solid ${HAIRLINE};color:${INK_SOFT};font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;width:60px;">${qtyHeader}</th>
          <th style="text-align:right;padding:10px 8px;border-bottom:1px solid ${HAIRLINE};color:${INK_SOFT};font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;width:96px;">${rateHeader}</th>
          <th style="text-align:right;padding:10px 0 10px 8px;border-bottom:1px solid ${HAIRLINE};color:${INK_SOFT};font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;width:96px;">Total</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>` : "";

  // ─── Totals stack ──────────────────────────────────────────────────
  const sub  = Number(m.totalCents) || 0;
  const paid = Number(m.paidCents)  || 0;
  const bal  = Number(m.balanceCents != null ? m.balanceCents : (sub - paid));

  const totalLabel =
    opts.docType === "receipt"   ? "Amount Received" :
    opts.docType === "paycheque" ? "Net Pay" :
                                   "Amount Due";

  const totalsStack = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:18px 0 0 0;border-collapse:collapse;">
      <tr><td style="width:55%;"></td><td style="padding:0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          ${opts.docType === "invoice" ? `
          <tr>
            <td style="padding:8px 14px;color:${INK_MUTE};font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;">Subtotal</td>
            <td style="padding:8px 14px;text-align:right;color:${INK};font-size:13px;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMoneyCents(sub))}</td>
          </tr>
          <tr>
            <td style="padding:8px 14px;color:${INK_MUTE};font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;">Amount Paid</td>
            <td style="padding:8px 14px;text-align:right;color:${INK};font-size:13px;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMoneyCents(paid))}</td>
          </tr>` : ""}
          <tr>
            <td style="padding:12px 14px;background-color:${HIGHLIGHT};color:${INK};font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;">${totalLabel}</td>
            <td style="padding:12px 14px;background-color:${HIGHLIGHT};text-align:right;color:${INK};font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;">${escapeHtml(fmtMoneyCents(opts.docType === "invoice" ? bal : sub))}</td>
          </tr>
        </table>
      </td></tr>
    </table>`;

  // ─── Payment instructions (invoices only, when there's a balance) ──
  const showPaymentBlock = opts.docType === "invoice" && bal > 0;
  const paymentBlock = showPaymentBlock ? `
    <div style="margin:28px 0 0 0;padding:18px 22px;background-color:${SIDEBAR_BG};border-radius:8px;">
      <div style="font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:${INK_SOFT};margin-bottom:8px;">How to Pay</div>
      <div style="font-size:13px;color:${INK_MUTE};line-height:1.6;">
        E-transfer to <strong style="color:${INK};font-weight:500;">${escapeHtml(COMPANY_EMAIL)}</strong><br/>
        Auto-deposit enabled — no security question required.
      </div>
    </div>` : "";

  // ─── Customer notes ────────────────────────────────────────────────
  const notesBlock = m.customerNotes ? `
    <div style="margin:24px 0 0 0;font-size:12px;color:${INK_MUTE};line-height:1.6;font-style:italic;">
      <div style="font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:${INK_SOFT};margin-bottom:6px;font-style:normal;">Notes</div>
      ${escapeHtml(m.customerNotes)}
    </div>` : "";

  // ─── Final assembled email ─────────────────────────────────────────
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:${BG};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BG};padding:40px 12px;">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:${CARD_BG};border-radius:8px;overflow:hidden;font-family:${FONT};">

        <!-- HEADER: logo left, doc type + number right -->
        <tr><td style="background-color:${SIDEBAR_BG};padding:28px 36px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
            <tr>
              <td style="vertical-align:middle;width:100px;">
                <img src="${LOGO_URL}" alt="${escapeHtml(COMPANY_NAME)}" width="84" style="display:block;border:0;width:84px;height:auto;" />
              </td>
              <td style="vertical-align:middle;text-align:right;">
                <div style="font-size:11px;font-weight:600;letter-spacing:0.28em;text-transform:uppercase;color:${INK_SOFT};">${escapeHtml(docLabel)}</div>
                ${num ? `<div style="font-size:18px;font-weight:300;color:${INK};letter-spacing:0.06em;margin-top:4px;">${num}</div>` : ""}
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- BODY -->
        <tr><td style="padding:36px 36px 28px 36px;">

          <!-- Greeting + intro -->
          <div style="font-size:15px;color:${INK};margin-bottom:14px;">${greeting}</div>
          <div style="font-size:13px;color:${INK_MUTE};line-height:1.65;margin-bottom:28px;">${escapeHtml(intro)}</div>

          <!-- Parties: BILLED TO (left) / DETAILS (right) -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom:24px;">
            <tr>
              <td style="vertical-align:top;width:55%;padding-right:20px;">
                <div style="font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:${INK_SOFT};margin-bottom:8px;">${partyLabel}</div>
                <div style="font-size:13px;color:${INK_MUTE};line-height:1.6;">
                  <div style="color:${INK};">${partyHeadline}</div>
                  ${partyForLine}
                  ${partyAddress}
                  ${partyPhone}
                  ${partyEmail}
                  ${partyEmail2}
                </div>
              </td>
              <td style="vertical-align:top;width:45%;">
                <div style="font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:${INK_SOFT};margin-bottom:8px;">Details</div>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;">
                  ${dateValueLeft ? `<tr><td style="padding:4px 0;color:${INK_TERT};font-style:italic;">${escapeHtml(dateLabelLeft)}</td><td style="padding:4px 0;text-align:right;color:${INK};font-weight:500;">${escapeHtml(dateValueLeft)}</td></tr>` : ""}
                  ${dueRow}
                  ${subjectRow}
                </table>
              </td>
            </tr>
          </table>

          <!-- Line items table -->
          ${itemsTable}

          <!-- Totals stack -->
          ${totalsStack}

          <!-- Payment instructions -->
          ${paymentBlock}

          <!-- Customer notes -->
          ${notesBlock}

          <!-- Attachment chip -->
          <div style="margin:30px 0 0 0;padding:14px 18px;background-color:#fafafa;border:1px solid ${HAIRLINE};border-radius:6px;font-size:12px;color:${INK_MUTE};">
            <span style="font-size:10px;font-weight:600;letter-spacing:0.22em;text-transform:uppercase;color:${INK_SOFT};margin-right:8px;">Attached</span>
            <span style="color:${INK};">${escapeHtml(opts.filename)}</span>
          </div>

        </td></tr>

        <!-- FOOTER -->
        <tr><td style="padding:0 36px 32px 36px;">
          <div style="border-top:1px solid ${HAIRLINE};padding-top:20px;font-size:11px;color:${INK_TERT};text-align:center;line-height:1.8;">
            Thank you for choosing ${escapeHtml(COMPANY_NAME)}<br/>
            <span style="color:${INK_MUTE};">${escapeHtml(COMPANY_EMAIL)}  ·  ${escapeHtml(COMPANY_WEB)}</span><br/>
            <span style="color:${INK_TERT};font-style:italic;">Reply directly to this email to reach us.</span>
          </div>
        </td></tr>

      </table>
    </td></tr>
  </table>
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

  const { docType, docId, docNumber, to, subject, body: emailBody, filename, pdfBase64 } = body || ({} as ReqBody);

  if (!docType || !["invoice", "receipt", "paycheque"].includes(docType)) {
    return jsonResponse(400, { ok: false, error: "docType must be invoice|receipt|paycheque" });
  }
  if (!docId || !/^[0-9a-f-]{8,}$/i.test(docId)) {
    return jsonResponse(400, { ok: false, error: "Valid docId required" });
  }
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return jsonResponse(400, { ok: false, error: "Valid recipient email required" });
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

  const resendPayload = {
    from: NOTIFY_FROM,
    to: [to],
    reply_to: REPLY_TO,
    subject,
    html,
    text: emailBody || "",
    attachments: [
      {
        filename: filename,
        content: pdfBase64,
      },
    ],
  };

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
          to,
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
        to,
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
