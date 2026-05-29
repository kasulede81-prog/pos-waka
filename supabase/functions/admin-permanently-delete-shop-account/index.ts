import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
  if (staffErr || !staffRow) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  const role = String((staffRow as { role?: string }).role ?? "").toLowerCase();
  if (role !== "super_admin") {
    return json({ ok: false, error: "forbidden", detail: "Super admin only." }, 403);
  }

  const { data: prep, error: prepErr } = await userClient.rpc("admin_permanently_delete_shop_account", {
    p_shop_id: shopId,
    p_confirmation: confirmation,
  });

  if (prepErr) {
    return json({ ok: false, error: "delete_failed", detail: prepErr.message }, 500);
  }

  const j = (prep ?? {}) as {
    ok?: boolean;
    error?: string;
    detail?: string;
    owner_user_id?: string;
    shop_name?: string;
    sales_deleted?: number;
  };

  if (!j.ok) {
    return json({ ok: false, error: j.error ?? "delete_failed", detail: j.detail }, 400);
  }

  const ownerId = j.owner_user_id;
  if (!ownerId) {
    return json({ ok: false, error: "owner_not_found" }, 404);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { error: authDelErr } = await admin.auth.admin.deleteUser(ownerId);

  await userClient.rpc("admin_permanent_delete_auth_user_audit", {
    p_owner_user_id: ownerId,
    p_shop_id: shopId,
    p_ok: !authDelErr,
    p_detail: authDelErr?.message ?? null,
  });

  if (authDelErr) {
    return json({
      ok: false,
      error: "auth_delete_failed",
      detail: authDelErr.message,
      partial: true,
      message: "Shop data was removed but login user could not be deleted. Retry or remove user in Supabase Auth.",
      sales_deleted: j.sales_deleted,
    }, 500);
  }

  return json({
    ok: true,
    shop_name: j.shop_name,
    sales_deleted: j.sales_deleted,
    message: "Shop, organization data, and login account permanently deleted.",
  });
});
