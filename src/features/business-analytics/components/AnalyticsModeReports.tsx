import type { Customer, Language, Product } from "../../../types";
import { t } from "../../../lib/i18n";
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
  downloadHospitalityTablePdf,
  downloadHospitalityWaiterPdf,
} from "../../../lib/hospitalityDocumentExports";
import type { PharmacyExpiryReport } from "../../../lib/pharmacyReports";
import type { HospitalityReportSummary } from "../../../lib/hospitalityReports";
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
}: {
  lang: Language;
  products: Product[];
  stockMovements: StockMovement[];
  pharmacyExpiryReport: PharmacyExpiryReport;
  periodLabel?: string;
}) {
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
        <button type="button" className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white" onClick={() => void downloadPharmacyExpiryPdf(lang, products)}>
          {t(lang, "pharmacyExportPdf")}
        </button>
        <button type="button" className="rounded-xl border border-emerald-300 bg-card px-3 py-2 text-xs font-black text-emerald-900" onClick={() => void downloadPharmacyExpiryCsv(products)}>
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
}: {
  lang: Language;
  wholesaleSection: {
    debtOutstanding: number;
    count: number;
    stockValueAtCost: number;
    customers: Customer[];
  };
}) {
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
          <p className="mt-1 text-xl font-black text-indigo-950">UGX {wholesaleSection.stockValueAtCost.toLocaleString()}</p>
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

export function HospitalityReportsSection({
  lang,
  hospitalityReports,
  hospitalityOpenBills,
  hospitalityFloor,
}: {
  lang: Language;
  hospitalityReports: HospitalityReportSummary;
  hospitalityOpenBills: { count: number; totalUgx: number } | null;
  hospitalityFloor?: HospitalityFloorState | null;
}) {
  const kitchenAnalytics = hospitalityFloor ? computeKitchenProductionAnalytics(hospitalityFloor) : null;
  const reservationCount =
    hospitalityFloor?.reservations?.filter((r) => r.status !== "cancelled").length ?? 0;
  const waitlistCount = hospitalityFloor?.waitlist?.filter((w) => w.status !== "cancelled").length ?? 0;

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
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-xl bg-waka-700 px-3 py-2 text-xs font-black text-white" onClick={() => void downloadHospitalityWaiterPdf(lang, hospitalityReports)}>
          {t(lang, "hospitalityExportWaiterPdf")}
        </button>
        <button type="button" className="rounded-xl border border-waka-300 bg-card px-3 py-2 text-xs font-black text-waka-900" onClick={() => void downloadHospitalityKitchenPdf(lang, hospitalityReports)}>
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
}: Props) {
  const pharmacySection =
    pharmacyExpiryReport && pharmacyMode && !wholesaleMode ? (
      <PharmacyReportsSection lang={lang} products={products} stockMovements={stockMovements} pharmacyExpiryReport={pharmacyExpiryReport} />
    ) : null;

  const wholesalePanel = wholesaleSection && wholesaleMode ? (
    <WholesaleReportsSection lang={lang} wholesaleSection={wholesaleSection} />
  ) : null;

  const hospitalityPanel = hospitalityReports ? (
    <HospitalityReportsSection
      lang={lang}
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
