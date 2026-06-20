import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { runCertifiedAuthRetry, runCertifiedHardDelete } from "../_shared/certifiedHardDelete.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function sessionRecentlyReauthenticated(lastSignInAt: string | undefined): boolean {
  if (!lastSignInAt) return false;
  const at = new Date(lastSignInAt).getTime();
  if (!Number.isFinite(at)) return false;
  return Date.now() - at <= REAUTH_MAX_AGE_MS;
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

  let body: {
    confirmation?: string;
    probe?: boolean;
    retry_auth?: boolean;
    shop_id?: string;
    organization_id?: string;
    shop_ids?: string[];
    staff_user_ids?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_body" }, 400);
  }

  if (body.probe === true) {
    return json({ ok: true, probe: true, edge: "owner-permanently-delete-account" });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user?.id) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const ownerId = userData.user.id;
  const admin = createClient(supabaseUrl, serviceKey);

  if (body.retry_auth === true) {
    if (!sessionRecentlyReauthenticated(userData.user.last_sign_in_at)) {
      return json({
        ok: false,
        error: "reauth_required",
        detail: "Confirm your password or Google account, then retry within 5 minutes.",
      }, 401);
    }

    const { data: orphanStatus, error: orphanErr } = await userClient.rpc("owner_self_delete_orphan_auth_status");
    if (orphanErr) {
      const msg = orphanErr.message ?? "";
      if (msg.includes("Could not find the function") || msg.includes("schema cache")) {
        return json({ ok: false, error: "migration_not_deployed", detail: msg }, 503);
      }
      return json({ ok: false, error: "delete_failed", detail: msg }, 500);
    }

    const orphan = (orphanStatus ?? {}) as { orphan_auth?: boolean };
    if (!orphan.orphan_auth) {
      return json({
        ok: false,
        error: "retry_not_applicable",
        detail: "Your shop account still exists. Use full account deletion instead.",
      }, 400);
    }

    const staffUserIds = (body.staff_user_ids ?? []).map(String);
    const shopIds = (body.shop_ids ?? []).map(String);
    const orgId = body.organization_id ? String(body.organization_id) : null;

    const retry = await runCertifiedAuthRetry({
      admin,
      userClient,
      ownerId,
      orgId,
      shopIds,
      staffUserIds,
    });

    await userClient.rpc("owner_self_delete_auth_audit", {
      p_owner_user_id: ownerId,
      p_shop_id: null,
      p_action: retry.ok ? "owner_retry_auth_delete_ok" : "owner_retry_auth_delete_failed",
      p_ok: retry.ok,
      p_detail: retry.detail ?? null,
    }).catch(() => undefined);

    if (!retry.ok) {
      return json({
        ok: false,
        error: retry.error ?? "auth_delete_failed",
        partial: true,
        detail: retry.detail,
        deletion_report: retry.deletion_report,
        message: "Login removal failed again. Contact Waka support with the deletion report.",
      }, 500);
    }

    return json({
      ok: true,
      message: retry.message,
      deletion_report: retry.deletion_report,
      retry: true,
    });
  }

  const confirmation = String(body.confirmation ?? "").trim();
  if (!confirmation) return json({ ok: false, error: "confirmation_required" }, 400);

  if (!sessionRecentlyReauthenticated(userData.user.last_sign_in_at)) {
    return json({
      ok: false,
      error: "reauth_required",
      detail: "Confirm your password or Google account, then retry within 5 minutes.",
    }, 401);
  }

  const result = await runCertifiedHardDelete({
    userClient,
    admin,
    prepare: () =>
      userClient.rpc("owner_permanently_delete_own_account", {
        p_confirmation: confirmation,
        p_phase: "prepare",
      }),
    execute: () =>
      userClient.rpc("owner_permanently_delete_own_account", {
        p_confirmation: confirmation,
        p_phase: "execute",
      }),
  });

  await userClient.rpc("owner_self_delete_auth_audit", {
    p_owner_user_id: ownerId,
    p_shop_id: null,
    p_action: result.ok ? "owner_permanent_delete_auth_ok" : "owner_permanent_delete_auth_failed",
    p_ok: result.ok,
    p_detail: result.detail ?? null,
  }).catch(() => undefined);

  if (!result.ok) {
    return json({
      ok: false,
      error: result.error ?? "delete_failed",
      detail: result.detail,
      partial: result.partial,
      message: result.message,
      deletion_report: result.deletion_report,
      shop_name: result.shop_name,
      sales_deleted: result.sales_deleted,
      devices_deactivated: result.devices_deactivated,
      user_ids: result.user_ids,
      organization_id: result.organization_id,
      shop_ids: result.shop_ids,
      staff_user_ids: result.staff_user_ids,
    }, result.partial ? 500 : 400);
  }

  return json({
    ok: true,
    shop_name: result.shop_name,
    sales_deleted: result.sales_deleted,
    devices_deactivated: result.devices_deactivated,
    deletion_report: result.deletion_report,
    message: result.message ??
      "Your account, shop data, and all staff logins were permanently deleted. You can register again with the same email.",
  });
});
