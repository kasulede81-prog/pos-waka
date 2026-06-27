export type InventoryPurchasingTab = "overview" | "purchases" | "suppliers" | "products" | "payments";

export const INVENTORY_PURCHASING_TABS: InventoryPurchasingTab[] = [
  "overview",
  "purchases",
  "suppliers",
  "products",
  "payments",
];

export type PurchaseStatusFilter = "all" | "paid" | "partial" | "unpaid" | "voided";

export type SupplierAlphaFilter = "all" | string;
