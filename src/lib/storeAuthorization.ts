/**
 * Store-layer authorization — enforce permissions before mutations (UI guards are not sufficient).
 */

import type { Permission, UserRole } from "../types";
import type { SessionActor } from "./sessionActor";
import { hasPermission } from "./permissions";

export type StoreAuthDenied = { ok: false; errorKey: "forbidden" | "noSelection" };
export type StoreAuthOk = { ok: true };
export type StoreAuthResult = StoreAuthOk | StoreAuthDenied;

export function checkStorePermission(actor: SessionActor | null, permission: Permission): StoreAuthResult {
  if (!actor) return { ok: false, errorKey: "noSelection" };
  if (!hasPermission(actor.role, permission)) return { ok: false, errorKey: "forbidden" };
  return { ok: true };
}

/** Sensitive store mutations and the permission each requires. */
export const STORE_ACTION_PERMISSIONS = {
  finalizeDraftSale: "pos.sell",
  adjustStock: "stock.adjust",
  updateProduct: "stock.adjust",
  addProduct: "products.add",
  quickAddProduct: "products.add",
  duplicateProduct: "products.add",
  removeProduct: "products.remove",
  updateProductQuickPresets: "products.edit_presets",
  addDebtPayment: "customers.debt",
  addCashExpense: "expenses.record",
  recordPurchase: "purchases.record",
  addSupplier: "suppliers.manage",
  updateSupplier: "suppliers.manage",
  addSupplierPayment: "suppliers.manage",
  voidPurchase: "purchases.void",
  addCustomer: "customers.view",
  recordDayClose: "day.close",
  backupRestore: "settings.shop",
  permanentlyDeleteArchived: "settings.shop",
  runDataArchive: "settings.shop",
} as const satisfies Record<string, Permission>;

export type SensitiveStoreAction = keyof typeof STORE_ACTION_PERMISSIONS;

export function permissionForStoreAction(action: SensitiveStoreAction): Permission {
  return STORE_ACTION_PERMISSIONS[action];
}

export function roleMayPerformStoreAction(role: UserRole, action: SensitiveStoreAction): boolean {
  return hasPermission(role, STORE_ACTION_PERMISSIONS[action]);
}
