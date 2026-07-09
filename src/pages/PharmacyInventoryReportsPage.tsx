import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { isPharmacyMode } from "../lib/pharmacy";
import { computePharmacyInventoryReports } from "../lib/pharmacyInventoryReports";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { formatUgx } from "../lib/formatUgx";

export function PharmacyInventoryReportsPage({ lang }: { lang: Language }) {
  const preferences = usePosStore((s) => s.preferences);
  const products = usePosStore((s) => s.products);

  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const report = useMemo(() => computePharmacyInventoryReports(products), [products]);

  if (!pharmacy) return null;

  const tiles = [
    { labelKey: "pharmacyReportInventoryValue", value: formatUgx(report.inventoryValueUgx) },
    { labelKey: "pharmacyReportExpiryLoss", value: formatUgx(report.expiryLossUgx) },
    { labelKey: "pharmacyReportBatchCount", value: String(report.batchCount) },
    { labelKey: "pharmacyReportMedicineCount", value: String(report.medicineCount) },
    { labelKey: "pharmacyReportNearExpiryValue", value: formatUgx(report.nearExpiryValueUgx) },
    { labelKey: "pharmacyReportControlled", value: String(report.controlledCount) },
  ];

  return (
    <EnterprisePageContainer>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-stone-950">{t(lang, "pharmacyInventoryReports")}</h1>
          <p className="mt-1 text-base font-medium text-stone-500">{t(lang, "pharmacyInventoryReportsSub")}</p>
        </div>
        <Link
          to="/pharmacy/expiry"
          className="inline-flex min-h-[44px] items-center rounded-2xl bg-teal-600 px-4 text-sm font-black text-white"
        >
          {t(lang, "pharmacyExpiryCenterTitle")}
        </Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.labelKey} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-waka-sm">
            <p className="text-xs font-black uppercase text-stone-500">{t(lang, tile.labelKey)}</p>
            <p className="mt-1 text-2xl font-black text-stone-950">{tile.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
          <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyDashTopMedicines")}</h2>
          <ul className="mt-3 space-y-2">
            {report.topMedicines.map((m) => (
              <li key={m.productId} className="flex justify-between gap-2 text-sm font-semibold">
                <span className="truncate text-stone-900">{m.name}</span>
                <span className="shrink-0 text-teal-800">{formatUgx(m.valueUgx)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-3xl border border-stone-200 bg-white p-4 shadow-waka-sm">
          <h2 className="text-lg font-black text-stone-950">{t(lang, "pharmacyReportSlowMovers")}</h2>
          <ul className="mt-3 space-y-2">
            {report.slowMovers.map((m) => (
              <li key={m.productId} className="flex justify-between gap-2 text-sm font-semibold">
                <span className="truncate text-stone-900">{m.name}</span>
                <span className="shrink-0 text-stone-600">{m.stockOnHand}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </EnterprisePageContainer>
  );
}
