import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { DraftCartStats } from "../../lib/draftCart";

type Props = {
  lang: Language;
  stats: DraftCartStats;
  compact?: boolean;
};

export function DraftCartSummary({ lang, stats, compact }: Props) {
  const unitShown =
    Number.isInteger(stats.unitCount) ? String(stats.unitCount) : stats.unitCount.toFixed(2).replace(/\.?0+$/, "");

  if (compact) {
    return (
      <p className="text-xs font-bold text-stone-600">
        {t(lang, "posCartProducts").replace("{{count}}", String(stats.productCount))}
        {" · "}
        {t(lang, "posCartUnits").replace("{{count}}", unitShown)}
      </p>
    );
  }

  return (
    <div className="rounded-2xl border border-waka-200 bg-waka-50/80 p-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{t(lang, "posCartProductsShort")}</p>
          <p className="text-2xl font-black tabular-nums text-slate-900">{stats.productCount}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{t(lang, "posCartUnitsShort")}</p>
          <p className="text-2xl font-black tabular-nums text-slate-900">{unitShown}</p>
        </div>
        <div>
          <p className="text-[10px] font-black uppercase tracking-wide text-stone-500">{t(lang, "totalLabel")}</p>
          <p className="text-lg font-black tabular-nums text-waka-700">UGX {stats.totalUgx.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}
