import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import { auditCenterLinkFromFilter } from "../../lib/ownerRiskDashboard";
import type { OwnerStaffPerformanceRow } from "../../lib/ownerStaffMetrics";
import { OwnerDashboardSection } from "./OwnerDashboardSection";

type Props = {
  lang: Language;
  rows: OwnerStaffPerformanceRow[];
  todayKey: string;
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

export function OwnerStaffPerformanceSection({ lang, rows, todayKey }: Props) {
  return (
    <OwnerDashboardSection
      title={t(lang, "ownerSectionStaffPerformance")}
      subtitle={t(lang, "ownerCashierPerfHint")}
      badgeCount={rows.length}
      defaultOpen={rows.length > 0}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{t(lang, "noSalesYet")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-black uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-2">{t(lang, "ownerStaffColStaff")}</th>
                <th className="pb-2 pr-2">{t(lang, "ownerStaffColTrust")}</th>
                <th className="pb-2 pr-2 text-right">{t(lang, "ownerStaffColSales")}</th>
                <th className="pb-2 pr-2 text-right">{t(lang, "ownerStaffColReturns")}</th>
                <th className="pb-2 pr-2 text-right">{t(lang, "ownerStaffColVoids")}</th>
                <th className="pb-2 text-right">{t(lang, "ownerStaffColDiscounts")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 12).map((row) => (
                <tr key={row.userId} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 pr-2">
                    <Link
                      to={auditCenterLinkFromFilter({
                        dateFrom: todayKey,
                        dateTo: todayKey,
                        actorUserId: row.userId,
                      })}
                      className="inline-flex max-w-[140px] items-center gap-2 font-bold text-waka-800 underline-offset-2 hover:underline"
                    >
                      <span
                        className={`inline-block h-6 w-1 shrink-0 rounded-full ${trustBadgeClass(row.trustLevel)}`}
                        aria-hidden
                      />
                      <span className="truncate" title={row.userId}>
                        {row.label}
                      </span>
                    </Link>
                  </td>
                  <td className="py-2.5 pr-2">
                    <span className="font-black text-slate-900">{row.trustScore}</span>
                    <span className="ml-1 text-xs font-semibold text-slate-500">{trustLabel(lang, row.trustLevel)}</span>
                  </td>
                  <td className="py-2.5 pr-2 text-right font-semibold tabular-nums text-slate-800">
                    UGX {row.salesUgx.toLocaleString()}
                  </td>
                  <td className="py-2.5 pr-2 text-right font-semibold tabular-nums text-slate-700">{row.returns}</td>
                  <td className="py-2.5 pr-2 text-right font-semibold tabular-nums text-slate-700">{row.voids}</td>
                  <td className="py-2.5 text-right font-semibold tabular-nums text-slate-700">{row.discounts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Link
        to="/office/audit-center"
        className="mt-4 inline-flex min-h-[44px] items-center rounded-2xl border-2 border-violet-200 bg-violet-50 px-4 text-sm font-black text-violet-950"
      >
        {t(lang, "ownerStaffViewTimeline")} →
      </Link>
    </OwnerDashboardSection>
  );
}
