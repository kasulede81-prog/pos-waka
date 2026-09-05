import { useMemo, useState } from "react";
import { CreditCard, Wallet } from "lucide-react";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { usePosStore } from "../../../store/usePosStore";
import { filterSupplierPayments, purchaseFilterFromDateFilter, resolvePurchaseFilterBounds, sumSupplierPaymentsUgx } from "../../../lib/purchaseReporting";
import { supplierPaymentCreatedByLabel } from "../../../lib/purchaseCorrections";
import { dateKeyKampala } from "../../../lib/datesUg";
import type { DateFilterValue } from "../../../lib/dateFilters";
import { InventoryDateFilterChips } from "./InventoryDateFilterChips";
import { buildSupplierSummary } from "../../../lib/purchaseReporting";
import { formatShortUgx } from "../lib/overviewStats";
import { isWalkInSupplierId } from "../../../lib/walkInSupplier";
import { WakaButton } from "../../../components/ui/wakaPrimitives";
import { InventoryRoomEmpty, InventoryRoomHeader, InventoryRoomMetric } from "./InventoryRoomChrome";
import { InventoryRoomTable } from "./InventoryRoomTable";

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
  const periodPaid = useMemo(() => sumSupplierPaymentsUgx(payments), [payments]);

  return (
    <div className="inventory-room inventory-room--payments space-y-3">
      <InventoryRoomHeader
        icon={Wallet}
        title={t(lang, "ipTabPayments")}
        subtitle={t(lang, "ipPaymentsSub")}
        action={
          <WakaButton
            type="button"
            variant="primary"
            className="inventory-hub-cta shrink-0"
            iconLeft={<CreditCard className="h-4 w-4" aria-hidden />}
            onClick={onRecordPayment}
          >
            {t(lang, "supplierPayButton")}
          </WakaButton>
        }
      />

      <div className="inventory-room-summary inventory-enter inventory-enter--1">
        <InventoryRoomMetric icon={Wallet} label={t(lang, "ipPaymentsPeriod")} value={formatShortUgx(periodPaid)} tone="ok" />
        <InventoryRoomMetric
          icon={CreditCard}
          label={t(lang, "ipStatOutstanding")}
          value={formatShortUgx(summary.totalDebtUgx)}
          tone={summary.totalDebtUgx > 0 ? "danger" : "default"}
        />
      </div>

      <div className="inventory-enter inventory-enter--2 space-y-2.5">
        <InventoryDateFilterChips lang={lang} filter={filter} onFilterChange={setFilter} />
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="inventory-room-search max-w-full sm:max-w-xs"
        >
          <option value="all">{t(lang, "ipAllSuppliers")}</option>
          {suppliers.filter((s) => !isWalkInSupplierId(s.id)).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      {owingSuppliers.length > 0 ? (
        <section className="inventory-enter inventory-enter--3">
          <h3 className="inventory-zone-label mb-1.5">{t(lang, "ipUpcomingPayments")}</h3>
          <ul>
            {owingSuppliers.slice(0, 5).map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOpenSupplier(s.id)} className="inventory-room-row">
                  <span className="inventory-ops-icon">
                    <CreditCard className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="inventory-room-row__name min-w-0 flex-1 truncate">{s.name}</span>
                  <span className="inventory-room-row__amount tabular-nums text-rose-700">{formatShortUgx(s.balanceOwedUgx)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="inventory-enter inventory-enter--4">
        <h3 className="inventory-zone-label mb-1.5">{t(lang, "supplierPaymentHistory")}</h3>
        {payments.length === 0 ? (
          <InventoryRoomEmpty
            icon={Wallet}
            title={t(lang, "supplierPaymentEmpty")}
            actionLabel={t(lang, "supplierPayButton")}
            onAction={onRecordPayment}
          />
        ) : (
          <>
            <InventoryRoomTable
              rows={payments}
              rowKey={(pay) => pay.id}
              ariaLabel={t(lang, "supplierPaymentHistory")}
              minWidthPx={640}
              onRowActivate={(pay) => onOpenSupplier(pay.supplierId)}
              columns={[
                {
                  id: "supplier",
                  header: t(lang, "officeCardSuppliers"),
                  cell: (pay) => (
                    <span className="inventory-table-product">{supplierNameById.get(pay.supplierId) ?? "—"}</span>
                  ),
                },
                {
                  id: "date",
                  header: t(lang, "purchasesColDate"),
                  hideBelow: "lg",
                  cell: (pay) => dateKeyKampala(pay.createdAt),
                },
                {
                  id: "by",
                  header: t(lang, "supplierPaymentCreatedBy"),
                  hideBelow: "xl",
                  cell: (pay) =>
                    supplierPaymentCreatedByLabel(
                      pay,
                      auditLogs.find((e) => e.action === "supplier_payment" && e.payload.paymentId === pay.id) ?? null,
                    ),
                },
                {
                  id: "amount",
                  header: t(lang, "supplierPayAmount"),
                  align: "right",
                  cell: (pay) => <span className="font-bold tabular-nums text-teal-800">{formatShortUgx(pay.amountUgx)}</span>,
                },
              ]}
            />
            <ul className="sm:hidden">
              {payments.map((pay) => (
                <li key={pay.id}>
                  <button type="button" onClick={() => onOpenSupplier(pay.supplierId)} className="inventory-room-row">
                    <span className="inventory-ops-icon">
                      <Wallet className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="inventory-room-row__name truncate">{supplierNameById.get(pay.supplierId) ?? "—"}</p>
                      <p className="inventory-room-row__meta">{dateKeyKampala(pay.createdAt)}</p>
                    </div>
                    <span className="inventory-room-row__amount tabular-nums text-teal-800">{formatShortUgx(pay.amountUgx)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
