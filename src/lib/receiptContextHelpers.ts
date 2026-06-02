import type { Language, Product, Sale, ShopPreferences } from "../types";
import type { SessionActor } from "./sessionActor";
import { buildReceiptNumberForSale, type ReceiptLabels } from "./receiptPrint";
import { resolveReceiptBranding } from "./receiptBranding";
import { t } from "./i18n";
import type { SaleReceiptContext } from "./receiptDocuments";

export function receiptLabels(lang: Language): ReceiptLabels {
  return {
    cashier: t(lang, "receiptCashier"),
    items: t(lang, "receiptItemsLabel"),
    total: t(lang, "receiptTotalLabel"),
    paid: t(lang, "receiptPaidLabel"),
    debtSale: t(lang, "receiptDebtLine"),
    balance: t(lang, "receiptBalanceLine"),
    time: t(lang, "receiptTimeLabel"),
  };
}

export function soldByLabelForSale(
  lang: Language,
  sale: Sale,
  staffAccounts: ShopPreferences["staffAccounts"],
): string {
  const id = sale.soldByUserId ?? "";
  if (!id) return t(lang, "role_owner");
  if (id.startsWith("staff:")) {
    const staffId = id.slice("staff:".length);
    const name = staffAccounts?.find((s) => s.id === staffId)?.name;
    return name ?? t(lang, "role_cashier");
  }
  return t(lang, "role_owner");
}

export function buildSaleReceiptContext(params: {
  lang: Language;
  sale: Sale;
  allSales: Sale[];
  preferences: ShopPreferences;
  products: Product[];
  actor: SessionActor;
  customerName?: string | null;
  customerBalanceUgx?: number | null;
}): SaleReceiptContext {
  const { lang, sale, allSales, preferences, products, actor, customerName, customerBalanceUgx } = params;
  const branding = resolveReceiptBranding(preferences);
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";
  const cashier =
    sale.soldByUserId && sale.soldByUserId === actor.userId
      ? actor.displayName?.trim() || soldByLabelForSale(lang, sale, preferences.staffAccounts)
      : soldByLabelForSale(lang, sale, preferences.staffAccounts);
  return {
    shopName,
    shopAddress: preferences.shopAddressLine ?? null,
    shopPhone: preferences.shopPhoneE164 ?? null,
    cashier,
    receiptNumber: buildReceiptNumberForSale(sale, allSales),
    sale,
    productById: new Map(products.map((p) => [p.id, p] as const)),
    customHeaderLines: branding.customHeaderLines,
    footerThanks: branding.footerThanks,
    footerPowered: "Powered by Waka POS",
    returnPolicy: branding.returnPolicy,
    customerName: customerName ?? null,
    customerBalanceUgx: customerBalanceUgx ?? null,
    labels: receiptLabels(lang),
    paper: preferences.receiptPaperSize ?? "80mm",
  };
}
