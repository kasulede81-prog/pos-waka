import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { EnterprisePageContainer } from "../components/layout/EnterprisePageContainer";
import { EnterprisePageHeader } from "../components/enterprise/EnterprisePageHeader";
import { ResponsiveDataTable } from "../components/shared/ResponsiveDataTable";
import { WakaButton } from "../components/ui/wakaPrimitives";
import { useSessionActor } from "../context/SessionActorContext";
import { canSeeFinanceDiagnostics } from "../lib/financeVisibility";
import { usePosStore } from "../store/usePosStore";
import {
  buildFinanceDiagnosticRows,
  filterFinanceDiagnosticRows,
  sortFinanceDiagnosticRows,
  summarizeFinanceHealth,
  type FinanceDiagnosticFilter,
  type FinanceDiagnosticSeverity,
} from "../lib/costValidation";
import { enterpriseTypeClass } from "../lib/enterpriseTypography";
import { healthStatusBadge } from "../lib/statusTokens";

type SortMode = "lowest_cost" | "highest_margin";

function severityToHealth(severity: FinanceDiagnosticSeverity): "ok" | "warning" | "critical" {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "warning";
  return "ok";
}

function severityLabel(lang: Language, severity: FinanceDiagnosticSeverity): string {
  if (severity === "critical") return t(lang, "financeDiagnosticsBadgeCritical");
  if (severity === "warning") return t(lang, "financeDiagnosticsBadgeWarning");
  return t(lang, "financeDiagnosticsBadgeNormal");
}

export function SettingsFinanceDiagnosticsPage({ lang }: { lang: Language }) {
  const actor = useSessionActor();
  const products = usePosStore((s) => s.products);
  const [sort, setSort] = useState<SortMode>("lowest_cost");
  const [filter, setFilter] = useState<FinanceDiagnosticFilter>("all");

  if (!canSeeFinanceDiagnostics(actor.role)) {
    return <Navigate to="/settings" replace />;
  }

  const allRows = useMemo(() => buildFinanceDiagnosticRows(products), [products]);
  const health = useMemo(() => summarizeFinanceHealth(allRows), [allRows]);

  const rows = useMemo(() => {
    const filtered = filterFinanceDiagnosticRows(allRows, filter);
    return sortFinanceDiagnosticRows(filtered, sort);
  }, [allRows, filter, sort]);

  const healthCards: { key: FinanceDiagnosticFilter; labelKey: string; count: number }[] = [
    { key: "suspicious_cost", labelKey: "financeHealthSuspiciousCost", count: health.suspiciousCost },
    { key: "high_margin", labelKey: "financeHealthHighMargin", count: health.highMargin },
    { key: "negative_margin", labelKey: "financeHealthNegativeMargin", count: health.negativeMargin },
    { key: "missing_cost", labelKey: "financeHealthMissingCost", count: health.missingCost },
    { key: "missing_sell", labelKey: "financeHealthMissingSell", count: health.missingSell },
  ];

  const filterChips: { key: FinanceDiagnosticFilter; labelKey: string }[] = [
    { key: "all", labelKey: "financeFilterAll" },
    { key: "margin_over_80", labelKey: "financeFilterMargin80" },
    { key: "margin_over_90", labelKey: "financeFilterMargin90" },
    { key: "cost_zero", labelKey: "financeFilterCostZero" },
    { key: "sell_zero", labelKey: "financeFilterSellZero" },
    { key: "unit_cost_under_10pct", labelKey: "financeFilterUnitCostLow" },
    { key: "negative_margin", labelKey: "financeFilterNegativeMargin" },
  ];

  return (
    <EnterprisePageContainer>
      <EnterprisePageHeader
        lang={lang}
        title={t(lang, "financeDiagnosticsTitle")}
        subtitle={t(lang, "financeDiagnosticsSub")}
        backFallback="/settings"
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {healthCards.map(({ key, labelKey, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={clsx(
              "rounded-2xl border p-3 text-left transition-waka",
              filter === key
                ? "border-primary bg-business-muted shadow-waka-sm"
                : "border-border bg-card hover:border-border",
            )}
          >
            <p className={enterpriseTypeClass("monoNumber", "text-2xl")}>{count}</p>
            <p className={enterpriseTypeClass("caption", "mt-1 normal-case")}>{t(lang, labelKey)}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {filterChips.map(({ key, labelKey }) => (
          <WakaButton
            key={key}
            type="button"
            size="standard"
            variant={filter === key ? "primary" : "secondary"}
            className={clsx("!min-h-[36px] !rounded-full !px-2.5 !py-1 !text-xs")}
            onClick={() => setFilter(key)}
          >
            {t(lang, labelKey)}
          </WakaButton>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["lowest_cost", "financeDiagnosticsSortLowestCost"],
            ["highest_margin", "financeDiagnosticsSortHighestMargin"],
          ] as const
        ).map(([mode, labelKey]) => (
          <WakaButton
            key={mode}
            type="button"
            variant={sort === mode ? "primary" : "secondary"}
            className="!rounded-full"
            onClick={() => setSort(mode)}
          >
            {t(lang, labelKey)}
          </WakaButton>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-muted px-4 py-8 text-center text-sm font-semibold text-muted-foreground">
          {t(lang, "financeDiagnosticsEmpty")}
        </p>
      ) : (
        <ResponsiveDataTable minWidthPx={720}>
          <thead>
            <tr>
              <th>{t(lang, "financeDiagnosticsColProduct")}</th>
              <th>{t(lang, "financeDiagnosticsColStatus")}</th>
              <th className="text-right">{t(lang, "financeDiagnosticsColStock")}</th>
              <th className="text-right">{t(lang, "financeDiagnosticsColUnitCost")}</th>
              <th className="text-right">{t(lang, "financeDiagnosticsColSellPrice")}</th>
              <th className="text-right">{t(lang, "financeDiagnosticsColStockValue")}</th>
              <th className="text-right">{t(lang, "financeDiagnosticsColMargin")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.productId}>
                <td className="max-w-[10rem] truncate font-bold text-foreground">{row.name}</td>
                <td>
                  <span className={healthStatusBadge(severityToHealth(row.severity))}>
                    {severityLabel(lang, row.severity)}
                  </span>
                </td>
                <td className={enterpriseTypeClass("monoNumber", "text-right text-sm")}>{row.stockOnHand}</td>
                <td className={enterpriseTypeClass("monoNumber", "text-right text-sm text-muted-foreground")}>
                  {row.unitCostUgx.toLocaleString()}
                </td>
                <td className={enterpriseTypeClass("monoNumber", "text-right text-sm text-muted-foreground")}>
                  {row.sellPriceUgx.toLocaleString()}
                </td>
                <td className={enterpriseTypeClass("monoNumber", "text-right text-sm")}>
                  {row.stockValueUgx.toLocaleString()}
                </td>
                <td className={enterpriseTypeClass("monoNumber", "text-right text-sm")}>
                  {row.marginPct != null ? `${row.marginPct}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </ResponsiveDataTable>
      )}
    </EnterprisePageContainer>
  );
}
