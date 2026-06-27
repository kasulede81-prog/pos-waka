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
import type { StockMovement } from "../../../types";

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
};

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
}: Props) {
  const pharmacySection =
    pharmacyExpiryReport && pharmacyMode && !wholesaleMode ? (
      <section className="space-y-4 rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
        <h2 className="text-lg font-black text-emerald-950">{t(lang, "pharmacyReportsTitle")}</h2>
        <p className="text-sm font-semibold text-stone-700">{t(lang, "pharmacyReportsPrimaryHint")}</p>
        <div className="rounded-2xl border border-stone-200 bg-white p-3">
          <StockMovementsPanel lang={lang} movements={stockMovements} pharmacyMode />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-xl bg-emerald-700 px-3 py-2 text-xs font-black text-white" onClick={() => void downloadPharmacyExpiryPdf(lang, products)}>
            {t(lang, "pharmacyExportPdf")}
          </button>
          <button type="button" className="rounded-xl border border-emerald-300 bg-white px-3 py-2 text-xs font-black text-emerald-900" onClick={() => void downloadPharmacyExpiryCsv(products)}>
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
    ) : null;

  const wholesalePanel = wholesaleSection && wholesaleMode ? (
    <section className="space-y-4 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm">
      <h2 className="text-lg font-black text-indigo-950">{t(lang, "wholesaleReportsHubTitle")}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl border border-indigo-100 bg-white p-3">
          <p className="text-xs font-black uppercase text-stone-500">{t(lang, "wholesaleReportsReceivables")}</p>
          <p className="mt-1 text-xl font-black text-indigo-950">UGX {wholesaleSection.debtOutstanding.toLocaleString()}</p>
        </article>
        <article className="rounded-2xl border border-indigo-100 bg-white p-3">
          <p className="text-xs font-black uppercase text-stone-500">{t(lang, "wholesaleReportsInvoiceVolume")}</p>
          <p className="mt-1 text-xl font-black text-indigo-950">{wholesaleSection.count}</p>
        </article>
        <article className="rounded-2xl border border-indigo-100 bg-white p-3">
          <p className="text-xs font-black uppercase text-stone-500">{t(lang, "wholesaleReportsWarehouseValue")}</p>
          <p className="mt-1 text-xl font-black text-indigo-950">UGX {wholesaleSection.stockValueAtCost.toLocaleString()}</p>
        </article>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-xl bg-indigo-700 px-3 py-2 text-xs font-black text-white" onClick={() => void downloadWholesaleReceivablesPdf(lang, wholesaleReceivablesRows(wholesaleSection.customers), wholesaleSection.debtOutstanding)}>
          {t(lang, "wholesaleExportReceivablesPdf")}
        </button>
        <button type="button" className="rounded-xl border border-indigo-300 bg-white px-3 py-2 text-xs font-black text-indigo-900" onClick={() => void downloadWholesaleReceivablesCsv(wholesaleReceivablesRows(wholesaleSection.customers))}>
          {t(lang, "wholesaleExportReceivablesCsv")}
        </button>
        <button type="button" className="rounded-xl border border-indigo-300 bg-white px-3 py-2 text-xs font-black text-indigo-900" onClick={() => void downloadWholesaleDebtorListPdf(lang, wholesaleReceivablesRows(wholesaleSection.customers))}>
          {t(lang, "wholesaleExportDebtorsPdf")}
        </button>
      </div>
    </section>
  ) : null;

  const hospitalityPanel = hospitalityReports ? (
    <section className="space-y-4 rounded-2xl border border-waka-200 bg-waka-50/40 p-4 shadow-sm">
      <h2 className="text-lg font-black text-waka-950">{t(lang, "hospitalityReportsTitle")}</h2>
      <p className="text-sm font-semibold text-stone-700">
        {hospitalityReports.completedBillCount} bills · UGX {hospitalityReports.totalRevenueUgx.toLocaleString()}
      </p>
      {hospitalityOpenBills && hospitalityOpenBills.count > 0 ? (
        <article className="rounded-2xl border border-amber-200 bg-amber-50/80 p-3">
          <p className="text-xs font-black uppercase text-amber-900">{t(lang, "hospitalityReportsOpenBills")}</p>
          <p className="mt-1 text-lg font-black text-amber-950">
            {hospitalityOpenBills.count} · UGX {hospitalityOpenBills.totalUgx.toLocaleString()}
          </p>
        </article>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="rounded-xl bg-waka-700 px-3 py-2 text-xs font-black text-white" onClick={() => void downloadHospitalityWaiterPdf(lang, hospitalityReports)}>
          {t(lang, "hospitalityExportWaiterPdf")}
        </button>
        <button type="button" className="rounded-xl border border-waka-300 bg-white px-3 py-2 text-xs font-black text-waka-900" onClick={() => void downloadHospitalityKitchenPdf(lang, hospitalityReports)}>
          {t(lang, "hospitalityExportKitchenPdf")}
        </button>
        <button type="button" className="rounded-xl border border-waka-300 bg-white px-3 py-2 text-xs font-black text-waka-900" onClick={() => void downloadHospitalityTablePdf(lang, hospitalityReports)}>
          {t(lang, "hospitalityExportTablePdf")}
        </button>
      </div>
    </section>
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
