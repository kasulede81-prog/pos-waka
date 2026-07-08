import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { formatShortUgx } from "../../../features/inventory-purchasing/lib/overviewStats";
import { AdjustmentHeader } from "./AdjustmentHeader";

type Props = {
  lang: Language;
  productName?: string;
  reasonLabel?: string;
  quantity?: number;
  currentStock?: number;
  newStock?: number;
  inventoryValueUgx?: number;
  operatorName?: string;
  businessDate?: string;
};

export function AdjustmentSummaryPanel({
  lang,
  productName,
  reasonLabel,
  quantity,
  currentStock,
  newStock,
  inventoryValueUgx,
  operatorName,
  businessDate,
}: Props) {
  const rows = [
    productName ? { label: t(lang, "adjSummaryProduct"), value: productName } : null,
    reasonLabel ? { label: t(lang, "adjSummaryReason"), value: reasonLabel } : null,
    quantity != null ? { label: t(lang, "adjSummaryQuantity"), value: quantity.toLocaleString() } : null,
    currentStock != null ? { label: t(lang, "adjSummaryCurrent"), value: currentStock.toLocaleString() } : null,
    newStock != null ? { label: t(lang, "adjSummaryNew"), value: newStock.toLocaleString() } : null,
    inventoryValueUgx != null
      ? { label: t(lang, "adjSummaryValue"), value: formatShortUgx(inventoryValueUgx) }
      : null,
    operatorName ? { label: t(lang, "adjSummaryOperator"), value: operatorName } : null,
    businessDate ? { label: t(lang, "receiveSummaryBusinessDate"), value: businessDate } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <AdjustmentHeader title={t(lang, "adjSummaryTitle")} />
      <dl className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-xs font-semibold text-muted-foreground">{row.label}</dt>
            <dd className="text-sm font-black tabular-nums text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
