import { supabase } from "./supabase";
import type { RemoteSubscriptionRow } from "./subscriptionEntitlements";

export async function resolvePrimaryOrganizationForUser(userId: string): Promise<{
  organizationId: string;
  shopId: string;
} | null> {
  if (!supabase) return null;

  const { data: members, error: mErr } = await supabase
    .from("shop_members")
    .select("shop_id, role, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (mErr || !members?.length) return null;

  const ownerRow = members.find((m) => m.role === "owner");
  const managerRow = members.find((m) => m.role === "manager");
  const shopId = (ownerRow ?? managerRow ?? members[0])?.shop_id;
  if (!shopId) return null;

  const { data: shop, error: sErr } = await supabase
    .from("shops")
    .select("organization_id")
    .eq("id", shopId)
    .maybeSingle();
  if (sErr || !shop?.organization_id) return null;

  return { organizationId: shop.organization_id, shopId };
}

/**
 * Loads the org subscription for the signed-in user (via primary shop membership).
 */
export async function fetchRemoteSubscriptionForUser(userId: string): Promise<RemoteSubscriptionRow | null> {
  if (!supabase) return null;

  const orgShop = await resolvePrimaryOrganizationForUser(userId);
  if (!orgShop) return null;

  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .select("id, organization_id, shop_id, status, trial_ends_at, current_period_start, current_period_end, plan_id, created_at")
    .eq("organization_id", orgShop.organizationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (subErr || !sub?.plan_id) return null;

  const { data: plan, error: pErr } = await supabase
    .from("subscription_plans")
    .select("code, max_pos_users, max_shops, features")
    .eq("id", sub.plan_id)
    .maybeSingle();
  if (pErr || !plan?.code) return null;

  const features = plan.features as Record<string, unknown> | null;
  const devicesRaw = features?.devices;
  const maxDevices =
    typeof devicesRaw === "number" && Number.isFinite(devicesRaw) && devicesRaw > 0
      ? Math.floor(devicesRaw)
      : null;

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
    max_devices: maxDevices,
  };
  return row;
}
