/**
 * Settings access contract — one matrix for hub visibility, route gates,
 * and preference mutation authorization.
 *
 * Feature entitlement decides whether a setting exists.
 * Role permission decides whether the user may operate it.
 *
 * `settings.shop` remains BUSINESS_PLUS on the generic permission-effective
 * API (diagnostics / existing entitlement tests). Settings pages do not use
 * that blob; they use this matrix.
 */

import type { Permission, ShopPreferences, UserRole } from "../types";
import type { SessionActor } from "./sessionActor";
import { authOperatorRole } from "./sessionActor";
import { actorHasPermission } from "./actorAuthorization";
import { hasActorPermission } from "./permissions";
import {
  canUseBackupRestore,
  maxStaffAccountsForTier,
  resolveEffectivePlanTier,
  tierMeetsMinimum,
  type SubscriptionPlanCode,
  type SubscriptionSnapshot,
} from "./subscriptionEntitlements";

export type SettingsCapabilityId =
  | "shop_profile"
  | "staff"
  | "backup"
  | "receipt"
  | "selling"
  | "pin"
  | "password"
  | "biometric"
  | "cash_drawer"
  | "appearance"
  | "notifications"
  | "devices"
  | "home_menu"
  | "office_menu"
  | "shelves"
  | "floor"
  | "pharmacy"
  | "hospitality"
  | "menu_builder"
  | "health"
  | "diagnostics"
  | "finance_diagnostics"
  | "retention"
  | "archive"
  | "sync_conflicts"
  | "hardware"
  | "shop_business";

export type SettingsEntitlementKind = "free" | "staff" | "backup" | "starter" | "business";

export type SettingsCapabilityDef = {
  id: SettingsCapabilityId;
  route: string;
  permission: Permission;
  entitlement: SettingsEntitlementKind;
  ownerOnly?: boolean;
  /** Shown as a Settings hub card when access + extra hub rules pass. */
  hub?: boolean;
};

export const SETTINGS_CAPABILITIES: Record<SettingsCapabilityId, SettingsCapabilityDef> = {
  shop_profile: {
    id: "shop_profile",
    route: "/settings/shop",
    permission: "settings.shop",
    entitlement: "free",
    hub: true,
  },
  pin: {
    id: "pin",
    route: "/settings/pin",
    permission: "settings.shop",
    entitlement: "free",
    hub: true,
  },
  password: {
    id: "password",
    route: "/settings/password",
    permission: "settings.shop",
    entitlement: "free",
    hub: true,
  },
  biometric: {
    id: "biometric",
    route: "/settings/biometric",
    permission: "settings.shop",
    entitlement: "free",
    ownerOnly: true,
    hub: true,
  },
  receipt: {
    id: "receipt",
    route: "/settings/receipt",
    permission: "settings.receipt",
    entitlement: "free",
    hub: true,
  },
  appearance: {
    id: "appearance",
    route: "/settings/appearance",
    permission: "settings.view",
    entitlement: "free",
    hub: true,
  },
  notifications: {
    id: "notifications",
    route: "/settings/notifications",
    permission: "settings.view",
    entitlement: "free",
    hub: true,
  },
  cash_drawer: {
    id: "cash_drawer",
    route: "/settings/cash-drawer",
    permission: "day.open_drawer",
    entitlement: "free",
    hub: true,
  },
  devices: {
    id: "devices",
    route: "/settings/devices",
    permission: "settings.devices",
    entitlement: "free",
    hub: true,
  },
  hardware: {
    id: "hardware",
    route: "/office/hardware",
    permission: "settings.view",
    entitlement: "free",
    hub: true,
  },
  staff: {
    id: "staff",
    route: "/staff-center",
    permission: "settings.shop",
    entitlement: "staff",
    hub: true,
  },
  backup: {
    id: "backup",
    route: "/office/backup",
    permission: "settings.shop",
    entitlement: "backup",
    hub: false,
  },
  selling: {
    id: "selling",
    route: "/settings/selling",
    permission: "settings.shop",
    entitlement: "business",
    hub: true,
  },
  home_menu: {
    id: "home_menu",
    route: "/settings/home-menu",
    permission: "settings.shop",
    entitlement: "business",
    hub: true,
  },
  office_menu: {
    id: "office_menu",
    route: "/settings/office-menu",
    permission: "settings.shop",
    entitlement: "business",
    hub: true,
  },
  shelves: {
    id: "shelves",
    route: "/settings/shelves",
    permission: "settings.shop",
    entitlement: "business",
    hub: true,
  },
  floor: {
    id: "floor",
    route: "/settings/floor",
    permission: "settings.shop",
    entitlement: "business",
    hub: true,
  },
  pharmacy: {
    id: "pharmacy",
    route: "/settings/pharmacy",
    permission: "settings.shop",
    entitlement: "business",
    hub: true,
  },
  hospitality: {
    id: "hospitality",
    route: "/settings/hospitality",
    permission: "settings.shop",
    entitlement: "business",
    hub: true,
  },
  menu_builder: {
    id: "menu_builder",
    route: "/settings/menu",
    permission: "settings.shop",
    entitlement: "business",
    hub: false,
  },
  health: {
    id: "health",
    route: "/settings/health",
    permission: "settings.shop",
    entitlement: "business",
    hub: true,
  },
  diagnostics: {
    id: "diagnostics",
    route: "/settings/diagnostics",
    permission: "settings.shop",
    entitlement: "business",
    hub: true,
  },
  finance_diagnostics: {
    id: "finance_diagnostics",
    route: "/settings/finance-diagnostics",
    permission: "owner.dashboard",
    entitlement: "business",
    hub: true,
  },
  retention: {
    id: "retention",
    route: "/settings/retention",
    permission: "settings.shop",
    entitlement: "business",
    hub: true,
  },
  archive: {
    id: "archive",
    route: "/settings/archive",
    permission: "settings.shop",
    entitlement: "business",
    hub: false,
  },
  sync_conflicts: {
    id: "sync_conflicts",
    route: "/settings/sync-conflicts",
    permission: "settings.shop",
    entitlement: "business",
    hub: false,
  },
  shop_business: {
    id: "shop_business",
    route: "",
    permission: "settings.shop",
    entitlement: "business",
    hub: false,
  },
};

