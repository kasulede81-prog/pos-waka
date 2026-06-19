import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { auditCenterLinkFromFilter } from "../../lib/ownerRiskDashboard";
import type { OwnerStaffPerformanceRow } from "../../lib/ownerStaffMetrics";
import { HistoryListCard } from "../shared/HistoryListCard";

type Props = {
  lang: Language;
  rows: OwnerStaffPerformanceRow[];
  periodFromKey: string;
  periodToKey: string;
};

function trustBadgeClass(level: OwnerStaffPerformanceRow["trustLevel"]): string {
  if (level === "good") return "bg-waka-500";
  if (level === "warning") return "bg-amber-400";
  return "bg-rose-500";
}

function trustLabel(lang: Language, level: OwnerStaffPerformanceRow["trustLevel"]): string {
  if (level === "good") return t(lang, "trustGood");
  if (level === "warning") return t(lang, "trustWarning");
  return t(lang, "trustRisky");
}

export function OwnerStaffPerformanceSection({ lang, rows, periodFromKey, periodToKey }: Props) {
  return (
    <HistoryListCard
      isEmpty={rows.length === 0}
      empty={<p className="text-sm font-semibold text-slate-500">{t(lang, "noSalesYet")}</p>}
    >
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
        <div>
          <h2 className="text-base font-black text-slate-950">{t(lang, "ownerSectionStaffPerformance")}</h2>
          <p className="text-xs font-semibold text-slate-500">{t(lang, "ownerCashierPerfHint")}</p>
        </div>
        <span className="text-xs font-bold text-slate-500">{rows.length}</span>
      </div>
      <ul className="divide-y divide-stone-100">
        {rows.slice(0, 12).map((row) => (
          <li key={row.userId}>
            <Link
              to={auditCenterLinkFromFilter({
                dateFrom: periodFromKey,
                dateTo: periodToKey,
                actorUserId: row.userId,
              })}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-stone-50"
            >
              <div className="flex min-w-[8rem] flex-1 items-center gap-2">
                <span
                  className={`inline-block h-6 w-1 shrink-0 rounded-full ${trustBadgeClass(row.trustLevel)}`}
                  aria-hidden
                />
                <span className="truncate font-bold text-slate-900" title={row.userId}>
                  {row.label}
                </span>
              </div>
              <div className="text-xs font-semibold text-slate-600">
                <span className="font-black text-slate-900">{row.trustScore}</span> {trustLabel(lang, row.trustLevel)}
              </div>
              <div className="ml-auto text-right text-sm font-black tabular-nums text-waka-800">
                UGX {row.salesUgx.toLocaleString()}
              </div>
              <div className="flex w-full gap-3 text-[11px] font-semibold text-slate-500 sm:w-auto sm:ml-0">
                <span>
                  {t(lang, "ownerStaffColReturns")}: {row.returns}
                </span>
                <span>
                  {t(lang, "ownerStaffColVoids")}: {row.voids}
                </span>
                <span>
                  {t(lang, "ownerStaffColDiscounts")}: {row.discounts}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <div className="border-t border-stone-100 p-4">
        <Link
          to="/office/audit-center"
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl border-2 border-violet-200 bg-violet-50 px-4 text-sm font-black text-violet-950"
        >
          {t(lang, "ownerStaffViewTimeline")} →
        </Link>
      </div>
    </HistoryListCard>
  );
}
