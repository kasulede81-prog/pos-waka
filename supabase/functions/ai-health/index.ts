import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseWakaInternalMeRow } from "../_shared/wakaInternalStaff.ts";
import { aiJson, cors } from "../_shared/aiResponse.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return aiJson({ ok: false, success: false, code: "server_misconfigured", reason: "Server misconfigured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return aiJson({ ok: false, success: false, code: "unauthorized", reason: "Unauthorized" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: staffRow, error: staffErr } = await userClient.rpc("waka_internal_me");
  const me = parseWakaInternalMeRow(staffRow);
  if (staffErr || !me) {
    return aiJson(
      { ok: false, success: false, code: "forbidden", reason: "Internal admin only" },
      403,
    );
  }

  const allowedRoles = new Set(["super_admin", "operations_admin", "support_admin"]);
  if (!allowedRoles.has(me.role)) {
    return aiJson(
      { ok: false, success: false, code: "forbidden", reason: "Internal admin only" },
      403,
    );
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { error: settingsErr } = await admin.rpc("get_platform_ai_settings");
  const settingsAvailable = !settingsErr;

  return aiJson({
    ok: true,
    success: true,
    deepseek_key_configured: Boolean(Deno.env.get("DEEPSEEK_API_KEY")?.trim()),
    settings_available: settingsAvailable,
    settings_error: settingsErr?.message ?? null,
  });
});
