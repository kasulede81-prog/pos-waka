import type { WakaInternalAdminRow } from "../../../lib/wakaInternalAdmin";

export function normalizeAdminRole(role: string | null | undefined): string {
  return (role ?? "").toLowerCase();
}

export function isSuperAdmin(role: string): boolean {
  return role === "super_admin";
}

export function canResolveSupport(role: string): boolean {
  return role === "super_admin" || role === "support_admin" || role === "finance_admin";
}

export function canManageTrials(role: string): boolean {
  return (
    role === "super_admin" ||
    role === "subscriptions_admin" ||
    role === "finance_admin" ||
    role === "operations_admin"
  );
}

export function canManageBillingOffers(role: string): boolean {
  return canManageTrials(role);
}

export function canSendAnnualOffer(role: string): boolean {
  return canManageTrials(role) || role === "support_admin";
}

export function canShopSupport(role: string): boolean {
  return canResolveSupport(role) || role === "operations_admin";
}

/**
 * Change a subscription's LIFECYCLE state (extend trial, pause, resume, cancel).
 *
 * NARROWER THAN `canManageTrials` ON PURPOSE — this mirrors the server, it does
 * not extend it. `admin_extend_subscription_trial` and
 * `admin_subscription_set_status` both accept only
 * `['super_admin','subscriptions_admin']`
 * (`028_internal_ops_live_metrics_admin_rpcs.sql:491,633`), while the UI gated
 * these controls on `canManageTrials` (four roles). A finance_admin or
 * operations_admin was therefore shown Extend / Pause / Resume / Cancel and
 * always got `Forbidden`.
 *
 * The server is the authority and is deliberately NOT loosened here; granting
 * and renewing stay on `canManageTrials`, because
 * `admin_shop_set_subscription_plan` really does allow all four roles.
 */
export function canManageSubscriptionLifecycle(role: string): boolean {
  return role === "super_admin" || role === "subscriptions_admin";
}

/**
 * Edit a shop's Vision settings.
 *
 * Mirrors `admin_update_shop_vision_settings`, which accepts only
 * `['super_admin','operations_admin']` (`145_shop_vision_included_with_subscription.sql`).
 * The tab previously inherited `canShopSubs`, so subscriptions_admin and
 * finance_admin were shown an editable panel the server refuses.
 */
export function canManageShopVision(role: string): boolean {
  return role === "super_admin" || role === "operations_admin";
}

/**
 * Send an owner password reset / clear credentials from the shop console.
 *
 * Mirrors the `admin-set-owner-password` Edge Function, which requires
 * `super_admin | support_admin` (`supabase/functions/admin-set-owner-password/index.ts:54`).
 * `AdminSupportPage` already gated its copy of this panel correctly; the shop
 * console gated it on `canSupport` (four roles) — the two mount sites
 * disagreed, and the server agrees with the support page.
 */
export function canResetOwnerPassword(role: string): boolean {
  return role === "super_admin" || role === "support_admin";
}

/**
 * Manage growth campaigns.
 *
 * Mirrors `_growth_require_admin`, which requires internal staff AND a role in
 * `['super_admin','subscriptions_admin','finance_admin','operations_admin']`
 * (`097_growth_campaigns.sql:125-137`). The page previously had NO client gate
 * at all, so any internal admin saw an editable page whose saves raised
 * `Forbidden`.
 */
export function canManageGrowthCampaigns(role: string): boolean {
  return canManageTrials(role);
}

/** Edit locked shop profile (support override). */
export function canEditShopProfile(role: string): boolean {
  return role === "super_admin" || role === "support_admin" || role === "operations_admin";
}

/** Permanent delete shop + owner login (destructive). */
export function canPermanentlyDeleteShopAccount(role: string): boolean {
  return role === "super_admin";
}

/**
 * Reset a shop's business/test data (products, sales, inventory movements,
 * etc.) while preserving the shop, org, and owner login (destructive, but
 * less severe than permanent account deletion — so operations_admin is
 * included alongside super_admin).
 */
export function canResetShopBusinessData(role: string): boolean {
  return role === "super_admin" || role === "operations_admin";
}

export function canShopSubs(role: string): boolean {
  return canManageTrials(role);
}

export function canFieldOps(role: string): boolean {
  return (
    role === "super_admin" ||
    role === "operations_admin" ||
    role === "field_agent" ||
    role === "subscriptions_admin" ||
    role === "finance_admin"
  );
}

export function canManageAppReleases(role: string): boolean {
  return role === "super_admin" || role === "operations_admin";
}

/** Platform AI Control Center + shop AI settings RPCs. */
export function canManageAi(role: string): boolean {
  return role === "super_admin" || role === "operations_admin";
}

/**
 * Loyalty control plane (Phase 6A/6B). Mirrors the server allowlist in
 * is_waka_internal_role(['super_admin','operations_admin']) so the nav matches what the
 * database will actually authorize — the server remains the authority either way.
 */
export function canManageLoyalty(role: string): boolean {
  return role === "super_admin" || role === "operations_admin";
}

/** Admin reset of shop AI onboarding templates (RPC includes support_admin). */
export function canManageShopAiSetup(role: string): boolean {
  return canManageAi(role) || role === "support_admin";
}

/** Remote Support request/revoke — not inherited from tickets or shop rescue. */
export function canRemoteSupport(role: string): boolean {
  return role === "super_admin" || role === "support_admin";
}

/**
 * Historical financial correction (sale-line COGS/profit) — the most sensitive
 * financial-data-mutation capability in the internal admin console. Deliberately NOT
 * inherited from canFieldOps/canManageTrials/canResolveSupport (finance_admin's other
 * capabilities) — this is its own explicit check so it can never be granted by
 * accident as a side effect of broadening one of those.
 */
export function canCorrectFinancials(role: string): boolean {
  return role === "super_admin" || role === "finance_admin";
}

export function adminPermissions(adminRow: WakaInternalAdminRow | null) {
  const role = normalizeAdminRole(adminRow?.role);
  return {
    role,
    isSuper: isSuperAdmin(role),
    canResolveSupport: canResolveSupport(role),
    canManageTrials: canManageTrials(role),
    canManageBillingOffers: canManageBillingOffers(role),
    canSendAnnualOffer: canSendAnnualOffer(role),
    canShopSupport: canShopSupport(role),
    canShopSubs: canShopSubs(role),
    // Server-mirroring gates for actions the broker service refuses to roles the
    // broader `canShop*` flags would otherwise expose (see each helper).
    canManageSubscriptionLifecycle: canManageSubscriptionLifecycle(role),
    canManageShopVision: canManageShopVision(role),
    canResetOwnerPassword: canResetOwnerPassword(role),
    canManageGrowthCampaigns: canManageGrowthCampaigns(role),
    canFieldOps: canFieldOps(role),
    canManageAppReleases: canManageAppReleases(role),
    canManageAi: canManageAi(role),
    canManageShopAiSetup: canManageShopAiSetup(role),
    canEditShopProfile: canEditShopProfile(role),
    canPermanentlyDeleteShopAccount: canPermanentlyDeleteShopAccount(role),
    canResetShopBusinessData: canResetShopBusinessData(role),
    canRemoteSupport: canRemoteSupport(role),
    canCorrectFinancials: canCorrectFinancials(role),
    districtCount: adminRow?.assigned_district_ids?.length ?? 0,
  };
}
