import type { BusinessType, Language } from "../types";
import { t } from "./i18n";
import { isPharmacyMode } from "./pharmacy";

/** Pharmacy UI vocabulary — retail shops keep existing i18n keys. */
export type PharmacyTermKey =
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
  | "strength"
  | "form"
  | "freeLimitProductsTitle";

const RETAIL_FALLBACK: Record<PharmacyTermKey, string> = {
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
  strength: "pharmacyStrengthLabel",
  form: "pharmacyFormLabel",
  freeLimitProductsTitle: "freeLimitProductsTitle",
};

const PHARMACY_KEY: Record<PharmacyTermKey, string> = {
  product: "pharmacyTerm_medicine",
  products: "pharmacyTerm_medicines",
  customer: "pharmacyTerm_patient",
  customers: "pharmacyTerm_patients",
  sale: "pharmacyTerm_dispense",
  sales: "pharmacyTerm_dispensings",
  receipt: "pharmacyTerm_dispensingReceipt",
  receipts: "pharmacyTerm_dispensingReceipts",
  category: "pharmacyTerm_medicineCategory",
  stock: "pharmacyTerm_medicineStock",
  sell: "pharmacyTerm_dispenseAction",
  checkout: "pharmacyTerm_checkout",
  pendingSale: "pharmacyTerm_heldBasket",
  addItem: "pharmacyTerm_addMedicine",
  clearSale: "pharmacyTerm_clearBasket",
  saveSale: "pharmacyTerm_saveBasket",
  stockTitle: "pharmacyPage_stockTitle",
  stockPageSub: "pharmacyPage_stockSub",
  stockAddProduct: "pharmacyPage_addMedicine",
  stockEditProduct: "pharmacyPage_editMedicine",
  stockEmptyTitle: "pharmacyPage_emptyStockTitle",
  stockEmptySub: "pharmacyPage_emptyStockSub",
  stockCardSell: "pharmacyTerm_dispenseAction",
  stockEditName: "pharmacyPage_medicineName",
  stockEditShelf: "pharmacyTerm_medicineCategory",
  quickAddStep2: "pharmacyTerm_medicineCategory",
  receiptsHint: "pharmacyPage_receiptsHint",
  customersEmptyTitle: "pharmacyPage_patientsEmptyTitle",
  customersEmptySub: "pharmacyPage_emptyStockSub",
  addCustomer: "pharmacyPage_addPatient",
  debts: "pharmacyPage_patientsDebts",
  officeCardStock: "pharmacyTerm_medicineStock",
  officeCardStockSub: "pharmacyPage_officeStockSub",
  categorySectionTitle: "pharmacyPage_categorySection",
  searchPlaceholder: "pharmacyPage_searchPlaceholder",
  strength: "pharmacyStrengthLabel",
  form: "pharmacyFormLabel",
  freeLimitProductsTitle: "pharmacyPage_productLimitTitle",
};

export function pharmacyTerm(
  lang: Language,
  businessType: BusinessType | undefined | null,
  key: PharmacyTermKey,
  pharmacyModeEnabled?: boolean | null,
): string {
  if (!isPharmacyMode(businessType, pharmacyModeEnabled)) {
    return t(lang, RETAIL_FALLBACK[key]);
  }
  return t(lang, PHARMACY_KEY[key]);
}

export function usePharmacyTerms(
  lang: Language,
  businessType: BusinessType | undefined | null,
  pharmacyModeEnabled?: boolean | null,
): (key: PharmacyTermKey) => string {
  const pharmacy = isPharmacyMode(businessType, pharmacyModeEnabled);
  return (key: PharmacyTermKey) => {
    if (!pharmacy) return t(lang, RETAIL_FALLBACK[key]);
    return t(lang, PHARMACY_KEY[key]);
  };
}
