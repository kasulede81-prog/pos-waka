import { TrendingUp, Wallet, ShoppingCart, Users, Percent, PiggyBank } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { KpiCardModel } from "../../lib/commandCenterPageView";
import { EnterpriseKpiCard } from "../enterprise/EnterpriseKpiCard";
import { Caption, MonoNumber, SectionTitle } from "../enterprise/EnterpriseTypography";
import { MiniSparkline } from "./MiniSparkline";

type Props = {
  lang: Language;
  cards: KpiCardModel[];
  periodLabel: string;
};

const KPI_ICONS: Record<string, LucideIcon> = {
  revenue: TrendingUp,
  profit: PiggyBank,
  transactions: ShoppingCart,
  avg: Percent,
  customers: Users,
  cash: Wallet,
};

export function CommandCenterKpiGrid({ lang, cards, periodLabel }: Props) {
  return (
    <section>
      <div className="mb-2 flex items-end justify-between gap-2">
        <div>
          <SectionTitle as="h2" className="!text-sm sm:!text-base">{t(lang, "cmdCenterOverviewTitle")}</SectionTitle>
          <Caption className="normal-case">{periodLabel}</Caption>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-3">
        {cards.map((card) => (
          <EnterpriseKpiCard
            key={card.id}
            icon={KPI_ICONS[card.id] ?? TrendingUp}
            label={t(lang, card.labelKey)}
            value={
              <div className="flex items-end justify-between gap-1">
                <MonoNumber className={card.valueClass ?? "text-base sm:text-lg"}>{card.value}</MonoNumber>
                <MiniSparkline points={card.sparkline} />
              </div>
            }
            hint={card.pctChange ? `${card.pctChange} ${t(lang, "cmdCenterVsYesterday")}` : undefined}
          />
        ))}
      </div>
    </section>
  );
}
