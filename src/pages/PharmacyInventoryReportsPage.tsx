import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Package, AlertTriangle, Layers, Pill, Clock, ShieldAlert } from "lucide-react";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { usePosStore } from "../store/usePosStore";
import { useSessionActor } from "../context/SessionActorContext";
import { useSubscription } from "../context/SubscriptionContext";
import { authOperatorPermissions, authOperatorRole } from "../lib/sessionActor";
import { resolveProfitVisibility } from "../lib/profitVisibility";
import { isPharmacyMode } from "../lib/pharmacy";
import {
  computePharmacyInventoryReports,
  presentPharmacyInventoryReports,
  type PharmacyInventoryCostField,
} from "../lib/pharmacyInventoryReports";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { EnterpriseKpiCard } from "../components/enterprise/EnterpriseKpiCard";
import { EnterpriseCard } from "../components/enterprise/EnterpriseCard";
import { EnterpriseDataTable, type EnterpriseDataColumn } from "../components/enterprise/data-table";
import { useWakaLayoutBand } from "../hooks/useWakaLayoutBand";
import { formatUgx } from "../lib/formatUgx";
import { enterpriseSpace } from "../lib/enterpriseSpacing";
import { themeUi } from "../lib/themeTokens";
import clsx from "clsx";

type MedicineRow = { productId: string; name: string; valueUgx?: number; stockOnHand?: number };

function costFieldDisplay(lang: Language, field: PharmacyInventoryCostField) {
  if (!field.visible) {
    return { value: t(lang, "baProfitLockedTitle"), hint: t(lang, "baProfitLockedBody") };
  }
  return { value: formatUgx(field.valueUgx) };
}

export function PharmacyInventoryReportsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const { snapshot, authMode } = useSubscription();
  const preferences = usePosStore((s) => s.preferences);
  const products = usePosStore((s) => s.products);
  const desktopTable = useWakaLayoutBand() === "desktop";

  const { canProfit } = resolveProfitVisibility({
    role: authOperatorRole(actor),
    snapshot,
    authMode,
    actorPermissions: authOperatorPermissions(actor),
  });

  const pharmacy = isPharmacyMode(preferences.businessType, preferences.pharmacyModeEnabled);
  const report = useMemo(
    () => presentPharmacyInventoryReports(computePharmacyInventoryReports(products), canProfit),
    [products, canProfit],
  );

  const inventoryValue = costFieldDisplay(lang, report.inventoryValue);
  const expiryLoss = costFieldDisplay(lang, report.expiryLoss);
  const nearExpiryValue = costFieldDisplay(lang, report.nearExpiryValue);

  const topColumns: EnterpriseDataColumn<MedicineRow>[] = useMemo(() => {
    const columns: EnterpriseDataColumn<MedicineRow>[] = [
      {
        id: "name",
        header: t(lang, "inventoryTableProduct"),
        width: "minmax(160px,2fr)",
        cell: (row) => row.name,
      },
    ];
    if (canProfit) {
      columns.push({
        id: "value",
        header: t(lang, "pharmacyReportInventoryValue"),
        width: "minmax(100px,1fr)",
        align: "right",
        cell: (row) => (row.valueUgx == null ? t(lang, "baProfitLockedTitle") : formatUgx(row.valueUgx)),
      });
    }
    return columns;
  }, [lang, canProfit]);

  const slowColumns: EnterpriseDataColumn<MedicineRow>[] = useMemo(
    () => [
      {
        id: "name",
        header: t(lang, "inventoryTableProduct"),
        width: "minmax(160px,2fr)",
        cell: (row) => row.name,
      },
      {
        id: "stock",
        header: t(lang, "inventoryTableStock"),
        width: "minmax(80px,1fr)",
        align: "right",
        cell: (row) => String(row.stockOnHand ?? 0),
      },
    ],
    [lang],
  );

  if (!pharmacy) return null;

  const tiles = [
    { labelKey: "pharmacyReportInventoryValue", value: inventoryValue.value, hint: inventoryValue.hint, icon: Package, tone: "highlight" as const },
    { labelKey: "pharmacyReportExpiryLoss", value: expiryLoss.value, hint: expiryLoss.hint, icon: AlertTriangle, tone: "warning" as const },
    { labelKey: "pharmacyReportBatchCount", value: String(report.batchCount), icon: Layers, tone: "default" as const },
    { labelKey: "pharmacyReportMedicineCount", value: String(report.medicineCount), icon: Pill, tone: "default" as const },
    { labelKey: "pharmacyReportNearExpiryValue", value: nearExpiryValue.value, hint: nearExpiryValue.hint, icon: Clock, tone: "warning" as const },
    { labelKey: "pharmacyReportControlled", value: String(report.controlledCount), icon: ShieldAlert, tone: "danger" as const },
  ];

  return (
    <EnterprisePageContainer className={enterpriseSpace.pageStack}>
      <EnterprisePageHeader
        lang={lang}
        title={t(lang, "pharmacyInventoryReports")}
        subtitle={t(lang, "pharmacyInventoryReportsSub")}
        backFallback="/pharmacy/inventory"
        backLabel={t(lang, "ipPageTitle")}
        compact
      >
        <Link
          to="/pharmacy/expiry"
          className={clsx(themeUi.btnPrimary, "inline-flex min-h-[44px] items-center px-4 text-sm")}
        >
          {t(lang, "pharmacyExpiryCenterTitle")}
        </Link>
      </EnterprisePageHeader>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <EnterpriseKpiCard
            key={tile.labelKey}
            icon={tile.icon}
            label={t(lang, tile.labelKey)}
            value={tile.value}
            hint={tile.hint}
            tone={tile.tone}
          />
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <EnterpriseCard title={t(lang, "pharmacyDashTopMedicines")}>
          {desktopTable ? (
            <EnterpriseDataTable
              rows={report.topMedicines}
              columns={topColumns}
              rowKey={(m) => m.productId}
              minWidthPx={420}
              estimateRowHeight={44}
              ariaLabel={t(lang, "pharmacyDashTopMedicines")}
            />
          ) : (
            <ul className="mt-1 space-y-2">
              {report.topMedicines.map((m) => (
                <li key={m.productId} className="flex justify-between gap-2 text-sm font-semibold">
                  <span className="truncate text-foreground">{m.name}</span>
                  {m.valueUgx != null ? (
                    <span className="shrink-0 text-primary">{formatUgx(m.valueUgx)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </EnterpriseCard>
        <EnterpriseCard title={t(lang, "pharmacyReportSlowMovers")}>
          {desktopTable ? (
            <EnterpriseDataTable
              rows={report.slowMovers}
              columns={slowColumns}
              rowKey={(m) => m.productId}
              minWidthPx={420}
              estimateRowHeight={44}
              ariaLabel={t(lang, "pharmacyReportSlowMovers")}
            />
          ) : (
            <ul className="mt-1 space-y-2">
              {report.slowMovers.map((m) => (
                <li key={m.productId} className="flex justify-between gap-2 text-sm font-semibold">
                  <span className="truncate text-foreground">{m.name}</span>
                  <span className="shrink-0 text-muted-foreground">{m.stockOnHand}</span>
                </li>
              ))}
            </ul>
          )}
        </EnterpriseCard>
      </section>
    </EnterprisePageContainer>
  );
}
