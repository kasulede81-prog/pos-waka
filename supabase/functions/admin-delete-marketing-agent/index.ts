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

  let body: { agent_id?: string; delete_login?: boolean; auth_only?: boolean; user_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const authOnly = body.auth_only === true;
  const deleteLogin = body.delete_login === true;
  const agentId = String(body.agent_id ?? "").trim();
  const directUserId = String(body.user_id ?? "").trim();

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: staffRow, error: staffErr } = await userClient.rpc("waka_internal_me");
  const me = parseWakaInternalMeRow(staffRow);
  if (staffErr || !me) {
    return json({ ok: false, error: "forbidden", detail: staffErr?.message ?? "Not internal staff." }, 403);
  }

  let userId: string | null = directUserId || null;

  if (!authOnly) {
    if (!agentId) return json({ ok: false, error: "agent_id_required" }, 400);

    const { data: prep, error: prepErr } = await userClient.rpc("internal_delete_marketing_agent", {
      p_agent_id: agentId,
      p_delete_login: deleteLogin,
    });

    if (prepErr) {
      return json({ ok: false, error: "delete_failed", detail: prepErr.message }, 500);
    }

    const j = (prep ?? {}) as {
      ok?: boolean;
      error?: string;
      user_id?: string | null;
      delete_login?: boolean;
      referral_code?: string;
    };

    if (!j.ok) {
      return json({ ok: false, error: j.error ?? "delete_failed" }, 400);
    }

    if (!deleteLogin || !j.user_id) {
      return json({
        ok: true,
        message: "Agent removed from marketing panel.",
        referral_code: j.referral_code,
      });
    }

    userId = j.user_id;
  } else {
    if (!deleteLogin || !userId) {
      return json({ ok: false, error: "user_id_required" }, 400);
    }
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { error: authDelErr } = await admin.auth.admin.deleteUser(userId!);

  if (authDelErr) {
    return json({
      ok: false,
      error: "auth_delete_failed",
      detail: authDelErr.message,
      partial: true,
      message:
        "Agent row removed but login could not be deleted. Remove the user in Supabase Auth → Users, then they can register again.",
    }, 500);
  }

  return json({
    ok: true,
    message: "Agent removed and login account deleted. They can register again with the same email.",
    referral_code: j.referral_code,
  });
});
