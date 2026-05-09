// Supabase Edge Function: notify-submission
// Sends an email to the owner whenever an applicant submits or resubmits a hiring application.
// Triggered from the wizard's submit() flow via supabase.functions.invoke('notify-submission', { body: { applicationId } }).
//
// REQUIRED ENV VARS (set via the Supabase dashboard → Functions → notify-submission → "Secrets"):
//   RESEND_API_KEY        — your Resend API key (https://resend.com/api-keys)
//   NOTIFY_TO_EMAIL       — the address that receives notifications (you / the owner)
//   NOTIFY_FROM_EMAIL     — the From: header (e.g. "Private Mentorship <hiring@privatementorship.com>")
//                           Must be a verified Resend sender or domain.
//   ADMIN_REVIEW_BASE_URL — (optional) the base URL of the admin dashboard, used in the email's
//                           "Review application" link. Defaults to http://127.0.0.1:5500.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided by the Functions runtime.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
  }

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
  const NOTIFY_TO = Deno.env.get("NOTIFY_TO_EMAIL") || "";
  const NOTIFY_FROM = Deno.env.get("NOTIFY_FROM_EMAIL") || "Private Mentorship <onboarding@resend.dev>";
  const ADMIN_BASE = Deno.env.get("ADMIN_REVIEW_BASE_URL") || "http://127.0.0.1:5500";

  if (!RESEND_API_KEY || !NOTIFY_TO) {
    return new Response(JSON.stringify({ ok: false, error: "Missing RESEND_API_KEY or NOTIFY_TO_EMAIL secret." }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let applicationId: string | null = null;
  try {
    const body = await req.json();
    applicationId = body?.applicationId || body?.record?.id || null;
  } catch (_) { /* fall through */ }
  if (!applicationId) {
    return new Response(JSON.stringify({ ok: false, error: "Missing applicationId in request body." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: app, error: appErr } = await sb
    .from("applications")
    .select("id, applicant_id, status, submitted_at, locked_at, current_step_key, progress_percent, updated_at")
    .eq("id", applicationId)
    .single();
  if (appErr || !app) {
    return new Response(JSON.stringify({ ok: false, error: appErr?.message || "Application not found." }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Look up applicant email and any identity data we already collected.
  let applicantEmail = "Unknown";
  try {
    const { data: u } = await sb.auth.admin.getUserById(app.applicant_id);
    applicantEmail = u?.user?.email || "Unknown";
  } catch (_) { /* silent */ }

  let legalName = "—", preferredName = "—", phone = "—", city = "—", province = "—";
  const { data: idStep } = await sb.from("application_steps").select("data").eq("application_id", applicationId).eq("step_key", "IDENTITY").maybeSingle();
  if (idStep?.data) {
    legalName = idStep.data.legalName || legalName;
    preferredName = idStep.data.preferredName || preferredName;
    phone = idStep.data.phone || phone;
  }
  const { data: addrStep } = await sb.from("application_steps").select("data").eq("application_id", applicationId).eq("step_key", "ADDRESS").maybeSingle();
  if (addrStep?.data) {
    city = addrStep.data.city || city;
    province = addrStep.data.province || province;
  }

  const ref = `PMA-${app.id.slice(0, 8).toUpperCase()}`;
  const reviewUrl = `${ADMIN_BASE}/admin-application.html?id=${app.id}`;
  const submittedAt = app.submitted_at ? new Date(app.submitted_at).toLocaleString("en-CA", { timeZone: "America/Vancouver" }) : "—";

  const subject = `New assistant application — ${preferredName !== "—" ? preferredName : legalName} · ${ref}`;
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /></head>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Inter','Segoe UI',sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px;box-shadow:0 1px 2px rgba(15,23,42,0.04),0 12px 30px -10px rgba(15,23,42,0.18);">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#0071e3;margin-bottom:12px;">Hiring · New submission</div>
    <h1 style="font-family:'Archivo','Inter',sans-serif;font-size:26px;font-weight:800;letter-spacing:-0.02em;margin:0 0 6px;">New assistant application</h1>
    <p style="margin:0 0 20px;color:#64748b;font-size:14px;line-height:1.55;">${ref} · just submitted via the Private Mentorship website.</p>

    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;font-size:14px;">
      <tr><td style="padding:8px 0;color:#64748b;width:140px;">Applicant</td><td style="font-weight:600;">${escapeHtml(legalName)}${preferredName !== "—" && preferredName !== legalName ? ` (${escapeHtml(preferredName)})` : ""}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Email</td><td style="font-weight:600;">${escapeHtml(applicantEmail)}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Phone</td><td>${escapeHtml(phone)}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Location</td><td>${escapeHtml([city, province].filter(x => x !== "—").join(", ") || "—")}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Reference</td><td style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${ref}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Submitted</td><td>${escapeHtml(submittedAt)}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;">Status</td><td><span style="background:#e8f2fd;color:#0058b3;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(app.status)}</span></td></tr>
    </table>

    <a href="${reviewUrl}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:13px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:-0.01em;">Review application →</a>

    <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;line-height:1.5;">You're receiving this because you're listed as the notification recipient for the Private Mentorship hiring system. Reference: ${ref}.</p>
  </div>
</body></html>`;

  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: NOTIFY_TO,
      subject,
      html,
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    return new Response(JSON.stringify({ ok: false, error: `Resend error: ${errText}` }), {
      status: 502,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, ref }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});

function escapeHtml(s: string): string {
  return (s || "").toString().replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c;
  });
}
