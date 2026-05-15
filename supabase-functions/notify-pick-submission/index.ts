// Supabase Edge Function: notify-pick-submission
// Sends an email to the owner when a family submits their pick list.
// Triggered from the client's submitPicks() flow via
// supabase.functions.invoke('notify-pick-submission', { body: { clientId } }).
//
// REQUIRED ENV VARS (set via the Supabase dashboard → Functions → notify-pick-submission → "Secrets"):
//   RESEND_API_KEY        — Resend API key (same one used by notify-submission)
//   NOTIFY_TO_EMAIL       — the address that receives notifications (you / the owner)
//   NOTIFY_FROM_EMAIL     — the From: header (e.g. "Private Mentorship <hiring@privatementorship.com>")
//   ADMIN_REVIEW_BASE_URL — (optional) base URL of the admin dashboard. Defaults to http://127.0.0.1:5500.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided by the Functions runtime.
//
// Mirrors the notify-submission edge function pattern. JWT verification can be left
// enabled — the client invocation forwards the user's JWT and the function uses the
// service role to look up data server-side.

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

  // Parse incoming request body — accept either { clientId } or webhook-style { record }
  let clientId: string | null = null;
  try {
    const body = await req.json();
    clientId = body?.clientId || body?.record?.client_id || null;
  } catch (_) {/* fall through */}
  if (!clientId) {
    return new Response(JSON.stringify({ ok: false, error: "Missing clientId in request body." }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // Use service-role client to look up data (bypasses RLS for the lookup)
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1) Load the family record
  const { data: client, error: clientErr } = await sb
    .from("clients")
    .select("id, profile_id, full_name, email, phone")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr || !client) {
    return new Response(JSON.stringify({ ok: false, error: "Client not found" }), {
      status: 404,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // 2) Load picks for this family with the joined assistant profile
  const { data: picks, error: picksErr } = await sb
    .from("client_assistant_picks")
    .select("rank, status, assistant_profiles ( display_name, city )")
    .eq("client_id", clientId)
    .eq("status", "introduction_requested")
    .order("rank", { ascending: true, nullsFirst: false });
  if (picksErr) {
    return new Response(JSON.stringify({ ok: false, error: picksErr.message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
  if (!picks || picks.length === 0) {
    return new Response(JSON.stringify({ ok: true, skipped: "no picks to notify" }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  // 3) Build the email
  const familyName = client.full_name || client.email || "A family";
  const familyEmail = client.email || "—";
  const familyPhone = client.phone || "—";
  const picksHtml = (picks || []).map((p: any, i: number) => {
    const rank = p.rank || (i + 1);
    const rankLabel = ["1st Choice", "2nd Choice", "3rd Choice"][rank - 1] || rank + "th Choice";
    const a = p.assistant_profiles || {};
    return `<li><strong>${rankLabel}:</strong> ${a.display_name || "Unnamed Assistant"}${a.city ? " — " + a.city : ""}</li>`;
  }).join("");

  const adminLink = `${ADMIN_BASE}/admin-intro-requests.html`;
  const subject = `Pick list submitted — ${familyName} (${picks.length} ${picks.length === 1 ? "pick" : "picks"})`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
      <h2 style="font-family: Georgia, serif; font-size: 22px; color: #1a1a1a; margin: 0 0 16px;">New pick list submission</h2>
      <p style="font-size: 15px; color: #333; line-height: 1.6;">
        <strong>${familyName}</strong> has submitted their top picks. Private Mentorship's next step is to schedule a 30-minute introduction with each.
      </p>
      <h3 style="font-size: 14px; color: #555; letter-spacing: 0.05em; text-transform: uppercase; margin: 24px 0 8px;">Family</h3>
      <p style="margin: 0 0 4px;">${familyName}</p>
      <p style="margin: 0 0 4px; color: #555; font-size: 14px;">${familyEmail}</p>
      <p style="margin: 0; color: #555; font-size: 14px;">${familyPhone}</p>
      <h3 style="font-size: 14px; color: #555; letter-spacing: 0.05em; text-transform: uppercase; margin: 24px 0 8px;">Picks</h3>
      <ul style="margin: 0; padding-left: 20px; font-size: 15px; line-height: 1.7; color: #1a1a1a;">${picksHtml}</ul>
      <p style="margin: 28px 0 0;">
        <a href="${adminLink}" style="display: inline-block; background: #1a1a1a; color: #fff; text-decoration: none; padding: 12px 22px; border-radius: 6px; font-weight: 500;">Review in admin →</a>
      </p>
    </div>
  `;
  const text = `New pick list submission

Family: ${familyName}
Email: ${familyEmail}
Phone: ${familyPhone}

Picks:
${(picks || []).map((p: any, i: number) => {
  const rank = p.rank || (i + 1);
  const rankLabel = ["1st Choice", "2nd Choice", "3rd Choice"][rank - 1] || rank + "th Choice";
  const a = p.assistant_profiles || {};
  return `  ${rankLabel}: ${a.display_name || "Unnamed"}${a.city ? " — " + a.city : ""}`;
}).join("\n")}

Review: ${adminLink}`;

  // 4) Send via Resend
  const resendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: [NOTIFY_TO],
      subject,
      html,
      text,
    }),
  });
  const resendBody = await resendResp.json().catch(() => ({}));
  if (!resendResp.ok) {
    return new Response(JSON.stringify({ ok: false, error: "Resend failed", resend: resendBody }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true, resend_id: resendBody?.id, picks_count: picks.length }), {
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
