import { fetchProfilePrimaryShopId } from "./primaryShop";
import { supabase } from "./supabase";
import type { PromotionalGrantRow, RemoteSubscriptionRow, SubscriptionSnapshot } from "./subscriptionEntitlements";
import { maxDevicesHintForTier, normalizePlanCode } from "./subscriptionEntitlements";

export async function resolvePrimaryOrganizationForUser(userId: string): Promise<{
  organizationId: string;
  shopId: string;
} | null> {
  if (!supabase) return null;

  const primaryShopId = await fetchProfilePrimaryShopId(userId);
  if (primaryShopId) {
    const { data: member, error: pmErr } = await supabase
      .from("shop_members")
      .select("shop_id")
      .eq("user_id", userId)
      .eq("shop_id", primaryShopId)
      .maybeSingle();
    if (!pmErr && member?.shop_id) {
      const { data: shop, error: sErr } = await supabase
        .from("shops")
        .select("organization_id")
        .eq("id", primaryShopId)
        .maybeSingle();
      if (!sErr && shop?.organization_id) {
        return { organizationId: shop.organization_id, shopId: primaryShopId };
      }
    }
  }

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
 * Latest active promotional grant (growth campaign / referral / manual) for the org.
 * RLS limits rows to the member's own organization; failures degrade to null so
 * the real subscription still resolves.
 */
export async function fetchActivePromotionalGrant(organizationId: string): Promise<PromotionalGrantRow | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("promotional_grants")
      .select("id, plan_code, granted_by, campaign_id, granted_at, expires_at, revoked_at")
      .eq("organization_id", organizationId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return data as PromotionalGrantRow;
  } catch {
    return null;
  }
}

/**
 * Full snapshot for the signed-in user: real subscription row + any active
 * promotional grant. Grant priority is applied by `resolveEffectivePlanTier`.
 */
export async function fetchSubscriptionSnapshotForUser(userId: string): Promise<SubscriptionSnapshot> {
  if (!supabase) return { kind: "none" };
  const orgShop = await resolvePrimaryOrganizationForUser(userId);
  if (!orgShop) return { kind: "none" };

  const [row, grant] = await Promise.all([
    fetchRemoteSubscriptionForUser(userId, orgShop),
    fetchActivePromotionalGrant(orgShop.organizationId),
  ]);
  if (row) return { kind: "remote", row, promotionalGrant: grant };
  return { kind: "none", promotionalGrant: grant };
}

/**
 * Loads the org subscription for the signed-in user (via primary shop membership).
 */
export async function fetchRemoteSubscriptionForUser(
  userId: string,
  resolvedOrgShop?: { organizationId: string; shopId: string },
): Promise<RemoteSubscriptionRow | null> {
  if (!supabase) return null;

  const orgShop = resolvedOrgShop ?? (await resolvePrimaryOrganizationForUser(userId));
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
  const tier = normalizePlanCode(plan.code);
  const maxDevicesFromFeatures =
    typeof devicesRaw === "number" && Number.isFinite(devicesRaw) && devicesRaw > 0
      ? Math.floor(devicesRaw)
      : null;
  const maxDevices = maxDevicesFromFeatures ?? maxDevicesHintForTier(tier);

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
