/**
 * Store-layer authorization — enforce permissions before mutations (UI guards are not sufficient).
 */

import type { Permission, UserRole } from "../types";
import type { SessionActor } from "./sessionActor";
import { hasPermission } from "./permissions";
import { hasEffectivePermission, type SubscriptionSnapshot } from "./subscriptionEntitlements";

export type StoreAuthErrorKey =
  | "forbidden"
  | "noSelection"
  | "notPrimaryDevice"
  | "planProductLimit"
  | "planProductLocked"
  | "planStaffLimit"
  | "planReceiptBranding"
  | "backupRestoreNotEntitled";

export type StoreAuthDenied = { ok: false; errorKey: StoreAuthErrorKey };
export type StoreAuthOk = { ok: true };
export type StoreAuthResult = StoreAuthOk | StoreAuthDenied;

export function checkStorePermission(actor: SessionActor | null, permission: Permission): StoreAuthResult {
  if (!actor) return { ok: false, errorKey: "noSelection" };
  if (!hasPermission(actor.role, permission)) return { ok: false, errorKey: "forbidden" };
  return { ok: true };
}

/** Role + subscription tier — authoritative for plan-gated store mutations. */
export function checkStorePermissionEffective(
  actor: SessionActor | null,
  permission: Permission,
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
): StoreAuthResult {
  if (!actor) return { ok: false, errorKey: "noSelection" };
  if (!hasEffectivePermission(actor.role, permission, snapshot, authMode)) {
    return { ok: false, errorKey: "forbidden" };
  }
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
  backupExport: "settings.shop",
  permanentlyDeleteArchived: "settings.shop",
  runDataArchive: "settings.shop",
  setPreferences: "settings.shop",
  addStaffAccount: "settings.shop",
  updateStaffAccount: "settings.shop",
  removeStaffAccount: "settings.shop",
  resetStaffSecret: "settings.shop",
  openTable: "hospitality.floor",
  openNamedTab: "hospitality.floor",
  resumeTableSession: "hospitality.order",
  saveTableBill: "hospitality.order",
  requestTableBill: "hospitality.order",
  transferTableSession: "hospitality.transfer",
  mergeTableSessions: "hospitality.transfer",
  updateKitchenTicketStatus: "hospitality.kitchen",
  cancelKitchenTicket: "hospitality.kitchen",
  cleanupKitchenTickets: "hospitality.kitchen",
  fireTableKitchenTickets: "hospitality.kitchen",
  addDiningArea: "hospitality.floor",
  renameDiningArea: "hospitality.floor",
  removeDiningArea: "hospitality.floor",
  addDiningTable: "hospitality.floor",
  updateDiningTable: "hospitality.floor",
  removeDiningTable: "hospitality.floor",
  savePendingSale: "pending_sales.manage",
  resumePendingSale: "pending_sales.manage",
  cancelPendingSale: "pending_sales.manage",
} as const satisfies Record<string, Permission>;

export type SensitiveStoreAction = keyof typeof STORE_ACTION_PERMISSIONS;

export function permissionForStoreAction(action: SensitiveStoreAction): Permission {
  return STORE_ACTION_PERMISSIONS[action];
}

export function roleMayPerformStoreAction(role: UserRole, action: SensitiveStoreAction): boolean {
  return hasPermission(role, STORE_ACTION_PERMISSIONS[action]);
}

export function roleMayPerformStoreActionEffective(
  role: UserRole,
  action: SensitiveStoreAction,
  snapshot: SubscriptionSnapshot,
  authMode: "supabase" | "local",
): boolean {
  return hasEffectivePermission(role, STORE_ACTION_PERMISSIONS[action], snapshot, authMode);
}