const FREE_SHOP_PROFILE_KEYS = new Set<keyof ShopPreferences>([
  "shopDisplayName",
  "shopPhoneE164",
  "shopAddressLine",
  "shopCurrency",
  "businessType",
  "onboardingDone",
  "onboardingWizardDone",
  "shopSellingStyle",
  "mixedPackSelling",
  "pharmacyModeEnabled",
  "hospitalityModeEnabled",
  "wakaShopId",
  "schemaVersion",
]);

const PIN_KEYS = new Set<keyof ShopPreferences>(["backOfficePin"]);
const BIOMETRIC_KEYS = new Set<keyof ShopPreferences>(["biometricAuthEnabled"]);
const STAFF_KEYS = new Set<keyof ShopPreferences>([
  "staffAccounts",
  "customStaffRoles",
  "staffCanRecordCashExpenses",
  "requireCashierExpenseApproval",
  "staffCanManagePendingSales",
  "staffAutoLockMinutes",
  "staffRequirePinAfterIdle",
  "staffAllowSwitchUser",
  "staffRememberSession",
  "staffMaxFailedAttempts",
  "staffSessionTimeoutMinutes",
]);
const SELLING_KEYS = new Set<keyof ShopPreferences>([
  "kioskQuickSell",
  "discountControlMode",
  "discountMaxPercentThreshold",
  "registerMode",
  "primaryDeviceFingerprint",
]);
const RETENTION_KEYS = new Set<keyof ShopPreferences>([
  "dataRetentionPolicy",
  "lastAutoBackupDateKey",
  "lastArchiveRunAt",
  "lastMonthlyReportPromptMonth",
]);
const SHELVES_KEYS = new Set<keyof ShopPreferences>([
  "posPinnedShelfKeys",
  "posPinnedShelfKeysUpdatedAt",
  "posPinnedShelfKeyRevisions",
  "posShelfLayout",
  "catalogHierarchyEnabled",
  "catalogHierarchyEnabledUpdatedAt",
  "posCatalogNodes",
  "posCatalogTombstones",
  "posShelfLayoutTombstones",
  "posQuickSellProductIds",
  "posShelfPresetId",
  "posShelfDefaultScale",
]);
const HOME_MENU_KEYS = new Set<keyof ShopPreferences>([
  "launcherTileOrder",
  "launcherTileLayout",
  "homeHeroPreviewBgColor",
]);
const OFFICE_MENU_KEYS = new Set<keyof ShopPreferences>(["officeHubTileOrder", "officeHubTileLayout"]);
const PHARMACY_KEYS = new Set<keyof ShopPreferences>(["pharmacyExpiredSaleBehavior"]);
const HOSPITALITY_KEYS = new Set<keyof ShopPreferences>([
  "hospitalityKitchenEnabled",
  "hospitalityManualKitchenFire",
  "hospitalityFloor",
  "pendingSalesTtl",
]);
const RECEIPT_KEYS = new Set<keyof ShopPreferences>([
  "receiptCustomHeaderText",
  "receiptCustomFooterText",
  "receiptReturnPolicyText",
  "receiptHeader",
  "receiptFooterLines",
  "receiptDisplayOptions",
  "receiptShowPoweredByWaka",
]);
const DEVICE_KEYS = new Set<keyof ShopPreferences>(["receiptPaperSize"]);
const CASH_DRAWER_KEYS = new Set<keyof ShopPreferences>([
  "cashVarianceThresholdPct",
  "cashVarianceThresholdUgxFixed",
  "cashDrawerFormulaVersion",
  "ownerDayOpenCorrectionAfterSales",
  "cashSafeLimitUgx",
  "cashPositionDayNotes",
]);
const NOTIFICATION_KEYS = new Set<keyof ShopPreferences>(["hapticsOn", "saleSoundOn"]);

