import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseWakaInternalMeRow } from "../_shared/wakaInternalStaff.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: { shop_id?: string; new_password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const shopId = String(body.shop_id ?? "").trim();
  const newPassword = String(body.new_password ?? "");
  if (!shopId) return json({ ok: false, error: "shop_id_required" }, 400);
  if (newPassword.length < 8) return json({ ok: false, error: "password_too_short" }, 400);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: staffRow, error: staffErr } = await userClient.rpc("waka_internal_me");
  const me = parseWakaInternalMeRow(staffRow);
  if (staffErr || !me) {
    return json({ ok: false, error: "forbidden", detail: staffErr?.message ?? "Not an active internal admin." }, 403);
  }

  if (me.role !== "super_admin" && me.role !== "support_admin") {
    return json({ ok: false, error: "forbidden", detail: "Support or super admin only." }, 403);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: member, error: memErr } = await admin
    .from("shop_members")
    .select("user_id")
    .eq("shop_id", shopId)
    .eq("role", "owner")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (memErr || !member?.user_id) {
    return json({ ok: false, error: "owner_not_found" }, 404);
  }

  const { error: pwErr } = await admin.auth.admin.updateUserById(member.user_id as string, {
    password: newPassword,
  });
  if (pwErr) {
    return json({ ok: false, error: "password_update_failed", detail: pwErr.message }, 500);
  }

  await userClient.rpc("admin_shop_password_set_audit", {
    p_shop_id: shopId,
    p_note: "Direct password set by support",
  });

  return json({ ok: true });
});
