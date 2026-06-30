import clsx from "clsx";
import type { Language } from "../../../types";
import { t } from "../../../lib/i18n";
import { KPI_VALUE_CLASS } from "../../../lib/desktopLayout";
import { MiniSparkline } from "../../../components/command-center/MiniSparkline";
import type { AnalyticsKpiCard, AnalyticsKpiId } from "../types";

type Props = {
  lang: Language;
  cards: AnalyticsKpiCard[];
  activeId: AnalyticsKpiId | null;
  compareLabel: string | null;
  onSelect: (id: AnalyticsKpiId) => void;
};

export function AnalyticsKpiGrid({ lang, cards, activeId, compareLabel, onSelect }: Props) {
  return (
    <section className="min-w-0 max-w-full">
      <div className="mb-2 flex items-end justify-between gap-2 px-0.5">
        <div>
          <h2 className="text-sm font-black text-stone-950">{t(lang, "baSnapshotTitle")}</h2>
          {compareLabel ? <p className="text-[11px] font-semibold text-stone-500">{compareLabel}</p> : null}
        </div>
      </div>
      <div className="w-full min-w-0 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] sm:overflow-visible">
      <div className="-mx-0.5 grid w-max min-w-full grid-flow-col auto-cols-[minmax(140px,1fr)] gap-2 sm:w-full sm:grid-flow-row sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const active = activeId === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onSelect(card.id)}
              className={clsx(
                "flex min-h-[108px] flex-col justify-between rounded-2xl border p-3 text-left shadow-sm transition-all active:scale-[0.98]",
                active
                  ? "border-waka-400 bg-gradient-to-br from-waka-50 to-waka-50/70 ring-2 ring-waka-200"
                  : "border-stone-200/90 bg-white/90 backdrop-blur-sm hover:border-stone-300",
              )}
            >
              <p className="text-[10px] font-bold uppercase tracking-wide text-stone-500">{t(lang, card.labelKey)}</p>
              <p className={clsx("truncate text-lg font-black sm:text-xl", KPI_VALUE_CLASS, card.valueClass ?? "text-stone-950")}>
                {card.value}
              </p>
              <div className="mt-1 flex items-end justify-between gap-1">
                {card.pctChange ? (
                  <span className="text-[10px] font-bold text-teal-700">
                    {card.pctChange} {t(lang, "baVsPriorPeriod")}
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold text-stone-400">&nbsp;</span>
                )}
                <MiniSparkline points={card.sparkline} strokeClass={active ? "stroke-waka-600" : "stroke-stone-400"} />
              </div>
            </button>
          );
        })}
      </div>
      </div>
    </section>
  );
}
