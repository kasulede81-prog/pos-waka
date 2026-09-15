import { useMemo, useState } from "react";
import { Banknote, Wallet } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { usePosStore } from "../../../store/usePosStore";
import { filterSupplierPayments, purchaseFilterFromDateFilter, resolvePurchaseFilterBounds, sumSupplierPaymentsUgx } from "../../../lib/purchaseReporting";
import { supplierPaymentCreatedByLabel } from "../../../lib/purchaseCorrections";
import { dateKeyKampala } from "../../../lib/datesUg";
import type { DateFilterValue } from "../../../lib/dateFilters";
import { SalesHistoryDateFilterChips } from "../../../components/receipts/SalesHistoryDateFilterChips";
import { buildSupplierSummary } from "../../../lib/purchaseReporting";
import { formatShortUgx } from "../lib/overviewStats";
import { isWalkInSupplierId } from "../../../lib/walkInSupplier";
import { EnterpriseKpiCard } from "../../../components/enterprise/EnterpriseKpiCard";
import { EnterpriseResponsiveTable } from "../../../components/shared/ResponsiveDataTable";
import { WakaButton } from "../../../components/ui/wakaPrimitives";
import { enterpriseTypeClass } from "../../../lib/enterpriseTypography";
import { Caption, MonoNumber, SectionTitle } from "../../../components/enterprise/EnterpriseTypography";
import { Body } from "../../../components/enterprise/EnterpriseTypography";
import clsx from "clsx";
import { statusTokens } from "../../../lib/statusTokens";

type Props = {
  lang: Language;
  onRecordPayment: () => void;
  onOpenSupplier: (id: string) => void;
};

export function PaymentsTab({ lang, onRecordPayment, onOpenSupplier }: Props) {
  const supplierPayments = usePosStore((s) => s.supplierPayments);
  const suppliers = usePosStore((s) => s.suppliers);
  const auditLogs = usePosStore((s) => s.auditLogs);

  const [filter, setFilter] = useState<DateFilterValue>({ kind: "preset", preset: "this_month" });
  const [supplierFilter, setSupplierFilter] = useState("all");

  const bounds = useMemo(() => resolvePurchaseFilterBounds(purchaseFilterFromDateFilter(filter)), [filter]);
  const payments = useMemo(() => {
    let list = filterSupplierPayments(supplierPayments, bounds);
    if (supplierFilter !== "all") list = list.filter((p) => p.supplierId === supplierFilter);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [supplierPayments, bounds, supplierFilter]);

  const summary = useMemo(() => buildSupplierSummary(suppliers), [suppliers]);
  const supplierNameById = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const owingSuppliers = useMemo(
    () => suppliers.filter((s) => !isWalkInSupplierId(s.id) && s.balanceOwedUgx > 0).sort((a, b) => b.balanceOwedUgx - a.balanceOwedUgx),
    [suppliers],
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <EnterpriseKpiCard
          icon={Wallet}
          label={t(lang, "ipPaymentsPeriod")}
          value={<MonoNumber className="text-lg text-teal-800">{formatShortUgx(sumSupplierPaymentsUgx(payments))}</MonoNumber>}
          tone="success"
        />
        <EnterpriseKpiCard
          icon={Banknote}
          label={t(lang, "ipStatOutstanding")}
          value={<MonoNumber className="text-lg text-rose-800">{formatShortUgx(summary.totalDebtUgx)}</MonoNumber>}
          tone="danger"
        />
      </div>

      <SalesHistoryDateFilterChips lang={lang} filter={filter} onFilterChange={setFilter} />

      <div className="flex flex-wrap gap-2">
        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold">
          <option value="all">{t(lang, "ipAllSuppliers")}</option>
          {suppliers.filter((s) => !isWalkInSupplierId(s.id)).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <WakaButton type="button" variant="primary" onClick={onRecordPayment}>
          {t(lang, "supplierPayButton")}
        </WakaButton>
      </div>

      {owingSuppliers.length > 0 ? (
        <section>
          <Caption as="h3" className="mb-2 block">{t(lang, "ipUpcomingPayments")}</Caption>
          <ul className="space-y-2">
            {owingSuppliers.slice(0, 5).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpenSupplier(s.id)}
                  className={clsx(
                    "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-left",
                    statusTokens.warning.banner,
                    statusTokens.warning.badgeRing,
                  )}
                >
                  <span className={enterpriseTypeClass("body", "!text-sm !font-bold")}>{s.name}</span>
                  <MonoNumber className="text-sm text-rose-800">{formatShortUgx(s.balanceOwedUgx)}</MonoNumber>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <SectionTitle as="h3" className="mb-2 !text-xs uppercase tracking-wide text-muted-foreground">
          {t(lang, "supplierPaymentHistory")}
        </SectionTitle>
        <EnterpriseResponsiveTable
          rows={payments}
          rowKey={(pay) => pay.id}
          minWidthPx={640}
          emptyState={<Body className="text-muted-foreground">{t(lang, "supplierPaymentEmpty")}</Body>}
          columns={[
            {
              id: "supplier",
              header: t(lang, "officeCardSuppliers"),
              cell: (pay) => supplierNameById.get(pay.supplierId) ?? "—",
            },
            {
              id: "date",
              header: t(lang, "purchasesColDate"),
              cell: (pay) => dateKeyKampala(pay.createdAt),
              hideOnMobile: true,
            },
            {
              id: "by",
              header: t(lang, "supplierPaymentCreatedBy"),
              cell: (pay) =>
                supplierPaymentCreatedByLabel(
                  pay,
                  auditLogs.find((e) => e.action === "supplier_payment" && e.payload.paymentId === pay.id) ?? null,
                ),
              hideOnMobile: true,
            },
            {
              id: "amount",
              header: t(lang, "supplierPayAmount"),
              className: "text-right",
              cell: (pay) => (
                <MonoNumber className="text-teal-800">{formatShortUgx(pay.amountUgx)}</MonoNumber>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
