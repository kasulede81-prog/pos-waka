/**
 * Phase 24.1BB — critical vs optional recovery modules.
 */

import { usePosStore } from "../store/usePosStore";
import type { CloudRecoveryStepId } from "./cloudRecoverySession";
import { storeHasCoreRecoveryData } from "./recoveryHydration";

export type RecoveryModuleId =
  | "products"
  | "customers"
  | "preferences"
  | "permissions"
  | "shop"
  | "inventory"
  | "staff"
  | "sales"
  | "shifts"
  | "cash"
  | "reports"
  | "analytics"
  | "diagnostics";

const CRITICAL_MODULES = new Set<RecoveryModuleId>([
  "products",
  "customers",
  "preferences",
  "permissions",
  "shop",
  "inventory",
  "staff",
]);

const OPTIONAL_MODULES = new Set<RecoveryModuleId>([
  "sales",
  "shifts",
  "cash",
  "reports",
  "analytics",
  "diagnostics",
]);

export function isCriticalRecoveryModule(module: RecoveryModuleId): boolean {
  return CRITICAL_MODULES.has(module);
}

export function isOptionalRecoveryModule(module: RecoveryModuleId): boolean {
  return OPTIONAL_MODULES.has(module);
}

export function recoveryStepToModule(step: CloudRecoveryStepId): RecoveryModuleId | null {
  switch (step) {
    case "products":
      return "products";
    case "customers":
      return "customers";
    case "sales":
      return "sales";
    case "inventory":
      return "inventory";
    case "staff":
      return "staff";
    case "shifts":
      return "shifts";
    case "cash":
    case "day_closes":
      return "cash";
    case "audit":
      return "diagnostics";
    default:
      return null;
  }
}

/** True when POS can operate — catalog hydrated with products. */
export function isCoreOperationalDatasetReady(): boolean {
  const s = usePosStore.getState();
  if (!s._hydrated) return false;
  if (s.products.length === 0) return false;
  return storeHasCoreRecoveryData();
}

export function criticalModulesForDisplay(): RecoveryModuleId[] {
  return ["products", "customers", "preferences", "shop", "inventory", "staff"];
}

export function optionalModulesForDisplay(): RecoveryModuleId[] {
  return ["sales", "shifts", "cash", "reports", "analytics", "diagnostics"];
}
