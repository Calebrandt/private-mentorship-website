// Supabase Edge Function: oracle-notify
// ─────────────────────────────────────────────────────────────────────────
// Phase 19c.8c — emails an Oracle digest to the caller (Caleb) with a
// list of their open chat threads + "Open in chat" deep-links straight
// into each one.
//
// Phase 19c.8c.1 — adds cron-bypass auth path so Postgres can call this
// directly via pg_net using a shared secret header (no JWT available
// from inside the database). User-initiated calls (FAB button) still
// use JWT exactly as before.
//
// Triggered from:
//   • the browser FAB right after a successful Scan (JWT path)
//   • the daily cron at 16:00 UTC via pg_net (shared-secret path)
//
// REQUEST BODY (optional)
//   threadIds?: string[]      — explicit list to summarize. If omitted,
//                                pulls the 10 most recent open/awaiting_user
//                                threads for the resolved owner.
//   owner_user_id?: string    — REQUIRED for cron path (no JWT to derive
//                                the owner from). Ignored for JWT path.
//   source?: 'cron' | 'fab'   — informational, written to audit_logs.
//
// AUTH PATHS
//   1. Cron:  header  x-oracle-cron-secret: <ORACLE_CRON_SECRET>
//             body    owner_user_id, source: 'cron'
//   2. User:  header  Authorization: Bearer <JWT>
//
// REQUIRED ENV VARS (Supabase Functions → oracle-notify → Secrets):
//   RESEND_API_KEY        — reuse the same key the other functions use
//   NOTIFY_FROM_EMAIL     — verified Resend From: header
//   ORACLE_SITE_URL       — (optional) base URL for deep-links.
//                            Defaults to https://privatementorship.ca
//   ORACLE_CRON_SECRET    — shared secret matching public.oracle_config.cron_secret
// ─────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return (s || "").toString().replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>)[c] || c
  );
}

interface ThreadRow {
  id: string;
  scenario_key: string;
  title: string;
  subtitle: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST")
    return jsonResponse(405, { ok: false, error: "Method not allowed" });

  const RESEND_API_KEY      = Deno.env.get("RESEND_API_KEY") || "";
  const NOTIFY_FROM         = Deno.env.get("NOTIFY_FROM_EMAIL") || "Private Mentorship <billing@privatementorship.ca>";
  const SITE_URL            = (Deno.env.get("ORACLE_SITE_URL") || "https://privatementorship.ca").replace(/\/+$/, "");
  const ORACLE_CRON_SECRET  = Deno.env.get("ORACLE_CRON_SECRET") || "";

