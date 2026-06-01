import type { BusinessType, Language } from "../types";
import { t } from "./i18n";
import { isHospitalityMode } from "./hospitality";

/** Hospitality UI vocabulary — retail shops keep existing i18n keys. */
export type HospitalityTermKey =
  | "product"
  | "products"
  | "customer"
  | "customers"
  | "sale"
  | "sales"
  | "receipt"
  | "receipts"
  | "category"
  | "supplier"
  | "suppliers"
  | "checkout"
  | "pendingSale"
  | "stock"
  | "sell"
  | "menu"
  | "bill"
  | "bills"
  | "guest"
  | "guests"
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
  | "receiptsHint"
  | "customersEmptyTitle"
  | "customersEmptySub"
  | "addCustomer"
  | "debts"
  | "officeCardStock"
  | "officeCardStockSub"
  | "categorySectionTitle"
  | "searchPlaceholder";

const RETAIL_FALLBACK: Record<HospitalityTermKey, string> = {
  product: "product",
  products: "products",
  customer: "customer",
  customers: "customers",
  sale: "sale",
  sales: "sales",
  receipt: "receipt",
  receipts: "receipts",
  category: "category",
  supplier: "supplier",
  suppliers: "suppliers",
  checkout: "checkout",
  pendingSale: "pendingSalesTitle",
  stock: "stockTitle",
  sell: "sellTitle",
  menu: "stockTitle",
  bill: "sale",
  bills: "receipts",
  guest: "customer",
  guests: "customers",
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
  receiptsHint: "receiptsHint",
  customersEmptyTitle: "customersEmptyTitle",
  customersEmptySub: "customersEmptySub",
  addCustomer: "addCustomer",
  debts: "debts",
  officeCardStock: "officeCardStock",
  officeCardStockSub: "officeCardStockSub",
  categorySectionTitle: "categorySectionTitle",
  searchPlaceholder: "posSellSearchPlaceholder",
};

const HOSPITALITY_KEY: Record<HospitalityTermKey, string> = {
  product: "hospitalityTerm_product",
  products: "hospitalityTerm_products",
  customer: "hospitalityTerm_guest",
  customers: "hospitalityTerm_guests",
  sale: "hospitalityTerm_bill",
  sales: "hospitalityTerm_bills",
  receipt: "hospitalityTerm_billReceipt",
  receipts: "hospitalityTerm_billsHistory",
  category: "hospitalityTerm_menuCategory",
  supplier: "hospitalityTerm_vendor",
  suppliers: "hospitalityTerm_vendors",
  checkout: "hospitalityTerm_settleBill",
  pendingSale: "hospitalityTerm_openBill",
  stock: "hospitalityTerm_menu",
  sell: "hospitalityTerm_orders",
  menu: "hospitalityTerm_menu",
  bill: "hospitalityTerm_bill",
  bills: "hospitalityTerm_bills",
  guest: "hospitalityTerm_guest",
  guests: "hospitalityTerm_guests",
  addItem: "hospitalityTerm_addMenuItem",
  clearSale: "hospitalityTerm_clearBill",
  saveSale: "hospitalityTerm_settleBill",
  stockTitle: "hospitalityPage_menuTitle",
  stockPageSub: "hospitalityPage_menuSub",
  stockAddProduct: "hospitalityPage_addMenuItem",
  stockEditProduct: "hospitalityPage_editMenuItem",
  stockEmptyTitle: "hospitalityPage_emptyMenuTitle",
  stockEmptySub: "hospitalityPage_emptyMenuSub",
  stockCardSell: "hospitalityTerm_orders",
  stockEditName: "hospitalityPage_itemName",
  receiptsHint: "hospitalityPage_receiptsHint",
  customersEmptyTitle: "hospitalityPage_guestsEmptyTitle",
  customersEmptySub: "hospitalityPage_emptyMenuSub",
  addCustomer: "hospitalityPage_addGuest",
  debts: "hospitalityPage_guestTabs",
  officeCardStock: "hospitalityTerm_menu",
  officeCardStockSub: "hospitalityPage_officeMenuSub",
  categorySectionTitle: "hospitalityPage_categorySection",
  searchPlaceholder: "hospitalityPage_searchPlaceholder",
};

export function useHospitalityTerms(
  lang: Language,
  businessType: BusinessType | undefined | null,
  hospitalityModeEnabled?: boolean | null,
): (key: HospitalityTermKey) => string {
  const hospitality = isHospitalityMode(businessType, hospitalityModeEnabled);
  return (key: HospitalityTermKey) => {
    if (!hospitality) {
      const fb = RETAIL_FALLBACK[key];
      return t(lang, fb);
    }
    return t(lang, HOSPITALITY_KEY[key]);
  };
}

export function hospitalityTerm(
  lang: Language,
  businessType: BusinessType | undefined | null,
  key: HospitalityTermKey,
  hospitalityModeEnabled?: boolean | null,
): string {
  return useHospitalityTerms(lang, businessType, hospitalityModeEnabled)(key);
}
