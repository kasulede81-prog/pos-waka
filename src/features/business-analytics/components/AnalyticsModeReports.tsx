import type { Customer, Language, Product } from "../../../types";
import { t, tTemplate } from "../../../lib/i18n";
import { reportsInventoryCostPresentation } from "../lib/analyticsPageView";
import { StockMovementsPanel } from "../../../components/stock/StockMovementsPanel";
import { ExpiryStatusBadge } from "../../../components/pharmacy/ExpiryStatusBadge";
import { formatMedicineFullLabel } from "../../../lib/pharmacyMedicine";
import {
  downloadPharmacyExpiryCsv,
  downloadPharmacyExpiryPdf,
} from "../../../lib/pharmacyDocumentExports";
import {
  downloadWholesaleDebtorListPdf,
  downloadWholesaleReceivablesCsv,
  downloadWholesaleReceivablesPdf,
  wholesaleReceivablesRows,
} from "../../../lib/wholesaleDocumentExports";
import {
  downloadHospitalityKitchenPdf,
  downloadHospitalityMenuPdf,
  downloadHospitalityTablePdf,
  downloadHospitalityWaiterPdf,
} from "../../../lib/hospitalityDocumentExports";
import type { PharmacyExpiryReport } from "../../../lib/pharmacyReports";
import {
  formatHospitalityCancellationTime,
  formatHospitalityDurationMinutes,
  formatIngredientDemandQty,
  hospitalityCancellationReasonLabel,
  hospitalityCancellationSourceLabel,
  hospitalityMenuMarginLabel,
  type HospitalityMenuPerformanceRow,
  type HospitalityReportSummary,
} from "../../../lib/hospitalityReports";
import type { HospitalityFloorState, StockMovement } from "../../../types";
import { computeKitchenProductionAnalytics } from "../../../lib/kitchenProduction";

export function StockActivityReportsSection({
  lang,
  movements,
  periodLabel,
  titleKey,
  pharmacyMode,
  wholesaleMode,
  emptyInPeriod,
}: {
  lang: Language;
  movements: StockMovement[];
  periodLabel?: string;
  titleKey: "stockMovementTitle" | "wholesaleReportsMovementTitle" | "pharmacyReportsMovementTitle";
  pharmacyMode?: boolean;
  wholesaleMode?: boolean;
  emptyInPeriod?: boolean;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
      <h3 className="text-base font-black text-foreground">{t(lang, titleKey)}</h3>
      {periodLabel ? (
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{periodLabel}</p>
      ) : null}
      <StockMovementsPanel
        lang={lang}
        movements={movements}
        pharmacyMode={pharmacyMode}
        wholesaleMode={wholesaleMode}
        emptyLabelKey={emptyInPeriod ? "noStockMovementsInPeriod" : undefined}
      />
    </section>
  );
}

export function PharmacyReportsSection({
  lang,
  products,
  stockMovements,
  pharmacyExpiryReport,
  periodLabel,
  canProfit,
}: {
  lang: Language;
  products: Product[];
  stockMovements: StockMovement[];
  pharmacyExpiryReport: PharmacyExpiryReport;
  periodLabel?: string;
  canProfit?: boolean;
}) {
  const expiryExport = { includeCost: canProfit === true };
  return (
    <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
      <h2 className="text-lg font-black text-emerald-950">{t(lang, "pharmacyReportsTitle")}</h2>
      <p className="text-sm font-semibold text-muted-foreground">{t(lang, "pharmacyReportsPrimaryHint")}</p>
      {periodLabel ? (
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">{periodLabel}</p>
      ) : null}
      <div className="rounded-2xl border border-border bg-card p-3">
        <StockMovementsPanel lang={lang} movements={stockMovements} pharmacyMode emptyLabelKey="noStockMovementsInPeriod" />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white" onClick={() => void downloadPharmacyExpiryPdf(lang, products, expiryExport)}>
          {t(lang, "pharmacyExportPdf")}
        </button>
        <button type="button" className="rounded-xl border border-emerald-300 bg-card px-3 py-2 text-xs font-black text-emerald-900" onClick={() => void downloadPharmacyExpiryCsv(products, expiryExport)}>
          {t(lang, "pharmacyExportCsv")}
        </button>
      </div>
      {pharmacyExpiryReport.expiring.slice(0, 5).map((row) => {
        const product = products.find((p) => p.id === row.productId);
        return (
          <p key={row.productId} className="flex justify-between text-sm font-medium">
            <span>{product ? formatMedicineFullLabel(product) : row.name}</span>
            {product ? <ExpiryStatusBadge lang={lang} product={product} compact /> : null}
          </p>
        );
      })}
    </section>
  );
}

