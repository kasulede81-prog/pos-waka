import type { Language, InventoryCountSession } from "../../../types";
import { t } from "../../../lib/i18n";
import type { InventoryCountVarianceReport } from "../../../lib/inventoryCount";
import { formatCountSessionDuration } from "../../../lib/countWorkspace";
import { dateKeyKampala } from "../../../lib/datesUg";
import { COUNT_SECTION_LABEL } from "./countTokens";

type Props = {
  lang: Language;
  session: InventoryCountSession;
  report: InventoryCountVarianceReport;
  operatorName?: string;
};

export function CountSummaryPanel({ lang, session, report, operatorName }: Props) {
  const businessDate = session.snapshotCreatedAt
    ? dateKeyKampala(new Date(session.snapshotCreatedAt))
    : dateKeyKampala(new Date());
  const duration = formatCountSessionDuration(session);

  const rows = [
    { label: t(lang, "inventoryCountProductsCounted"), value: report.productsCounted.toLocaleString() },
    { label: t(lang, "inventoryCountMissingStock"), value: report.missingQty.toLocaleString() },
    { label: t(lang, "inventoryCountExcessStock"), value: report.excessQty.toLocaleString() },
    {
      label: t(lang, "inventoryCountCostImpact"),
      value: `UGX ${report.varianceCostUgx.toLocaleString()}`,
    },
    operatorName ? { label: t(lang, "adjSummaryOperator"), value: operatorName } : null,
    { label: t(lang, "receiveSummaryBusinessDate"), value: businessDate },
    duration ? { label: t(lang, "cntSummaryDuration"), value: duration } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <p className={COUNT_SECTION_LABEL}>{t(lang, "inventoryCountVarianceSummary")}</p>
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
