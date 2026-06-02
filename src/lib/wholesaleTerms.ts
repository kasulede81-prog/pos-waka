import type { BusinessType, Language } from "../types";
import { t } from "./i18n";
import { isWholesaleMode } from "./wholesale";

export type WholesaleTermKey =
  | "product"
  | "products"
  | "customer"
  | "customers"
  | "sale"
  | "sales"
  | "receipt"
  | "receipts"
  | "category"
  | "stock"
  | "sell"
  | "checkout"
  | "pendingSale"
  | "addItem"
  | "clearSale"
  | "saveSale"
  | "stockTitle"
  | "stockPageSub"
  | "stockAddProduct"
  | "stockEditProduct"
  | "stockEmptyTitle"
  | "stockEmptySub"
  | "stockCardSell"
  | "stockEditName"
  | "stockEditShelf"
  | "quickAddStep2"
  | "receiptsHint"
  | "customersEmptyTitle"
  | "customersEmptySub"
  | "addCustomer"
  | "debts"
  | "officeCardStock"
  | "officeCardStockSub"
  | "categorySectionTitle"
  | "searchPlaceholder"
  | "freeLimitProductsTitle";

const RETAIL_FALLBACK: Record<WholesaleTermKey, string> = {
  product: "product",
  products: "products",
  customer: "customer",
  customers: "customers",
  sale: "sale",
  sales: "sales",
  receipt: "receipt",
  receipts: "receipts",
  category: "category",
  stock: "stockTitle",
  sell: "sellTitle",
  checkout: "checkout",
  pendingSale: "pendingSalesTitle",
  addItem: "addItem",
  clearSale: "clearSale",
  saveSale: "saveSale",
  stockTitle: "stockTitle",
  stockPageSub: "stockPageSub",
  stockAddProduct: "stockAddProductBtn",
  stockEditProduct: "stockEditProductTitle",
  stockEmptyTitle: "stockEmptyTitle",
  stockEmptySub: "stockEmptySub",
  stockCardSell: "stockCardSell",
  stockEditName: "stockEditNameLabel",
  stockEditShelf: "stockEditShelfLabel",
  quickAddStep2: "quickAddStep2",
  receiptsHint: "receiptsHint",
  customersEmptyTitle: "customersEmptyTitle",
  customersEmptySub: "customersEmptySub",
  addCustomer: "addCustomer",
  debts: "debts",
  officeCardStock: "officeCardStock",
  officeCardStockSub: "officeCardStockSub",
  categorySectionTitle: "categorySectionTitle",
  searchPlaceholder: "posSellSearchPlaceholder",
  freeLimitProductsTitle: "freeLimitProductsTitle",
};

const WHOLESALE_KEY: Record<WholesaleTermKey, string> = {
  product: "wholesaleTerm_stockItem",
  products: "wholesaleTerm_stockItems",
  customer: "wholesaleTerm_account",
  customers: "wholesaleTerm_accounts",
  sale: "wholesaleTerm_invoice",
  sales: "wholesaleTerm_invoices",
  receipt: "wholesaleTerm_invoice",
  receipts: "wholesaleTerm_invoices",
  category: "wholesaleTerm_stockCategory",
  stock: "wholesaleTerm_warehouse",
  sell: "wholesaleTerm_createInvoice",
  checkout: "wholesaleTerm_finalizeInvoice",
  pendingSale: "wholesaleTerm_pendingInvoice",
  addItem: "wholesaleTerm_addStockItem",
  clearSale: "wholesaleTerm_clearInvoice",
  saveSale: "wholesaleTerm_saveInvoice",
  stockTitle: "wholesalePage_warehouseTitle",
  stockPageSub: "wholesalePage_warehouseSub",
  stockAddProduct: "wholesalePage_addStockItem",
  stockEditProduct: "wholesalePage_editStockItem",
  stockEmptyTitle: "wholesalePage_emptyWarehouseTitle",
  stockEmptySub: "wholesalePage_emptyWarehouseSub",
  stockCardSell: "wholesaleTerm_createInvoice",
  stockEditName: "wholesalePage_stockItemName",
  stockEditShelf: "wholesaleTerm_stockCategory",
  quickAddStep2: "wholesaleTerm_stockCategory",
  receiptsHint: "wholesalePage_invoicesHint",
  customersEmptyTitle: "wholesalePage_accountsEmptyTitle",
  customersEmptySub: "wholesalePage_accountsEmptySub",
  addCustomer: "wholesalePage_addAccount",
  debts: "wholesalePage_receivables",
  officeCardStock: "wholesaleTerm_warehouse",
  officeCardStockSub: "wholesalePage_officeWarehouseSub",
  categorySectionTitle: "wholesalePage_categorySection",
  searchPlaceholder: "wholesalePage_searchPlaceholder",
  freeLimitProductsTitle: "wholesalePage_itemLimitTitle",
};

export function wholesaleTerm(
  lang: Language,
  businessType: BusinessType | undefined | null,
  key: WholesaleTermKey,
): string {
  if (!isWholesaleMode(businessType)) {
    return t(lang, RETAIL_FALLBACK[key]);
  }
  return t(lang, WHOLESALE_KEY[key]);
}

export function useWholesaleTerms(
  lang: Language,
  businessType: BusinessType | undefined | null,
): (key: WholesaleTermKey) => string {
  const wholesale = isWholesaleMode(businessType);
  return (key: WholesaleTermKey) => {
    if (!wholesale) return t(lang, RETAIL_FALLBACK[key]);
    return t(lang, WHOLESALE_KEY[key]);
  };
}