export function WholesaleReportsSection({
  lang,
  wholesaleSection,
  canProfit,
}: {
  lang: Language;
  wholesaleSection: {
    debtOutstanding: number;
    count: number;
    stockValueAtCost: number;
    customers: Customer[];
  };
  canProfit: boolean;
}) {
  const warehouseCost = reportsInventoryCostPresentation(canProfit, wholesaleSection.stockValueAtCost);
  return (
    <section className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm">
      <h2 className="text-lg font-black text-indigo-950">{t(lang, "wholesaleReportsHubTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl border border-indigo-100 bg-card p-3">
          <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "wholesaleReportsReceivables")}</p>
          <p className="mt-1 text-xl font-black text-indigo-950">UGX {wholesaleSection.debtOutstanding.toLocaleString()}</p>
        </article>
        <article className="rounded-2xl border border-indigo-100 bg-card p-3">
          <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "wholesaleReportsInvoiceVolume")}</p>
          <p className="mt-1 text-xl font-black text-indigo-950">{wholesaleSection.count}</p>
        </article>
        <article className="rounded-2xl border border-indigo-100 bg-card p-3">
          <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "wholesaleReportsWarehouseValue")}</p>
          <p className="mt-1 text-xl font-black text-indigo-950">
            {warehouseCost.visible
              ? `UGX ${warehouseCost.valueUgx.toLocaleString()}`
              : t(lang, "baProfitLockedTitle")}
          </p>
        </article>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-xl bg-indigo-700 px-3 py-2 text-xs font-black text-white" onClick={() => void downloadWholesaleReceivablesPdf(lang, wholesaleReceivablesRows(wholesaleSection.customers), wholesaleSection.debtOutstanding)}>
          {t(lang, "wholesaleExportReceivablesPdf")}
        </button>
        <button type="button" className="rounded-xl border border-indigo-300 bg-card px-3 py-2 text-xs font-black text-indigo-900" onClick={() => void downloadWholesaleReceivablesCsv(wholesaleReceivablesRows(wholesaleSection.customers))}>
          {t(lang, "wholesaleExportReceivablesCsv")}
        </button>
        <button type="button" className="rounded-xl border border-indigo-300 bg-card px-3 py-2 text-xs font-black text-indigo-900" onClick={() => void downloadWholesaleDebtorListPdf(lang, wholesaleReceivablesRows(wholesaleSection.customers))}>
          {t(lang, "wholesaleExportDebtorsPdf")}
        </button>
      </div>
    </section>
  );
}

