import type {
  BusinessType,
  HospitalityHardwarePrefs,
  HospitalityIngredientPolicyConfig,
  IngredientShortage,
  IngredientStockPolicy,
  ReceiptTemplateConfig,
  ReceiptTemplateKind,
  ShopPreferences,
  UserRole,
} from "../types";

export const PRINT_QUEUE_MAX_ATTEMPTS = 5;
export const PRINT_HISTORY_MAX = 120;
export const PRINT_QUEUE_MAX_PENDING = 80;

export function defaultReceiptTemplate(kind: ReceiptTemplateKind = "restaurant"): ReceiptTemplateConfig {
  return {
    kind,
    showTableNumber: true,
    showWaiter: true,
    showGuests: true,
    showModifiers: true,
    showDiscounts: true,
    showSplitSummary: true,
    showQrPlaceholder: true,
    customLogoUrl: null,
  };
}

export function receiptTemplateForBusinessType(businessType: BusinessType): ReceiptTemplateConfig {
  if (businessType === "bar") return defaultReceiptTemplate("bar");
  if (businessType === "hotel") return defaultReceiptTemplate("hotel");
  return defaultReceiptTemplate("restaurant");
}

export function resolveIngredientPolicyConfig(prefs: ShopPreferences): HospitalityIngredientPolicyConfig {
  const ext = prefs.hospitalityIngredientPolicy;
  const legacy = prefs.hospitalityIngredientStockPolicy ?? "warn";
  if (ext) {
    return {
      policy: ext.policy ?? legacy,
      allowNegativeInventory: ext.allowNegativeInventory ?? false,
      autoReserveIngredients: ext.autoReserveIngredients ?? false,
      lowStockThreshold: ext.lowStockThreshold ?? null,
      kitchenWarningLevel: ext.kitchenWarningLevel ?? null,
    };
  }
  return {
    policy: legacy,
    allowNegativeInventory: false,
    autoReserveIngredients: false,
    lowStockThreshold: null,
    kitchenWarningLevel: null,
  };
}

export function effectiveIngredientPolicy(prefs: ShopPreferences): IngredientStockPolicy {
  return resolveIngredientPolicyConfig(prefs).policy;
}

export type IngredientShortageDecision =
  | { allow: true; shortfall: boolean }
  | { allow: false; errorKey: "ingredientShortage" | "ingredientShortageOverride" };

/**
 * ONE rule for "may this order proceed with too little ingredient stock?", used both when a dish is
 * added to an order and when the bill is finalized (they used to disagree: the add step honoured the
 * configured policy while finalize hard-blocked every shortage, stranding bills the policy had
 * accepted).
 *
 *  - no shortage                    → proceed
 *  - allowNegativeInventory / warn  → proceed; the shortfall is audited, stock still floors at 0
 *  - manager_override               → proceed only for an owner/manager (or an explicit override)
 *  - block                          → never
 */
export function decideIngredientShortage(input: {
  prefs: ShopPreferences;
  shortages: ReadonlyArray<IngredientShortage>;
  role: UserRole | null | undefined;
  managerOverride?: boolean;
}): IngredientShortageDecision {
  if (input.shortages.length === 0) return { allow: true, shortfall: false };
  const cfg = resolveIngredientPolicyConfig(input.prefs);
  if (cfg.allowNegativeInventory) return { allow: true, shortfall: true };
  if (cfg.policy === "warn") return { allow: true, shortfall: true };
  if (cfg.policy === "manager_override") {
    const isManager = input.role === "owner" || input.role === "manager";
    return input.managerOverride === true || isManager
      ? { allow: true, shortfall: true }
      : { allow: false, errorKey: "ingredientShortageOverride" };
  }
  return { allow: false, errorKey: "ingredientShortage" };
}

export function defaultHospitalityHardwarePrefs(businessType: BusinessType = "mini_supermarket"): HospitalityHardwarePrefs {
  return {
    printers: [],
    printQueue: [],
    printHistory: [],
    receiptTemplate: receiptTemplateForBusinessType(
      businessType === "restaurant_bar" ? "restaurant" : businessType,
    ),
    autoPrintKitchen: true,
    autoPrintReceipt: true,
    openDrawerOnPayment: true,
    customerDisplayEnabled: false,
    drawerAudit: [],
  };
}

export function resolveHospitalityHardware(
  prefs: { hospitalityHardware?: HospitalityHardwarePrefs | null; businessType?: BusinessType },
): HospitalityHardwarePrefs {
  const base = defaultHospitalityHardwarePrefs(prefs.businessType ?? "mini_supermarket");
  const hw = prefs.hospitalityHardware;
  if (!hw) return base;
  return {
    ...base,
    ...hw,
    printers: hw.printers ?? base.printers,
    printQueue: hw.printQueue ?? base.printQueue,
    printHistory: hw.printHistory ?? base.printHistory,
    receiptTemplate: { ...base.receiptTemplate, ...(hw.receiptTemplate ?? {}) },
    drawerAudit: hw.drawerAudit ?? base.drawerAudit,
  };
}

export function patchHospitalityHardware(
  prefs: { hospitalityHardware?: HospitalityHardwarePrefs | null; businessType?: BusinessType },
  patch: Partial<HospitalityHardwarePrefs>,
): HospitalityHardwarePrefs {
  const current = resolveHospitalityHardware(prefs);
  return {
    ...current,
    ...patch,
    receiptTemplate: patch.receiptTemplate
      ? { ...current.receiptTemplate, ...patch.receiptTemplate }
      : current.receiptTemplate,
  };
}
