import type {
  BusinessType,
  HospitalityHardwarePrefs,
  HospitalityIngredientPolicyConfig,
  IngredientStockPolicy,
  ReceiptTemplateConfig,
  ReceiptTemplateKind,
  ShopPreferences,
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
