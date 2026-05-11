import { supabase } from "./supabase";
import type { RemoteSubscriptionRow } from "./subscriptionEntitlements";

/**
 * Loads the org subscription for the signed-in user (via primary shop membership).
 */
export async function fetchRemoteSubscriptionForUser(userId: string): Promise<RemoteSubscriptionRow | null> {
  if (!supabase) return null;

  const { data: member, error: mErr } = await supabase
    .from("shop_members")
    .select("shop_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (mErr || !member?.shop_id) return null;

  const { data: shop, error: sErr } = await supabase
    .from("shops")
    .select("organization_id")
    .eq("id", member.shop_id)
    .maybeSingle();
  if (sErr || !shop?.organization_id) return null;

  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .select("id, organization_id, shop_id, status, trial_ends_at, current_period_start, current_period_end, plan_id, created_at")
    .eq("organization_id", shop.organization_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subErr || !sub?.plan_id) return null;

  const { data: plan, error: pErr } = await supabase
    .from("subscription_plans")
    .select("code, max_pos_users, max_shops")
    .eq("id", sub.plan_id)
    .maybeSingle();
  if (pErr || !plan?.code) return null;

  const row: RemoteSubscriptionRow = {
    id: sub.id,
    organization_id: sub.organization_id,
    shop_id: sub.shop_id ?? null,
    status: sub.status,
    trial_ends_at: sub.trial_ends_at ?? null,
    current_period_start: sub.current_period_start ?? null,
    current_period_end: sub.current_period_end ?? null,
    plan_code: plan.code,
    max_pos_users: plan.max_pos_users ?? null,
    max_shops: plan.max_shops ?? null,
  };
  return row;
}
