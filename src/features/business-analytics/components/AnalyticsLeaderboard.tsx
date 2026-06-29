import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import type { LeaderboardRow } from "../types";

type Props = {
  lang: Language;
  title: string;
  rows: LeaderboardRow[];
  emptyKey?: string;
};

export function AnalyticsLeaderboard({ lang, title, rows, emptyKey = "noSalesYet" }: Props) {
  return (
    <section className="min-w-0 max-w-full rounded-2xl border border-stone-200/90 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-black text-stone-950">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm font-medium text-stone-500">{t(lang, emptyKey)}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {rows.map((row, index) => (
            <li
              key={row.id}
              className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-xl bg-stone-50/80 px-3 py-2 sm:grid-cols-[1.75rem_minmax(0,1fr)_auto] sm:items-center"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-waka-100 text-xs font-black text-waka-800 sm:row-span-1">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="break-words text-sm font-bold leading-snug text-stone-900">{row.label}</p>
                {row.sub ? (
                  <p className="mt-0.5 text-[11px] font-medium leading-snug text-stone-500">{row.sub}</p>
                ) : null}
              </div>
              <p className="col-span-2 pl-[calc(1.75rem+0.75rem)] text-sm font-black tabular-nums text-stone-900 sm:col-span-1 sm:col-start-3 sm:pl-0 sm:text-right">
                {row.value}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function AnalyticsEmptyState({ lang, titleKey, bodyKey }: { lang: Language; titleKey: string; bodyKey: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-stone-200 bg-stone-50/60 px-6 py-12 text-center">
      <p className="text-base font-black text-stone-800">{t(lang, titleKey)}</p>
      <p className="mx-auto mt-2 max-w-sm text-sm font-medium text-stone-500">{t(lang, bodyKey)}</p>
    </div>
  );
}
