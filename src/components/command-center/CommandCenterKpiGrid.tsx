import clsx from "clsx";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { KpiCardModel } from "../../lib/commandCenterPageView";
import { MiniSparkline } from "./MiniSparkline";

type Props = {
  lang: Language;
  cards: KpiCardModel[];
  periodLabel: string;
};

export function CommandCenterKpiGrid({ lang, cards, periodLabel }: Props) {
  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-black text-foreground sm:text-base">{t(lang, "cmdCenterOverviewTitle")}</h2>
          <p className="text-[11px] font-semibold text-muted-foreground">{periodLabel}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-3">
        {cards.map((card) => (
          <div
            key={card.id}
            className="flex min-h-[96px] flex-col justify-between rounded-2xl border border-border/90 bg-card p-2.5 shadow-sm"
          >
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{t(lang, card.labelKey)}</p>
            <p className={clsx("truncate text-base font-black tabular-nums sm:text-lg", card.valueClass ?? "text-foreground")}>
              {card.value}
            </p>
            <div className="mt-1 flex items-end justify-between gap-1">
              {card.pctChange ? (
                <span className="text-[10px] font-bold text-teal-700">{card.pctChange} {t(lang, "cmdCenterVsYesterday")}</span>
              ) : (
                <span className="text-[10px] font-semibold text-muted-foreground">&nbsp;</span>
              )}
              <MiniSparkline points={card.sparkline} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
