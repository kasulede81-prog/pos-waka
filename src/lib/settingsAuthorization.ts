/**
 * Store-layer authorization for preference mutations.
 * UI route guards are not sufficient — this map is authoritative.
 */

import type { Permission, ShopPreferences } from "../types";
import type { SessionActor } from "./sessionActor";
import {
  checkStorePermission,
  checkStorePermissionEffective,
  type StoreAuthResult,
} from "./storeAuthorization";
import { canHideWakaReceiptBranding } from "./receiptBranding";
import { resolveStorePlanTier } from "./productPlanEnforcement";
import { validateStaffAccountsPatch } from "./staffPlanEnforcement";
import type { SubscriptionSnapshot } from "./subscriptionEntitlements";
import { getStoreSubscriptionContext } from "./storeSubscriptionContext";

/** Per-device / sell-screen UX — no settings permission required. */
const OPERATIONAL_PREFERENCE_KEYS = new Set<keyof ShopPreferences>([
  "recentProductIds",
  "favoriteProductIds",
  "posSellCategoryFilter",
  "celebratedFirstSale",
  "posLocked",
  "activeTableSessionId",
]);

/** Device / hardware receipt width — owner devices settings. */
const DEVICES_PREFERENCE_KEYS = new Set<keyof ShopPreferences>(["receiptPaperSize"]);

/** POS UI mode toggle — separate from shop settings. */
const UI_MODE_KEYS = new Set<keyof ShopPreferences>(["posUiMode"]);

/** Shift rows are mutated via beginShift / endActiveShift / closeShiftWithCashCount. */
const SHIFT_PREFERENCE_KEYS = new Set<keyof ShopPreferences>(["shifts", "archivedShifts"]);

/** Receipt branding — managers may edit via settings.receipt. */
const RECEIPT_PREFERENCE_KEYS = new Set<keyof ShopPreferences>([
  "receiptCustomHeaderText",
  "receiptCustomFooterText",
  "receiptReturnPolicyText",
  "receiptHeader",
  "receiptFooterLines",
  "receiptDisplayOptions",
  "receiptShowPoweredByWaka",
]);

/** Shop profile, shelves, retention, PIN, staff prefs, etc. (not receipt branding). */
const SHOP_PREFERENCE_KEYS = new Set<keyof ShopPreferences>([
  "backOfficePin",
  "shopDisplayName",
  "shopPhoneE164",
  "shopAddressLine",
  "shopCurrency",
  "staffCanRecordCashExpenses",
  "requireCashierExpenseApproval",
  "staffAccounts",
  "kioskQuickSell",
  "discountControlMode",
  "discountMaxPercentThreshold",
  "dataRetentionPolicy",
  "lastAutoBackupDateKey",
  "lastArchiveRunAt",
  "lastMonthlyReportPromptMonth",
  "posPinnedShelfKeys",
  "posShelfLayout",
  "posQuickSellProductIds",
  "posShelfPresetId",
  "posShelfDefaultScale",
  "launcherTileOrder",
  "launcherTileLayout",
  "officeHubTileOrder",
  "officeHubTileLayout",
  "pharmacyModeEnabled",
  "pharmacyExpiredSaleBehavior",
  "hospitalityModeEnabled",
  "hospitalityKitchenEnabled",
  "hospitalityManualKitchenFire",
  "hospitalityFloor",
  "pendingSalesTtl",
  "staffCanManagePendingSales",
  "devRoleOverride",
  "cashVarianceThresholdPct",
  "cashVarianceThresholdUgxFixed",
  "wakaShopId",
  "businessType",
  "onboardingDone",
  "onboardingWizardDone",
  "shopSellingStyle",
  "mixedPackSelling",
  "schemaVersion",
  "activeBranchId",
  "branchDisplayName",
  "pilotModeEnabled",
]);

const OWNER_ACTIVITY_KEYS = new Set<keyof ShopPreferences>(["ownerRisksReviewedAt"]);

const NOTIFICATIONS_KEYS = new Set<keyof ShopPreferences>(["hapticsOn", "saleSoundOn"]);

/** Shop profile fields allowed on Free tier (role-only gate). */
const FREE_TIER_SHOP_PROFILE_KEYS = new Set<keyof ShopPreferences>([
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

function permissionForPreferenceKey(key: keyof ShopPreferences): Permission | null {
  if (OPERATIONAL_PREFERENCE_KEYS.has(key)) return null;
  if (SHIFT_PREFERENCE_KEYS.has(key)) return null;
  if (DEVICES_PREFERENCE_KEYS.has(key)) return "settings.devices";
  if (UI_MODE_KEYS.has(key)) return "ui.toggle_mode";
  if (OWNER_ACTIVITY_KEYS.has(key)) return "owner.activity";
  if (NOTIFICATIONS_KEYS.has(key)) return "settings.view";
  if (RECEIPT_PREFERENCE_KEYS.has(key)) return "settings.receipt";
  if (SHOP_PREFERENCE_KEYS.has(key)) return "settings.shop";
  return "settings.shop";
}

/** Permissions required to apply a preferences patch (deduped). */
export function requiredPermissionsForPreferencesPatch(
  patch: Partial<ShopPreferences>,
): Permission[] {
  const perms = new Set<Permission>();
  for (const key of Object.keys(patch) as (keyof ShopPreferences)[]) {
    const perm = permissionForPreferenceKey(key);
    if (perm) perms.add(perm);
  }
  return [...perms];
}

export function authorizePreferencesPatch(
  actor: SessionActor | null,
  patch: Partial<ShopPreferences>,
  input?: {
    snapshot: SubscriptionSnapshot;
    authMode: "supabase" | "local";
    currentStaffAccounts?: readonly import("../types").StaffAccount[];
  },
): StoreAuthResult {
  const ctx = input ?? getStoreSubscriptionContext();
  for (const key of Object.keys(patch) as (keyof ShopPreferences)[]) {
    const perm = permissionForPreferenceKey(key);
    if (!perm) continue;
    const effectiveCheck =
      perm === "settings.shop" && FREE_TIER_SHOP_PROFILE_KEYS.has(key)
        ? checkStorePermission(actor, perm)
        : checkStorePermissionEffective(actor, perm, ctx.snapshot, ctx.authMode);
    if (!effectiveCheck.ok) return effectiveCheck;
  }

  const tier = resolveStorePlanTier(ctx.snapshot, ctx.authMode);
  if (patch.receiptShowPoweredByWaka === false && !canHideWakaReceiptBranding(tier)) {
    return { ok: false, errorKey: "planReceiptBranding" };
  }

  if (patch.staffAccounts && input?.currentStaffAccounts) {
    const staffCheck = validateStaffAccountsPatch(input.currentStaffAccounts, patch.staffAccounts, tier);
    if (!staffCheck.ok) return staffCheck;
  }

  return { ok: true };
}