  if (!RESEND_API_KEY)
    return jsonResponse(500, { ok: false, error: "RESEND_API_KEY not configured" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // ── Body (parsed up-front; cron path needs owner_user_id from it)
  let body: any = {};
  try { body = await req.json(); } catch (_) {}
  const explicit: string[] | null = Array.isArray(body?.threadIds) ? body.threadIds : null;
  const source: string = (body?.source as string) || "fab";

  // ── Service-role client for the queries
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── Resolve caller via one of two auth paths:
  //    1. Cron:  shared-secret header → owner_user_id from body
  //    2. User:  JWT in Authorization header → owner = JWT user
  let callerId    = "";
  let callerEmail = "";
  let callerName  = "";

  const cronHeaderSecret = req.headers.get("x-oracle-cron-secret") || "";
  const isCron = !!(cronHeaderSecret && ORACLE_CRON_SECRET && cronHeaderSecret === ORACLE_CRON_SECRET);

  if (isCron) {
    const ownerId = (body?.owner_user_id as string) || "";
    if (!ownerId)
      return jsonResponse(400, { ok: false, error: "cron path requires owner_user_id in body" });

    const { data: u, error: uErr } = await sb.auth.admin.getUserById(ownerId);
    if (uErr || !u?.user)
      return jsonResponse(404, { ok: false, error: "owner_user_id not found in auth.users" });

    callerId    = u.user.id;
    callerEmail = u.user.email || "";
    callerName  = ((u.user.user_metadata as any)?.full_name as string) || callerEmail;
  } else {
    // JWT path (browser FAB)
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonResponse(401, { ok: false, error: "Missing Authorization header" });

    const sbUser = createClient(SUPABASE_URL, SERVICE_ROLE, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await sbUser.auth.getUser(token);
    if (userErr || !userData?.user)
      return jsonResponse(401, { ok: false, error: "Invalid session" });

    // Admin gate (JWT path only — cron is its own trust boundary)
    const { data: isAdmin, error: adminErr } = await sbUser.rpc("is_admin");
    if (adminErr || !isAdmin)
      return jsonResponse(403, { ok: false, error: "Admin only" });

    callerId    = userData.user.id;
    callerEmail = userData.user.email || "";
    callerName  = ((userData.user.user_metadata as any)?.full_name as string) || callerEmail;
  }

  if (!callerEmail)
    return jsonResponse(400, { ok: false, error: "Caller has no email on file" });

  let threads: ThreadRow[] = [];
  {
    let q = sb.from("assistant_threads")
      .select("id, scenario_key, title, subtitle, status, created_at, updated_at")
      .eq("owner_user_id", callerId);
    if (explicit && explicit.length) {
      q = q.in("id", explicit);
    } else {
      q = q.in("status", ["open", "awaiting_user"])
           .order("updated_at", { ascending: false })
           .limit(10);
    }
    const { data, error } = await q;
    if (error)
      return jsonResponse(500, { ok: false, error: "thread fetch: " + error.message });
    threads = (data || []) as ThreadRow[];
  }

  if (threads.length === 0) {
    return jsonResponse(200, { ok: true, skipped: true, reason: "no threads to send" });
  }

  // Pull scenario icons + the bot's greeting message (first 'text' message per thread)
  const scenarioKeys = [...new Set(threads.map(t => t.scenario_key))];
  const { data: scenarios } = await sb.from("assistant_scenarios")
    .select("scenario_key, icon, label")
    .in("scenario_key", scenarioKeys);
  const iconByKey = new Map<string, string>(
    (scenarios || []).map(s => [s.scenario_key as string, (s.icon || "💬") as string])
  );

  // Greeting messages — one per thread
  const { data: greetings } = await sb.from("assistant_messages")
    .select("thread_id, content, created_at")
    .in("thread_id", threads.map(t => t.id))
    .eq("role", "bot")
    .eq("content_type", "text")
    .order("created_at", { ascending: true });
  const greetByThread = new Map<string, string>();
  (greetings || []).forEach((g: any) => {
    if (!greetByThread.has(g.thread_id)) greetByThread.set(g.thread_id, g.content || "");
  });

  // ── First name for the greeting
  const firstName = (callerName || callerEmail).split(/\s+|@/)[0] || "there";

  // ── Subject: include date so daily digests group cleanly + time-of-day
  // so repeated same-day sends (testing) don't get collapsed by Gmail's
  // identical-content threading. In production this means one Oracle
  // email per cron run shows up as its own conversation.
  const now = new Date();
  const niceDate = now.toLocaleString("en-CA", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
    hour12: true,
    timeZone: "America/Los_Angeles",
  });
  const subject = `Oracle: ${threads.length} thing${threads.length === 1 ? "" : "s"} to handle · ${niceDate}`;
  const html = buildEmailHtml({
    firstName,
    threads,
    iconByKey,
    greetByThread,
    siteUrl: SITE_URL,
  });

  // ── Send via Resend
  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: NOTIFY_FROM,
      to: [callerEmail],
      reply_to: callerEmail,
      subject,
      html,
      text: buildPlainText({ firstName, threads, siteUrl: SITE_URL, greetByThread }),
    }),
  });

  const resendBodyText = await resendRes.text();
  let resendParsed: any = null;
  try { resendParsed = JSON.parse(resendBodyText); } catch (_) { resendParsed = { raw: resendBodyText }; }

  if (!resendRes.ok)
    return jsonResponse(502, { ok: false, error: `Resend error: ${resendParsed?.message || resendBodyText}` });

  // Audit (best-effort)
  try {
    await sb.from("audit_logs").insert({
      user_id: callerId,
      action: "ORACLE_NOTIFY_SENT",
      entity_type: "assistant",
      entity_id: callerId,
      details: {
        thread_count: threads.length,
        thread_ids: threads.map(t => t.id),
        sent_to: callerEmail,
        resend_message_id: resendParsed?.id || null,
        source,
      },
    });
  } catch (e) {
    console.warn("[oracle-notify] audit insert failed:", e);
  }

  return jsonResponse(200, {
    ok: true,
    thread_count: threads.length,
    sent_to: callerEmail,
    message_id: resendParsed?.id || null,
  });
});

