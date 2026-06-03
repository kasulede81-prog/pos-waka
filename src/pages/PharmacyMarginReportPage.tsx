import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { hasEffectivePermission } from "../lib/subscriptionEntitlements";
import { isPharmacyMode } from "../lib/pharmacy";
import { PageHeader } from "../components/layout/PageHeader";
import { formatMedicineFullLabel } from "../lib/pharmacyMedicine";
import {
  computeMedicineMarginRows,
  sortMedicineMarginRows,
  type MedicineMarginSort,
} from "../lib/pharmacyCostIntegrity";
import { PharmacyCostWarningBanner } from "../components/pharmacy/PharmacyCostWarningBanner";
import { downloadPharmacyMarginCsv, downloadPharmacyMarginPdf } from "../lib/pharmacyDocumentExports";

type Props = { lang: Language };

export function PharmacyMarginReportPage({ lang }: Props) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const preferences = usePosStore((s) => s.preferences);
  const products = usePosStore((s) => s.products);
  const [sort, setSort] = useState<MedicineMarginSort>("highest_margin");

  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const canReports = hasEffectivePermission(actor.role, "reports.view", snapshot, authMode);
  const canProfit = hasEffectivePermission(actor.role, "reports.profit", snapshot, authMode);

  if (!pharmacy) return <Navigate to="/office" replace />;
  if (!canReports || !canProfit) return <Navigate to="/upgrade" replace />;

  const rows = useMemo(() => sortMedicineMarginRows(computeMedicineMarginRows(products), sort), [products, sort]);

  const sortOptions: { id: MedicineMarginSort; labelKey: string }[] = [
    { id: "highest_margin", labelKey: "pharmacyMarginSortHigh" },
    { id: "lowest_margin", labelKey: "pharmacyMarginSortLow" },
    { id: "largest_inventory_value", labelKey: "pharmacyMarginSortInventory" },
  ];

  return (
    <div className="page-content-pad space-y-5">
      <PageHeader
        lang={lang}
        title={t(lang, "pharmacyMarginReportTitle")}
        subtitle={t(lang, "pharmacyMarginReportSub")}
        backLabel={t(lang, "officeBackToHub")}
        backFallback="/office"
      />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="min-h-[44px] rounded-2xl bg-emerald-700 px-4 text-sm font-black text-white"
          onClick={() => void downloadPharmacyMarginPdf(lang, products)}
        >
          {t(lang, "pharmacyMarginExportPdf")}
        </button>
        <button
          type="button"
          className="min-h-[44px] rounded-2xl border-2 border-emerald-300 bg-white px-4 text-sm font-black text-emerald-900"
          onClick={() => void downloadPharmacyMarginCsv(products)}
        >
          {t(lang, "pharmacyMarginExportCsv")}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {sortOptions.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setSort(opt.id)}
            className={`min-h-[44px] rounded-2xl px-4 text-sm font-black ${
              sort === opt.id ? "bg-waka-600 text-white" : "border-2 border-stone-200 bg-white text-stone-800"
            }`}
          >
            {t(lang, opt.labelKey)}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-stone-50 px-4 py-10 text-center text-sm font-semibold text-stone-500">
          {t(lang, "pharmacyMarginReportEmpty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const product = products.find((p) => p.id === row.productId);
            return (
              <li key={row.productId} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <p className="text-base font-black text-stone-950">
                  {product ? formatMedicineFullLabel(product) : row.name}
                </p>
                <p className="mt-1 text-xs font-semibold text-stone-500">{row.category}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-xs font-bold text-stone-500">{t(lang, "pharmacyMarginColCost")}</dt>
                    <dd className="font-black text-stone-900">UGX {row.costPerUnitUgx.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-stone-500">{t(lang, "pharmacyMarginColSell")}</dt>
                    <dd className="font-black text-stone-900">UGX {row.sellingPricePerUnitUgx.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-stone-500">{t(lang, "pharmacyMarginColMarginUgx")}</dt>
                    <dd className={`font-black ${row.marginUgx < 0 ? "text-rose-700" : "text-emerald-800"}`}>
                      UGX {row.marginUgx.toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-stone-500">{t(lang, "pharmacyMarginColMarginPct")}</dt>
                    <dd className="font-black text-stone-900">
                      {row.marginPercent != null ? `${row.marginPercent}%` : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-bold text-stone-500">{t(lang, "pharmacyMarginColInventory")}</dt>
                    <dd className="font-black text-stone-900">UGX {row.inventoryValueUgx.toLocaleString()}</dd>
                  </div>
                  {row.packagingEnabled ? (
                    <>
                      <div>
                        <dt className="text-xs font-bold text-stone-500">{t(lang, "pharmacyMarginColStockTablets")}</dt>
                        <dd className="font-black text-stone-900">{Math.round(row.stockTablets).toLocaleString()}</dd>
                      </div>
                      {row.stockStrips != null ? (
                        <div>
                          <dt className="text-xs font-bold text-stone-500">{t(lang, "pharmacyMarginColStockStrips")}</dt>
                          <dd className="font-black text-stone-900">
                            {row.stockStrips % 1 === 0 ? row.stockStrips.toLocaleString() : row.stockStrips.toFixed(1)}
                          </dd>
                        </div>
                      ) : null}
                      {row.stockBoxes != null ? (
                        <div>
                          <dt className="text-xs font-bold text-stone-500">{t(lang, "pharmacyMarginColStockBoxes")}</dt>
                          <dd className="font-black text-stone-900">
                            {row.stockBoxes % 1 === 0 ? row.stockBoxes.toLocaleString() : row.stockBoxes.toFixed(1)}
                          </dd>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </dl>
                {product ? <PharmacyCostWarningBanner lang={lang} product={product} className="mt-3" /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
