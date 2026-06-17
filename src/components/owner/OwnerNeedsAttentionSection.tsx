import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import {
  auditCenterLinkFromFilter,
  ownerRiskCardTitle,
  type OwnerRiskCard,
} from "../../lib/ownerRiskDashboard";
import { formatDateFilterChipDay } from "../../lib/dateFilterLabels";
import { HistoryListCard } from "../shared/HistoryListCard";

type Props = {
  lang: Language;
  cards: OwnerRiskCard[];
  todayKey: string;
};

export function OwnerNeedsAttentionSection({ lang, cards, todayKey }: Props) {
  const timeLabel = formatDateFilterChipDay(todayKey, lang);
  const badgeCount = cards.reduce((sum, c) => sum + c.count, 0);

  return (
    <HistoryListCard
      isEmpty={cards.length === 0}
      empty={
        <p className="text-sm font-semibold text-emerald-900">{t(lang, "ownerRiskNone")}</p>
      }
    >
      <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-black text-slate-950">{t(lang, "ownerNeedsAttentionTitle")}</h2>
          <p className="text-xs font-semibold text-slate-500">
            {tTemplate(lang, "ownerRiskTimeRangeToday", { label: timeLabel })}
          </p>
        </div>
        {badgeCount > 0 ? (
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-black text-amber-950">{badgeCount}</span>
        ) : null}
      </div>
      <ul className="divide-y divide-stone-100">
        {cards.map((card) => (
          <li key={card.kind}>
            <Link
              to={auditCenterLinkFromFilter(card.auditFilter)}
              className="flex min-h-[72px] items-center gap-3 px-4 py-3 transition-colors hover:bg-amber-50/50 active:bg-amber-50"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black text-slate-950">{ownerRiskCardTitle(lang, card.kind)}</p>
                {card.impactUgx > 0 ? (
                  <p className="mt-0.5 text-xs font-bold text-rose-700">
                    {tTemplate(lang, "ownerRiskImpact", { amount: card.impactUgx.toLocaleString() })}
                  </p>
                ) : null}
                {card.staffLabels.length > 0 ? (
                  <p className="mt-0.5 line-clamp-1 text-xs font-semibold text-slate-500">
                    {tTemplate(lang, "ownerRiskStaff", { names: card.staffLabels.join(", ") })}
                  </p>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-2xl font-black tabular-nums text-slate-900">{card.count}</p>
                <p className="text-[10px] font-black uppercase tracking-wide text-waka-700">{t(lang, "ownerRiskInvestigate")}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </HistoryListCard>
  );
}
