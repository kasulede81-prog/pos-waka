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

/** Edit locked shop profile (support override). */
export function canEditShopProfile(role: string): boolean {
  return role === "super_admin" || role === "support_admin" || role === "operations_admin";
}

/** Permanent delete shop + owner login (destructive). */
export function canPermanentlyDeleteShopAccount(role: string): boolean {
  return role === "super_admin";
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

/** Admin reset of shop AI onboarding templates (RPC includes support_admin). */
export function canManageShopAiSetup(role: string): boolean {
  return canManageAi(role) || role === "support_admin";
}

/** Remote Support request/revoke — not inherited from tickets or shop rescue. */
export function canRemoteSupport(role: string): boolean {
  return role === "super_admin" || role === "support_admin";
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
    canFieldOps: canFieldOps(role),
    canManageAppReleases: canManageAppReleases(role),
    canManageAi: canManageAi(role),
    canManageShopAiSetup: canManageShopAiSetup(role),
    canEditShopProfile: canEditShopProfile(role),
    canPermanentlyDeleteShopAccount: canPermanentlyDeleteShopAccount(role),
    canRemoteSupport: canRemoteSupport(role),
    districtCount: adminRow?.assigned_district_ids?.length ?? 0,
  };
}
