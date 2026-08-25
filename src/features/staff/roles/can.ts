/**
 * Staff permission gateway — business action dictionary above the Permission engine.
 *
 *   can(actor, action) → permissionForStaffAction → actorHasPermission
 *
 * Phase 5b: expand StaffAction aliases only. Does NOT rename Permission codes,
 * ROLE_PERMISSIONS, custom role storage, RLS/RPC, or authorization results.
 *
 * See docs/WAKA_STAFF_PERMISSION_DICTIONARY.md
 */

import type { Permission } from "../../../types";
import type { SessionActor } from "../../../lib/sessionActor";
import { actorHasPermission } from "../../../lib/actorAuthorization";

/**
 * Business / owner-friendly action ids + legacy aliases + raw Permission passthrough.
 */
export type StaffAction =
  /* Legacy aliases (Phase 3) — keep working */
  | "sell"
  | "create_sale"
  | "refund_sale"
  | "void_sale"
  | "manage_staff"
  | "view_reports"
  | "view_profit"
  | "view_settings"
  | "manage_shop_settings"
  | "view_receipts"
  | "access_back_office"
  /* Sales */
  | "sale.create"
  | "sale.void"
  | "sale.refund"
  | "sale.discount"
  | "sale.hold"
  | "receipt.view"
  /* Inventory */
  | "inventory.view"
  | "inventory.adjust"
  | "inventory.count"
  | "product.add"
  | "product.edit"
  | "product.remove"
  | "inventory.purchase"
  /* Customers / suppliers */
  | "customer.view"
  | "customer.credit"
  | "supplier.view"
  | "supplier.manage"
  /* Staff / shop (still map to current engine codes — no split yet) */
  | "staff.view"
  | "staff.invite"
  | "staff.manage"
  | "shop.settings"
  | "shop.receipt_settings"
  | "shop.devices"
  /* Reports / access */
  | "report.view"
  | "report.profit"
  | "backoffice.enter"
  | Permission;

/**
 * Business action → existing Permission code (source of truth unchanged).
 * Legacy aliases remain.
 */
export const STAFF_ACTION_TO_PERMISSION: Record<string, Permission> = {
  /* Legacy */
  sell: "pos.sell",
  create_sale: "pos.sell",
  refund_sale: "sale_void",
  void_sale: "sale_void",
  manage_staff: "settings.shop",
  view_reports: "reports.view",
  view_profit: "reports.profit",
  view_settings: "settings.view",
  manage_shop_settings: "settings.shop",
  view_receipts: "receipts.view",
  access_back_office: "back_office.access",

  /* Sales */
  "sale.create": "pos.sell",
  "sale.void": "sale_void",
  "sale.refund": "sale_void",
  /** No separate discount Permission today — same gate as selling. */
  "sale.discount": "pos.sell",
  "sale.hold": "pending_sales.manage",
  "receipt.view": "receipts.view",

  /* Inventory */
  "inventory.view": "stock.view",
  "inventory.adjust": "stock.adjust",
  "inventory.count": "stock.count",
  "product.add": "products.add",
  "product.edit": "products.edit_presets",
  "product.remove": "products.remove",
  "inventory.purchase": "purchases.record",

  /* Customers / suppliers */
  "customer.view": "customers.view",
  "customer.credit": "customers.debt",
  "supplier.view": "suppliers.view",
  "supplier.manage": "suppliers.manage",

  /* Staff / shop — not yet split in the engine */
  "staff.view": "settings.shop",
  "staff.invite": "settings.shop",
  "staff.manage": "settings.shop",
  "shop.settings": "settings.shop",
  "shop.receipt_settings": "settings.receipt",
  "shop.devices": "settings.devices",

  /* Reports / access */
  "report.view": "reports.view",
  "report.profit": "reports.profit",
  "backoffice.enter": "back_office.access",
};

export function permissionForStaffAction(action: StaffAction): Permission {
  const mapped = STAFF_ACTION_TO_PERMISSION[action];
  if (mapped) return mapped;
  return action as Permission;
}

/**
 * Single staff authorization gateway.
 * Identical to actorHasPermission(actor, permissionForStaffAction(action)).
 */
export function can(
  actor: SessionActor | null | undefined,
  action: StaffAction,
): boolean {
  return actorHasPermission(actor, permissionForStaffAction(action));
}
