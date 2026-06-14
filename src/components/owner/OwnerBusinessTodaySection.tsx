import { useState } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerDashboardStats } from "../../lib/ownerDashboardData";
import { OwnerDashboardSection } from "./OwnerDashboardSection";

type FastMover = { name: string; qty: number; revenue: number };

type Props = {
  lang: Language;
  stats: OwnerDashboardStats;
  trendLine: string;
  pulseLabel: string;
  customersCount: number;
  totalDebtUgx: number;
  fastMovers: FastMover[];
  summaryLines: string[];
  waLine: string;
};

function MetricLink({
  to,
  label,
  value,
  hint,
  valueClassName = "text-slate-900",
}: {
  to: string;
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}) {
  return (
    <Link
      to={to}
      className="block rounded-2xl border border-slate-100 bg-slate-50/80 p-4 shadow-sm transition-colors hover:border-waka-200 hover:bg-waka-50/40 active:scale-[0.99]"
    >
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-black sm:text-2xl ${valueClassName}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs font-semibold text-slate-500">{hint}</p> : null}
    </Link>
  );
}

export function OwnerBusinessTodaySection({
  lang,
  stats,
  trendLine,
  pulseLabel,
  customersCount,
  totalDebtUgx,
  fastMovers,
  summaryLines,
  waLine,
}: Props) {
  const [waCopied, setWaCopied] = useState(false);

  const copyWa = () => {
    void navigator.clipboard.writeText(waLine).then(
      () => {
        setWaCopied(true);
        window.setTimeout(() => setWaCopied(false), 2500);
      },
      () => {},
    );
  };

  const topProducts = fastMovers.slice(0, 5);

  return (
    <OwnerDashboardSection
      title={t(lang, "ownerSectionBusinessToday")}
      subtitle={`${pulseLabel} · ${trendLine}`}
      defaultOpen
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricLink
          to="/reports"
          label={t(lang, "ownerCardSalesToday")}
          value={`UGX ${stats.totalSalesUgx.toLocaleString()}`}
          hint={`${stats.saleCount} ${t(lang, "salesCount")} · ${trendLine}`}
        />
        <MetricLink
          to="/office/profit"
          label={t(lang, "estimatedProfit")}
          value={`UGX ${stats.estProfitUgx.toLocaleString()}`}
          hint={stats.estProfitUgx < 0 ? t(lang, "estimatedProfitNegativeHint") : t(lang, "estimatedProfitHint")}
          valueClassName={stats.estProfitUgx < 0 ? "text-slate-600" : "text-waka-800"}
        />
        <MetricLink
          to="/customers"
          label={t(lang, "customers")}
          value={String(customersCount)}
          hint={t(lang, "ownerDebtHint")}
        />
        <MetricLink
          to="/customers"
          label={t(lang, "debtToday")}
          value={`UGX ${totalDebtUgx.toLocaleString()}`}
          hint={`${t(lang, "debtToday")}: UGX ${stats.debtTodayUgx.toLocaleString()}`}
          valueClassName="text-amber-900"
        />
        <MetricLink
          to="/office/cash-position"
          label={t(lang, "ownerCardExpectedCash")}
          value={`UGX ${stats.expectedCashUgx.toLocaleString()}`}
          hint={
            stats.countedCashUgx !== null
              ? `${t(lang, "ownerCardCountedCash")}: UGX ${stats.countedCashUgx.toLocaleString()}`
              : t(lang, "ownerNoCloseYet")
          }
        />
        <Link
          to="/reports"
          className="block rounded-2xl border border-slate-100 bg-slate-50/80 p-4 shadow-sm transition-colors hover:border-waka-200 hover:bg-waka-50/40"
        >
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t(lang, "ownerSectionTopProducts")}</p>
          {topProducts.length === 0 ? (
            <p className="mt-2 text-sm font-semibold text-slate-500">{t(lang, "noSalesYet")}</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {topProducts.map((m) => (
                <li key={m.name} className="flex justify-between gap-2 text-sm font-semibold">
                  <span className="min-w-0 truncate">{m.name}</span>
                  <span className="shrink-0 text-waka-700">UGX {m.revenue.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Link>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-black text-slate-900">{t(lang, "ownerDailySummaryTitle")}</h3>
          <button
            type="button"
            onClick={() => copyWa()}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white"
          >
            {t(lang, "ownerCopyWaSummary")}
          </button>
        </div>
        {waCopied ? <p className="mt-2 text-sm font-semibold text-waka-700">{t(lang, "ownerCopiedWa")}</p> : null}
        <ul className="mt-3 space-y-2 text-sm font-semibold text-slate-800">
          {summaryLines.map((line) => (
            <li key={line} className="flex gap-2 rounded-xl bg-white px-3 py-2">
              <span className="text-waka-600">●</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>
    </OwnerDashboardSection>
  );
}
