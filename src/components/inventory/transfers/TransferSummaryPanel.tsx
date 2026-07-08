import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { formatShortUgx } from "../../../features/inventory-purchasing/lib/overviewStats";
import { TransferHeader } from "./TransferHeader";

type Props = {
  lang: Language;
  productCount: number;
  totalUnits: number;
  estimatedValueUgx: number;
  operatorName?: string;
  businessDate?: string;
  destinationName?: string | null;
  sourceName?: string;
};

export function TransferSummaryPanel({
  lang,
  productCount,
  totalUnits,
  estimatedValueUgx,
  operatorName,
  businessDate,
  destinationName,
  sourceName,
}: Props) {
  const rows = [
    sourceName ? { label: t(lang, "xferSummarySource"), value: sourceName } : null,
    destinationName
      ? { label: t(lang, "xferSummaryDestination"), value: destinationName }
      : { label: t(lang, "xferSummaryDestination"), value: t(lang, "xferDestinationPending") },
    { label: t(lang, "xferSummaryProducts"), value: productCount.toLocaleString() },
    { label: t(lang, "xferSummaryUnits"), value: totalUnits.toLocaleString() },
    { label: t(lang, "xferSummaryValue"), value: formatShortUgx(estimatedValueUgx) },
    operatorName ? { label: t(lang, "adjSummaryOperator"), value: operatorName } : null,
    businessDate ? { label: t(lang, "receiveSummaryBusinessDate"), value: businessDate } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <TransferHeader title={t(lang, "xferSummaryTitle")} />
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
