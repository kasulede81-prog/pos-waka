import type { AuditLogEntry, Language, Product, Sale, ShopPreferences } from "../types";
import type { SessionActor } from "./sessionActor";
import { buildReceiptNumberForSale, type ReceiptLabels } from "./receiptPrint";
import { brandingFromSale } from "./receiptBranding";
import { t } from "./i18n";
import { buildSoldByNameByUserId, resolveSoldByUserId } from "./soldByLabels";
import type { SaleReceiptContext } from "./receiptDocuments";
import type { SubscriptionPlanCode } from "./subscriptionEntitlements";

export function receiptLabels(lang: Language): ReceiptLabels {
  return {
    cashier: t(lang, "receiptCashier"),
    items: t(lang, "receiptItemsLabel"),
    total: t(lang, "receiptTotalLabel"),
    paid: t(lang, "receiptPaidLabel"),
    debtSale: t(lang, "receiptDebtLine"),
    balance: t(lang, "receiptBalanceLine"),
    time: t(lang, "receiptTimeLabel"),
    outstandingDebt: t(lang, "receiptOutstandingDebt"),
    customer: t(lang, "receiptCustomerLabel"),
    customerNotRecorded: t(lang, "receiptCustomerNotRecorded"),
    receiptNo: t(lang, "receiptNoLabel"),
    date: t(lang, "receiptDateLabel"),
    method: t(lang, "receiptMethodLabel"),
    change: t(lang, "receiptChangeLabel"),
    subtotal: t(lang, "receiptSubtotalLabel"),
    discount: t(lang, "receiptDiscountLabel"),
    grandTotal: t(lang, "receiptGrandTotalLabel"),
  };
}

export function soldByLabelForSale(
  lang: Language,
  sale: Sale,
  staffAccounts: ShopPreferences["staffAccounts"],
  shopDisplayName?: string | null,
  identity?: {
    shifts?: ShopPreferences["shifts"];
    auditLogs?: AuditLogEntry[];
    ownerUserId?: string | null;
    ownerDisplayName?: string | null;
  },
): string {
  const nameByUserId = buildSoldByNameByUserId({
    staffAccounts,
    shopDisplayName,
    shifts: identity?.shifts,
    auditLogs: identity?.auditLogs,
    ownerUserId: identity?.ownerUserId,
    ownerDisplayName: identity?.ownerDisplayName,
  });
  return resolveSoldByUserId(lang, sale.soldByUserId, nameByUserId, shopDisplayName);
}

export function buildSaleReceiptContext(params: {
  lang: Language;
  sale: Sale;
  allSales: Sale[];
  preferences: ShopPreferences;
  products: Product[];
  actor: SessionActor;
  customerName?: string | null;
  customerPhone?: string | null;
  customerBalanceUgx?: number | null;
  planTier?: SubscriptionPlanCode;
  auditLogs?: AuditLogEntry[];
}): SaleReceiptContext {
  const { lang, sale, allSales, preferences, products, actor, customerName, customerPhone, customerBalanceUgx, planTier } =
    params;
  const branding = brandingFromSale(sale, preferences, planTier ?? "waka_plus");
  const shopName = preferences.shopDisplayName?.trim() || "Waka POS";
  const cashier = soldByLabelForSale(lang, sale, preferences.staffAccounts, preferences.shopDisplayName, {
    shifts: preferences.shifts,
    auditLogs: params.auditLogs,
    ownerUserId: actor.authUserId ?? (actor.userId.startsWith("staff:") ? null : actor.userId),
    ownerDisplayName: actor.displayName,
  });

  const resolvedCustomerName = sale.receiptCustomerName ?? customerName ?? null;
  const resolvedCustomerPhone = sale.receiptCustomerPhone ?? customerPhone ?? null;

  return {
    shopName,
    shopAddress: preferences.shopAddressLine ?? null,
    shopPhone: preferences.shopPhoneE164 ?? null,
    cashier,
    receiptNumber: buildReceiptNumberForSale(sale, allSales),
    sale,
    productById: new Map(products.map((p) => [p.id, p] as const)),
    customHeaderLines: branding.customHeaderLines,
    headerLines: branding.headerLines,
    footerLines: branding.footerLines,
    footerThanks: branding.footerThanks,
    footerPowered: branding.footerPowered,
    returnPolicy: branding.returnPolicy,
    displayOptions: branding.displayOptions,
    customerName: resolvedCustomerName,
    customerPhone: resolvedCustomerPhone,
    customerBalanceUgx: customerBalanceUgx ?? null,
    labels: receiptLabels(lang),
    paper: preferences.receiptPaperSize ?? "80mm",
  };
}