function MenuPerformanceList({
  lang,
  title,
  rows,
  emptyLabel,
}: {
  lang: Language;
  title: string;
  rows: HospitalityMenuPerformanceRow[];
  emptyLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <p className="text-xs font-black uppercase text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm font-semibold text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {rows.map((row) => (
            <li
              key={row.productId}
              className="flex items-start justify-between gap-2 text-sm font-semibold text-foreground"
            >
              <span className="min-w-0 truncate">{row.name}</span>
              <span className="shrink-0 text-right text-xs text-muted-foreground">
                {row.unitsSold} · UGX {row.revenueUgx.toLocaleString()} ·{" "}
                {hospitalityMenuMarginLabel(lang, row)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function HospitalityReportsSection({
  lang,
  periodLabel,
  hospitalityReports,
  hospitalityOpenBills,
  hospitalityFloor,
}: {
  lang: Language;
  periodLabel?: string;
  hospitalityReports: HospitalityReportSummary;
  hospitalityOpenBills: { count: number; totalUgx: number } | null;
  hospitalityFloor?: HospitalityFloorState | null;
}) {
  const kitchenAnalytics = hospitalityFloor ? computeKitchenProductionAnalytics(hospitalityFloor) : null;
  const reservationCount =
    hospitalityFloor?.reservations?.filter((r) => r.status !== "cancelled").length ?? 0;
  const waitlistCount = hospitalityFloor?.waitlist?.filter((w) => w.status !== "cancelled").length ?? 0;
  const demand = hospitalityReports.menu.ingredientDemand;
  const hasDemandGaps =
    demand.missingIngredients.length > 0 || demand.noRecipeDishes.length > 0;
  const prepBatches = hospitalityReports.prepBatches;
  const prepReturnsIncluded = prepBatches.returnsEvidence === "included";
  // A missing snapshot with no known subtotal is unknown; a known subtotal from
  // the other lines is still shown and flagged as incomplete by the row suffix.
  const prepRowMoney = (
    row: (typeof prepBatches.rows)[number],
    net: number | null,
    gross: number,
  ) => {
    const value = prepReturnsIncluded ? net : gross;
    if (row.salesSnapshotEvidence === "missing" && (value ?? 0) <= 0) {
      return t(lang, "hospitalityPrepBatchReportUnknown");
    }
    return `UGX ${(value ?? 0).toLocaleString()}`;
  };
  const prepYieldUnknownCount = prepBatches.batchCount - prepBatches.yieldMeasuredBatchCount;
  const cancellations = hospitalityReports.cancellations;
  const tableService = hospitalityReports.tableService;

  return (
    <section className="space-y-4 rounded-2xl border border-waka-200 bg-waka-50/40 p-4 shadow-sm">
      <h2 className="text-lg font-black text-waka-950">{t(lang, "hospitalityReportsTitle")}</h2>
      <p className="text-sm font-semibold text-muted-foreground">
        {hospitalityReports.completedBillCount} bills · UGX {hospitalityReports.totalRevenueUgx.toLocaleString()} ·{" "}
        {t(lang, "hospitalityReportsAvgBill")} UGX {hospitalityReports.avgBillUgx.toLocaleString()}
      </p>
      {hospitalityOpenBills && hospitalityOpenBills.count > 0 ? (
        <article className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3">
          <p className="text-xs font-black uppercase text-amber-900">{t(lang, "hospitalityReportsOpenBills")}</p>
          <p className="mt-1 text-lg font-black text-amber-950">
            {hospitalityOpenBills.count} · UGX {hospitalityOpenBills.totalUgx.toLocaleString()}
          </p>
        </article>
      ) : null}
      {kitchenAnalytics ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <article className="rounded-2xl border border-waka-100 bg-card p-3">
            <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "hospitalityReportsAvgPrep")}</p>
            <p className="mt-1 text-xl font-black text-waka-950">
              {kitchenAnalytics.averagePrepMinutes != null ? `${kitchenAnalytics.averagePrepMinutes} min` : "—"}
            </p>
          </article>
          <article className="rounded-2xl border border-waka-100 bg-card p-3">
            <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "hospitalityReportsStationLoad")}</p>
            <p className="mt-1 text-sm font-bold text-foreground">
              {Object.entries(kitchenAnalytics.stationWorkload)
                .map(([id, n]) => `${id}: ${n}`)
                .join(" · ") || "—"}
            </p>
          </article>
          <article className="rounded-2xl border border-waka-100 bg-card p-3">
            <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "hospitalityReportsReservationUtil")}</p>
            <p className="mt-1 text-xl font-black text-waka-950">{reservationCount}</p>
            {waitlistCount > 0 ? (
              <p className="text-xs font-semibold text-muted-foreground">Waitlist: {waitlistCount}</p>
            ) : null}
          </article>
          <article className="rounded-2xl border border-waka-100 bg-card p-3">
            <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "hospitalityReportsMix")}</p>
            <p className="mt-1 text-sm font-bold text-foreground">
              {hospitalityReports.categoryMix
                .map((m) => `${m.kind}: UGX ${m.revenueUgx.toLocaleString()}`)
                .join(" · ") || "—"}
            </p>
          </article>
        </div>
      ) : null}
      <div className="rounded-2xl border border-waka-200 bg-card p-3">
        <p className="text-xs font-black uppercase text-muted-foreground">
          {t(lang, "hospitalityReportsMenuTitle")}
        </p>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {t(lang, "hospitalityReportsMenuHint")}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            {
              label: t(lang, "hospitalityReportsMenuItems"),
              value: hospitalityReports.menu.menuItemCount,
              className: "text-foreground",
            },
            {
              label: t(lang, "hospitalityReportsReliableCost"),
              value: hospitalityReports.menu.reliableCostCount,
              className: "text-emerald-800",
            },
            {
              label: t(lang, "hospitalityReportsNeedsCost"),
              value: hospitalityReports.menu.needsCostCount,
              className: "text-amber-800",
            },
            {
              label: t(lang, "hospitalityReportsUnverifiedCost"),
              value: hospitalityReports.menu.unverifiedCostCount,
              className: "text-muted-foreground",
            },
          ].map((tile) => (
            <article key={tile.label} className="rounded-xl bg-muted/60 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                {tile.label}
              </p>
              <p className={`mt-0.5 text-lg font-black ${tile.className}`}>{tile.value}</p>
            </article>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <MenuPerformanceList
            lang={lang}
            title={t(lang, "hospitalityReportsTopDishes")}
            rows={hospitalityReports.menu.topDishes}
            emptyLabel={t(lang, "hospitalityReportsNoMenuSales")}
          />
          <MenuPerformanceList
            lang={lang}
            title={t(lang, "hospitalityReportsTopDrinks")}
            rows={hospitalityReports.menu.topDrinks}
            emptyLabel={t(lang, "hospitalityReportsNoMenuSales")}
          />
          <MenuPerformanceList
            lang={lang}
            title={t(lang, "hospitalityReportsLowMargin")}
            rows={hospitalityReports.menu.lowMargin}
            emptyLabel={t(lang, "hospitalityReportsNoLowMargin")}
          />
          <div className="rounded-2xl border border-border bg-card p-3">
            <p className="text-xs font-black uppercase text-muted-foreground">
              {t(lang, "hospitalityReportsIngredientGaps")}
            </p>
            {hospitalityReports.menu.ingredientCostGaps.length === 0 ? (
              <p className="mt-2 text-sm font-semibold text-muted-foreground">
                {t(lang, "hospitalityReportsNoIngredientGaps")}
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {hospitalityReports.menu.ingredientCostGaps.map((gap) => (
                  <li
                    key={`${gap.reason}:${gap.ingredientId}`}
                    className="flex items-start justify-between gap-2 text-sm font-semibold text-foreground"
                  >
                    <span className="min-w-0 truncate">
                      {gap.name || t(lang, "menuCostSelectIngredient")}
                    </span>
                    <span className="shrink-0 text-right text-xs text-muted-foreground">
                      {tTemplate(lang, "hospitalityReportsIngredientGapRow", {
                        count: String(gap.dishCount),
                      })}{" "}
                      ·{" "}
                      {gap.reason === "missing"
                        ? t(lang, "hospitalityReportsIngredientMissing")
                        : t(lang, "hospitalityReportsIngredientZeroCost")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        {hospitalityReports.menu.topModifiers.length > 0 ? (
          <div className="mt-3 rounded-2xl border border-border bg-card p-3">
            <p className="text-xs font-black uppercase text-muted-foreground">
              {t(lang, "hospitalityReportsTopModifiers")}
            </p>
            <ul className="mt-2 space-y-1">
              {hospitalityReports.menu.topModifiers.map((mod) => (
                <li
                  key={`${mod.groupLabel}:${mod.optionLabel}`}
                  className="flex justify-between text-sm font-semibold text-foreground"
                >
                  <span>{mod.optionLabel}</span>
                  <span className="text-xs text-muted-foreground">
                    {mod.count} · {mod.groupLabel}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <div className="rounded-2xl border border-waka-200 bg-card p-3">
        <p className="text-xs font-black uppercase text-muted-foreground">
          {t(lang, "hospitalityPrepBatchReportTitle")}
        </p>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {t(lang, "hospitalityPrepBatchReportHint")}
        </p>
        {prepBatches.rows.length === 0 ? (
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            {t(lang, "hospitalityPrepBatchReportEmpty")}
          </p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                {
                  label: t(lang, "hospitalityPrepBatchReportBatches"),
                  value: String(prepBatches.batchCount),
                },
                {
                  label: t(lang, "hospitalityPrepBatchReportPortions"),
                  value: formatIngredientDemandQty(prepBatches.portionsPrepared),
                },
                {
                  label: t(lang, "hospitalityPrepBatchReportActualPortions"),
                  value:
                    prepBatches.actualPortionBatchCount > 0
                      ? formatIngredientDemandQty(prepBatches.recordedActualPortions)
                      : t(lang, "hospitalityPrepBatchReportUnknown"),
                },
                {
                  label: t(lang, "hospitalityPrepBatchReportYieldVariance"),
                  value:
                    prepBatches.yieldMeasuredBatchCount > 0
                      ? `${prepBatches.yieldVariancePortions > 0 ? "+" : ""}${formatIngredientDemandQty(
                          prepBatches.yieldVariancePortions,
                        )}`
                      : "—",
                },
                {
                  label: t(lang, "menuPrepBatchCost"),
                  value: `UGX ${prepBatches.totalBatchCostUgx.toLocaleString()}`,
                },
                {
                  label: t(lang, "hospitalityPrepBatchReportWasted"),
                  value: formatIngredientDemandQty(prepBatches.wastedPortions),
                },
                {
                  label: t(lang, "menuPrepWasteValue"),
                  value: `UGX ${prepBatches.wasteValueUgx.toLocaleString()}`,
                },
              ].map((tile) => (
                <article key={tile.label} className="rounded-xl bg-muted/60 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                    {tile.label}
                  </p>
                  <p className="mt-0.5 text-lg font-black text-foreground">{tile.value}</p>
                </article>
              ))}
            </div>
            <p className="mt-3 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
              {t(lang, "hospitalityPrepBatchReportCurrentStock")}
            </p>
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                {
                  label: t(lang, "menuPrepRemaining"),
                  value: formatIngredientDemandQty(prepBatches.remainingPortions),
                },
                {
                  label: t(lang, "menuPrepRemainingValue"),
                  value: `UGX ${prepBatches.remainingValueUgx.toLocaleString()}`,
                },
              ].map((tile) => (
                <article key={tile.label} className="rounded-xl bg-muted/60 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                    {tile.label}
                  </p>
                  <p className="mt-0.5 text-lg font-black text-foreground">{tile.value}</p>
                </article>
              ))}
            </div>
            <p className="mt-3 text-[10px] font-black uppercase tracking-wide text-muted-foreground">
              {t(lang, "hospitalityPrepBatchReportUsage")}
            </p>
            <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                {
                  label: t(lang, "hospitalityPrepBatchReportSoldNet"),
                  value:
                    prepBatches.soldPortionsNet == null
                      ? t(lang, "hospitalityPrepBatchReportUnknown")
                      : formatIngredientDemandQty(prepBatches.soldPortionsNet),
                },
                {
                  label: t(lang, "hospitalityPrepBatchReportReturned"),
                  value:
                    prepBatches.returnedPortions == null
                      ? t(lang, "hospitalityPrepBatchReportUnknown")
                      : formatIngredientDemandQty(prepBatches.returnedPortions),
                },
                {
                  label: t(lang, "hospitalityPrepBatchReportCancelled"),
                  value:
                    prepBatches.cancelledPortions != null
                      ? formatIngredientDemandQty(prepBatches.cancelledPortions)
                      : prepBatches.cancelledPortionsUnknownBatchCount > 0
                        ? `${formatIngredientDemandQty(prepBatches.cancelledPortionsKnown)} + ?`
                        : t(lang, "hospitalityPrepBatchReportUnknown"),
                },
                {
                  label: t(lang, "hospitalityPrepBatchReportSalesRevenue"),
                  value:
                    prepBatches.salesRevenueUgx == null
                      ? `UGX ${prepBatches.grossSalesRevenueUgx.toLocaleString()}`
                      : `UGX ${prepBatches.salesRevenueUgx.toLocaleString()}`,
                },
                {
                  label: t(lang, "hospitalityPrepBatchReportSalesCogs"),
                  value:
                    prepBatches.salesCogsUgx == null
                      ? `UGX ${prepBatches.grossSalesCogsUgx.toLocaleString()}`
                      : `UGX ${prepBatches.salesCogsUgx.toLocaleString()}`,
                },
              ].map((tile) => (
                <article key={tile.label} className="rounded-xl bg-muted/60 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                    {tile.label}
                  </p>
                  <p className="mt-0.5 text-lg font-black text-foreground">{tile.value}</p>
                </article>
              ))}
            </div>
            <p
              className={`mt-2 text-xs font-semibold ${
                prepBatches.unreconciledBatchCount > 0 || prepBatches.unknownReconciliationBatchCount > 0
                  ? "text-amber-800"
                  : "text-muted-foreground"
              }`}
            >
              {t(lang, "hospitalityPrepBatchReportReconciliationLine")}:{" "}
              {tTemplate(lang, "hospitalityPrepBatchReportReconciliationSummary", {
                reconciled: String(prepBatches.reconciledBatchCount),
                unreconciled: String(prepBatches.unreconciledBatchCount),
                unknown: String(prepBatches.unknownReconciliationBatchCount),
              })}
            </p>
            <p className="mt-1 text-[10px] font-medium text-muted-foreground">
              {t(lang, "hospitalityPrepBatchReportScopeNote")}
            </p>
            <p className="mt-1 text-[10px] font-medium text-muted-foreground">
              {t(lang, "hospitalityPrepBatchReportSalesNote")}
            </p>
            <ul className="mt-3 space-y-2">
              {prepBatches.rows.map((row) => (
                <li
                  key={row.batchId}
                  className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-bold text-foreground">{row.productName}</p>
                    <p className="shrink-0 text-muted-foreground">
                      {row.preparedAt.slice(0, 10)} · {row.status}
                    </p>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">
                    {t(lang, "hospitalityPrepBatchReportPortions")}:{" "}
                    {formatIngredientDemandQty(row.portionsPrepared)}
                    {row.expectedPortions != null && row.actualPortions != null
                      ? ` · ${t(lang, "hospitalityPrepBatchReportExpected")}: ${formatIngredientDemandQty(
                          row.expectedPortions,
                        )} · ${t(lang, "hospitalityPrepBatchReportActual")}: ${formatIngredientDemandQty(
                          row.actualPortions,
                        )} · ${t(lang, "hospitalityPrepBatchReportYieldVariance")}: ${
                          (row.yieldVariancePortions ?? 0) > 0 ? "+" : ""
                        }${formatIngredientDemandQty(row.yieldVariancePortions ?? 0)}`
                      : ""}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {t(lang, "menuPrepCostPerPlate")}: UGX{" "}
                    {row.ingredientCostPerPlateUgx.toLocaleString()} ·{" "}
                    {t(lang, "hospitalityPrepBatchReportCostPerPlate")}: UGX{" "}
                    {row.costPerPlateUgx.toLocaleString()}
                    {row.legacyCost ? ` · ${t(lang, "menuPrepLegacyBatch")}` : ""}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {t(lang, "menuPrepIngredientCostTotal")}: UGX{" "}
                    {row.ingredientCostUgx.toLocaleString()} ·{" "}
                    {t(lang, "menuPrepAdditionalCostTotal")}: UGX{" "}
                    {row.additionalCostUgx.toLocaleString()} ·{" "}
                    {t(lang, "menuPrepBatchCost")}: UGX{" "}
                    {row.totalBatchCostUgx.toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {t(lang, "hospitalityPrepBatchReportSoldNet")}:{" "}
                    {row.soldPortionsNet == null
                      ? t(lang, "hospitalityPrepBatchReportUnknown")
                      : formatIngredientDemandQty(row.soldPortionsNet)}{" "}
                    · {t(lang, "hospitalityPrepBatchReportSoldGross")}:{" "}
                    {formatIngredientDemandQty(row.soldPortionsGross)} ·{" "}
                    {t(lang, "hospitalityPrepBatchReportReturned")}:{" "}
                    {row.returnedPortions == null
                      ? t(lang, "hospitalityPrepBatchReportUnknown")
                      : formatIngredientDemandQty(row.returnedPortions)}{" "}
                    · {t(lang, "hospitalityPrepBatchReportCancelled")}:{" "}
                    {row.cancelledPortions == null
                      ? t(lang, "hospitalityPrepBatchReportUnknown")
                      : formatIngredientDemandQty(row.cancelledPortions)}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {t(lang, "hospitalityPrepBatchReportSalesRevenue")}:{" "}
                    {prepRowMoney(row, row.salesRevenueUgx, row.grossSalesRevenueUgx)} ·{" "}
                    {t(lang, "hospitalityPrepBatchReportSalesCogs")}:{" "}
                    {prepRowMoney(row, row.salesCogsUgx, row.grossSalesCogsUgx)}
                    {row.salesSnapshotEvidence === "missing"
                      ? ` · ${t(lang, "hospitalityPrepBatchReportSnapshotMissing")}`
                      : row.salesSnapshotEvidence === "partial"
                        ? ` · ${t(lang, "hospitalityPrepBatchReportSnapshotPartial")}`
                        : ""}
                  </p>
                  <p
                    className={`mt-0.5 font-semibold ${
                      row.reconciliation === "reconciled"
                        ? "text-muted-foreground"
                        : "text-amber-800"
                    }`}
                  >
                    {t(lang, "hospitalityPrepBatchReportReconciliationLine")}:{" "}
                    {row.reconciliation === "reconciled"
                      ? t(lang, "hospitalityPrepBatchReportReconciled")
                      : row.reconciliation === "unreconciled"
                        ? `${t(lang, "hospitalityPrepBatchReportUnreconciled")} (${
                            (row.reconciliationDeltaPortions ?? 0) > 0 ? "+" : ""
                          }${formatIngredientDemandQty(row.reconciliationDeltaPortions ?? 0)})`
                        : t(lang, "hospitalityPrepBatchReportUnknown")}
                  </p>
                  <p className="mt-0.5 text-muted-foreground">
                    {t(lang, "hospitalityPrepBatchReportWasted")}:{" "}
                    {formatIngredientDemandQty(row.wastedPortions)} ·{" "}
                    {t(lang, "menuPrepWasteValue")}: UGX {row.wasteValueUgx.toLocaleString()} ·{" "}
                    {t(lang, "menuPrepRemaining")}: {formatIngredientDemandQty(row.remainingPortions)} ·{" "}
                    {t(lang, "menuPrepRemainingValue")}: UGX {row.remainingValueUgx.toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] font-medium text-muted-foreground">
              {t(lang, "menuPrepBatchCostBasisNote")}
            </p>
            {!prepReturnsIncluded ? (
              <p className="mt-1 text-xs font-semibold text-amber-800">
                {t(lang, "hospitalityPrepBatchReportReturnsUnavailable")}
              </p>
            ) : null}
            {prepBatches.missingAllocationLineCount > 0 ? (
              <p className="mt-1 text-xs font-semibold text-amber-800">
                {tTemplate(lang, "hospitalityPrepBatchReportMissingAllocation", {
                  count: String(prepBatches.missingAllocationLineCount),
                })}
              </p>
            ) : null}
            {prepBatches.unallocatedSalesRevenueUgx > 0 ||
            prepBatches.unallocatedSalesCogsUgx > 0 ? (
              <p className="mt-1 text-xs font-semibold text-amber-800">
                {tTemplate(lang, "hospitalityPrepBatchReportUnallocatedSales", {
                  revenue: prepBatches.unallocatedSalesRevenueUgx.toLocaleString(),
                  cogs: prepBatches.unallocatedSalesCogsUgx.toLocaleString(),
                })}
              </p>
            ) : null}
            {prepBatches.missingFinancialSnapshotLineCount > 0 ? (
              <p className="mt-1 text-xs font-semibold text-amber-800">
                {tTemplate(lang, "hospitalityPrepBatchReportMissingSnapshot", {
                  count: String(prepBatches.missingFinancialSnapshotLineCount),
                })}
              </p>
            ) : null}
            {prepBatches.partialFinancialSnapshotLineCount > 0 ? (
              <p className="mt-1 text-xs font-semibold text-amber-800">
                {tTemplate(lang, "hospitalityPrepBatchReportPartialSnapshot", {
                  count: String(prepBatches.partialFinancialSnapshotLineCount),
                })}
              </p>
            ) : null}
            {prepBatches.missingReturnCogsCount > 0 ? (
              <p className="mt-1 text-xs font-semibold text-amber-800">
                {tTemplate(lang, "hospitalityPrepBatchReportMissingReturnCogs", {
                  count: String(prepBatches.missingReturnCogsCount),
                })}
              </p>
            ) : null}
            {prepBatches.unattributedReturnCount > 0 ? (
              <p className="mt-1 text-xs font-semibold text-amber-800">
                {tTemplate(lang, "hospitalityPrepBatchReportUnattributedReturns", {
                  count: String(prepBatches.unattributedReturnCount),
                })}
              </p>
            ) : null}
            {prepBatches.cancelledPortionsUnknownBatchCount > 0 ? (
              <p className="mt-1 text-xs font-semibold text-amber-800">
                {tTemplate(lang, "hospitalityPrepBatchReportCancelledUnknown", {
                  count: String(prepBatches.cancelledPortionsUnknownBatchCount),
                })}
              </p>
            ) : null}
          </>
        )}
        {prepBatches.rows.length > 0 && prepYieldUnknownCount > 0 ? (
          <p className="mt-2 text-xs font-semibold text-amber-800">
            {tTemplate(lang, "hospitalityPrepBatchReportYieldUnknown", {
              count: String(prepYieldUnknownCount),
            })}
          </p>
        ) : null}
        {prepBatches.rows.length > 0 && prepBatches.legacyBatchCount > 0 ? (
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {tTemplate(lang, "hospitalityPrepBatchReportLegacy", {
              count: String(prepBatches.legacyBatchCount),
            })}
          </p>
        ) : null}
        {prepBatches.undatedBatchCount > 0 ? (
          <p className="mt-1 text-xs font-semibold text-amber-800">
            {tTemplate(lang, "hospitalityPrepBatchReportUndated", {
              count: String(prepBatches.undatedBatchCount),
            })}
          </p>
        ) : null}
        {prepBatches.outsideRangeBatchCount > 0 ? (
          <p className="mt-1 text-xs font-semibold text-muted-foreground">
            {tTemplate(lang, "hospitalityPrepBatchReportOutsideRange", {
              count: String(prepBatches.outsideRangeBatchCount),
            })}
          </p>
        ) : null}
      </div>
      <div className="rounded-2xl border border-waka-200 bg-card p-3">
        <p className="text-xs font-black uppercase text-muted-foreground">
          {t(lang, "hospitalityIngredientDemandTitle")}
        </p>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {t(lang, "hospitalityIngredientDemandHint")}
        </p>
        {demand.rows.length === 0 && !hasDemandGaps ? (
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            {t(lang, "hospitalityIngredientDemandEmpty")}
          </p>
        ) : (
          <>
            {demand.rows.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {demand.rows.map((row) => (
                  <li
                    key={`${row.ingredientId}:${row.unit}`}
                    className="flex items-start justify-between gap-2 text-sm font-semibold text-foreground"
                  >
                    <span className="min-w-0 truncate">{row.name}</span>
                    <span className="shrink-0 text-right text-xs text-muted-foreground">
                      {formatIngredientDemandQty(row.quantityBase)} {row.unit} ·{" "}
                      {row.costStatus === "trusted"
                        ? `UGX ${(row.estimatedCostUgx ?? 0).toLocaleString()}`
                        : t(lang, "hospitalityIngredientDemandCostUnavailable")}
                      {" · "}
                      {tTemplate(lang, "hospitalityIngredientDemandDishCount", {
                        count: String(row.dishCount),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {hasDemandGaps ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-black uppercase text-amber-900">
                  {t(lang, "hospitalityIngredientDemandGapsTitle")}
                </p>
                <ul className="mt-1 space-y-1 text-xs font-semibold text-amber-950">
                  {demand.noRecipeDishes.map((row) => (
                    <li key={`${row.reason}:${row.productId}`}>
                      {tTemplate(
                        lang,
                        row.reason === "missing_product"
                          ? "hospitalityIngredientDemandMissingProduct"
                          : "hospitalityIngredientDemandNoRecipe",
                        { name: row.name, units: String(row.unitsSold) },
                      )}
                    </li>
                  ))}
                  {demand.missingIngredients.map((gap) => (
                    <li key={`${gap.ingredientId}:${gap.unit}`}>
                      {tTemplate(lang, "hospitalityIngredientDemandMissingIngredient", {
                        name: gap.ingredientId,
                        quantity: formatIngredientDemandQty(gap.quantityBase),
                        unit: gap.unit ? ` ${gap.unit}` : "",
                        count: String(gap.dishCount),
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
      <div className="rounded-2xl border border-amber-200 bg-card p-3">
        <p className="text-xs font-black uppercase text-muted-foreground">
          {t(lang, "hospitalityCancelledItemsTitle")}
        </p>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {t(lang, "hospitalityCancelledItemsHint")}
        </p>
        {cancellations.rows.length === 0 ? (
          <p className="mt-2 text-sm font-semibold text-muted-foreground">
            {t(lang, "hospitalityCancelledItemsEmpty")}
          </p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                {
                  label: t(lang, "hospitalityCancelledLineVoids"),
                  value: cancellations.lineVoidCount,
                  className: "text-foreground",
                },
                {
                  label: t(lang, "hospitalityCancelledWholeBillVoids"),
                  value: cancellations.wholeBillVoidCount,
                  className: "text-amber-800",
                },
                {
                  label: t(lang, "hospitalityCancelledKitchenCancellations"),
                  value: cancellations.kitchenCancellationCount,
                  className: "text-muted-foreground",
                },
              ].map((tile) => (
                <article key={tile.label} className="rounded-xl bg-muted/60 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                    {tile.label}
                  </p>
                  <p className={`mt-0.5 text-lg font-black ${tile.className}`}>{tile.value}</p>
                </article>
              ))}
            </div>
            <p className="mt-2 text-xs font-semibold text-muted-foreground">
              {tTemplate(lang, "hospitalityCancelledSummaryCount", {
                count: String(cancellations.rows.length),
              })}{" "}
              · {t(lang, "hospitalityCancelledRecordedValue")}: UGX{" "}
              {cancellations.totalRecordedValueUgx.toLocaleString()} ·{" "}
              {t(lang, "hospitalityCancelledSaleTimeCost")}: UGX{" "}
              {cancellations.totalSaleTimeCostUgx.toLocaleString()} (
              {tTemplate(lang, "hospitalityCancelledSnapshotCoverage", {
                count: String(cancellations.saleTimeCostRowCount),
              })}
              )
            </p>
            <ul className="mt-2 space-y-2">
              {cancellations.rows.map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border border-border/70 bg-muted/30 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-foreground">
                        {row.productName} · {formatIngredientDemandQty(row.quantity)}
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-muted-foreground">
                        {hospitalityCancellationSourceLabel(lang, row.source)} ·{" "}
                        {formatHospitalityCancellationTime(row.occurredAt)}
                        {row.contextLabel ? ` · ${row.contextLabel}` : ""}
                        {row.ticketNumber != null
                          ? ` · ${tTemplate(lang, "hospitalityCancelledTicketLabel", {
                              number: String(row.ticketNumber),
                            })}`
                          : ""}
                        {row.actorLabel ? ` · ${row.actorLabel}` : ""}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-amber-950">
                        {hospitalityCancellationReasonLabel(lang, row)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs font-semibold text-muted-foreground">
                      {row.recordedValueUgx != null ? (
                        <p>
                          {t(lang, "hospitalityCancelledRecordedValue")}: UGX{" "}
                          {row.recordedValueUgx.toLocaleString()}
                        </p>
                      ) : null}
                      {row.saleTimeCostUgx != null ? (
                        <p>
                          {row.saleTimeCostBasis === "partial"
                            ? t(lang, "hospitalityCancelledSaleTimeCostPartial")
                            : t(lang, "hospitalityCancelledSaleTimeCost")}
                          : UGX {row.saleTimeCostUgx.toLocaleString()}
                        </p>
                      ) : (
                        <p>
                          {row.source === "kitchen_ticket"
                            ? t(lang, "hospitalityCancelledNoSnapshot")
                            : t(lang, "hospitalityCancelledCostNotRecorded")}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-2 text-[11px] font-medium text-muted-foreground">
          {t(lang, "hospitalityCancelledValueNote")}
        </p>
      </div>
      {hospitalityReports.waiters.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "hospitalityReportsWaiters")}</p>
          <ul className="mt-2 space-y-1">
            {hospitalityReports.waiters.slice(0, 8).map((w) => (
              <li key={w.waiterId} className="flex justify-between text-sm font-semibold text-foreground">
                <span>{w.label}</span>
                <span>
                  {w.billCount} · UGX {w.revenueUgx.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {hospitalityReports.peakHours.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "hospitalityReportsPeak")}</p>
          <ul className="mt-2 space-y-1">
            {hospitalityReports.peakHours
              .slice()
              .sort((a, b) => b.revenueUgx - a.revenueUgx)
              .slice(0, 6)
              .map((h) => (
                <li key={h.hour} className="flex justify-between text-sm font-semibold text-foreground">
                  <span>{h.label}</span>
                  <span>
                    {h.billCount} · UGX {h.revenueUgx.toLocaleString()}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
      {hospitalityReports.tables.length > 0 ? (
        <div className="rounded-2xl border border-border bg-card p-3">
          <p className="text-xs font-black uppercase text-muted-foreground">{t(lang, "hospitalityReportsTables")}</p>
          <ul className="mt-2 space-y-1">
            {hospitalityReports.tables
              .slice()
              .sort((a, b) => b.revenueUgx - a.revenueUgx)
              .slice(0, 8)
              .map((row) => (
                <li key={row.label} className="flex justify-between text-sm font-semibold text-foreground">
                  <span>{row.label}</span>
                  <span>
                    {row.billCount} · UGX {row.revenueUgx.toLocaleString()}
                  </span>
                </li>
              ))}
          </ul>
        </div>
      ) : null}
      <div className="rounded-2xl border border-border bg-card p-3">
        <p className="text-xs font-black uppercase text-muted-foreground">
          {t(lang, "hospitalityTableServiceTitle")}
        </p>
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {t(lang, "hospitalityTableServiceHint")}
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            {
              label: t(lang, "hospitalityTableServiceCompleted"),
              value: String(tableService.completedCount),
              className: "text-foreground",
            },
            {
              label: t(lang, "hospitalityTableServiceAvgDuration"),
              value:
                tableService.averageCompletedDurationMinutes != null
                  ? formatHospitalityDurationMinutes(tableService.averageCompletedDurationMinutes)
                  : "—",
              className: "text-foreground",
            },
            {
              label: t(lang, "hospitalityTableServiceOpenNow"),
              value: String(tableService.openCount),
              className: "text-amber-800",
            },
            {
              label: t(lang, "hospitalityTableServiceMissingEnd"),
              value: String(tableService.missingEndEvidenceCount),
              className:
                tableService.missingEndEvidenceCount > 0
                  ? "text-rose-700"
                  : "text-muted-foreground",
            },
          ].map((tile) => (
            <article key={tile.label} className="rounded-xl bg-muted/60 px-3 py-2">
              <p className="text-[10px] font-black uppercase tracking-wide text-muted-foreground">
                {tile.label}
              </p>
              <p className={`mt-0.5 text-lg font-black ${tile.className}`}>{tile.value}</p>
            </article>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-3">
            <p className="text-xs font-black uppercase text-muted-foreground">
              {t(lang, "hospitalityTableServiceByTable")}
            </p>
            {tableService.completedByTable.length === 0 ? (
              <p className="mt-2 text-sm font-semibold text-muted-foreground">
                {t(lang, "hospitalityTableServiceNoCompleted")}
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {tableService.completedByTable.map((row) => (
                  <li
                    key={row.tableLabel}
                    className="flex justify-between text-sm font-semibold text-foreground"
                  >
                    <span className="min-w-0 truncate">{row.tableLabel}</span>
                    <span className="shrink-0 text-right text-xs text-muted-foreground">
                      {tTemplate(lang, "hospitalityTableServiceCycles", {
                        count: String(row.completedCount),
                      })}{" "}
                      · {t(lang, "hospitalityTableServiceAvgDuration")}:{" "}
                      {formatHospitalityDurationMinutes(row.averageDurationMinutes)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-2xl border border-border bg-card p-3">
            <p className="text-xs font-black uppercase text-muted-foreground">
              {t(lang, "hospitalityTableServiceOpenTables")}
            </p>
            {tableService.openTables.length === 0 ? (
              <p className="mt-2 text-sm font-semibold text-muted-foreground">
                {t(lang, "hospitalityTableServiceNoOpen")}
              </p>
            ) : (
              <>
                <ul className="mt-2 space-y-1">
                  {tableService.openTables.map((row) => (
                    <li
                      key={row.sessionId}
                      className="flex justify-between text-sm font-semibold text-foreground"
                    >
                      <span className="min-w-0 truncate">
                        {row.tableLabel} ·{" "}
                        {row.status === "payment_pending"
                          ? t(lang, "hospitalityTableServiceStatusPaymentPending")
                          : t(lang, "hospitalityTableServiceStatusOpen")}
                      </span>
                      <span className="shrink-0 text-right text-xs text-muted-foreground">
                        {formatHospitalityDurationMinutes(row.elapsedMinutes)} ·{" "}
                        {tTemplate(lang, "hospitalityTableServiceGuests", {
                          count: String(row.guestCount),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] font-medium text-muted-foreground">
                  {t(lang, "hospitalityTableServiceOpenNote")}
                </p>
              </>
            )}
          </div>
        </div>
        {tableService.missingEndEvidenceCount > 0 || tableService.invalidIntervalCount > 0 ? (
          <p className="mt-2 text-xs font-semibold text-rose-700">
            {tTemplate(lang, "hospitalityTableServiceExcludedNote", {
              missing: String(tableService.missingEndEvidenceCount),
              invalid: String(tableService.invalidIntervalCount),
            })}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-xl border border-waka-300 bg-card px-3 py-2 text-xs font-black text-waka-900" onClick={() => void downloadHospitalityMenuPdf(lang, hospitalityReports, periodLabel)}>
          {t(lang, "hospitalityExportMenuPdf")}
        </button>
        <button type="button" className="rounded-xl bg-waka-700 px-3 py-2 text-xs font-black text-white" onClick={() => void downloadHospitalityWaiterPdf(lang, hospitalityReports)}>
          {t(lang, "hospitalityExportWaiterPdf")}
        </button>
        <button type="button" className="rounded-xl border border-waka-300 bg-card px-3 py-2 text-xs font-black text-waka-900" onClick={() => void downloadHospitalityKitchenPdf(lang, hospitalityReports, periodLabel)}>
          {t(lang, "hospitalityExportKitchenPdf")}
        </button>
        <button type="button" className="rounded-xl border border-waka-300 bg-card px-3 py-2 text-xs font-black text-waka-900" onClick={() => void downloadHospitalityTablePdf(lang, hospitalityReports)}>
          {t(lang, "hospitalityExportTablePdf")}
        </button>
      </div>
    </section>
  );
}

type Props = {
  lang: Language;
  products: Product[];
  stockMovements: StockMovement[];
  pharmacyMode: boolean;
  wholesaleMode: boolean;
  canProfit?: boolean;
  pharmacyExpiryReport: PharmacyExpiryReport | null;
  wholesaleSection: {
    debtOutstanding: number;
    count: number;
    stockValueAtCost: number;
    customers: Customer[];
  } | null;
  hospitalityReports: HospitalityReportSummary | null;
  hospitalityOpenBills: { count: number; totalUgx: number } | null;
  hospitalityFloor?: HospitalityFloorState | null;
  periodLabel?: string;
};

/** @deprecated Prefer registry widgets — kept for composition tests. */
export function AnalyticsModeReports({
  lang,
  products,
  stockMovements,
  pharmacyMode,
  wholesaleMode,
  pharmacyExpiryReport,
  wholesaleSection,
  hospitalityReports,
  hospitalityOpenBills,
  hospitalityFloor,
  periodLabel,
  canProfit = false,
}: Props) {
  const pharmacySection =
    pharmacyExpiryReport && pharmacyMode && !wholesaleMode ? (
      <PharmacyReportsSection lang={lang} products={products} stockMovements={stockMovements} pharmacyExpiryReport={pharmacyExpiryReport} canProfit={canProfit} />
    ) : null;

  const wholesalePanel = wholesaleSection && wholesaleMode ? (
    <WholesaleReportsSection lang={lang} wholesaleSection={wholesaleSection} canProfit={canProfit} />
  ) : null;

  const hospitalityPanel = hospitalityReports ? (
    <HospitalityReportsSection
      lang={lang}
      periodLabel={periodLabel}
      hospitalityReports={hospitalityReports}
      hospitalityOpenBills={hospitalityOpenBills}
      hospitalityFloor={hospitalityFloor}
    />
  ) : null;

  if (!pharmacySection && !wholesalePanel && !hospitalityPanel) return null;

  return (
    <>
      {pharmacySection}
      {wholesalePanel}
      {hospitalityPanel}
    </>
  );
}
