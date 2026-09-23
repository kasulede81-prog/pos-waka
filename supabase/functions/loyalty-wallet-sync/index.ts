import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { loadGoogleWalletEnv } from "../_shared/loyaltyWallet/googleWalletEnv.ts";
import { deterministicGoogleWalletIds } from "../_shared/loyaltyWallet/googleWalletRest.ts";
import { syncGoogleWalletObjectBalance } from "../_shared/loyaltyWallet/loyaltyWalletService.ts";

/**
 * Drain loyalty_wallet_sync_outbox → Google Wallet object PATCH.
 *
 * POST { shop_id?: string, account_id?: string, limit?: number }
 * Authorization: Bearer <user jwt> (shop-scoped) OR service role key.
 *
 * Wallet failures never affect sales or ledger rows — they only update outbox status.
 */

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

type OutboxRow = {
  id: string;
  shop_id: string;
  account_id: string;
  balance_points: number;
  attempts: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const env = loadGoogleWalletEnv();
  if (!env.ok) {
    return json({ ok: false, error: env.error, drained: 0 }, env.error === "wallet_not_configured" ? 409 : 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const isService = authHeader === `Bearer ${serviceKey}`;

  let body: { shop_id?: string; account_id?: string; limit?: number } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const shopId = String(body.shop_id ?? "").trim();
  const accountId = String(body.account_id ?? "").trim();
  const limit = Math.min(50, Math.max(1, Number(body.limit ?? 20) || 20));

  const admin = createClient(supabaseUrl, serviceKey);

  if (!isService) {
    if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);
    if (!shopId) return json({ ok: false, error: "shop_id_required" }, 400);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: shop } = await userClient.from("shops").select("id").eq("id", shopId).maybeSingle();
    if (!shop) return json({ ok: false, error: "shop_not_found" }, 404);
  }

  let query = admin
    .from("loyalty_wallet_sync_outbox")
    .select("id, shop_id, account_id, balance_points, attempts")
    .in("status", ["pending", "failed"])
    .lt("attempts", 8)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (shopId) query = query.eq("shop_id", shopId);
  if (accountId) query = query.eq("account_id", accountId);

  const { data: rows, error: listErr } = await query;
  if (listErr) return json({ ok: false, error: "outbox_read_failed" }, 500);

  const pending = (rows ?? []) as OutboxRow[];
  let synced = 0;
  let failed = 0;
  const now = Math.floor(Date.now() / 1000);

  for (const row of pending) {
    await admin
      .from("loyalty_wallet_sync_outbox")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", row.id);

    // Always re-read authoritative balance — never trust a stale queued value alone.
    const { data: account } = await admin
      .from("loyalty_accounts")
      .select("id, shop_id, balance_points, google_wallet_object_id")
      .eq("id", row.account_id)
      .maybeSingle();

    if (!account) {
      await admin
        .from("loyalty_wallet_sync_outbox")
        .update({
          status: "failed",
          attempts: row.attempts + 1,
          last_error: "account_missing",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      failed += 1;
      continue;
    }

    // Skip accounts that were never issued to Google Wallet.
    if (!account.google_wallet_object_id) {
      await admin
        .from("loyalty_wallet_sync_outbox")
        .update({
          status: "done",
          attempts: row.attempts + 1,
          last_error: "not_issued",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      continue;
    }

    const balance = Math.max(0, Number(account.balance_points ?? row.balance_points ?? 0));
    const ids = deterministicGoogleWalletIds(env.issuerId, String(account.shop_id), String(account.id));
    const result = await syncGoogleWalletObjectBalance(ids, balance, env.signer, now);

    if (result.ok) {
      synced += 1;
      await admin
        .from("loyalty_wallet_sync_outbox")
        .update({
          status: "done",
          attempts: row.attempts + 1,
          last_error: null,
          balance_points: balance,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      await admin
        .from("loyalty_accounts")
        .update({
          google_wallet_synced_at: new Date().toISOString(),
          google_wallet_sync_balance: balance,
        })
        .eq("id", account.id);
    } else {
      failed += 1;
      await admin
        .from("loyalty_wallet_sync_outbox")
        .update({
          status: "failed",
          attempts: row.attempts + 1,
          last_error: result.error.slice(0, 240),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  }

  return json({ ok: true, drained: pending.length, synced, failed });
});
