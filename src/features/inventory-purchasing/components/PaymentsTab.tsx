import { useMemo, useState } from "react";
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
        <div className="rounded-2xl border border-border bg-card p-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ipPaymentsPeriod")}</p>
          <p className="text-lg font-black tabular-nums text-teal-800">{formatShortUgx(sumSupplierPaymentsUgx(payments))}</p>
        </div>
        <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-3 shadow-sm">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">{t(lang, "ipStatOutstanding")}</p>
          <p className="text-lg font-black tabular-nums text-rose-800">{formatShortUgx(summary.totalDebtUgx)}</p>
        </div>
      </div>

      <SalesHistoryDateFilterChips lang={lang} filter={filter} onFilterChange={setFilter} />

      <div className="flex flex-wrap gap-2">
        <select value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className="rounded-xl border border-border bg-card px-3 py-2 text-xs font-bold">
          <option value="all">{t(lang, "ipAllSuppliers")}</option>
          {suppliers.filter((s) => !isWalkInSupplierId(s.id)).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <button type="button" onClick={onRecordPayment} className="rounded-xl bg-waka-600 px-4 py-2 text-xs font-black text-white">
          {t(lang, "supplierPayButton")}
        </button>
      </div>

      {owingSuppliers.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-muted-foreground">{t(lang, "ipUpcomingPayments")}</h3>
          <ul className="space-y-2">
            {owingSuppliers.slice(0, 5).map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOpenSupplier(s.id)} className="flex w-full items-center justify-between rounded-xl border border-amber-100 bg-amber-50/60 px-3 py-2 text-left">
                  <span className="text-sm font-bold text-foreground">{s.name}</span>
                  <span className="text-sm font-black tabular-nums text-rose-800">{formatShortUgx(s.balanceOwedUgx)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mb-2 text-xs font-black uppercase tracking-wide text-muted-foreground">{t(lang, "supplierPaymentHistory")}</h3>
        {payments.length === 0 ? (
          <p className="text-sm font-semibold text-muted-foreground">{t(lang, "supplierPaymentEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {payments.map((pay) => (
              <li key={pay.id} className="rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-black text-foreground">{supplierNameById.get(pay.supplierId) ?? "—"}</p>
                    <p className="text-xs font-semibold text-muted-foreground">{dateKeyKampala(pay.createdAt)}</p>
                    <p className="text-xs text-muted-foreground">
                      {t(lang, "supplierPaymentCreatedBy")}:{" "}
                      {supplierPaymentCreatedByLabel(pay, auditLogs.find((e) => e.action === "supplier_payment" && e.payload.paymentId === pay.id) ?? null)}
                    </p>
                  </div>
                  <p className="text-lg font-black tabular-nums text-teal-800">{formatShortUgx(pay.amountUgx)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
