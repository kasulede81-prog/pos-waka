import { useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import clsx from "clsx";
import type { Language } from "../types";
import { t } from "../lib/i18n";
import { PageBackBar } from "../components/layout/PageBackBar";
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

type SortMode = "lowest_cost" | "highest_margin";

function severityBadgeClass(severity: FinanceDiagnosticSeverity): string {
  if (severity === "critical") return "bg-rose-100 text-rose-900 border-rose-200";
  if (severity === "warning") return "bg-amber-100 text-amber-950 border-amber-200";
  return "bg-emerald-100 text-emerald-900 border-emerald-200";
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
    <div className="space-y-5 pb-8">
      <PageBackBar lang={lang} fallbackTo="/settings" />
      <div>
        <h1 className="text-2xl font-black text-stone-950">{t(lang, "financeDiagnosticsTitle")}</h1>
        <p className="mt-1 text-sm font-medium text-stone-600">{t(lang, "financeDiagnosticsSub")}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {healthCards.map(({ key, labelKey, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={clsx(
              "rounded-2xl border p-3 text-left transition",
              filter === key
                ? "border-waka-500 bg-waka-50 shadow-waka-sm"
                : "border-stone-200 bg-white hover:border-stone-300",
            )}
          >
            <p className="text-2xl font-black tabular-nums text-stone-900">{count}</p>
            <p className="mt-1 text-[11px] font-bold leading-tight text-stone-600">{t(lang, labelKey)}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {filterChips.map(({ key, labelKey }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={clsx(
              "rounded-full border px-2.5 py-1 text-xs font-bold",
              filter === key
                ? "border-waka-500 bg-waka-600 text-white"
                : "border-stone-200 bg-white text-stone-700",
            )}
          >
            {t(lang, labelKey)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["lowest_cost", "financeDiagnosticsSortLowestCost"],
            ["highest_margin", "financeDiagnosticsSortHighestMargin"],
          ] as const
        ).map(([mode, labelKey]) => (
          <button
            key={mode}
            type="button"
            onClick={() => setSort(mode)}
            className={clsx(
              "rounded-full border px-3 py-1.5 text-sm font-bold",
              sort === mode
                ? "border-stone-400 bg-stone-800 text-white"
                : "border-stone-200 bg-white text-stone-700",
            )}
          >
            {t(lang, labelKey)}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-stone-200 bg-stone-50 px-4 py-8 text-center text-sm font-semibold text-stone-600">
          {t(lang, "financeDiagnosticsEmpty")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-waka-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-stone-100 bg-stone-50 text-[11px] font-black uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2.5">{t(lang, "financeDiagnosticsColProduct")}</th>
                <th className="px-3 py-2.5">{t(lang, "financeDiagnosticsColStatus")}</th>
                <th className="px-3 py-2.5 text-right">{t(lang, "financeDiagnosticsColStock")}</th>
                <th className="px-3 py-2.5 text-right">{t(lang, "financeDiagnosticsColUnitCost")}</th>
                <th className="px-3 py-2.5 text-right">{t(lang, "financeDiagnosticsColSellPrice")}</th>
                <th className="px-3 py-2.5 text-right">{t(lang, "financeDiagnosticsColStockValue")}</th>
                <th className="px-3 py-2.5 text-right">{t(lang, "financeDiagnosticsColMargin")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.productId} className="border-b border-stone-50 last:border-0">
                  <td className="max-w-[10rem] truncate px-3 py-2.5 font-bold text-stone-900">{row.name}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={clsx(
                        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase",
                        severityBadgeClass(row.severity),
                      )}
                    >
                      {severityLabel(lang, row.severity)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-stone-700">
                    {row.stockOnHand}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-stone-700">
                    {row.unitCostUgx.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-stone-700">
                    {row.sellPriceUgx.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-violet-800">
                    {row.stockValueUgx.toLocaleString()}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-bold text-stone-800">
                    {row.marginPct != null ? `${row.marginPct}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
