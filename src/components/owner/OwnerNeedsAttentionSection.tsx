import { Link } from "react-router-dom";
import type { Language } from "../../types";
import { t, tTemplate } from "../../lib/i18n";
import {
  auditCenterLinkFromFilter,
  ownerRiskCardTitle,
  type OwnerRiskCard,
} from "../../lib/ownerRiskDashboard";
import { formatDateFilterChipDay } from "../../lib/dateFilterLabels";
import { OwnerDashboardSection } from "./OwnerDashboardSection";

type Props = {
  lang: Language;
  cards: OwnerRiskCard[];
  todayKey: string;
};

export function OwnerNeedsAttentionSection({ lang, cards, todayKey }: Props) {
  const timeLabel = formatDateFilterChipDay(todayKey, lang);
  const badgeCount = cards.reduce((sum, c) => sum + c.count, 0);

  return (
    <OwnerDashboardSection
      title={t(lang, "ownerNeedsAttentionTitle")}
      subtitle={tTemplate(lang, "ownerRiskTimeRangeToday", { label: timeLabel })}
      badgeCount={badgeCount}
      defaultOpen
      className="border-amber-200/90 bg-gradient-to-br from-amber-50 via-white to-rose-50/40"
    >
      {cards.length === 0 ? (
        <p className="rounded-2xl border border-emerald-100 bg-emerald-50/80 px-4 py-3 text-sm font-semibold text-emerald-900">
          {t(lang, "ownerRiskNone")}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((card) => (
            <Link
              key={card.kind}
              to={auditCenterLinkFromFilter(card.auditFilter)}
              className="flex min-h-[120px] flex-col rounded-2xl border border-white bg-white/90 p-4 shadow-sm ring-1 ring-slate-100/80 transition-colors hover:border-waka-200 hover:bg-waka-50/30 active:scale-[0.99]"
            >
              <p className="text-xs font-black uppercase tracking-wide text-amber-900">
                {ownerRiskCardTitle(lang, card.kind)}
              </p>
              <p className="mt-2 text-3xl font-black tabular-nums text-slate-900">{card.count}</p>
              {card.impactUgx > 0 ? (
                <p className="mt-1 text-sm font-bold text-rose-800">
                  {tTemplate(lang, "ownerRiskImpact", { amount: card.impactUgx.toLocaleString() })}
                </p>
              ) : null}
              {card.staffLabels.length > 0 ? (
                <p className="mt-2 line-clamp-2 text-xs font-semibold text-slate-600">
                  {tTemplate(lang, "ownerRiskStaff", { names: card.staffLabels.join(", ") })}
                </p>
              ) : null}
              <p className="mt-auto pt-3 text-xs font-black text-waka-700">{t(lang, "ownerRiskInvestigate")} →</p>
            </Link>
          ))}
        </div>
      )}
    </OwnerDashboardSection>
  );
}
