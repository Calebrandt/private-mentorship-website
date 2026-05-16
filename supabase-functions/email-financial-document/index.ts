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
//   docType:   'invoice' | 'receipt' | 'paycheque'
//   docId:     uuid of the document
//   docNumber: optional display number (INV-000001) — used in audit + subject
//   to:        recipient email
//   subject:   email subject line
//   body:      plaintext email body (also rendered as HTML below)
//   filename:  attachment filename, e.g. INV-000001.pdf
//   pdfBase64: base64-encoded PDF (no data:... prefix)
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

interface ReqBody {
  docType: DocType;
  docId: string;
  docNumber?: string | null;
  to: string;
  subject: string;
  body: string;
  filename: string;
  pdfBase64: string;
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
    .map((p) => `<p style="margin:0 0 14px;line-height:1.55;">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
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

  // ─── Send via Resend ─────────────────────────────────────────────
  const safeBody = bodyToHtml(emailBody || "");
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;color:#0f172a;">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px;box-shadow:0 1px 2px rgba(15,23,42,0.04),0 12px 30px -10px rgba(15,23,42,0.18);">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#2563eb;margin-bottom:12px;">Private Mentorship · ${escapeHtml(String(docType).toUpperCase())}${docNumber ? " · " + escapeHtml(docNumber) : ""}</div>
    ${safeBody}
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#94a3b8;line-height:1.5;">
      Attachment: <strong style="color:#475569;">${escapeHtml(filename)}</strong><br>
      Reply directly to this e-mail to reach us.
    </div>
  </div>
</body></html>`;

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
