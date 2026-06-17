import { useState } from "react";
import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { OwnerDashboardStats } from "../../lib/ownerDashboardData";
import { HistoryListCard } from "../shared/HistoryListCard";

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
    <div className="space-y-4">
      <HistoryListCard>
        <div className="border-b border-stone-100 px-4 py-3">
          <h2 className="text-base font-black text-slate-950">{t(lang, "ownerSectionBusinessToday")}</h2>
          <p className="text-xs font-semibold text-slate-500">
            {pulseLabel} · {trendLine}
          </p>
        </div>
        <ul className="divide-y divide-stone-100">
          <li className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t(lang, "customers")}</p>
              <p className="mt-0.5 text-lg font-black text-slate-950">{customersCount}</p>
            </div>
            <Link to="/customers" className="text-xs font-black text-waka-700">
              {t(lang, "customers")} →
            </Link>
          </li>
          <li className="flex items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t(lang, "debtToday")}</p>
              <p className="mt-0.5 text-lg font-black text-amber-950">UGX {totalDebtUgx.toLocaleString()}</p>
              <p className="text-xs font-semibold text-slate-500">
                {t(lang, "debtToday")}: UGX {stats.debtTodayUgx.toLocaleString()}
              </p>
            </div>
          </li>
        </ul>
      </HistoryListCard>

      <HistoryListCard
        isEmpty={topProducts.length === 0}
        empty={<p className="text-sm font-semibold text-slate-500">{t(lang, "noSalesYet")}</p>}
      >
        <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
          <h3 className="text-base font-black text-slate-950">{t(lang, "ownerSectionTopProducts")}</h3>
          <Link to="/reports" className="text-xs font-black text-waka-700">
            {t(lang, "salesHistoryViewSummary")} →
          </Link>
        </div>
        <ul className="divide-y divide-stone-100">
          {topProducts.map((m) => (
            <li key={m.name}>
              <Link
                to="/reports"
                className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-stone-50"
              >
                <span className="min-w-0 truncate text-sm font-semibold text-slate-900">{m.name}</span>
                <span className="shrink-0 text-sm font-black text-waka-700">UGX {m.revenue.toLocaleString()}</span>
              </Link>
            </li>
          ))}
        </ul>
      </HistoryListCard>

      <HistoryListCard>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-4 py-3">
          <h3 className="text-base font-black text-slate-950">{t(lang, "ownerDailySummaryTitle")}</h3>
          <button
            type="button"
            onClick={() => copyWa()}
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-white"
          >
            {t(lang, "ownerCopyWaSummary")}
          </button>
        </div>
        <div className="p-4">
          {waCopied ? <p className="mb-3 text-sm font-semibold text-waka-700">{t(lang, "ownerCopiedWa")}</p> : null}
          <ul className="space-y-2 text-sm font-semibold text-slate-800">
            {summaryLines.map((line) => (
              <li key={line} className="flex gap-2 rounded-xl bg-stone-50 px-3 py-2">
                <span className="text-waka-600">●</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </HistoryListCard>
    </div>
  );
}
