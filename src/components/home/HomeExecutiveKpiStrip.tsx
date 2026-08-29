import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Banknote,
  Package,
  PiggyBank,
  ShoppingCart,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Language } from "../../types";
import { t } from "../../lib/i18n";
import type { HomeExecutiveKpi, HomeExecutiveKpiId } from "../../lib/homeExecutiveKpis";
import { EnterpriseKpiCard } from "../enterprise/EnterpriseKpiCard";
import { Caption, SectionTitle } from "../enterprise/EnterpriseTypography";

const ICONS: Record<HomeExecutiveKpiId, LucideIcon> = {
  sales: TrendingUp,
  transactions: ShoppingCart,
  profit: PiggyBank,
  cash: Banknote,
  lowStock: Package,
  debts: Users,
};

type Props = {
  lang: Language;
  kpis: HomeExecutiveKpi[];
};

/** Phase 34.1 — compact KPI strip above the fold (EnterpriseKpiCard). */
export function HomeExecutiveKpiStrip({ lang, kpis }: Props) {
  const navigate = useNavigate();

  if (kpis.length === 0) return null;

  return (
    <section className="home-executive-kpi-strip mb-4 sm:mb-5" aria-label={t(lang, "homeExecutiveKpiTitle")}>
      <div className="mb-2 flex items-end justify-between gap-2">
        <div>
          <SectionTitle as="h2" className="!text-sm sm:!text-base">
            {t(lang, "homeExecutiveKpiTitle")}
          </SectionTitle>
          <Caption className="normal-case">{t(lang, "homeExecutiveKpiSub")}</Caption>
        </div>
      </div>
      <div className="grid auto-rows-min grid-cols-2 items-start gap-2 sm:gap-2.5 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <EnterpriseKpiCard
            key={kpi.id}
            icon={kpi.id === "lowStock" && kpi.tone === "danger" ? AlertTriangle : ICONS[kpi.id]}
            label={kpi.label}
            value={kpi.value}
            hint={kpi.hint}
            tone={kpi.tone}
            onClick={() => navigate(kpi.to)}
            className="min-h-[72px] shadow-sm"
          />
        ))}
      </div>
    </section>
  );
}
