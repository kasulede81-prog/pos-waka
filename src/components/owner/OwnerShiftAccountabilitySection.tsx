import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { ShiftAccountabilityRow } from "../../lib/ownerCommandCenter";
import { HistoryListCard } from "../shared/HistoryListCard";

type Props = {
  lang: Language;
  rows: ShiftAccountabilityRow[];
  periodLabel: string;
};

export function OwnerShiftAccountabilitySection({ lang, rows, periodLabel }: Props) {
  return (
    <HistoryListCard
      isEmpty={rows.length === 0}
      empty={<p className="text-sm font-semibold text-slate-500">{t(lang, "ownerShiftEmpty")}</p>}
    >
      <div className="border-b border-stone-100 px-4 py-3">
        <h2 className="text-base font-black text-slate-950">{t(lang, "ownerShiftTitle")}</h2>
        <p className="text-xs font-semibold text-slate-500">{periodLabel}</p>
      </div>
      <ul className="divide-y divide-stone-100">
        {rows.slice(0, 10).map((row) => (
          <li key={row.userId} className="px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-black text-slate-950">{row.label}</p>
                  {row.hasActiveShift ? (
                    <span className="rounded-full bg-waka-100 px-2 py-0.5 text-[10px] font-black uppercase text-waka-800">
                      {t(lang, "ownerShiftActive")}
                    </span>
                  ) : null}
                  {row.isRepeatOffender ? (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black uppercase text-rose-800">
                      {t(lang, "ownerShiftRepeat")}
                    </span>
                  ) : null}
                </div>
                {row.verifiedByLabel ? (
                  <p className="mt-0.5 text-xs font-semibold text-stone-500">
                    {t(lang, "ownerShiftVerifiedBy")}: {row.verifiedByLabel}
                  </p>
                ) : null}
              </div>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerShiftOpenVar")}</dt>
                <dd className="font-black tabular-nums text-stone-900">
                  {row.latestOpeningVarianceUgx != null
                    ? `UGX ${row.latestOpeningVarianceUgx.toLocaleString()}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerShiftCloseVar")}</dt>
                <dd
                  className={`font-black tabular-nums ${
                    row.latestClosingVarianceUgx != null && row.latestClosingVarianceUgx < 0
                      ? "text-rose-700"
                      : "text-stone-900"
                  }`}
                >
                  {row.latestClosingVarianceUgx != null
                    ? `UGX ${row.latestClosingVarianceUgx.toLocaleString()}`
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerShiftShortages")}</dt>
                <dd className="font-black text-stone-900">
                  {row.shortageCount} · UGX {row.cumulativeShortageUgx.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerShiftOverages")}</dt>
                <dd className="font-black text-stone-900">
                  {row.overageCount} · UGX {row.cumulativeOverageUgx.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerShiftLifetimeShortages")}</dt>
                <dd className="font-black text-stone-900">
                  {row.lifetimeShortageCount} · UGX {row.lifetimeShortageUgx.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-stone-500">{t(lang, "ownerShiftShortages30d")}</dt>
                <dd className="font-black text-stone-900">{row.shortageCount30d}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
      <div className="border-t border-stone-100 p-4">
        <Link
          to="/office/open-shifts"
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-2xl border-2 border-stone-200 bg-white px-4 text-sm font-black text-stone-900"
        >
          {t(lang, "ownerShiftViewAll")} →
        </Link>
      </div>
    </HistoryListCard>
  );
}
