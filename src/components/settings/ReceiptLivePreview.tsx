import { useMemo } from "react";
import type { Language, ShopPreferences } from "../../types";
import { buildSaleReceiptHtml } from "../../lib/receiptPrint";
import { sampleReceiptDisplay } from "../../lib/receiptSampleDocument";
import type { SubscriptionPlanCode } from "../../lib/subscriptionEntitlements";
import { t } from "../../lib/i18n";

type Props = {
  lang: Language;
  preferences: ShopPreferences;
  planTier: SubscriptionPlanCode;
};

export function ReceiptLivePreview({ lang, preferences, planTier }: Props) {
  // Same synthetic sample the "Print sample" action prints (lib/receiptSampleDocument).
  const html = useMemo(
    () => buildSaleReceiptHtml(sampleReceiptDisplay(lang, preferences, planTier)),
    [lang, preferences, planTier],
  );

  return (
    <article className="rounded-2xl border border-border bg-muted p-4 shadow-inner">
      <p className="text-center text-xs font-black uppercase tracking-wide text-muted-foreground">
        {t(lang, "settingsReceiptPreviewTitle")}
      </p>
      <div
        className="mx-auto mt-3 max-w-[320px] overflow-hidden rounded-xl border border-border bg-card p-3 shadow-sm"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </article>
  );
}
