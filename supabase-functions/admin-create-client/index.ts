// Supabase Edge Function: admin-create-client
// Creates a new client account on behalf of an authenticated admin/owner.
//
// Caller (browser) sends a POST with the user's JWT in Authorization header
// and a JSON body of: { email, password, fullName, phone?, role? }
//
// The function:
//  1. Validates the caller's JWT and confirms their profiles.role is OWNER / ADMIN / SUPERADMIN.
//  2. Calls auth.admin.createUser with email_confirm:true (skips verification email).
//     The on_auth_user_created trigger auto-creates a profiles row with role='CLIENT'.
//  3. Updates the profile's phone (trigger doesn't set it).
//  4. Inserts a clients row (full_name + profile_id linked to the new user).
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
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // 1. Verify caller is admin/owner.
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ ok: false, error: "Missing Authorization Bearer token." }, 401);

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: callerData, error: callerErr } = await sb.auth.getUser(jwt);
  if (callerErr || !callerData?.user) {
    return json({ ok: false, error: "Invalid auth token." }, 401);
  }
  const callerId = callerData.user.id;

  const { data: callerProfile, error: profErr } = await sb
    .from("profiles")
    .select("role")
    .eq("user_id", callerId)
    .maybeSingle();
  if (profErr) return json({ ok: false, error: profErr.message }, 500);

  const callerRole = String(callerProfile?.role || "").toUpperCase();
  if (!["OWNER", "ADMIN", "SUPERADMIN"].includes(callerRole)) {
    return json({ ok: false, error: "Forbidden — admin/owner role required." }, 403);
  }

  // 2. Parse body.
  let body: any = {};
  try { body = await req.json(); } catch (_) {}
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const fullName = String(body?.fullName || "").trim();
  const phone = body?.phone ? String(body.phone).trim() : null;
  const role = body?.role ? String(body.role).trim().toUpperCase() : null; // PRIMARY/SPOUSE/FAMILY (informational, not a DB column)

  if (!email || !password || !fullName) {
    return json({ ok: false, error: "email, password, and fullName are required." }, 400);
  }
  if (password.length < 8) {
    return json({ ok: false, error: "Password must be at least 8 characters." }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, error: "Invalid email." }, 400);
  }

  // 3. Create auth user. Trigger handle_new_user creates profile with role='CLIENT' + full_name.
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, family_role: role || "PRIMARY" },
  });
  if (createErr || !created?.user) {
    return json({ ok: false, error: createErr?.message || "Failed to create auth user." }, 400);
  }
  const newUserId = created.user.id;

  // 4. Update profile with phone (trigger only sets full_name + role).
  if (phone) {
    const { error: updErr } = await sb
      .from("profiles")
      .update({ phone })
      .eq("user_id", newUserId);
    if (updErr) {
      // Roll back auth user if profile update fails
      await sb.auth.admin.deleteUser(newUserId).catch(() => {});
      return json({ ok: false, error: `Profile update failed: ${updErr.message}` }, 500);
    }
  }

  // 5. Insert clients row.
  const { data: clientRow, error: clientErr } = await sb
    .from("clients")
    .insert({
      full_name: fullName,
      email,
      phone,
      profile_id: newUserId,
      created_by: callerId,
      display_name: fullName,
    })
    .select("id")
    .single();
  if (clientErr) {
    // Roll back auth user if clients insert fails
    await sb.auth.admin.deleteUser(newUserId).catch(() => {});
    return json({ ok: false, error: `Client insert failed: ${clientErr.message}` }, 500);
  }

  return json({
    ok: true,
    user_id: newUserId,
    client_id: clientRow.id,
    email,
    full_name: fullName,
  }, 200);
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