function planTier(snapshot: SubscriptionSnapshot, authMode: "supabase" | "local"): SubscriptionPlanCode {
  if (authMode === "local") return "waka_plus";
  return resolveEffectivePlanTier(snapshot);
}

export function settingsCapabilityEntitlementAllows(
  capabilityId: SettingsCapabilityId,
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
): boolean {
  const def = SETTINGS_CAPABILITIES[capabilityId];
  if (authMode === "local") return true;
  const tier = planTier(snapshot, authMode);
  switch (def.entitlement) {
    case "free":
      return true;
    case "staff":
      return maxStaffAccountsForTier(tier) > 0;
    case "backup":
      return canUseBackupRestore(snapshot, authMode);
    case "starter":
      return tierMeetsMinimum(tier, "starter");
    case "business":
      return tierMeetsMinimum(tier, "business");
  }
}

export function hasSettingsCapabilityRole(
  actor: SessionActor | null | undefined,
  capabilityId: SettingsCapabilityId,
): boolean {
  if (!actor) return false;
  const def = SETTINGS_CAPABILITIES[capabilityId];
  if (!actorHasPermission(actor, def.permission)) return false;
  if (def.ownerOnly && authOperatorRole(actor) !== "owner") return false;
  return true;
}

export function canAccessSettingsCapability(
  actor: SessionActor | null | undefined,
  capabilityId: SettingsCapabilityId,
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
): boolean {
  if (!hasSettingsCapabilityRole(actor, capabilityId)) return false;
  return settingsCapabilityEntitlementAllows(capabilityId, snapshot, authMode);
}

export function canAccessSettingsCapabilityForRole(
  role: UserRole,
  capabilityId: SettingsCapabilityId,
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
  actorPermissions?: Permission[] | null,
): boolean {
  const def = SETTINGS_CAPABILITIES[capabilityId];
  if (!hasActorPermission(role, def.permission, actorPermissions)) return false;
  if (def.ownerOnly && role !== "owner") return false;
  return settingsCapabilityEntitlementAllows(capabilityId, snapshot, authMode);
}

export type SettingsRouteDenialTarget = "/upgrade" | "/settings" | "/";

/**
 * Where a denied Settings capability request should go.
 * Upgrade only when the operator has the role but lacks the plan entitlement.
 */
export function resolveSettingsCapabilityDenialTarget(
  actor: SessionActor | null | undefined,
  capabilityId: SettingsCapabilityId,
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
): SettingsRouteDenialTarget | null {
  if (canAccessSettingsCapability(actor, capabilityId, snapshot, authMode)) return null;
  const def = SETTINGS_CAPABILITIES[capabilityId];
  const hasRole = Boolean(actor) && actorHasPermission(actor, def.permission);
  const ownerOk = !def.ownerOnly || (actor != null && authOperatorRole(actor) === "owner");
  if (hasRole && ownerOk && !settingsCapabilityEntitlementAllows(capabilityId, snapshot, authMode)) {
    return "/upgrade";
  }
  if (def.route.startsWith("/settings/") || def.route === "/staff-center") return "/settings";
  return "/";
}

export function capabilityForSettingsPath(pathname: string): SettingsCapabilityId | null {
  const path = pathname.split("?")[0]?.replace(/\/+$/, "") || "/";
  if (path === "/staff-center" || path.startsWith("/staff-center/")) return "staff";
  for (const def of Object.values(SETTINGS_CAPABILITIES)) {
    if (def.route && def.route === path) return def.id;
  }
  return null;
}

export function settingsCapabilityForPreferenceKey(
  key: keyof ShopPreferences,
): SettingsCapabilityId | null {
  if (FREE_SHOP_PROFILE_KEYS.has(key)) return "shop_profile";
  if (PIN_KEYS.has(key)) return "pin";
  if (BIOMETRIC_KEYS.has(key)) return "biometric";
  if (STAFF_KEYS.has(key)) return "staff";
  if (SELLING_KEYS.has(key)) return "selling";
  if (RETENTION_KEYS.has(key)) return "retention";
  if (SHELVES_KEYS.has(key)) return "shelves";
  if (HOME_MENU_KEYS.has(key)) return "home_menu";
  if (OFFICE_MENU_KEYS.has(key)) return "office_menu";
  if (PHARMACY_KEYS.has(key)) return "pharmacy";
  if (HOSPITALITY_KEYS.has(key)) return "hospitality";
  if (RECEIPT_KEYS.has(key)) return "receipt";
  if (DEVICE_KEYS.has(key)) return "devices";
  if (CASH_DRAWER_KEYS.has(key)) return "cash_drawer";
  if (NOTIFICATION_KEYS.has(key)) return "notifications";
  return null;
}

export function fallbackShopBusinessCapability(key: keyof ShopPreferences): SettingsCapabilityId {
  const mapped = settingsCapabilityForPreferenceKey(key);
  if (mapped) return mapped;
  return "shop_business";
}

export { FREE_SHOP_PROFILE_KEYS as SETTINGS_FREE_SHOP_PROFILE_KEYS };
