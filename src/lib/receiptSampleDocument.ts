/**
 * Synthetic receipt sample for Settings → Receipt branding (printing audit, P2.8).
 *
 * Merchants configure header/footer/display options but could only see the result on
 * a real sale. This prints the configured template with clearly synthetic data.
 *
 * It is presentation only: `SAMPLE_SALE` is a plain object that is never added to the
 * store, so printing a sample cannot create a sale, move stock, or record money. It
 * also deliberately bypasses the ESC/POS print queue (no receipt identity is consumed).
 */
import type { Language, ShopPreferences } from "../types";
import { buildReceiptDisplayData, buildSaleReceiptHtml } from "./receiptPrint";
import { resolveReceiptBranding } from "./receiptBranding";
import type { SubscriptionPlanCode } from "./subscriptionEntitlements";
import { t } from "./i18n";
import { printReceiptFallback, type ReceiptFallbackResult } from "./receiptNativeFallback";

export const SAMPLE_SALE = {
  id: "preview-sale",
  createdAt: new Date().toISOString(),
  status: "completed" as const,
  lines: [
    {
      productId: "preview-p1",
      name: "Sample Item",
      quantity: 2,
      unitPriceUgx: 500,
      unitCostUgx: 300,
      lineTotalUgx: 1000,
      estimatedProfitUgx: 400,
      inputMode: "quantity" as const,
    },
  ],
  subtotalUgx: 1000,
  totalUgx: 1000,
  cashPaidUgx: 0,
  debtUgx: 1000,
  discountTotalUgx: 0,
  estimatedProfitUgx: 400,
  pendingSync: false,
  paymentMethod: "credit" as const,
  receiptCustomerName: "John Ssemanda",
  receiptCustomerPhone: "+256700000000",
};

export function sampleReceiptDisplay(lang: Language, preferences: ShopPreferences, planTier: SubscriptionPlanCode) {
  const branding = resolveReceiptBranding(preferences, planTier);
  return buildReceiptDisplayData({
    shopName: preferences.shopDisplayName?.trim() || "Waka POS",
    shopAddress: preferences.shopAddressLine ?? null,
    shopPhone: preferences.shopPhoneE164 ?? null,
    cashier: t(lang, "role_owner"),
    receiptNumber: "042",
    sale: SAMPLE_SALE,
    headerLines: branding.headerLines,
    footerLines: branding.footerLines,
    footerThanks: branding.footerThanks,
    footerPowered: branding.footerPowered,
    returnPolicy: branding.returnPolicy,
    displayOptions: branding.displayOptions,
    customerName: "John Ssemanda",
    customerPhone: "+256700000000",
    customerBalanceUgx: 1000,
  });
}

export function buildSampleReceiptParts(
  lang: Language,
  preferences: ShopPreferences,
  planTier: SubscriptionPlanCode,
): { html: string; plainText: string } {
  const display = sampleReceiptDisplay(lang, preferences, planTier);
  const plainText = [
    t(lang, "settingsReceiptPreviewTitle").toUpperCase(),
    display.shopName,
    "",
    ...display.lines.flatMap((l) => [l.name, `${l.quantityLabel} — UGX ${l.lineTotalUgx.toLocaleString()}`]),
    "",
    `${t(lang, "receiptSubtotalLabel")}: UGX ${display.subtotalUgx.toLocaleString()}`,
    `${t(lang, "receiptGrandTotalLabel")}: UGX ${display.totalUgx.toLocaleString()}`,
    "",
    ...display.footerLines,
  ].join("\n");
  return { html: buildSaleReceiptHtml(display), plainText };
}

/** Print the sample receipt using the shop's current template. Never touches sales or stock. */
export async function printSampleReceipt(
  lang: Language,
  preferences: ShopPreferences,
  planTier: SubscriptionPlanCode,
): Promise<ReceiptFallbackResult> {
  const { html, plainText } = buildSampleReceiptParts(lang, preferences, planTier);
  return printReceiptFallback({
    plainText,
    html,
    paper: preferences.receiptPaperSize ?? "80mm",
    filenameStem: "waka-receipt-sample",
    title: t(lang, "settingsReceiptPreviewTitle"),
  });
}
