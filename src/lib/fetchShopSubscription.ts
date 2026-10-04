import { getActiveShopId } from "../offline/shopScope";
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
 * The subscription of a SHOP the caller can operate, read through the server.
 *
 * WHY THIS EXISTS. Resolving the plan from the caller's own organization is correct for an owner
 * and wrong for everyone else: an invited cashier holds no `organization_members` row for the shop
 * they work in, so `subscriptions_select` refuses them, the query returns zero rows, and the client
 * read that as "no subscription" → Free. The cashier operates the shop; the shop's plan is what
 * they inherit, and this asks for it by SHOP so the server can derive the organization itself.
 *
 * Returns `null` when the call could not be made or was refused — never `none`. A refusal and an
 * absence must not be the same value, or the bug returns.
 */
async function fetchShopScopedSubscriptionSnapshot(
  shopId: string,
): Promise<{ snapshot: SubscriptionSnapshot; organizationId: string | null } | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc("shop_get_effective_subscription", { p_shop_id: shopId });
    if (error) return null;
    const payload = (data ?? {}) as {
      ok?: boolean;
      found?: boolean;
      subscription?: Record<string, unknown> | null;
    };
    if (payload.ok !== true) return null;

    const organizationId =
      typeof payload.subscription?.organization_id === "string" ? payload.subscription.organization_id : null;

    if (payload.found !== true || !payload.subscription) {
      // A REAL answer: the caller may access this shop and it has no subscription.
      return { snapshot: { kind: "none" }, organizationId };
    }

    const sub = payload.subscription;
    const features = (sub.features ?? null) as Record<string, unknown> | null;
    const devicesRaw = features?.devices;
    const tier = normalizePlanCode(typeof sub.plan_code === "string" ? sub.plan_code : "");
    const maxDevicesFromFeatures =
      typeof devicesRaw === "number" && Number.isFinite(devicesRaw) && devicesRaw > 0
        ? Math.floor(devicesRaw)
        : null;

    // Shaped exactly like the owner path's row, so nothing downstream can tell the two apart.
    const row: RemoteSubscriptionRow = {
      id: String(sub.id ?? ""),
      organization_id: String(sub.organization_id ?? ""),
      shop_id: (sub.shop_id as string | null) ?? null,
      status: String(sub.status ?? ""),
      trial_ends_at: (sub.trial_ends_at as string | null) ?? null,
      current_period_start: (sub.current_period_start as string | null) ?? null,
      current_period_end: (sub.current_period_end as string | null) ?? null,
      plan_code: String(sub.plan_code ?? ""),
      max_pos_users: (sub.max_pos_users as number | null) ?? null,
      max_shops: (sub.max_shops as number | null) ?? null,
      max_devices: maxDevicesFromFeatures ?? maxDevicesHintForTier(tier),
    };
    return { snapshot: { kind: "remote", row }, organizationId };
  } catch {
    return null;
  }
}

/**
 * Full snapshot for the signed-in user: real subscription row + any active
 * promotional grant. Effective resolution via resolveEffectiveSubscription (Phase 16.4).
 *
 * RESOLUTION ORDER, and why:
 *   1. THE ACTIVE SHOP. This is the operational context — the shop the terminal is actually on —
 *      and it is the only one that is correct for staff. The server authorises it with the same
 *      `user_can_access_shop` predicate that governs shop access, so this is not a new privilege.
 *   2. Otherwise the caller's own organization (the original path). It stays as the fallback so an
 *      OWNER is untouched, and so a merchant with no active shop yet still resolves their plan.
 *
 * A failed shop-scoped read does NOT silently fall through to the owner path's `none`: it reports
 * `unavailable`, because falling through is precisely the shape of the original bug.
 */
export async function fetchSubscriptionSnapshotForUser(userId: string): Promise<SubscriptionSnapshot> {
  if (!supabase) return { kind: "none" };

  const activeShopId = getActiveShopId();
  if (activeShopId) {
    const scoped = await fetchShopScopedSubscriptionSnapshot(activeShopId);
    if (scoped) {
      const grant = scoped.organizationId
        ? await fetchActivePromotionalGrant(scoped.organizationId)
        : null;
      if (scoped.snapshot.kind === "remote") {
        return { kind: "remote", row: scoped.snapshot.row, promotionalGrant: grant };
      }
      if (scoped.snapshot.kind === "none") {
        return { kind: "none", promotionalGrant: grant };
      }
      return { kind: "unavailable", promotionalGrant: grant };
    }
    // Could not read this shop's plan. Do not drop to `none` — that is what showed Free.
    return { kind: "unavailable" };
  }

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
