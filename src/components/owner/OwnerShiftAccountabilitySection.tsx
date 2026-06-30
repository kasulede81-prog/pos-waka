import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { StaffControlRow } from "../../lib/ownerCommandCenterBuilders";
import { HistoryListCard } from "../shared/HistoryListCard";

type Props = {
  lang: Language;
  rows: StaffControlRow[];
  periodLabel: string;
};

function riskBadge(lang: Language, tier: StaffControlRow["riskTier"], score: number): string {
  if (tier === "offender") return `${t(lang, "ownerStaffRiskOffender")} · ${score}`;
  if (tier === "review") return `${t(lang, "ownerStaffRiskReview")} · ${score}`;
  return `${t(lang, "ownerStaffRiskTrusted")} · ${score}`;
}

function riskClass(tier: StaffControlRow["riskTier"]): string {
  if (tier === "offender") return "bg-rose-100 text-rose-900";
  if (tier === "review") return "bg-amber-100 text-amber-900";
  return "bg-emerald-100 text-emerald-900";
}

export function OwnerShiftAccountabilitySection({ lang, rows, periodLabel }: Props) {
  const trusted = rows.filter((r) => r.riskTier === "trusted").slice(0, 3);
  const review = rows.filter((r) => r.riskTier === "review").slice(0, 3);
  const offenders = rows.filter((r) => r.riskTier === "offender").slice(0, 5);

  return (
    <HistoryListCard
      isEmpty={rows.length === 0}
      empty={<p className="text-sm font-semibold text-stone-500">{t(lang, "ownerShiftEmpty")}</p>}
    >
      <div className="border-b border-stone-100 px-3 py-2.5 sm:px-4 sm:py-3">
        <h2 className="text-sm font-black text-stone-950 sm:text-base">{t(lang, "ownerShiftTitle")}</h2>
        <p className="text-[11px] font-semibold text-stone-500">{periodLabel}</p>
      </div>

      {offenders.length > 0 ? (
        <div className="border-b border-stone-100 px-3 py-2 sm:px-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-rose-700">{t(lang, "ownerStaffRepeatOffenders")}</p>
          <ul className="mt-1 space-y-1">
            {offenders.map((row) => (
              <li key={row.userId} className="flex justify-between text-xs font-bold text-rose-950">
                <span>{row.label}</span>
                <span className="tabular-nums">UGX {row.cumulativeShortageUgx.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="divide-y divide-stone-100">
        {rows.slice(0, 8).map((row) => (
          <li key={row.userId} className="px-3 py-2.5 sm:px-4 sm:py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="font-black text-stone-950">{row.label}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${riskClass(row.riskTier)}`}>
                    {riskBadge(lang, row.riskTier, row.riskScore)}
                  </span>
                  {row.hasActiveShift ? (
                    <span className="rounded-full bg-waka-100 px-2 py-0.5 text-[10px] font-black uppercase text-waka-800">
                      {t(lang, "ownerShiftActive")}
                    </span>
                  ) : null}
                </div>
              </div>
              <p className="text-xs font-black tabular-nums text-stone-800">UGX {row.salesUgx.toLocaleString()}</p>
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 text-[11px] sm:grid-cols-4">
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerStaffDebtCollected")}</dt>
                <dd className="font-black tabular-nums">{row.debtCollectedUgx.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerStaffVoids")}</dt>
                <dd className="font-black">{row.voidCount}</dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerStaffReturns")}</dt>
                <dd className="font-black">{row.returnCount}</dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerStaffDiscounts")}</dt>
                <dd className="font-black">{row.discountCount}</dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerShiftShortages")}</dt>
                <dd className="font-black tabular-nums text-rose-700">{row.cumulativeShortageUgx.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerStaffFloatMismatch")}</dt>
                <dd className="font-black">{row.floatMismatchCount}</dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerStaffStockAdj")}</dt>
                <dd className="font-black">{row.stockAdjustCount}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      {trusted.length > 0 ? (
        <p className="border-t border-stone-100 px-3 py-2 text-[11px] font-semibold text-emerald-800 sm:px-4">
          {t(lang, "ownerStaffTopTrusted")}: {trusted.map((r) => r.label).join(", ")}
        </p>
      ) : null}
      {review.length > 0 ? (
        <p className="border-t border-stone-100 px-3 py-2 text-[11px] font-semibold text-amber-800 sm:px-4">
          {t(lang, "ownerStaffNeedsReview")}: {review.map((r) => r.label).join(", ")}
        </p>
      ) : null}

      <div className="border-t border-stone-100 p-3 sm:p-4">
        <Link
          to="/office/open-shifts"
          className="inline-flex min-h-[40px] w-full items-center justify-center rounded-xl border border-stone-200 bg-white px-4 text-xs font-black text-stone-900 sm:text-sm"
        >
          {t(lang, "ownerShiftViewAll")} →
        </Link>
      </div>
    </HistoryListCard>
  );
}
