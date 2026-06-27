import { ChevronRight } from "lucide-react";
import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { ProfitCategoryGroup } from "../../lib/homeProfit";
import { formatShortUgx, shelfContributionPct } from "../../lib/profitPageView";
import { shelfIconFor } from "../../lib/productCategories";

const MEDALS = ["🥇", "🥈", "🥉"] as const;

type Props = {
  lang: Language;
  groups: ProfitCategoryGroup[];
  totalProfitUgx: number;
  onShelfClick?: (shelfLabel: string) => void;
};

export function ProfitShelfRanking({ lang, groups, totalProfitUgx, onShelfClick }: Props) {
  if (groups.length === 0) return null;

  return (
    <section className="rounded-2xl border border-stone-200/90 bg-white shadow-sm">
      <div className="border-b border-stone-100 px-3 py-2.5">
        <h3 className="text-xs font-black text-stone-800">{t(lang, "profitShelfPerformance")}</h3>
      </div>
      <ul className="divide-y divide-stone-100">
        {groups.map((g, index) => {
          const pct = shelfContributionPct(g.profitUgx, totalProfitUgx);
          const icon = shelfIconFor(g.categoryLabel) ?? "📦";
          const medal = index < 3 ? MEDALS[index] : null;
          return (
            <li key={g.categoryKey}>
              <button
                type="button"
                onClick={() => onShelfClick?.(g.categoryLabel)}
                className="flex w-full min-h-[52px] items-center gap-2.5 px-3 py-2.5 text-left active:bg-stone-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-base">
                  {medal ?? icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-black text-stone-950">{g.categoryLabel}</p>
                  <p className="text-[10px] font-medium text-stone-500">
                    {g.products.length} {t(lang, "profitShelfProducts")}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={clsx("text-sm font-black tabular-nums", g.profitUgx >= 0 ? "text-teal-800" : "text-rose-700")}>
                    {formatShortUgx(g.profitUgx)}
                  </p>
                  <p className="text-[10px] font-bold text-stone-500">{pct.toFixed(0)}%</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-stone-400" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