// ─── HTML email template — matches the inline-receipt style ─────────────
function buildEmailHtml(opts: {
  firstName: string;
  threads: ThreadRow[];
  iconByKey: Map<string, string>;
  greetByThread: Map<string, string>;
  siteUrl: string;
}): string {
  const BRAND_PRIMARY = "#0f172a";
  const BRAND_ACCENT  = "#2563eb";
  const BG            = "#f1f5f9";

  const threadCards = opts.threads.map((t) => {
    const icon = opts.iconByKey.get(t.scenario_key) || "💬";
    const greet = opts.greetByThread.get(t.id) || "";
    const deepLink = `${opts.siteUrl}/admin-financials.html?oracle_thread=${t.id}`;
    return `
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:18px 20px;margin-bottom:14px;background:#fafbfc;">
        <div style="font-size:13px;color:#0f172a;font-weight:700;letter-spacing:-0.005em;margin-bottom:4px;">
          <span style="font-size:15px;margin-right:6px;">${icon}</span> ${escapeHtml(t.title)}
        </div>
        ${t.subtitle ? `<div style="font-size:12px;color:#64748b;margin-bottom:10px;">${escapeHtml(t.subtitle)}</div>` : ""}
        ${greet ? `<div style="font-size:13px;color:#475569;line-height:1.55;margin:8px 0 14px 0;font-style:italic;">${escapeHtml(greet)}</div>` : ""}
        <a href="${escapeHtml(deepLink)}" style="display:inline-block;padding:8px 16px;background:${BRAND_ACCENT};color:#ffffff;text-decoration:none;font-size:12px;font-weight:600;border-radius:8px;letter-spacing:-0.005em;">Open in chat →</a>
      </div>`;
  }).join("");

  const subject = `${opts.threads.length} thing${opts.threads.length === 1 ? "" : "s"} to handle`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1.0" /></head>
<body style="margin:0;padding:0;">
  <div style="background-color:${BG};padding:40px 10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#334155;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">

      <div style="background:${BRAND_PRIMARY};padding:30px 40px;text-align:center;">
        <h1 style="color:#ffffff;margin:0;font-size:24px;letter-spacing:0.05em;text-transform:uppercase;">Oracle</h1>
        <p style="color:${BRAND_ACCENT};margin:5px 0 0 0;font-size:14px;font-weight:600;">${escapeHtml(subject)}</p>
      </div>

      <div style="padding:36px 40px 28px 40px;">
        <p style="font-size:16px;margin:0 0 14px 0;color:#334155;">Good morning, <strong>${escapeHtml(opts.firstName)}</strong>.</p>
        <p style="font-size:14px;line-height:1.6;color:#64748b;margin:0 0 24px 0;">
          ${opts.threads.length === 1
            ? "There's one thing waiting for you in Oracle:"
            : `There are ${opts.threads.length} things waiting for you in Oracle:`}
        </p>

        ${threadCards}

        <div style="margin-top:24px;text-align:center;">
          <a href="${escapeHtml(opts.siteUrl + "/admin-financials.html")}" style="display:inline-block;padding:12px 24px;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;border-radius:8px;letter-spacing:0.02em;">Open Oracle</a>
        </div>

        <div style="margin-top:32px;border-top:1px solid #e2e8f0;padding-top:20px;text-align:center;font-size:12px;color:#94a3b8;">
          You're receiving this because you have open Oracle threads.<br/>
          Private Mentorship · privatementorship.ca
        </div>
      </div>

    </div>
  </div>
</body></html>`;
}

function buildPlainText(opts: { firstName: string; threads: ThreadRow[]; siteUrl: string; greetByThread: Map<string,string> }): string {
  const lines: string[] = [];
  lines.push(`Good morning, ${opts.firstName}.`);
  lines.push("");
  lines.push(opts.threads.length === 1
    ? "There's one thing waiting for you in Oracle:"
    : `There are ${opts.threads.length} things waiting for you in Oracle:`);
  lines.push("");
  for (const t of opts.threads) {
    lines.push(`• ${t.title}`);
    if (t.subtitle) lines.push(`  ${t.subtitle}`);
    const greet = opts.greetByThread.get(t.id);
    if (greet) lines.push(`  ${greet}`);
    lines.push(`  ${opts.siteUrl}/admin-financials.html?oracle_thread=${t.id}`);
    lines.push("");
  }
  lines.push(`Open Oracle: ${opts.siteUrl}/admin-financials.html`);
  lines.push("");
  lines.push("Private Mentorship · privatementorship.ca");
  return lines.join("\n");
}
