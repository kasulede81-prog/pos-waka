import { useMemo } from "react";
import type { Language, ShopPreferences } from "../../types";
import { buildReceiptDisplayData, buildSaleReceiptHtml } from "../../lib/receiptPrint";
import { resolveReceiptBranding } from "../../lib/receiptBranding";
import type { SubscriptionPlanCode } from "../../lib/subscriptionEntitlements";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  preferences: ShopPreferences;
  planTier: SubscriptionPlanCode;
};

const SAMPLE_SALE = {
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

export function ReceiptLivePreview({ lang, preferences, planTier }: Props) {
  const display = useMemo(() => {
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
  }, [lang, preferences, planTier]);

  const html = useMemo(() => buildSaleReceiptHtml(display), [display]);

  return (
    <article className="rounded-2xl border border-stone-200 bg-stone-50 p-4 shadow-inner">
      <p className="text-center text-xs font-black uppercase tracking-wide text-stone-500">
        {t(lang, "settingsReceiptPreviewTitle")}
      </p>
      <div
        className="mx-auto mt-3 max-w-[320px] overflow-hidden rounded-xl border border-stone-200 bg-white p-3 shadow-sm"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
