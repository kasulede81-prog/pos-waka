import type { Language, Permission } from "../../types";
import { t } from "../i18n";

const PERMISSION_LABEL_KEYS: Partial<Record<Permission, string>> = {
  "pos.sell": "permLabel_posSell",
  sale_void: "permLabel_saleVoid",
  "receipts.view": "permLabel_receiptsView",
  "pending_sales.manage": "permLabel_pendingSalesManage",
  "stock.view": "permLabel_stockView",
  "stock.adjust": "permLabel_stockAdjust",
  "stock.count": "permLabel_stockCount",
  "products.add": "permLabel_productsAdd",
  "products.remove": "permLabel_productsRemove",
  "products.edit_presets": "permLabel_productsEditPresets",
  "shelves.customize": "permLabel_shelvesCustomize",
  "purchases.record": "permLabel_purchasesRecord",
  "purchases.view": "permLabel_purchasesView",
  "purchases.void": "permLabel_purchasesVoid",
  "customers.view": "permLabel_customersView",
  "customers.debt": "permLabel_customersDebt",
  "suppliers.view": "permLabel_suppliersView",
  "suppliers.manage": "permLabel_suppliersManage",
  "day.open_drawer": "permLabel_dayOpenDrawer",
  "day.verify_opening_float": "permLabel_dayVerifyFloat",
  "day.close": "permLabel_dayClose",
  "shift.start": "permLabel_shiftStart",
  "shift.close": "permLabel_shiftClose",
  "expenses.record": "permLabel_expensesRecord",
  "expenses.edit": "permLabel_expensesEdit",
  "expenses.delete": "permLabel_expensesDelete",
  "expenses.approve": "permLabel_expensesApprove",
  "reports.view": "permLabel_reportsView",
  "reports.profit": "permLabel_reportsProfit",
  "owner.dashboard": "permLabel_ownerDashboard",
  "owner.activity": "permLabel_ownerActivity",
  "owner.cash_history": "permLabel_ownerCashHistory",
  "settings.shop": "permLabel_settingsShop",
  "back_office.access": "permLabel_backOfficeAccess",
  "settings.devices": "permLabel_settingsDevices",
  "settings.view": "permLabel_settingsView",
  "settings.receipt": "permLabel_settingsReceipt",
  "nav.office": "permLabel_navOffice",
  "ui.toggle_mode": "permLabel_uiToggleMode",
  "pharmacy.access": "permLabel_pharmacyAccess",
  "pharmacy.expired_writeoff": "permLabel_pharmacyExpiredWriteoff",
  "hospitality.floor": "permLabel_hospitalityFloor",
  "hospitality.order": "permLabel_hospitalityOrder",
  "hospitality.settle": "permLabel_hospitalitySettle",
  "hospitality.transfer": "permLabel_hospitalityTransfer",
  "hospitality.kitchen": "permLabel_hospitalityKitchen",
  "enterprise.access": "permLabel_enterpriseAccess",
  "enterprise.branches": "permLabel_enterpriseBranches",
  "enterprise.dashboard": "permLabel_enterpriseDashboard",
  "enterprise.transfers": "permLabel_enterpriseTransfers",
  "enterprise.purchasing": "permLabel_enterprisePurchasing",
  "enterprise.reports": "permLabel_enterpriseReports",
  "enterprise.audit": "permLabel_enterpriseAudit",
  "enterprise.backup": "permLabel_enterpriseBackup",
  "enterprise.health": "permLabel_enterpriseHealth",
};

export function permissionLabel(lang: Language, permission: Permission): string {
  const key = PERMISSION_LABEL_KEYS[permission];
  if (key) {
    const label = t(lang, key as never);
    if (label !== key) return label;
  }
  return permission.replace(/\./g, " · ").replace(/_/g, " ");
}
