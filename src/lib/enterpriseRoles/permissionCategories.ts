import type { Permission } from "../../types";

export type PermissionCategoryId =
  | "sales"
  | "inventory"
  | "purchases"
  | "customers"
  | "suppliers"
  | "accounting"
  | "reports"
  | "staff"
  | "security"
  | "devices"
  | "settings"
  | "pharmacy"
  | "hospitality"
  | "enterprise"
  | "system";

export type PermissionCategoryDef = {
  id: PermissionCategoryId;
  labelKey: string;
  permissions: Permission[];
};

/** Grouped permission catalog for the enterprise role editor. */
export const PERMISSION_CATEGORIES: PermissionCategoryDef[] = [
  {
    id: "sales",
    labelKey: "permCategory_sales",
    permissions: ["pos.sell", "sale_void", "receipts.view", "pending_sales.manage"],
  },
  {
    id: "inventory",
    labelKey: "permCategory_inventory",
    permissions: [
      "stock.view",
      "stock.adjust",
      "stock.count",
      "products.add",
      "products.remove",
      "products.edit_presets",
      "shelves.customize",
    ],
  },
  {
    id: "purchases",
    labelKey: "permCategory_purchases",
    permissions: ["purchases.record", "purchases.view", "purchases.void"],
  },
  {
    id: "customers",
    labelKey: "permCategory_customers",
    permissions: ["customers.view", "customers.debt"],
  },
  {
    id: "suppliers",
    labelKey: "permCategory_suppliers",
    permissions: ["suppliers.view", "suppliers.manage"],
  },
  {
    id: "accounting",
    labelKey: "permCategory_accounting",
    permissions: [
      "day.open_drawer",
      "day.verify_opening_float",
      "day.close",
      "shift.start",
      "shift.close",
      "expenses.record",
      "expenses.edit",
      "expenses.delete",
      "expenses.approve",
    ],
  },
  {
    id: "reports",
    labelKey: "permCategory_reports",
    permissions: ["reports.view", "reports.profit", "owner.dashboard", "owner.activity", "owner.cash_history"],
  },
  {
    id: "staff",
    labelKey: "permCategory_staff",
    permissions: ["settings.shop"],
  },
  {
    id: "security",
    labelKey: "permCategory_security",
    permissions: ["back_office.access"],
  },
  {
    id: "devices",
    labelKey: "permCategory_devices",
    permissions: ["settings.devices"],
  },
  {
    id: "settings",
    labelKey: "permCategory_settings",
    permissions: ["settings.view", "settings.receipt", "nav.office", "ui.toggle_mode"],
  },
  {
    id: "pharmacy",
    labelKey: "permCategory_pharmacy",
    permissions: ["pharmacy.access", "pharmacy.expired_writeoff"],
  },
  {
    id: "hospitality",
    labelKey: "permCategory_hospitality",
    permissions: [
      "hospitality.floor",
      "hospitality.order",
      "hospitality.settle",
      "hospitality.transfer",
      "hospitality.kitchen",
    ],
  },
  {
    id: "enterprise",
    labelKey: "permCategory_enterprise",
    permissions: [
      "enterprise.access",
      "enterprise.branches",
      "enterprise.dashboard",
      "enterprise.transfers",
      "enterprise.purchasing",
      "enterprise.reports",
      "enterprise.audit",
      "enterprise.backup",
      "enterprise.health",
    ],
  },
  {
    id: "system",
    labelKey: "permCategory_system",
    permissions: [],
  },
];

export const ALL_CATALOG_PERMISSIONS: Permission[] = PERMISSION_CATEGORIES.flatMap((c) => c.permissions);

export function permissionsByCategory(): Map<PermissionCategoryId, Permission[]> {
  return new Map(PERMISSION_CATEGORIES.map((c) => [c.id, c.permissions]));
}
