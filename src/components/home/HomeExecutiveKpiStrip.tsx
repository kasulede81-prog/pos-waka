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
import { HomeLiveValue } from "./HomeLiveValue";

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
    <section className="home-executive-kpi-strip mb-2.5 sm:mb-3" aria-label={t(lang, "homeExecutiveKpiTitle")}>
      <div className="mb-1.5 flex items-end justify-between gap-2 sm:mb-2">
        <div>
          <SectionTitle as="h2" className="!text-sm sm:!text-base">
            {t(lang, "homeExecutiveKpiTitle")}
          </SectionTitle>
          <Caption className="normal-case">{t(lang, "homeExecutiveKpiSub")}</Caption>
        </div>
      </div>
      <div className="grid auto-rows-min grid-cols-2 items-start gap-1.5 sm:gap-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <EnterpriseKpiCard
            key={kpi.id}
            icon={kpi.id === "lowStock" && kpi.tone === "danger" ? AlertTriangle : ICONS[kpi.id]}
            label={kpi.label}
            value={<HomeLiveValue value={kpi.value} className="enterprise-kpi-value text-base font-black tabular-nums sm:text-lg" />}
            hint={kpi.hint}
            tone={kpi.tone}
            onClick={() => navigate(kpi.to)}
            className="home-kpi-card min-h-[68px] shadow-sm sm:min-h-[72px]"
          />
        ))}
      </div>
    </section>
  );
}
