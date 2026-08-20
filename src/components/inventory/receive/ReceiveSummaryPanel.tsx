import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { formatShortUgx } from "../../../features/inventory-purchasing/lib/overviewStats";
import { ReceiveHeader } from "./ReceiveHeader";

type Props = {
  lang: Language;
  invoiceTotalUgx: number;
  productCount?: number;
  unitsReceived?: number;
  supplierName?: string;
  businessDate?: string;
  purchaseReference?: string;
  inventoryValueUgx?: number;
  paidNowUgx?: number;
  balanceDueUgx?: number;
};

export function ReceiveSummaryPanel({
  lang,
  invoiceTotalUgx,
  productCount,
  unitsReceived,
  supplierName,
  businessDate,
  purchaseReference,
  inventoryValueUgx,
  paidNowUgx,
  balanceDueUgx,
}: Props) {
  const rows = [
    { label: t(lang, "receiveSummaryInvoiceTotal"), value: formatShortUgx(invoiceTotalUgx) },
    paidNowUgx != null ? { label: t(lang, "restockPaidToday"), value: formatShortUgx(paidNowUgx) } : null,
    balanceDueUgx != null && balanceDueUgx > 0
      ? { label: t(lang, "ipBalance"), value: formatShortUgx(balanceDueUgx) }
      : null,
    productCount != null ? { label: t(lang, "receiveSummaryProducts"), value: String(productCount) } : null,
    unitsReceived != null ? { label: t(lang, "receiveSummaryUnits"), value: unitsReceived.toLocaleString() } : null,
    inventoryValueUgx != null
      ? { label: t(lang, "receiveSummaryInventoryValue"), value: formatShortUgx(inventoryValueUgx) }
      : null,
    supplierName ? { label: t(lang, "receiveSummarySupplier"), value: supplierName } : null,
    businessDate ? { label: t(lang, "receiveSummaryBusinessDate"), value: businessDate } : null,
    purchaseReference ? { label: t(lang, "receiveSummaryReference"), value: purchaseReference } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  if (rows.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <ReceiveHeader title={t(lang, "receiveSummaryTitle")} />
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
