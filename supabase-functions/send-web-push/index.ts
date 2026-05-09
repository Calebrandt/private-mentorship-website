// Supabase Edge Function: send-web-push
// Delivers Web Push notifications to all web_push subscriptions for a
// set of user_ids, using VAPID keys.
//
// Triggered from the website (after sendMessage or system events) via:
//   supabase.functions.invoke('send-web-push', { body: {...} })
//
// REQUIRED ENV VARS (Supabase dashboard → Functions → send-web-push → Secrets):
//   VAPID_PUBLIC_KEY   — base64-url public key
//   VAPID_PRIVATE_KEY  — base64-url private key
//   VAPID_SUBJECT      — usually "mailto:owner@example.com"
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-provided.
//
// Body shape (one of):
//   { source: "message", conversationId, senderUserId, title, body, type }
//   { source: "direct",  userIds: [], title, body, type, data }
//
// Response: { ok, attempted, delivered, removed, errors }

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import webpush from "npm:web-push@3.6.7";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

interface Subscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface MessageBody {
  source: "message";
  conversationId: string;
  senderUserId: string;
  title?: string;
  body?: string;
  type?: string;
}

interface DirectBody {
  source: "direct";
  userIds: string[];
  title: string;
  body?: string;
  type?: string;
  data?: Record<string, unknown>;
}

type Body = MessageBody | DirectBody;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST")
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: CORS_HEADERS,
    });

  const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") || "";
  const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") || "";
  const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:owner@privatementorship.ca";
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing VAPID keys (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)" }),
      { status: 500, headers: CORS_HEADERS },
    );
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing Supabase env" }),
      { status: 500, headers: CORS_HEADERS },
    );
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE);

  let body: Body;
  try {
    body = await req.json();
  } catch (_) {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  // Resolve target user_ids based on source
  let userIds: string[] = [];
  let title = "Private Mentorship";
  let bodyText = "";
  let payloadType = "message";
  let extraData: Record<string, unknown> = {};
  let conversationId: string | null = null;

  if (body.source === "message") {
    if (!body.conversationId || !body.senderUserId) {
      return new Response(
        JSON.stringify({ ok: false, error: "conversationId + senderUserId required" }),
        { status: 400, headers: CORS_HEADERS },
      );
    }
    conversationId = body.conversationId;
    title = body.title || "New message";
    bodyText = body.body || "";
    payloadType = body.type || "message";

    // Find participants (excluding sender)
    const { data: parts, error: partsErr } = await supa
      .from("conversation_participants")
      .select("profile_id")
      .eq("conversation_id", body.conversationId)
      .neq("profile_id", body.senderUserId);
    if (partsErr) {
      return new Response(JSON.stringify({ ok: false, error: partsErr.message }), {
        status: 500,
        headers: CORS_HEADERS,
      });
    }
    userIds = (parts || []).map((p) => p.profile_id);

    // Skip recipients currently viewing this conversation (mirrors
    // messages-service.queueNotificationInserts behavior)
    if (userIds.length) {
      const { data: presences } = await supa
        .from("user_presence")
        .select("user_id, active_conversation_id, updated_at")
        .in("user_id", userIds);
      const fresh = new Set<string>();
      (presences || []).forEach((p) => {
        const ageMs = Date.now() - new Date(p.updated_at as string).getTime();
        if (
          p.active_conversation_id === body.conversationId &&
          ageMs < 15_000
        ) fresh.add(p.user_id as string);
      });
      userIds = userIds.filter((id) => !fresh.has(id));
    }
  } else if (body.source === "direct") {
    userIds = Array.isArray(body.userIds) ? body.userIds : [];
    title = body.title || title;
    bodyText = body.body || "";
    payloadType = body.type || "message";
    extraData = body.data || {};
  } else {
    return new Response(JSON.stringify({ ok: false, error: "Unknown source" }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  if (!userIds.length) {
    return new Response(
      JSON.stringify({ ok: true, attempted: 0, delivered: 0, removed: 0, note: "no recipients" }),
      { status: 200, headers: CORS_HEADERS },
    );
  }

  // Pull web_push tokens for these users
  const { data: tokens, error: tokErr } = await supa
    .from("device_push_tokens")
    .select("id, user_id, push_token")
    .in("user_id", userIds)
    .eq("device_type", "web_push");
  if (tokErr) {
    return new Response(JSON.stringify({ ok: false, error: tokErr.message }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }

  const payload = JSON.stringify({
    title,
    body: bodyText,
    type: payloadType,
    conversationId,
    ...extraData,
  });

  let attempted = 0;
  let delivered = 0;
  const removedIds: string[] = [];
  const errors: { id: string; status?: number; message: string }[] = [];

  await Promise.all(
    (tokens || []).map(async (row) => {
      let sub: Subscription;
      try {
        sub = JSON.parse(row.push_token as string);
        if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error("invalid sub shape");
      } catch (e) {
        errors.push({ id: row.id as string, message: "Bad subscription JSON" });
        removedIds.push(row.id as string);
        return;
      }
      attempted++;
      try {
        await webpush.sendNotification(sub, payload, { TTL: 60 });
        delivered++;
      } catch (e: any) {
        const status = e?.statusCode;
        errors.push({ id: row.id as string, status, message: e?.body || e?.message || "send failed" });
        // 404 / 410 = subscription gone; clean it up
        if (status === 404 || status === 410) removedIds.push(row.id as string);
      }
    }),
  );

  if (removedIds.length) {
    await supa.from("device_push_tokens").delete().in("id", removedIds);
  }

  return new Response(
    JSON.stringify({ ok: true, attempted, delivered, removed: removedIds.length, errors }),
    { status: 200, headers: CORS_HEADERS },
  );
});
