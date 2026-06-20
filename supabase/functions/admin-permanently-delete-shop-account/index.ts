import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { parseWakaInternalMeRow } from "../_shared/wakaInternalStaff.ts";
import { runCertifiedHardDelete } from "../_shared/certifiedHardDelete.ts";

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

  let body: { shop_id?: string; confirmation?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  const shopId = String(body.shop_id ?? "").trim();
  const confirmation = String(body.confirmation ?? "").trim();
  if (!shopId) return json({ ok: false, error: "shop_id_required" }, 400);
  if (!confirmation) return json({ ok: false, error: "confirmation_required" }, 400);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: staffRow, error: staffErr } = await userClient.rpc("waka_internal_me");
  const me = parseWakaInternalMeRow(staffRow);
  if (staffErr || !me) {
    return json({ ok: false, error: "forbidden", detail: staffErr?.message ?? "Not an active internal admin." }, 403);
  }

  if (me.role !== "super_admin") {
    return json({ ok: false, error: "forbidden", detail: "Super admin only." }, 403);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  let preparedOwnerId: string | null = null;

  const result = await runCertifiedHardDelete({
    userClient,
    admin,
    prepare: async () => {
      const r = await userClient.rpc("admin_permanently_delete_shop_account", {
        p_shop_id: shopId,
        p_confirmation: confirmation,
        p_phase: "prepare",
      });
      const prep = (r.data ?? {}) as { organization_id?: string; owner_user_id?: string };
      if (prep.owner_user_id) preparedOwnerId = String(prep.owner_user_id);
      return r;
    },
    execute: () =>
      userClient.rpc("admin_permanently_delete_shop_account", {
        p_shop_id: shopId,
        p_confirmation: confirmation,
        p_phase: "execute",
      }),
  });

  await userClient.rpc("admin_permanent_delete_auth_user_audit", {
    p_owner_user_id: preparedOwnerId ?? result.user_ids?.find((id) => id) ?? null,
    p_shop_id: shopId,
    p_ok: result.ok,
    p_detail: result.detail ?? null,
  }).catch(() => undefined);

  if (!result.ok) {
    return json({
      ok: false,
      error: result.error ?? "delete_failed",
      detail: result.detail,
      partial: result.partial,
      message: result.message ??
        "Shop data was removed but certified deletion verification failed. Review the deletion report.",
      deletion_report: result.deletion_report,
      sales_deleted: result.sales_deleted,
    }, result.partial ? 500 : 400);
  }

  return json({
    ok: true,
    shop_name: result.shop_name,
    sales_deleted: result.sales_deleted,
    deletion_report: result.deletion_report,
    message: result.message ??
      "Certified hard delete completed. Organization, staff logins, and all verification checks passed.",
  });
});
